# Wallet Login (Identity v3): RainbowKit + SIWE replaces the Circle email/PIN gate

**Date:** 2026-07-03
**Status:** Approved (brainstormed with Kenny; decisions his)

## Why

The Circle user-controlled email/PIN login failed in production with no diagnosable error
(the SDK's OTP verify fails closed; feedback.md entries 2026-07-03), and its modal UI can't
be themed to match the app. More fundamentally: every renter must hold testnet USDC to use
the marketplace, so a wallet-less email user can't get past the next step anyway. Wallet
sign-in matches the actual audience. Decision: replace, not repair (same posture as the
passkey retirement).

The identity contracts C1–C5 (spec 2026-06-29) are unchanged. The wallet address remains the
permanent identity anchor; only the mechanism swaps — which is exactly what C5 was for.

## Decisions (user-made, don't re-litigate)

- **Stack: wagmi + RainbowKit** for connect (multi-wallet modal, WalletConnect for mobile).
- **Login proof: SIWE (EIP-4361)** signed after connect, verified server-side with viem's
  `verifySiweMessage`. Not RainbowKit's authentication adapter (too opaque), not a custom
  challenge string (nonstandard for no gain).
- **The Circle user-controlled login path is ripped out entirely.** No fallback, no flag.
  Old email-provisioned profiles stay as DB rows nobody can log into (testnet fresh start).

## Login flow

1. **Connect** — RainbowKit `ConnectButton` on `/onboarding`. wagmi is configured with a
   custom Arc testnet chain (`defineChain`, id 5042002, Canteen `VITE_ARC_RPC_URL` transport,
   USDC at `VITE_`-exposed address). Wallets without Arc get `wallet_addEthereumChain` via
   wagmi's switch-chain machinery.
2. **Prove ownership** — on connect, the page requests a SIWE signature. The SIWE `nonce` is
   the stateless HMAC nonce from Phase 0 (server-issued, bound to the address, time-boxed
   ~5 min, keyed by `AUTH_NONCE_SECRET`). No nonce table.
3. **Bridge** — server fn verifies the SIWE message (signature, address match, domain, chain
   id, nonce validity, expiry) and calls the existing `mintSessionForWallet({ address,
   walletId: address })`. Profile creation stays with the `handle_new_user` DB trigger.
   `supabaseBrowser.auth.setSession(...)` completes the app session.

Sessions, guards, `require-user`, RLS, rents, the spend wallet: all untouched. They only see
the Supabase session and `wallet_address`.

Onboarding ladder copy: **Connect wallet → Prove ownership → Authenticated.**

## Funding UX (WalletSheet)

The connected wallet replaces the Circle treasury wallet as the *funding source*. The
server-custodied spend EOA remains the Gateway payer — hard constraint, Gateway requires a
raw-key signer.

- "Fund spend wallet": amount input → wagmi `writeContract` USDC `transfer(spendAddress,
  amount)` from the connected wallet → wallet confirm → tx hash displayed. Spend address +
  copy button stay for manual/mobile funding.
- Balance chip: connected wallet's USDC read via wagmi hooks (replaces `getTreasuryBalance`).
- Withdraw flow unchanged (server signs from the spend wallet).

## File plan

New / changed:
- `src/lib/wallet-connect/config.ts` — wagmi config, Arc `defineChain`, RainbowKit setup,
  `WalletProviders` wrapper mounted client-only at the root route (SSR-safe).
- `src/lib/auth/siwe.ts` — pure core: HMAC nonce mint/verify (resurrect Phase-0 `nonce.ts`
  from git history, commit dce6429), SIWE message rules (domain, chain id, TTL). Unit-tested.
- `src/lib/auth/siwe-fns.ts` — server fns `getLoginNonce(address)` and
  `completeSiweLogin({ message, signature })` → `mintSessionForWallet`.
- `src/routes/onboarding.tsx` — ConnectButton + auto-trigger sign-in, 3-step ladder, real
  error messages.
- `src/components/site/WalletSheet.tsx` — funding step as above.

Deleted:
- `src/lib/circle/user-sdk.ts`, `src/lib/auth/circle-fns.ts`, `src/lib/auth/circle-bridge.ts`
  (+ its test), `@circle-fin/w3s-pw-web-sdk` from package.json.
- `clientOnlyNodePolyfills` and `vite-plugin-node-polyfills` from `vite.config.ts` — the
  Circle Web SDK was the only reason they existed. `ssr.noExternal` stays (other services
  deps still pull the axios chain into SSR).
- `treasuryTransferChallenge` / `getTreasuryBalance` server fns.
- `services/src/wallet/circle-user.ts` (`CircleUserGate`) goes too **iff** nothing but the
  web login imports it after a full-tree sweep; the dev-controlled custody side
  (`circle.ts`, agents, worker) is unrelated and stays.

Terminology sweep: grep the whole tree (`src/`, `services/`, docs, .env.example, README) for
every form of the retired flow (user-sdk, circle-fns, userToken, OTP, PIN copy, challenge,
VITE_CIRCLE_APP_ID) before calling removal done.

## Error handling

Every failure surfaces its real message (lesson of the "sign-in failed" outage):
- User rejects the signature → "signature request declined — try again".
- Wrong chain → RainbowKit's switch-chain prompt.
- Nonce expired → transparently re-request once, then surface it.
- `verifySiweMessage` fails → explicit message naming the recovered address.
- Server fns throw real `Error`s; the onboarding catch stringifies non-Error throws instead
  of collapsing to a generic label.

## Testing

- Unit: `siwe.ts` nonce round-trip / expiry / tamper, message rule validation; bridge fn with
  an injected verifier stub (valid → mint called with lower-cased address; invalid → throw).
- Not unit-tested: RainbowKit/wagmi internals (library's job).
- Gates: app test suite, tsc, `bun run build`, SSR smoke, client bundle has zero polyfill
  references and shrinks.
- Browser handoff to Kenny: real-wallet click-through (connect, add Arc chain, sign, fund) —
  wallet extensions can't be driven headless.

## Env

- Uses existing `AUTH_NONCE_SECRET` (still in root .env from Phase 0) and `VITE_ARC_*` vars.
- New: `VITE_WALLETCONNECT_PROJECT_ID` (RainbowKit requires one for WalletConnect; free from
  cloud.reown.com — Kenny provides). Injected-only wallets work without it in dev.
- Retired from use by the web login: `VITE_CIRCLE_APP_ID` (agents/custody env untouched).
- Vercel env must gain the new var; nothing else changes in deploy.

## Out of scope

Provider self-onboarding, real compute, funding the spend wallet automatically on rent
(stays manual), migrating old email-provisioned profiles, mobile-specific UX beyond what
RainbowKit gives for free.
