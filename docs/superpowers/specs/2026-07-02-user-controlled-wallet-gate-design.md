# User-Controlled Wallet Gate (Identity v2)

**Date:** 2026-07-02
**Status:** Approved design, awaiting capability probe + implementation plan
**Supersedes:** the Modular (passkey) wallet as the app's identity/treasury tier
(Phase 0 spec `2026-06-29-phase0-identity-and-provisioning-design.md` stays the contract
baseline; this changes the mechanism, not the contracts)

## Why

The passkey Modular wallet has been the consistent source of friction: domain-bound
credentials, the duplicate-username failure mode, opaque entity-config errors, and an
unmerged `feat/modular-on-arc` branch that needs ERC-4337 bundler/paymaster machinery
just to move USDC on Arc. It also can never be a payer in the streaming architecture
(no EIP-3009), so it was already reduced to login + treasury.

Circle **user-controlled wallets** fit that remaining role better (user decision
2026-07-02): custody at Circle, the user approves each action with a PIN challenge, and
the wallet signs ordinary transactions on Arc with no 4337 machinery. The wallet tiers
become:

- **Treasury / identity:** Circle user-controlled wallet (PIN per action)
- **Streaming float:** Circle developer-controlled wallet (continuous signer, built)
- **Agents:** developer-controlled (built)

Zero private keys in our database at every tier.

## Front door

Circle's own login via the user-controlled Web SDK, **email OTP first** (social
providers are an additive follow-up, no architectural change). Circle authenticates the
user and issues a `userToken`; the first login runs Circle's PIN setup and a
create-wallet challenge on Arc testnet. Returning logins are email OTP + PIN challenge.

Login is a human moment, so the PIN-challenge-per-action model that disqualified
user-controlled wallets from streaming (decision 2026-07-01) is exactly right here.

## Bridge to the app session

Mirrors the existing passkey bridge, with Circle's userToken replacing the signed nonce:

1. Client completes Circle login + challenges in the SDK; hands the backend the
   `userToken` (and Circle `userId`).
2. Backend verifies server-side against Circle's API with our API key: fetch the user
   and their Arc wallet for that `userToken`. A token Circle rejects is a failed login.
3. Find-or-create the Supabase user anchored on the **wallet address**
   (`profiles.wallet_address` stays the unique immutable identity anchor, so Phase 0's
   C1-C5 contracts survive unchanged). Store `circle_user_id` alongside on the profile.
4. Mint a real Supabase session via the existing `generateLink` + `verifyOtp` path.
   Session handling downstream of the bridge is untouched.

## Treasury actions

Funding the streaming (developer-controlled) spend wallet becomes an ordinary Circle
user-controlled **transfer transaction** with a PIN challenge: user enters amount,
approves the challenge, USDC moves user-controlled wallet -> spend wallet address on
Arc. Withdrawals to external addresses work the same way. This replaces the 4337
`fundSpendWallet` userOp path entirely; the `feat/modular-on-arc` branch is abandoned.

The WalletSheet keeps its current structure (two labelled wallets: treasury + spend,
balances, deposit, withdraw, fund-spend-wallet step); only the signing ceremony behind
the fund/withdraw buttons changes.

## Migration

Testnet fresh start. The passkey/Modular path is removed from onboarding (git history
keeps it); existing passkey-anchored profiles (the developer's own plus test rows) are
not migrated. The `profiles` table and its trigger/RLS machinery are reused as-is; the
only schema change is the nullable `circle_user_id` column.

## Gate zero: capability probe

Before any build (Circle product boundaries have bitten us repeatedly), a gated probe
must confirm on our actual Circle account:

1. User-controlled wallets can be created on **ARC-TESTNET** (SDK blockchain enum plus a
   live create).
2. The email-OTP login flow works with our API key / app configuration (user-controlled
   needs an App ID and its own console configuration, distinct from the
   developer-controlled entity-secret setup; find out whether one account carries both).
3. A PIN-challenged USDC transfer executes on Arc (including how gas is paid for
   user-controlled wallets there).
4. Server-side userToken verification: which API call proves a live token maps to a
   user + wallet.

Probe outcomes get locked into the implementation plan the way the signer probe locked
Phase 2's constants. Any FAIL stops and re-designs rather than working around.

## Testing

- Bridge unit tests with a stubbed Circle verification seam (valid token -> session
  mint path; rejected token -> failed login; new wallet -> profile created; existing
  wallet -> same user).
- `circle_user_id` persistence on the profile.
- Onboarding route renders the new ceremony; signed-in state unchanged.
- Live acceptance (handoff, needs a real browser + email): full register -> PIN ->
  wallet -> session, then a PIN-approved fund-spend-wallet transfer.

## Out of scope

- Social login providers (additive later).
- Migrating existing passkey identities.
- Any change to streaming/settlement (spend wallets, worker, adapters).
- Display-name-at-signup (separate small feature, still pending from earlier).
