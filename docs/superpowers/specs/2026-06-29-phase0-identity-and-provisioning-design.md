# Phase 0: Identity & Provisioning — Design

**Status:** approved (brainstormed 2026-06-29). Next: implementation plan via writing-plans.

**One-line contract:** Given a person who controls a Circle Modular Wallet, Prime Compute
produces an authenticated application session bound to a single provisioned user identity, in
which the wallet is the permanent identity anchor.

This is **Phase 0** of the product layer, the foundation the rest sits on. It comes before the
three downstream sub-projects already sketched: **A** live-data read path, **B** control bridge,
**C** Lumen conversational deploy. Each of those is its own spec → plan → build; this document
covers Phase 0 only.

---

## Why this phase, and why first

The real broker engine in `services/` is proven (soul-driven matching, autonomous migrate-on-
degrade, real USDC streaming on Arc), but the frontend (`src/`, TanStack Start / React / SSR /
Vite) still runs entirely on client-generated `src/lib/mock-data.ts` and has no concept of a
real user. Every `rent` already carries a `user_id`, and the whole product is the broker
spending a user's money, so a real authenticated user with a real wallet is the ground floor.

Building identity first buys a single, powerful invariant for every later phase: *the current
user always has a session and a wallet.* That deletes a whole class of null checks and
half-provisioned edge cases downstream.

---

## Identity model

Prime Compute is a wallet-centric product, so the wallet, not the auth provider, is the
canonical identity.

```
Prime User
  ├── Wallet            (Circle Modular Wallet — the permanent identity anchor)
  └── Auth session      (Supabase — replaceable)
```

**The wallet is the persistent identity anchor; the application session is replaceable.**
`wallet_address` is the canonical identifier. `auth.uid()` is today's session-provider key; it
is a convenient primary key only because Supabase owns auth right now. If the auth provider is
ever swapped, the wallet re-establishes the same Prime user and `auth.uid()` is remapped onto
it. We therefore resolve users **by wallet**, never by auth id, and `wallet_address` is unique,
not null, and immutable (a different wallet is a different user).

### Responsibilities

- **Circle** owns the cryptographic identity: the passkey, the Modular Wallet (a smart-contract
  account), and signing.
- **Supabase** owns the application session: JWT, `auth.uid()`, RLS.
- **The backend** is the bridge that turns provable control of a wallet into a Supabase session.
  Its exact shape is deliberately undesigned here (see "Capability spike comes first").

---

## The contracts (the spec's backbone)

Phase 0 is specified as invariants, not a procedure. The implementation is free to evolve as
long as these hold.

- **C1 — Wallet-backed sessions.** Every authenticated user has a wallet.
- **C2 — One wallet, one user.** Every wallet maps to exactly one application user.
  (`wallet_address` is unique, not null, immutable.)
- **C3 — Owned sessions.** Every session belongs to exactly one provisioned identity.
- **C4 — No half-identities.** No half-provisioned identity ever exists or is observable. A user
  is never persisted or seen without its profile.
- **C5 — Replaceable implementation.** The mechanism (how the wallet is created, how ownership
  is proven, how the session is minted, how provisioning is made atomic) may change freely as
  long as C1–C4 hold.

A spec written as contracts tends to survive SDK changes and backend migrations without a
rewrite. That is the point.

---

## Provisioning (outcome-level, idempotent)

The onboarding ladder, stated as outcomes rather than calls:

```
Anonymous
   ↓   Circle passkey + Modular Wallet ceremony (create, or re-open for a returning user)
Controls a wallet
   ↓   backend establishes provable control of that wallet
Verified wallet
   ↓   find-or-create the user keyed by wallet_address, atomically
Provisioned identity   (user + profile, together or not at all — C4)
   ↓   Supabase session issued
Authenticated user (Ready)
```

**Idempotent on every login.** A returning user resolves to the same identity (C2); a new user
is provisioned. The end state is always identical: `{ session, wallet, profile }`. Running this
on every login is safe and expected.

