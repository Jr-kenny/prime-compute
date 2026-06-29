# Phase 0 Capability Spike — Findings & Decisions

**Date:** 2026-06-29. Spike mandated by
[`2026-06-29-phase0-identity-and-provisioning-design.md`](2026-06-29-phase0-identity-and-provisioning-design.md)
("Capability spike comes first"). This resolves the four open items so the build plan can be
written from real capabilities instead of guesses. It chooses mechanisms only; it does not
change the Phase 0 contracts (C1–C5).

---

## What Circle Modular Wallets actually provide

- A wallet is a **passkey-controlled smart-contract account (MSCA)**, created in two steps:
  `toWebAuthnCredential(WebAuthnMode.Register)` captures a WebAuthn P-256 credential bound to the
  domain, then `toCircleSmartAccount(...)` creates the smart account with that passkey as owner.
  Login restores the credential via `toWebAuthnCredential(WebAuthnMode.Login)`.
- A created wallet exposes a **smart-account address** and a **Circle wallet id**.
- Arbitrary-message signing is **ERC-1271** (the passkey signs; verification is the smart
  account's `isValidSignature`), not a raw EOA ECDSA signature.
- Accounts are **counterfactual / lazily deployed**: the address is known immediately, but the
  contract isn't deployed until the first outbound user operation. So at signup the account is
  not yet on-chain.
- The SDK persists the P256 credential client-side (e.g. httpOnly cookie) and restores it on
  reload. That is a *wallet-level* credential session, not an application session.

**Source:** Circle's own `use-modular-wallets` skill and Modular Wallets Web SDK docs.

## What Supabase provides

- **`signInWithWeb3` is EOA-only.** It implements EIP-4361 (Sign-In with Ethereum) and verifies
  an off-chain ECDSA (secp256k1) signature. The docs make no mention of smart-contract wallets
  (ERC-1271/ERC-6492) or passkey/WebAuthn signatures. A Circle MSCA signs via ERC-1271 with a
  P-256 passkey, so **the native Web3 path cannot verify a Circle wallet signature.** We do not
  rely on it.
- **Server-side session minting without hand-rolling JWTs:** the supported pattern is the admin
  API `auth.admin.generateLink({ type: 'magiclink', ... })` to obtain a one-time token, then
  `auth.verifyOtp(...)` to exchange it for a **real Supabase session** (access + refresh tokens).
  Supabase owns session lifetime and refresh; we do not mint or rotate tokens ourselves. (A
  first-class "admin create session" call does not exist yet; this is the documented bridge.)
- **Atomic profile creation:** a Postgres trigger on `auth.users` insert (the standard
  `handle_new_user` pattern) creates the `profiles` row in the same transaction as the auth user.
  Passing the wallet in `user_metadata` at user-creation time lets the trigger populate
  `wallet_address`/`wallet_id`, so a user can never exist without its profile (satisfies C4).

**Sources:** Supabase Web3 auth guide, Custom Access Token Hook / sessions / JWT docs.

---

## Decisions (the four open items)

1. **Circle's auth primitive.** Use the SDK's passkey register/login plus a smart-account
   signature over a backend-issued nonce as the proof of control. We do **not** depend on
   Circle's hosted RP/passkey-server as our app auth; the backend verifies the signature itself.

2. **Supabase session path = custom bridge, real sessions.** The backend verifies the wallet's
   ERC-1271 signature over its nonce, then mints a real Supabase session via admin
   `generateLink` + `verifyOtp`. No native `signInWithWeb3`, no hand-rolled JWT, no custom
   refresh logic. Because Circle accounts are counterfactual, signature verification must handle
   the **undeployed** case: verify with a viem public client (`verifyMessage`/`verifyHash`, which
   covers ERC-6492-wrapped signatures for counterfactual accounts and ERC-1271 once deployed).
   The exact Circle-signature → viem-verify round-trip is the one integration detail the build
   pins with a test.

3. **Atomic provisioning mechanism = `handle_new_user` trigger.** Create the auth user via admin
   with `user_metadata = { wallet_address, wallet_id }`; a `SECURITY DEFINER` trigger on
   `auth.users` inserts the matching `profiles` row in the same transaction. No half-identities.

4. **Keep `wallet_id`.** Circle exposes it as the account's handle and later phases that operate
   the wallet (sponsored user operations, balances) will likely need it, not just the address.
   It is cheap to store at creation time and not worth a follow-up migration to add later. The
   address remains the canonical identity anchor; `wallet_id` is operational metadata.

---

## Resulting bridge shape (for the build plan)

```
Client (browser)
  1. toWebAuthnCredential(Register|Login) + toCircleSmartAccount  -> { address, walletId }
  2. GET  /auth/nonce                                             -> { nonce }
  3. account.signMessage(nonce)                                   -> signature (ERC-1271/6492)
  4. POST /auth/verify { address, walletId, nonce, signature }

Backend (services-side endpoint)
  5. validate the nonce it issued (single-use, short TTL)
  6. verify signature for `address` with a viem public client (handles counterfactual)
  7. find-or-create the Supabase auth user keyed by wallet_address
     (admin.createUser with user_metadata.wallet_address/_id on first sight;
      handle_new_user trigger writes the profile row atomically)
  8. admin.generateLink(magiclink) + verifyOtp  -> real Supabase session
  9. return the session to the client

Client
 10. set the Supabase session; user is Authenticated (Ready)
```

This honors every contract: wallet-backed sessions (C1), one wallet ↔ one user via the unique
`wallet_address` lookup (C2), each session tied to one provisioned identity (C3), atomic
profile creation via the trigger (C4), and the mechanism stays swappable behind the same
contracts (C5).

---

## What the build plan covers (next, via writing-plans)

- `profiles` table + immutability + RLS migration, and the `handle_new_user` trigger.
- The nonce issue/verify endpoints and the signature-verification step (with the viem
  round-trip pinned by a test against a real Circle-signed message).
- The session mint (`generateLink` + `verifyOtp`) and find-or-create-by-wallet.
- The client onboarding flow (Circle ceremony → verify → session → Ready), idempotent on reload.
- Contract tests for C1–C4 at the application boundary.

## Sources

- [Sign in with Web3 | Supabase Docs](https://supabase.com/docs/guides/auth/auth-web3)
- [Custom Access Token Hook | Supabase Docs](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
- [User sessions | Supabase Docs](https://supabase.com/docs/guides/auth/sessions)
- [Passkey | Circle Docs](https://developers.circle.com/wallets/modular/passkeys)
- [Modular Wallets Web SDK | Circle Docs](https://developers.circle.com/wallets/modular/web-sdk)
- [circlefin/skills — use-modular-wallets](https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-modular-wallets/SKILL.md)
