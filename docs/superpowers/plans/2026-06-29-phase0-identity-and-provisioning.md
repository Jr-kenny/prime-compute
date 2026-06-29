# Phase 0: Identity & Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person can arrive anonymous, create a passkey-backed Circle Modular Wallet, and be returned an authenticated Supabase session bound to a provisioned profile, with the wallet as the permanent identity anchor, and reload back into the same identity.

**Architecture:** The wallet is the identity root (Circle), Supabase owns the session/RLS, and a TanStack Start server function is the bridge that verifies provable wallet control and mints a real Supabase session. The Circle passkey ceremony and signing happen in the browser; verification, find-or-create, and session minting happen server-side with the service-role key. Profile creation is atomic with auth-user creation via a Postgres trigger, so no half-identity can exist.

**Tech Stack:** TanStack Start (React/SSR/Vite) frontend in `src/`; Supabase (Postgres + Auth + RLS); Circle Modular Wallets Web SDK (`@circle-fin/modular-wallets-core`); viem for ERC-1271/6492 signature verification; `@supabase/supabase-js`. Pure server-side modules are tested with `bun test`; the DB layer is tested against the live Supabase project (ref `xwxuqcougmanzonypoym`) like the existing `services/` registry contract.

**Spec:** [`docs/superpowers/specs/2026-06-29-phase0-identity-and-provisioning-design.md`](../specs/2026-06-29-phase0-identity-and-provisioning-design.md) (contracts C1–C5). **Findings driving the mechanism:** [`docs/superpowers/specs/2026-06-29-phase0-capability-findings.md`](../specs/2026-06-29-phase0-capability-findings.md).

**Contracts this plan must honor:** C1 every authenticated user has a wallet; C2 one wallet ↔ one user (`wallet_address` unique, immutable); C3 each session belongs to one provisioned identity; C4 no half-provisioned identity ever exists; C5 mechanism stays swappable behind C1–C4.

**Branch:** `git checkout -b feat/phase0-identity`.

**Scope note:** In: passkey + wallet creation, ownership verification, session mint, the minimal profile, idempotent re-login, sign-out, the Ready state. Out (later phases): funding the wallet, gasless/Paymaster spend, rents, the broker spending from a user wallet, the live dashboard.

**External-SDK honesty:** Tasks 1–2 and the pure modules in 4–5 are exact and runnable. Tasks 6–8 integrate the Circle Web SDK and Supabase admin session mint; their exact call signatures are confirmed against the cited docs during execution, and each is gated by a concrete acceptance check rather than a fabricated unit test, because the SDKs are not yet in this repo.

---

## File Structure

**Created:**
- `services/supabase/migrations/0005_identity_profiles.sql` — profiles table, RLS, immutability + `handle_new_user` triggers.
- `services/src/identity/profiles.contract.test.ts` — live-DB contract test for C2, immutability, C4, RLS.
- `src/lib/supabase/server.ts` — service-role admin client (server only).
- `src/lib/supabase/client.ts` — browser anon client.
- `src/lib/auth/nonce.ts` — stateless signed login nonce (issue/verify).
- `src/lib/auth/nonce.test.ts`
- `src/lib/auth/verify-ownership.ts` — viem ERC-1271/6492 signature verification.
- `src/lib/auth/verify-ownership.test.ts`
- `src/lib/auth/bridge.ts` — server function: verify → find-or-create → mint session.
- `src/lib/circle/wallet.ts` — Circle passkey ceremony + signing (browser).
- `src/routes/onboarding.tsx` — the onboarding flow UI.
- `src/lib/auth/session.tsx` — current-user/session context + route guard.

**Modified:**
- `package.json` (frontend) — add `@supabase/supabase-js`, `@circle-fin/modular-wallets-core`, `viem`.
- `.env` files / env wiring — `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public), `SUPABASE_SERVICE_ROLE_KEY`, `CIRCLE_CLIENT_KEY`/`CIRCLE_APP_ID`, `ARC_RPC_URL`, `AUTH_NONCE_SECRET` (all secrets server-only).

---

## Task 1: Profiles schema, RLS, and atomic-provisioning trigger

The wallet-anchored user record, and the trigger that makes profile creation atomic with auth-user creation (C4).

**Files:**
- Create: `services/supabase/migrations/0005_identity_profiles.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 0 identity. The wallet is the permanent identity anchor; auth.users.id is today's
-- replaceable session-provider key. profiles is the only provisioned record (the profile IS
-- the seed: no preferences, flags, balances, or sample data).

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  wallet_address text not null unique,         -- C2: one wallet, one user. Canonical anchor.
  wallet_id text,                              -- Circle's account handle (operational metadata).
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- wallet_address is the identity: immutable once set (a different wallet is a different user).
create or replace function enforce_wallet_address_immutable()
returns trigger language plpgsql as $$
begin
  if new.wallet_address is distinct from old.wallet_address then
    raise exception 'wallet_address is immutable';
  end if;
  new.updated_at := now();
  return new;