**Atomicity requirement (outcome, not mechanism).** Provisioning must be atomic from the
application's perspective: a user must never observe or persist a half-provisioned identity. The
implementation mechanism (Postgres trigger, transaction, Supabase auth hook, backend
orchestration, or whatever the spike surfaces) is chosen **after** the capability spike, not
assumed now.

---

## Data model

A single `profiles` table. The profile *is* the seed: nothing is provisioned beyond it.

| column         | notes                                                                       |
|----------------|-----------------------------------------------------------------------------|
| `id`           | primary key; references the auth user (`auth.users.id`) today               |
| `wallet_address` | unique, not null, immutable — the canonical identity anchor                |
| `wallet_id`    | Circle's wallet handle. **Candidate for removal** if the spike shows the address alone is enough to operate the wallet in later phases. |
| `display_name` | nullable                                                                    |
| `created_at`   | timestamp                                                                   |
| `updated_at`   | timestamp                                                                   |

**RLS:** a user may read and update only their own row (`auth.uid() = id`). Provisioning inserts
happen through the bridge.

**No other columns.** No preferences, no settings, no onboarding flags, no default workspace or
project, no balances, no feature flags, no sample data. Future phases create what they need when
they need it.

The registry's existing `rents.user_id` will reference this identity in a later phase; wiring
rents to it is **out of scope** here.

---

## Capability spike comes first

The bridge is intentionally **not designed in this document.** Designing ownership verification,
challenge signing, or session minting before confirming what the platforms already provide is
exactly the trap this phase avoids. The first implementation task is a spike whose output is a
short, documented inventory:

- What does Circle's auth/wallet flow actually give us today (wallet creation, and any
  built-in proof-of-control or session primitive)?
- What does Supabase provide today for turning a wallet into a session (native Web3 / SIWE
  sign-in and whether it accepts smart-contract / ERC-1271 signatures; Auth admin; auth hooks;
  custom-JWT)?
- Which mechanism gives atomic provisioning (C4)?
- Is `wallet_id` actually needed, or does `wallet_address` suffice?

Only after that inventory do we decide what the bridge does. Terms like ERC-1271, challenge
signing, and JWT minting are noted here only as things the spike must check for; none of them is
committed to as the design.

---

## Scope

**In:** Circle passkey + Modular Wallet creation; provable control of the wallet; minting a
Supabase session; the minimal `profiles` record with the wallet as its anchor; idempotent
re-login; sign-out; the "Ready" state where a person who reloads lands back in the same identity.

**Out (later phases):** funding the wallet with USDC; Paymaster / gasless spend configuration;
creating rents; the broker spending from a user's wallet; the live-data dashboard (sub-project
A); multi-device passkey enrollment and account recovery beyond what Circle provides natively.

---

## Error handling (outcome-level)

- Wallet ceremony cancelled or failed → no user created; clean retry from Anonymous.
- Wallet control not provable → no session and no partial record persisted.
- Provisioning fails partway → the atomicity guarantee (C4) means nothing is left behind.
- Returning user → resolves to the same identity by wallet (C2), never a duplicate.
- Session expiry / refresh → handled by Supabase's session machinery; the exact behavior is
  confirmed in the spike rather than hand-rolled.

---

## Testing

- **Contract tests** for C1–C4, written against the application boundary so they survive an
  implementation swap: a user cannot be created without a wallet (C1); the same wallet through
  the flow twice yields one user, not two (C2); a simulated mid-provision failure leaves no
  observable user or profile (C4).
- The spike's findings determine the concrete integration seams (which calls are real vs. faked
  offline); those are pinned in the implementation plan, not here.

---

## Open items the spike resolves

1. Circle's exact auth primitive and whether it already yields a verifiable proof of wallet
   control (or a session) we can lean on.
2. Supabase's exact session-mint path for a wallet identity (native Web3 sign-in with
   smart-account support, Auth admin + custom JWT, or auth hooks).
3. The atomic-provisioning mechanism that satisfies C4.
4. Whether `wallet_id` is needed or `wallet_address` alone suffices.