end; $$;

create trigger profiles_wallet_address_immutable
  before update on profiles
  for each row execute function enforce_wallet_address_immutable();

-- C4: atomic provisioning. A profile is created in the same transaction as its auth user,
-- reading the wallet from the user metadata set at creation time. A user can therefore never
-- exist without a profile. wallet_address is normalized to lower-case so C2 holds case-insensitively.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, wallet_address, wallet_id)
  values (
    new.id,
    lower(new.raw_user_meta_data->>'wallet_address'),
    new.raw_user_meta_data->>'wallet_id'
  );
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- RLS: a user reads and updates only their own row.
alter table profiles enable row level security;

create policy profiles_select_own on profiles
  for select using (auth.uid() = id);

create policy profiles_update_own on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
```

- [ ] **Step 2: Apply the migration to the live Supabase project**

Apply `0005_identity_profiles.sql` to the PrimeBot project (ref `xwxuqcougmanzonypoym`) via the Supabase MCP `apply_migration` (name `0005_identity_profiles`) or the SQL editor. It is additive (new table + functions + triggers), no destructive change.

- [ ] **Step 3: Commit**

```bash
git add services/supabase/migrations/0005_identity_profiles.sql
git commit -m "feat(identity): profiles table + RLS + atomic-provisioning trigger (Phase 0)"
```

---

## Task 2: Contract test for C2, immutability, C4, RLS

Prove the contracts at the database boundary against the live project, mirroring the existing registry contract style.

**Files:**
- Create: `services/src/identity/profiles.contract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, beforeAll } from "bun:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const admin: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false } });

const T = 30_000;
const wallet = () => `0x${crypto.randomUUID().replace(/-/g, "")}`.slice(0, 42);

async function makeUser(walletAddress: string, walletId = "wid-1") {
  const email = `${walletAddress}@wallet.prime`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { wallet_address: walletAddress, wallet_id: walletId },
  });
  if (error) throw error;
  return data.user;
}

beforeAll(() => {
  if (!url || !serviceKey || !anonKey) throw new Error("set SUPABASE_URL/SERVICE_ROLE_KEY/ANON_KEY");
});

test("C4: creating an auth user provisions its profile atomically", async () => {
  const w = wallet();
  const user = await makeUser(w);
  const { data: profile } = await admin.from("profiles").select().eq("id", user.id).single();
  expect(profile?.wallet_address).toBe(w.toLowerCase());
  expect(profile?.wallet_id).toBe("wid-1");
  await admin.auth.admin.deleteUser(user.id);
}, T);

test("C2: a second user with the same wallet is rejected", async () => {
  const w = wallet();
  const a = await makeUser(w);
  // The duplicate's trigger insert must violate the unique constraint, so createUser fails.
  await expect(makeUser(w)).rejects.toBeDefined();
  await admin.auth.admin.deleteUser(a.id);
}, T);

test("immutability: wallet_address cannot be changed", async () => {
  const w = wallet();
  const user = await makeUser(w);
  const { error } = await admin.from("profiles").update({ wallet_address: wallet() }).eq("id", user.id);
  expect(error?.message ?? "").toContain("immutable");
  await admin.auth.admin.deleteUser(user.id);
}, T);

test("RLS: an anon client cannot read other users' profiles", async () => {
  const w = wallet();
  const user = await makeUser(w);
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data } = await anon.from("profiles").select().eq("id", user.id);
  expect(data ?? []).toHaveLength(0); // no session => RLS denies
  await admin.auth.admin.deleteUser(user.id);
}, T);
```

- [ ] **Step 2: Run it**

Run: `cd services && SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY bun test src/identity/profiles.contract.test.ts`
Expected: PASS (4 tests). If `SUPABASE_ANON_KEY` is not yet in `services/.env`, add it from the Supabase project's API settings first.

- [ ] **Step 3: Commit**

```bash
git add services/src/identity/profiles.contract.test.ts
git commit -m "test(identity): profiles contract — C2, immutability, C4, RLS"
```

---

## Task 3: Supabase clients + env wiring (frontend)

Two clients: a browser anon client and a server-only service-role client. Add the dependency and the env plumbing.

**Files:**
- Modify: `package.json` (add `@supabase/supabase-js`)
- Create: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`

- [ ] **Step 1: Add the dependency**

```bash
bun add @supabase/supabase-js
```

- [ ] **Step 2: Browser anon client**

Write `src/lib/supabase/client.ts`:

```ts
import { createClient } from "@supabase/supabase-js";

// Browser client: anon key only, safe to ship. RLS is the security boundary.
export const supabaseBrowser = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
);
```

- [ ] **Step 3: Server admin client**

Write `src/lib/supabase/server.ts`:

```ts
import { createClient } from "@supabase/supabase-js";

// Server-only client: service-role key. NEVER import this into a browser bundle. Used by the
// bridge server function for find-or-create and session minting.
export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required server-side");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
```

- [ ] **Step 4: Env wiring**

Add to the frontend env (`.env` / deployment env). Public (browser) values are prefixed `VITE_`; secrets are server-only and unprefixed so they never reach the bundle:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
ARC_RPC_URL=...
AUTH_NONCE_SECRET=...           # random 32+ byte secret
CIRCLE_CLIENT_KEY=...
CIRCLE_APP_ID=...
```

- [ ] **Step 5: Commit**

```bash
git add package.json src/lib/supabase/
git commit -m "feat(identity): Supabase browser + server clients and env wiring"
```

---

## Task 4: Wallet-ownership verification (viem, ERC-1271/6492)

Pure, testable server-side function that verifies a signature proves control of a (possibly counterfactual) smart-account address.

**Files:**
- Modify: `package.json` (add `viem`)
- Create: `src/lib/auth/verify-ownership.ts`, `src/lib/auth/verify-ownership.test.ts`

- [ ] **Step 1: Add viem**

```bash
bun add viem
```

- [ ] **Step 2: Write the failing test**

`verifyMessage` over a public client returns true for a valid EOA signature and false for a tampered one. (A real Circle counterfactual signature is exercised in the Task 7 acceptance; here we pin the verifier's contract with a deterministic EOA fixture, since viem routes EOA, ERC-1271, and ERC-6492 through the same `verifyMessage` call.)

Write `src/lib/auth/verify-ownership.test.ts`:

```ts
import { test, expect } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { verifyWalletOwnership } from "./verify-ownership";

test("accepts a valid signature over the message for the signing address", async () => {
  const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const message = "prime-nonce-abc";
  const signature = await account.signMessage({ message });
  expect(await verifyWalletOwnership({ address: account.address, message, signature })).toBe(true);
});

test("rejects a signature over a different message", async () => {
  const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const signature = await account.signMessage({ message: "other" });
  expect(await verifyWalletOwnership({ address: account.address, message: "prime-nonce-abc", signature })).toBe(false);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test src/lib/auth/verify-ownership.test.ts`
Expected: FAIL — `Cannot find module "./verify-ownership"`.

- [ ] **Step 4: Implement**

Write `src/lib/auth/verify-ownership.ts`:

```ts
import { createPublicClient, http, type Address, type Hex } from "viem";

// viem's verifyMessage transparently handles EOA (ecrecover), deployed smart accounts (ERC-1271),
// and counterfactual smart accounts (ERC-6492) when given a public client, which is exactly the
// Circle Modular Wallet case (smart account, possibly not yet deployed). One call covers all three.
const publicClient = createPublicClient({ transport: http(process.env.ARC_RPC_URL) });

export async function verifyWalletOwnership(args: {
  address: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  return publicClient.verifyMessage({
    address: args.address as Address,
    message: args.message,
    signature: args.signature as Hex,
  });
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `bun test src/lib/auth/verify-ownership.test.ts`
Expected: PASS (2 tests). (The EOA path needs no RPC; `ARC_RPC_URL` is exercised by the smart-account path in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add package.json src/lib/auth/verify-ownership.ts src/lib/auth/verify-ownership.test.ts
git commit -m "feat(identity): wallet-ownership verification via viem (ERC-1271/6492)"
```

---

## Task 5: Stateless login nonce

A short-TTL, HMAC-signed nonce bound to the wallet address, so the verify step can't be replayed across wallets and stale challenges are rejected. Stateless (no table) for Phase 0; true single-use hardening is a later follow-up.

**Files:**
- Create: `src/lib/auth/nonce.ts`, `src/lib/auth/nonce.test.ts`

- [ ] **Step 1: Write the failing test**

Write `src/lib/auth/nonce.test.ts`:

```ts
import { test, expect } from "bun:test";
import { issueNonce, verifyNonce } from "./nonce";

const secret = "test-secret-please-change";
const addr = "0xabc0000000000000000000000000000000000001";

test("a freshly issued nonce verifies for its address", () => {
  const nonce = issueNonce(addr, { secret, now: 1000 });
  expect(verifyNonce(nonce, addr, { secret, now: 1000 + 30_000 }).ok).toBe(true);
});

test("a nonce for one address does not verify for another", () => {
  const nonce = issueNonce(addr, { secret, now: 1000 });
  expect(verifyNonce(nonce, "0xdifferent", { secret, now: 1000 }).ok).toBe(false);
});

test("an expired nonce is rejected", () => {
  const nonce = issueNonce(addr, { secret, now: 1000 });
  expect(verifyNonce(nonce, addr, { secret, now: 1000 + 10 * 60_000 }).ok).toBe(false);
});

test("a tampered nonce is rejected", () => {
  const nonce = issueNonce(addr, { secret, now: 1000 });
  expect(verifyNonce(nonce + "x", addr, { secret, now: 1000 }).ok).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/auth/nonce.test.ts`
Expected: FAIL — `Cannot find module "./nonce"`.

- [ ] **Step 3: Implement**

Write `src/lib/auth/nonce.ts`:

```ts
import { createHmac } from "node:crypto";

const TTL_MS = 5 * 60_000;
type Opts = { secret?: string; now?: number };
const secretOf = (o?: Opts) => o?.secret ?? process.env.AUTH_NONCE_SECRET!;
const nowOf = (o?: Opts) => o?.now ?? Date.now();

// nonce = `${address}.${ts}.${random}.${hmac}` — the signed message the wallet must sign is the
// whole `${address}.${ts}.${random}` prefix, so the signature is bound to this exact challenge.
function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueNonce(address: string, opts?: Opts): string {
  const payload = `${address.toLowerCase()}.${nowOf(opts)}.${crypto.randomUUID()}`;
  return `${payload}.${sign(payload, secretOf(opts))}`;
}

export function verifyNonce(nonce: string, address: string, opts?: Opts): { ok: boolean } {
  const i = nonce.lastIndexOf(".");
  if (i < 0) return { ok: false };
  const payload = nonce.slice(0, i);
  const mac = nonce.slice(i + 1);
  if (sign(payload, secretOf(opts)) !== mac) return { ok: false };
  const [addr, tsStr] = payload.split(".");
  if (!addr || addr !== address.toLowerCase()) return { ok: false };
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || nowOf(opts) - ts > TTL_MS) return { ok: false };
  return { ok: true };
}

// The exact string the wallet signs to prove control of `address` for this challenge.
export function nonceMessage(nonce: string): string {
  return nonce.slice(0, nonce.lastIndexOf("."));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test src/lib/auth/nonce.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/nonce.ts src/lib/auth/nonce.test.ts
git commit -m "feat(identity): stateless HMAC login nonce bound to the wallet"
```

---

## Task 6: The bridge — verify, find-or-create, mint session

The server function that ties it together. Exposes two server endpoints: issue a nonce, and verify a signed nonce to produce a Supabase session. Find-or-create keys on `wallet_address`; the session is a real Supabase session via admin `generateLink` + `verifyOtp` (per the findings doc).

**Files:**
- Create: `src/lib/auth/bridge.ts`

- [ ] **Step 1: Implement the bridge**

Confirm the exact server-function/route registration against the TanStack Start docs in this repo's version; the logic below is the contract. Write `src/lib/auth/bridge.ts`:

```ts
import { supabaseAdmin } from "../supabase/server";
import { issueNonce, verifyNonce, nonceMessage } from "./nonce";
import { verifyWalletOwnership } from "./verify-ownership";

// Step 1 of the ceremony: hand the client a challenge bound to its wallet address.
export async function getNonce(address: string): Promise<{ nonce: string; message: string }> {
  const nonce = issueNonce(address);
  return { nonce, message: nonceMessage(nonce) };
}

// Step 2: verify the signed challenge, find-or-create the user by wallet, mint a real session.
export async function verifyAndMintSession(input: {
  address: string;
  walletId: string;
  nonce: string;
  signature: string;
}): Promise<{ access_token: string; refresh_token: string }> {
  const address = input.address.toLowerCase();

  if (!verifyNonce(input.nonce, address).ok) throw new Error("invalid or expired nonce");
  const owns = await verifyWalletOwnership({
    address,
    message: nonceMessage(input.nonce),
    signature: input.signature,
  });
  if (!owns) throw new Error("signature does not prove wallet ownership");

  const db = supabaseAdmin();
  const email = `${address}@wallet.prime`;

  // Find-or-create by wallet (C2). The profile is created atomically by the DB trigger from the
  // user_metadata we set here (C4); we never write profiles directly here.
  const { data: existing } = await db.from("profiles").select("id").eq("wallet_address", address).maybeSingle();
  if (!existing) {
    const { error } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { wallet_address: address, wallet_id: input.walletId },
    });
    if (error && !/already.*registered/i.test(error.message)) throw error;
  }

  // Mint a real Supabase session (access + refresh) without hand-rolling JWTs: generate a
  // magiclink token via admin, then exchange it for a session. No email is sent.
  const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !link?.properties?.email_otp) throw linkErr ?? new Error("no otp");
  const { data: session, error: otpErr } = await db.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  if (otpErr || !session.session) throw otpErr ?? new Error("no session");

  return {
    access_token: session.session.access_token,
    refresh_token: session.session.refresh_token,
  };
}
```

- [ ] **Step 2: Wire as TanStack Start server endpoints**

Expose `getNonce` and `verifyAndMintSession` as server functions/routes (e.g. `createServerFn`) so they run only server-side with the service-role key. Confirm the exact API against the installed `@tanstack/react-start` version. Acceptance is covered in Task 7; there is no isolated unit test here because the value is the live round-trip.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/bridge.ts
git commit -m "feat(identity): auth bridge — verify ownership, find-or-create, mint Supabase session"
```

---

## Task 7: Circle wallet ceremony, onboarding flow, and the end-to-end acceptance

The browser half: create or restore the Circle Modular Wallet via passkey, sign the nonce, exchange for a session, and land in the Ready state. This task's "test" is a concrete acceptance run, since it needs a passkey ceremony in a real browser.

**Files:**
- Modify: `package.json` (add `@circle-fin/modular-wallets-core`)
- Create: `src/lib/circle/wallet.ts`, `src/routes/onboarding.tsx`, `src/lib/auth/session.tsx`

- [ ] **Step 1: Add the Circle Web SDK**

```bash
bun add @circle-fin/modular-wallets-core
```

- [ ] **Step 2: Wallet ceremony module**

Write `src/lib/circle/wallet.ts` per the Circle Modular Wallets Web SDK docs
(https://developers.circle.com/wallets/modular/web-sdk). It must expose:

```ts
// createOrLoginWallet(): runs the passkey ceremony (toWebAuthnCredential Register on first use,
//   Login on return), builds the smart account (toCircleSmartAccount), and returns
//   { address, walletId, signMessage }.
// signMessage(message): signs an arbitrary message with the wallet (ERC-1271), for the nonce.
export type WalletHandle = {
  address: string;
  walletId: string;
  signMessage: (message: string) => Promise<string>;
};
export async function createOrLoginWallet(): Promise<WalletHandle> { /* per Circle Web SDK */ }
```

Persist the P256 credential as the SDK documents (httpOnly cookie) so reload restores the wallet.

- [ ] **Step 3: Onboarding flow**

Write `src/routes/onboarding.tsx`: a single button that runs the ladder, calling the Task 6 endpoints:

```
createOrLoginWallet()  ->  getNonce(address)  ->  signMessage(message)
  ->  verifyAndMintSession({ address, walletId, nonce, signature })
  ->  supabaseBrowser.auth.setSession({ access_token, refresh_token })
  ->  redirect to the authed area (Ready)
```

Show the four states from the spec (Anonymous → Passkey → Wallet → Authenticated) as the flow progresses, and surface errors (ceremony cancelled, verification failed) with a clean retry from Anonymous.

- [ ] **Step 4: Session context + guard**

Write `src/lib/auth/session.tsx`: a provider that reads the current Supabase session (`supabaseBrowser.auth.getSession` + `onAuthStateChange`), exposes `{ user, walletAddress, signOut }`, and a guard that redirects unauthenticated users to `/onboarding`. `signOut` calls `supabaseBrowser.auth.signOut()`.

- [ ] **Step 5: Acceptance run (the real test)**

Run the app (`bun dev`) and, in a passkey-capable browser:
1. Visit a guarded route while signed out → redirected to `/onboarding`.
2. Complete onboarding → a passkey is created, the wallet is created, you land Ready.
3. In Supabase, confirm exactly one `auth.users` row and one `profiles` row for the wallet (C1, C4), and `wallet_address` is the lower-cased smart-account address (C2).
4. Reload → restored into the same identity, no second user/profile created (idempotency).
5. Sign out → redirected back to `/onboarding`; sign in again → same identity, still one user.

Record the result (pass/fail per step). This run also validates the one external unknown: that a real Circle counterfactual signature verifies through `verifyWalletOwnership` (Task 4) against the Arc RPC.

- [ ] **Step 6: Commit**

```bash
git add package.json src/lib/circle/ src/routes/onboarding.tsx src/lib/auth/session.tsx
git commit -m "feat(identity): Circle passkey wallet ceremony + onboarding flow + session guard"
```

---

## Task 8: Wrap-up

- [ ] **Step 1: Pure + DB suites green**

Run: `bun test src/lib/auth/ && cd services && bun test src/identity/profiles.contract.test.ts`
Expected: all pass (nonce, verify-ownership, profiles contract).

- [ ] **Step 2: Type-check**

Run: `bun run build` (frontend) and confirm no type errors introduced.
Expected: build succeeds.

- [ ] **Step 3: Contracts checklist**

Confirm against the acceptance run in Task 7: C1 (no session without a wallet), C2 (one wallet ↔ one user), C3 (session belongs to the provisioned identity), C4 (no half-identity, proven by the trigger contract test). Note any gap.

- [ ] **Step 4: Finish the branch**

Use superpowers:finishing-a-development-branch. Default to merging `feat/phase0-identity` to `main` once green.

- [ ] **Step 5: Update the project memory**

Record Phase 0 status in `autonomous-compute-broker-project.md`: identity & provisioning shipped — Circle Modular Wallet (passkey, counterfactual smart account) as identity anchor, custom bridge (viem ERC-1271/6492 verify → admin generateLink/verifyOtp session), atomic profile via `handle_new_user` trigger, migration `0005`. Note what's next: sub-project A (live-data read path) now has real `auth.uid()` to filter by.

---

## Self-Review Notes

**Spec coverage:** C1 → Task 6 mints a session only after wallet ownership is proven, and Task 1's schema makes `wallet_address` mandatory; the acceptance (Task 7) confirms no session exists without a wallet. C2 → Task 1 `unique` + lower-casing, Task 2 duplicate-rejection test, find-or-create-by-wallet in Task 6. C3 → the session is minted for the specific provisioned user resolved by wallet. C4 → Task 1 `handle_new_user` trigger + Task 2 atomicity test. C5 → the bridge mechanism is isolated in `bridge.ts`/`verify-ownership.ts` behind the contracts. Findings decisions (custom bridge, generateLink+verifyOtp, trigger, keep `wallet_id`) all implemented.

**Placeholder scan:** Data layer (Tasks 1–2) and pure modules (Tasks 4–5) are exact code with run/expected. Tasks 6–7 deliberately anchor the Circle Web SDK and TanStack Start server-function specifics to the cited docs with a concrete acceptance run, rather than fabricated exact code, per the plan's stated external-SDK honesty. No TBDs.

**Type consistency:** `WalletHandle` (Task 7) feeds `{ address, walletId, signMessage }` into `verifyAndMintSession` (Task 6), whose inputs match. `nonceMessage`/`issueNonce`/`verifyNonce` (Task 5) are used by `bridge.ts` (Task 6) with matching signatures. `verifyWalletOwnership({ address, message, signature })` (Task 4) is called with exactly those keys in Task 6. `supabaseAdmin()` (Task 3) is the client used in Task 6.

**Out of scope (unchanged):** funding the wallet, Paymaster/gasless spend, rents, the broker spending from a user wallet, the live dashboard. True single-use nonce storage (replay hardening beyond the short TTL) is noted as a follow-up.
