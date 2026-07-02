# User-Controlled Wallet Gate (Identity v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the passkey Modular wallet with Circle user-controlled wallets as the app's front door (email OTP + PIN) and treasury tier, bridging Circle's `userToken` into the existing Supabase session machinery with the wallet address staying the identity anchor.

**Architecture:** Per spec `docs/superpowers/specs/2026-07-02-user-controlled-wallet-gate-design.md`. Client runs Circle's Web SDK (`@circle-fin/w3s-pw-web-sdk`: email OTP modal, PIN challenges); the backend verifies the resulting `userToken` against Circle's API (`getUserStatus` + `listWallets`), finds-or-creates the Supabase user by wallet address, stamps `circle_user_id` on the profile, and mints a session via the existing `generateLink`+`verifyOtp` path. Treasury actions (fund spend wallet, withdraw) become server-created transfer challenges the client executes with a PIN. The whole passkey/Modular stack is deleted.

**Tech Stack:** `@circle-fin/user-controlled-wallets@10.8.0` (server, already in `services/`), `@circle-fin/w3s-pw-web-sdk@1.1.11` (client, already in root), Supabase, TanStack Start server-fns.

---

## Locked probe outcomes (gate zero, `services/probes/circle-user-gate.ts`, run 2026-07-02)

All headless checks PASSED on our real account:

- `Blockchain.ArcTestnet === "ARC-TESTNET"` and a live `createUserPinWithWallets({ blockchains: ["ARC-TESTNET"], accountType: "EOA" })` returned a real challengeId — Arc wallet creation is accepted.
- **App ID `b4abe630-9089-5bfb-a089-7c2b70eabdee`** exists on the same account as the entity secret (one account carries both setups). This becomes `VITE_CIRCLE_APP_ID`.
- `createUser` + `createUserToken` work with `CIRCLE_API_KEY`.
- **Server-side token verification = `getUserStatus({ userToken })`** (returns the Circle user id + pinStatus) and `listWallets({ userToken })` (the wallet lookup).
- Email OTP endpoint exists but returned: *"The SMTP server configuration is not found. Please complete the SMTP setting in developer console first."* — **console config gap, not a capability FAIL.**

**Locked SDK mechanics (verified against installed type defs):**
- Server `createDeviceTokenForEmailLogin({ deviceId, email, idempotencyKey })` → `{ deviceToken, deviceEncryptionKey?, otpToken? }`.
- Web SDK: `new W3SSdk({ appSettings: { appId } })`, `getDeviceId()`, `updateConfigs(configs, onLoginComplete)`, `verifyOtp()` (opens the OTP modal), `setAuthentication({ userToken, encryptionKey })`, `execute(challengeId, cb)`. `EmailLoginResult = { userToken, encryptionKey, refreshToken }`.
- Server transfer challenge: `createTransaction({ userToken, amounts: [..], destinationAddress, walletId, tokenAddress, blockchain: "ARC-TESTNET", fee: { type: "level", config: { feeLevel: "MEDIUM" } }, idempotencyKey })` → `{ challengeId }`.
- USDC on Arc testnet: `0x3600000000000000000000000000000000000000` (`USDC_ADDRESS`).

## Prerequisites (user actions, before Task 6 can be verified live)

1. **Circle console: complete the SMTP setting** (developer console → the email-login configuration) so `createDeviceTokenForEmailLogin` stops erroring. Without it the whole login flow 4xxes.
2. Root `.env` must carry `CIRCLE_API_KEY` (same value as `services/.env`) and the new `VITE_CIRCLE_APP_ID=b4abe630-9089-5bfb-a089-7c2b70eabdee` (Task 9 documents this; add the values when the task lands).

**Heads-up on uncommitted WIP:** `src/lib/circle/wallet.ts`, `src/lib/circle/passkey-ux.ts(+test)`, and parts of `src/routes/onboarding.tsx` hold the uncommitted passkey duplicate-username fix from 2026-07-01. This plan deletes/rewrites those files (the spec abandons the passkey path), so that WIP is intentionally discarded. `feat/modular-on-arc` stays abandoned (do not merge; leave the branch for git history).

---

## File structure

- `services/supabase/migrations/0011_circle_user_id.sql` (new) — nullable `circle_user_id` on profiles
- `services/src/wallet/circle-user.ts` + `circle-user.test.ts` (new) — user-controlled client factory + thin gate wrapper (status/wallet/challenges), the injectable seam
- `src/lib/auth/mint-session.ts` (new) — find-or-create-by-wallet + session mint, extracted from `bridge.ts`
- `src/lib/auth/circle-bridge.ts` + `circle-bridge.test.ts` (new) — the userToken→session bridge, pure with injected deps
- `src/lib/auth/circle-fns.ts` (new) — server-fns: startEmailLogin / completeCircleLogin / treasuryTransferChallenge / getTreasuryBalance
- `src/lib/circle/user-sdk.ts` (new) — client Web SDK wrapper: OTP ceremony, challenge execution, session storage
- `src/routes/onboarding.tsx` (rewrite) — email → OTP → PIN/wallet → session ceremony
- `src/components/site/WalletSheet.tsx` (modify) — treasury balance + PIN-approved fund-spend-wallet / treasury-withdraw flow
- DELETE: `src/lib/circle/{wallet,passkey-ux,passkey-ux.test,chain}.ts`, `src/lib/auth/{bridge,server-fns,nonce,nonce.test,verify-ownership,verify-ownership.test}.ts`; drop `@circle-fin/modular-wallets-core`; fix `Sidebar.tsx`'s `walletChainSegment` usage
- `.env.example`, `README`-adjacent docs — env churn

---

## Task 1: Migration — `circle_user_id` on profiles

**Files:**
- Create: `services/supabase/migrations/0011_circle_user_id.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Identity v2: the Circle user-controlled login id, stored alongside the wallet anchor.
-- Operational metadata only — wallet_address stays the unique immutable identity (C1-C5).
alter table profiles add column if not exists circle_user_id text;
```

- [ ] **Step 2: Apply it live to PrimeBot (`xwxuqcougmanzonypoym`)**

Apply via the Supabase MCP (`apply_migration`) or SQL editor, then verify:

```sql
select column_name, is_nullable from information_schema.columns
where table_name = 'profiles' and column_name = 'circle_user_id';
```

Expected: one row, `is_nullable = YES`.

- [ ] **Step 3: Commit**

```bash
git add services/supabase/migrations/0011_circle_user_id.sql
git commit -m "feat(identity): profiles carry the Circle user-controlled login id"
```

---

## Task 2: Server client seam — `circle-user.ts`

The app's server-fns need a narrow, stubbable surface over `@circle-fin/user-controlled-wallets` (same idiom as `services/src/wallet/circle.ts` wraps the developer-controlled SDK). It lives in `services/` so it resolves against `services/node_modules`, and the app imports it via the existing `@services/` alias.

**Files:**
- Create: `services/src/wallet/circle-user.ts`
- Test: `services/src/wallet/circle-user.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// services/src/wallet/circle-user.test.ts
import { test, expect } from "bun:test";
import { CircleUserGate, type CircleUserApi } from "./circle-user";

function apiStub(overrides: Partial<CircleUserApi> = {}): CircleUserApi {
  return {
    createDeviceTokenForEmailLogin: async () => ({ data: { deviceToken: "dt", deviceEncryptionKey: "dek", otpToken: "ot" } }) as any,
    getUserStatus: async () => ({ data: { id: "circle-u1", status: "ENABLED", pinStatus: "ENABLED" } }) as any,
    listWallets: async () => ({ data: { wallets: [
      { id: "w-base", address: "0xbase", blockchain: "BASE-SEPOLIA" },
      { id: "w-arc", address: "0xARC", blockchain: "ARC-TESTNET" },
    ] } }) as any,
    createUserPinWithWallets: async () => ({ data: { challengeId: "ch-1" } }) as any,
    createTransaction: async () => ({ data: { challengeId: "ch-tx" } }) as any,
    ...overrides,
  };
}

test("status maps the Circle user; a throwing call (rejected token) is null", async () => {
  const gate = new CircleUserGate(apiStub(), "0x36USDC");
  expect(await gate.status("tok")).toEqual({ circleUserId: "circle-u1", pinStatus: "ENABLED" });
  const rejected = new CircleUserGate(apiStub({ getUserStatus: async () => { throw new Error("401"); } }), "0x36USDC");
  expect(await rejected.status("bad")).toBeNull();
});

test("arcWallet picks the ARC-TESTNET wallet and lower-cases the address", async () => {
  const gate = new CircleUserGate(apiStub(), "0x36USDC");
  expect(await gate.arcWallet("tok")).toEqual({ walletId: "w-arc", address: "0xarc" });
  const none = new CircleUserGate(apiStub({ listWallets: async () => ({ data: { wallets: [] } }) as any }), "0x36USDC");
  expect(await none.arcWallet("tok")).toBeNull();
});

test("createArcWalletChallenge returns the challengeId", async () => {
  const gate = new CircleUserGate(apiStub(), "0x36USDC");
  expect(await gate.createArcWalletChallenge("tok")).toBe("ch-1");
});

test("createTransferChallenge sends a USDC level-fee transfer on ARC-TESTNET", async () => {
  let sent: any;
  const gate = new CircleUserGate(apiStub({ createTransaction: async (input: any) => { sent = input; return { data: { challengeId: "ch-tx" } } as any; } }), "0x36USDC");
  const id = await gate.createTransferChallenge("tok", { walletId: "w-arc", amount: "1.5", destinationAddress: "0xdest" });
  expect(id).toBe("ch-tx");
  expect(sent.amounts).toEqual(["1.5"]);
  expect(sent.destinationAddress).toBe("0xdest");
  expect(sent.walletId).toBe("w-arc");
  expect(sent.tokenAddress).toBe("0x36USDC");
  expect(sent.blockchain).toBe("ARC-TESTNET");
  expect(sent.fee).toEqual({ type: "level", config: { feeLevel: "MEDIUM" } });
  expect(typeof sent.idempotencyKey).toBe("string");
});

test("startEmailLogin returns the device-token triple", async () => {
  const gate = new CircleUserGate(apiStub(), "0x36USDC");
  expect(await gate.startEmailLogin("dev-1", "a@b.c")).toEqual({ deviceToken: "dt", deviceEncryptionKey: "dek", otpToken: "ot" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services && bun test src/wallet/circle-user.test.ts`
Expected: FAIL, "Cannot find module './circle-user'".

- [ ] **Step 3: Implement**

```ts
// services/src/wallet/circle-user.ts
// The user-controlled wallets slice the identity gate needs. Same idiom as circle.ts
// (developer-controlled): a factory over the real SDK client plus a narrow wrapper the
// bridge takes as a seam, so unit tests never touch the network.
import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import { randomUUID } from "node:crypto";

// The API slice we use; the real client satisfies it, tests stub it.
export type CircleUserApi = {
  createDeviceTokenForEmailLogin(input: { deviceId: string; email: string; idempotencyKey: string }): Promise<any>;
  getUserStatus(input: { userToken: string }): Promise<any>;
  listWallets(input: { userToken: string }): Promise<any>;
  createUserPinWithWallets(input: { userToken: string; blockchains: any[]; accountType: "EOA" }): Promise<any>;
  createTransaction(input: any): Promise<any>;
};

export function makeCircleUserApi(env: Record<string, string | undefined> = process.env): CircleUserApi {
  const apiKey = env.CIRCLE_API_KEY;
  if (!apiKey) throw new Error("CIRCLE_API_KEY required");
  return initiateUserControlledWalletsClient({ apiKey });
}

export type CircleUserStatus = { circleUserId: string; pinStatus: string };
export type ArcWallet = { walletId: string; address: string };

export class CircleUserGate {
  constructor(private api: CircleUserApi, private usdcAddress: string) {}

  /** Email OTP step 1: mint the device token the Web SDK's OTP modal needs. */
  async startEmailLogin(deviceId: string, email: string): Promise<{ deviceToken: string; deviceEncryptionKey?: string; otpToken?: string }> {
    const res = await this.api.createDeviceTokenForEmailLogin({ deviceId, email, idempotencyKey: randomUUID() });
    const d = res.data;
    if (!d?.deviceToken) throw new Error("Circle returned no deviceToken");
    return { deviceToken: d.deviceToken, deviceEncryptionKey: d.deviceEncryptionKey, otpToken: d.otpToken };
  }

  /** Server-side proof a live userToken maps to a Circle user. null = token rejected. */
  async status(userToken: string): Promise<CircleUserStatus | null> {
    try {
      const res = await this.api.getUserStatus({ userToken });
      const u = res.data;
      return u?.id ? { circleUserId: u.id, pinStatus: u.pinStatus ?? "UNSET" } : null;
    } catch {
      return null;
    }
  }

  /** The user's Arc wallet, if the create-wallet challenge has run. */
  async arcWallet(userToken: string): Promise<ArcWallet | null> {
    const res = await this.api.listWallets({ userToken });
    const w = (res.data?.wallets ?? []).find((x: any) => x.blockchain === "ARC-TESTNET");
    return w ? { walletId: w.id, address: String(w.address).toLowerCase() } : null;
  }

  /** First login: one challenge sets the PIN and creates the Arc wallet. */
  async createArcWalletChallenge(userToken: string): Promise<string> {
    const res = await this.api.createUserPinWithWallets({ userToken, blockchains: ["ARC-TESTNET"], accountType: "EOA" });
    const id = res.data?.challengeId;
    if (!id) throw new Error("Circle returned no challengeId");
    return id;
  }

  /** Treasury action: a PIN-gated USDC transfer challenge on Arc. */
  async createTransferChallenge(
    userToken: string,
    input: { walletId: string; amount: string; destinationAddress: string },
  ): Promise<string> {
    const res = await this.api.createTransaction({
      userToken,
      amounts: [input.amount],
      destinationAddress: input.destinationAddress,
      walletId: input.walletId,
      tokenAddress: this.usdcAddress,
      blockchain: "ARC-TESTNET",
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      idempotencyKey: randomUUID(),
    });
    const id = res.data?.challengeId;
    if (!id) throw new Error("Circle returned no challengeId");
    return id;
  }
}
```

- [ ] **Step 4: Run tests + type-check**

Run: `cd services && bun test src/wallet/circle-user.test.ts && bunx tsc --noEmit`
Expected: PASS (5 tests) + clean.

- [ ] **Step 5: Commit**

```bash
git add services/src/wallet/circle-user.ts services/src/wallet/circle-user.test.ts
git commit -m "feat(identity): user-controlled wallets client seam (status, arc wallet, challenges)"
```

---

## Task 3: Extract the session mint from the passkey bridge

`bridge.ts` mixes signature verification (dies with the passkey) with find-or-create + session mint (survives). Extract the surviving half so Task 4 can reuse it and Task 8 can delete the rest.

**Files:**
- Create: `src/lib/auth/mint-session.ts`
- Modify: `src/lib/auth/bridge.ts`

- [ ] **Step 1: Create `mint-session.ts`** (moved code, plus the `circle_user_id` stamp)

```ts
// src/lib/auth/mint-session.ts
import { supabaseAdmin } from "../supabase/server";

// Find-or-create the Supabase user by wallet (C2) and mint a real session. The profile is
// created atomically by the DB trigger from user_metadata (C4); we never insert profiles here.
// circle_user_id is operational metadata stamped after the fact (also backfills profiles that
// existed before Identity v2).
export async function mintSessionForWallet(input: {
  address: string;   // already lower-cased by the caller
  walletId: string;
  circleUserId?: string;
}): Promise<{ access_token: string; refresh_token: string }> {
  const db = supabaseAdmin();
  const email = `${input.address}@wallet.prime`;

  const { data: existing } = await db.from("profiles").select("id").eq("wallet_address", input.address).maybeSingle();
  if (!existing) {
    const { error } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { wallet_address: input.address, wallet_id: input.walletId },
    });
    if (error && !/already.*registered/i.test(error.message)) throw error;
  }

  if (input.circleUserId) {
    const { error } = await db.from("profiles")
      .update({ circle_user_id: input.circleUserId })
      .eq("wallet_address", input.address);
    if (error) throw error;
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

- [ ] **Step 2: Refactor `bridge.ts` to call it** (behavior unchanged; keeps the passkey path compiling until Task 8 deletes it)

Replace everything in `verifyAndMintSession` from `const db = supabaseAdmin();` to the end with:

```ts
  return mintSessionForWallet({ address, walletId: input.walletId });
```

and add `import { mintSessionForWallet } from "./mint-session";`, removing the now-unused `supabaseAdmin` import.

- [ ] **Step 3: Type-check + app tests**

Run: `bunx tsc --noEmit && bun test src/lib`
Expected: clean + all green (no behavior change).

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/mint-session.ts src/lib/auth/bridge.ts
git commit -m "refactor(identity): extract the wallet session mint from the passkey bridge"
```

---

## Task 4: The Circle bridge

**Files:**
- Create: `src/lib/auth/circle-bridge.ts`
- Test: `src/lib/auth/circle-bridge.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/auth/circle-bridge.test.ts
import { test, expect } from "bun:test";
import { circleGateLogin, type CircleBridgeDeps } from "./circle-bridge";

function deps(overrides: Partial<CircleBridgeDeps> = {}): CircleBridgeDeps & { minted: any[] } {
  const minted: any[] = [];
  return {
    minted,
    status: async () => ({ circleUserId: "cu-1", pinStatus: "ENABLED" }),
    arcWallet: async () => ({ walletId: "w-1", address: "0xabc" }),
    createArcWalletChallenge: async () => "ch-9",
    mint: async (input) => { minted.push(input); return { access_token: "at", refresh_token: "rt" }; },
    ...overrides,
  };
}

test("a valid token with a wallet mints a session and stamps circle_user_id", async () => {
  const d = deps();
  const out = await circleGateLogin(d, "tok");
  expect(out).toEqual({ kind: "session", access_token: "at", refresh_token: "rt" });
  expect(d.minted).toEqual([{ address: "0xabc", walletId: "w-1", circleUserId: "cu-1" }]);
});

test("a rejected token is a failed login", async () => {
  const d = deps({ status: async () => null });
  await expect(circleGateLogin(d, "bad")).rejects.toThrow(/login/i);
  expect(d.minted).toEqual([]);
});

test("no wallet yet -> returns the PIN+wallet challenge instead of a session", async () => {
  const d = deps({ arcWallet: async () => null });
  const out = await circleGateLogin(d, "tok");
  expect(out).toEqual({ kind: "challenge", challengeId: "ch-9" });
  expect(d.minted).toEqual([]);
});

test("an existing wallet keeps mapping to the same user (mint is keyed by address)", async () => {
  const d = deps();
  await circleGateLogin(d, "tok");
  await circleGateLogin(d, "tok");
  expect(d.minted.map((m) => m.address)).toEqual(["0xabc", "0xabc"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/lib/auth/circle-bridge.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement**

```ts
// src/lib/auth/circle-bridge.ts
// Identity v2 bridge: Circle's userToken replaces the signed nonce. Circle authenticated
// the human (email OTP + PIN); we verify the token server-side, anchor on the wallet
// address (C1-C5 unchanged), and mint the same Supabase session as before. Deps are
// injected so the bridge is unit-testable without Circle or Supabase.
export type CircleBridgeDeps = {
  status(userToken: string): Promise<{ circleUserId: string; pinStatus: string } | null>;
  arcWallet(userToken: string): Promise<{ walletId: string; address: string } | null>;
  createArcWalletChallenge(userToken: string): Promise<string>;
  mint(input: { address: string; walletId: string; circleUserId: string }): Promise<{ access_token: string; refresh_token: string }>;
};

export type CircleGateResult =
  | { kind: "challenge"; challengeId: string }   // first login: run PIN setup + wallet creation, then call again
  | { kind: "session"; access_token: string; refresh_token: string };

export async function circleGateLogin(deps: CircleBridgeDeps, userToken: string): Promise<CircleGateResult> {
  const user = await deps.status(userToken);
  if (!user) throw new Error("Circle login rejected: invalid or expired user token");

  const wallet = await deps.arcWallet(userToken);
  if (!wallet) {
    return { kind: "challenge", challengeId: await deps.createArcWalletChallenge(userToken) };
  }

  const session = await deps.mint({ address: wallet.address, walletId: wallet.walletId, circleUserId: user.circleUserId });
  return { kind: "session", ...session };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/auth/circle-bridge.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/circle-bridge.ts src/lib/auth/circle-bridge.test.ts
git commit -m "feat(identity): circle userToken bridge (verify, wallet challenge, session mint)"
```

---

## Task 5: Server-fns

**Files:**
- Create: `src/lib/auth/circle-fns.ts`

- [ ] **Step 1: Implement the server-fns**

```ts
// src/lib/auth/circle-fns.ts
import { createServerFn } from "@tanstack/react-start";
import { CircleUserGate, makeCircleUserApi } from "@services/wallet/circle-user";
import { circleGateLogin } from "./circle-bridge";
import { mintSessionForWallet } from "./mint-session";
import { requireUser } from "./require-user";
import { supabaseAdmin } from "../supabase/server";

const usdc = () => {
  const a = process.env.USDC_ADDRESS;
  if (!a) throw new Error("USDC_ADDRESS required");
  return a;
};
const gate = () => new CircleUserGate(makeCircleUserApi(), usdc());

// Step 1 of login: the client hands us its SDK deviceId + the user's email; Circle emails
// the OTP and we return the device token triple the Web SDK's OTP modal needs.
export const startEmailLogin = createServerFn({ method: "POST" })
  .validator((d: { deviceId: string; email: string }) => d)
  .handler(async ({ data }) => gate().startEmailLogin(data.deviceId, data.email));

// Step 2 (and 3, after a first-login wallet challenge): verify the userToken, then either
// hand back the PIN+wallet challengeId or mint the app session.
export const completeCircleLogin = createServerFn({ method: "POST" })
  .validator((d: { userToken: string }) => d)
  .handler(async ({ data }) => {
    const g = gate();
    return circleGateLogin(
      {
        status: (t) => g.status(t),
        arcWallet: (t) => g.arcWallet(t),
        createArcWalletChallenge: (t) => g.createArcWalletChallenge(t),
        mint: (input) => mintSessionForWallet(input),
      },
      data.userToken,
    );
  });

// Treasury action: a PIN-gated USDC transfer challenge from the user's own Circle wallet
// (fund the spend wallet, or withdraw to any external address). The userToken must belong
// to the signed-in profile, so one user can't build challenges against another's session.
export const treasuryTransferChallenge = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; userToken: string; amount: string; destinationAddress: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    if (!/^\d+(\.\d+)?$/.test(data.amount) || Number(data.amount) <= 0) throw new Error("invalid amount");
    if (!/^0x[0-9a-fA-F]{40}$/.test(data.destinationAddress)) throw new Error("invalid destination address");

    const g = gate();
    const status = await g.status(data.userToken);
    if (!status) throw new Error("Circle session expired — sign in again");
    const { data: profile, error } = await supabaseAdmin()
      .from("profiles").select("circle_user_id").eq("id", user.id).single();
    if (error) throw error;
    if (!profile.circle_user_id || profile.circle_user_id !== status.circleUserId) {
      throw new Error("Circle session does not belong to this account");
    }

    const wallet = await g.arcWallet(data.userToken);
    if (!wallet) throw new Error("no Arc treasury wallet on this Circle account");
    const challengeId = await g.createTransferChallenge(data.userToken, {
      walletId: wallet.walletId, amount: data.amount, destinationAddress: data.destinationAddress,
    });
    return { challengeId };
  });

// The treasury balance is an ordinary on-chain read of the profile's wallet address —
// no Circle token needed, so the sheet can show it whenever the app session is live.
export const getTreasuryBalance = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    const { data: profile, error } = await supabaseAdmin()
      .from("profiles").select("wallet_address").eq("id", user.id).single();
    if (error) throw error;
    const { makeOnchain } = await import("@services/wallet/onchain");
    const { loadWalletConfig } = await import("@services/wallet/config");
    try {
      const onchain = makeOnchain(loadWalletConfig());
      const atomic = await onchain.usdcBalance(profile.wallet_address as `0x${string}`);
      return { address: profile.wallet_address as string, usdcFormatted: (Number(atomic) / 1_000_000).toFixed(6) };
    } catch {
      return { address: profile.wallet_address as string, usdcFormatted: null };
    }
  });
```

**Note:** `requireUser` is the existing helper in `src/lib/auth/require-user.ts`; `makeOnchain`/`loadWalletConfig` are the existing spend-wallet balance readers (see `src/lib/wallet/server-fns.ts` for the exact import/call shape — mirror how `getSpendWalletBalance` reads a balance; if its method is named differently than `usdcBalance`, use whatever that file uses).

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/circle-fns.ts
git commit -m "feat(identity): circle login + treasury transfer server-fns"
```

---

## Task 6: Client Web SDK wrapper

**Files:**
- Create: `src/lib/circle/user-sdk.ts`

- [ ] **Step 1: Implement**

```ts
// src/lib/circle/user-sdk.ts
// The browser half of the Circle user-controlled ceremony. One W3SSdk instance drives the
// email OTP modal and PIN challenges. The Circle session triple is kept in sessionStorage:
// it's what treasury actions authenticate with (the PIN challenge still gates every funds
// movement, so a leaked triple alone can't move money).
import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

const appId = import.meta.env.VITE_CIRCLE_APP_ID as string;

export type CircleSession = { userToken: string; encryptionKey: string; refreshToken?: string };

const STORAGE_KEY = "prime-circle-session";
export function saveCircleSession(s: CircleSession): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}
export function loadCircleSession(): CircleSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CircleSession) : null;
  } catch {
    return null;
  }
}
export function clearCircleSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

let sdk: W3SSdk | null = null;
function getSdk(): W3SSdk {
  if (!appId) throw new Error("VITE_CIRCLE_APP_ID is not set");
  if (!sdk) sdk = new W3SSdk({ appSettings: { appId } });
  return sdk;
}

export function getDeviceId(): Promise<string> {
  return getSdk().getDeviceId();
}

// Opens Circle's OTP modal; resolves with the Circle session once the emailed code checks out.
export function runEmailOtp(login: { deviceToken: string; deviceEncryptionKey?: string; otpToken?: string }): Promise<CircleSession> {
  return new Promise((resolve, reject) => {
    const s = getSdk();
    s.updateConfigs(
      {
        appSettings: { appId },
        loginConfigs: {
          deviceToken: login.deviceToken,
          deviceEncryptionKey: login.deviceEncryptionKey ?? "",
          otpToken: login.otpToken,
        },
      },
      (error, result) => {
        if (error || !result) return reject(new Error(error?.message ?? "email login failed"));
        const session = { userToken: result.userToken, encryptionKey: result.encryptionKey, refreshToken: (result as { refreshToken?: string }).refreshToken };
        saveCircleSession(session);
        resolve(session);
      },
    );
    s.verifyOtp();
  });
}

// Runs a Circle challenge (PIN setup + wallet creation, or a transfer approval).
export function executeChallenge(challengeId: string, session: CircleSession): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = getSdk();
    s.setAuthentication({ userToken: session.userToken, encryptionKey: session.encryptionKey });
    s.execute(challengeId, (error) => {
      if (error) return reject(new Error(error.message));
      resolve();
    });
  });
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/circle/user-sdk.ts
git commit -m "feat(identity): browser wrapper for the Circle user-controlled web sdk"
```

---

## Task 7: Onboarding rewrite

**Files:**
- Modify: `src/routes/onboarding.tsx`

- [ ] **Step 1: Rewrite the ceremony**

Keep the route config (`validateSearch`/`beforeLoad`/redirect effect), the signed-in "You're in" card, `Centered`, and the ladder UI pattern. Replace the passkey machinery with the email flow. The full new component body:

```tsx
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getDeviceId, runEmailOtp, executeChallenge, type CircleSession } from "../lib/circle/user-sdk";
import { startEmailLogin, completeCircleLogin } from "../lib/auth/circle-fns";
import { supabaseBrowser } from "../lib/supabase/client";
import { useSession } from "../lib/auth/session";

// Onboarding is a waypoint, not a destination: whoever sent the user here (a gated route's
// authGuard, a "Get Started" CTA) passes along where they were headed via `redirect`, and once
// authenticated we send them straight there instead of always dropping them on one fixed page.
export const Route = createFileRoute("/onboarding")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: async ({ search }) => {
    if (!search.redirect) return;
    const { data } = await supabaseBrowser.auth.getSession();
    if (data.session) throw redirect({ href: search.redirect });
  },
  component: Onboarding,
});

type Step = "anonymous" | "email" | "wallet" | "verifying" | "ready" | "error";

const LADDER: { key: Step; label: string }[] = [
  { key: "anonymous", label: "Anonymous" },
  { key: "email", label: "Email verified" },
  { key: "wallet", label: "Wallet ready" },
  { key: "ready", label: "Authenticated" },
];

function Onboarding() {
  const { redirect: redirectTo } = Route.useSearch();
  const router = useRouter();
  const { session, loading, walletAddress, signOut } = useSession();
  const [step, setStep] = useState<Step>("anonymous");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session && redirectTo) router.navigate({ href: redirectTo, replace: true });
  }, [session, redirectTo, router]);

  async function run() {
    setError(null);
    setBusy(true);
    try {
      // [1] Circle emails an OTP; its modal collects the code and yields the Circle session.
      const deviceId = await getDeviceId();
      const login = await startEmailLogin({ data: { deviceId, email: email.trim() } });
      const circle: CircleSession = await runEmailOtp(login);
      setStep("email");

      // [2] Bridge: verify the token server-side. First login comes back as a PIN+wallet
      // challenge; run it (Circle's PIN UI), then complete again with a wallet in place.
      let result = await completeCircleLogin({ data: { userToken: circle.userToken } });
      if (result.kind === "challenge") {
        await executeChallenge(result.challengeId, circle);
        setStep("wallet");
        result = await completeCircleLogin({ data: { userToken: circle.userToken } });
      }
      if (result.kind !== "session") throw new Error("wallet creation did not complete — try again");

      // [3] The app session.
      setStep("verifying");
      await supabaseBrowser.auth.setSession({ access_token: result.access_token, refresh_token: result.refresh_token });
      setStep("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "sign-in failed");
      setStep("error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Centered>Loading…</Centered>;
  if (session && redirectTo) return <Centered>Redirecting…</Centered>;

  if (session) {
    return (
      <Centered>
        <div className="w-full max-w-md rounded-xl border border-input bg-card p-8 text-center">
          <h1 className="text-xl font-semibold text-foreground">You're in</h1>
          <p className="mt-2 text-sm text-muted-foreground">Authenticated with your wallet.</p>
          <p className="mt-4 break-all rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">
            {walletAddress ?? "(wallet address unavailable)"}
          </p>
          <Link
            to="/marketplace"
            className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Browse the marketplace
          </Link>
          <button
            onClick={() => signOut()}
            className="mt-3 inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Sign out
          </button>
        </div>
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="w-full max-w-md rounded-xl border border-input bg-card p-8">
        <h1 className="text-2xl font-semibold text-foreground">Welcome to Prime Compute</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in with your email. Circle custodies your wallet; a PIN approves every action.
        </p>

        <ol className="mt-6 flex items-center justify-between text-xs">
          {LADDER.map((s, i) => {
            const reached = currentIndex(step) >= i;
            return (
              <li key={s.key} className="flex flex-1 flex-col items-center gap-1">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                    reached ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </span>
                <span className={reached ? "text-foreground" : "text-muted-foreground"}>{s.label}</span>
              </li>
            );
          })}
        </ol>

        <div className="mt-8 flex flex-col gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-md border border-input bg-background px-3 py-2.5 text-sm text-foreground"
          />
          <button
            disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())}
            onClick={run}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Working…" : "Continue with email"}
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
        )}
      </div>
    </Centered>
  );
}

function currentIndex(step: Step): number {
  if (step === "anonymous" || step === "error") return 0;
  if (step === "email") return 1;
  if (step === "wallet" || step === "verifying") return 2;
  return 3; // ready
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-background px-4">{children}</div>;
}
```

- [ ] **Step 2: Type-check + SSR smoke**

Run: `bunx tsc --noEmit`, then start the dev server and `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/onboarding`
Expected: clean; 200.

- [ ] **Step 3: Commit**

```bash
git add src/routes/onboarding.tsx
git commit -m "feat(identity): onboarding runs the circle email + PIN ceremony"
```

---

## Task 8: Passkey teardown

**Files:**
- Delete: `src/lib/circle/wallet.ts`, `src/lib/circle/passkey-ux.ts`, `src/lib/circle/passkey-ux.test.ts`, `src/lib/circle/chain.ts`, `src/lib/auth/bridge.ts`, `src/lib/auth/server-fns.ts`, `src/lib/auth/nonce.ts`, `src/lib/auth/nonce.test.ts`, `src/lib/auth/verify-ownership.ts`, `src/lib/auth/verify-ownership.test.ts`
- Modify: `src/components/site/Sidebar.tsx`, `package.json`

- [ ] **Step 1: Confirm nothing else imports the doomed modules**

Run: `grep -rn "circle/wallet\|passkey-ux\|auth/bridge\|auth/server-fns\|auth/nonce\|verify-ownership\|circle/chain" src/ --include="*.ts" --include="*.tsx" | grep -v "src/lib/circle/wallet.ts\|passkey-ux\|src/lib/auth/bridge.ts\|src/lib/auth/server-fns.ts\|src/lib/auth/nonce\|verify-ownership\|src/lib/circle/chain.ts"`
Expected: only `Sidebar.tsx` (the `walletChainSegment` import). If anything else shows up, migrate it before deleting.

- [ ] **Step 2: Fix Sidebar and delete**

In `src/components/site/Sidebar.tsx`, remove `import { walletChainSegment } from "@/lib/circle/chain";` and replace the `{walletChainSegment}` usage with the literal string `arcTestnet`.

```bash
git rm src/lib/circle/wallet.ts src/lib/circle/passkey-ux.ts src/lib/circle/passkey-ux.test.ts src/lib/circle/chain.ts \
       src/lib/auth/bridge.ts src/lib/auth/server-fns.ts src/lib/auth/nonce.ts src/lib/auth/nonce.test.ts \
       src/lib/auth/verify-ownership.ts src/lib/auth/verify-ownership.test.ts
bun remove @circle-fin/modular-wallets-core
```

(Note: `passkey-ux.ts`/`passkey-ux.test.ts` may be untracked; if `git rm` complains, plain `rm` them.)

Also delete `AUTH_NONCE_SECRET` from root `.env`/`.env.example` if documented there (nothing reads it anymore).

- [ ] **Step 3: Full app gates**

Run: `bun test src/lib && bunx tsc --noEmit && bun run build`
Expected: all green (the nonce/verify-ownership tests are gone with their modules).

- [ ] **Step 4: Commit**

```bash
git add -A src package.json bun.lock .env.example
git commit -m "feat(identity): retire the passkey modular wallet path"
```

---

## Task 9: WalletSheet — treasury balance + PIN-approved transfers

**Files:**
- Modify: `src/components/site/WalletSheet.tsx`

- [ ] **Step 1: Wire the treasury**

Changes to `WalletSheet.tsx` (structure otherwise untouched — spend balance, deposit card, spend-wallet withdraw, history all stay):

1. Add imports:

```tsx
import { getTreasuryBalance, treasuryTransferChallenge } from "@/lib/auth/circle-fns";
import { loadCircleSession, executeChallenge } from "@/lib/circle/user-sdk";
```

2. Add a treasury balance query next to the existing ones:

```tsx
  const { data: treasury } = useQuery({
    queryKey: ["treasury-wallet", accessToken],
    queryFn: () => getTreasuryBalance({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken && open,
    refetchInterval: 5000,
  });
```

3. Replace the passkey `AddressRow` (`label="Your wallet (passkey)"`) with:

```tsx
            <AddressRow
              label="Treasury (Circle wallet)"
              hint={treasury?.usdcFormatted ? `$${treasury.usdcFormatted} USDC` : "identity + treasury"}
              address={treasury?.address ?? walletAddress ?? "…"}
            />
```

4. Add a `TreasuryTransferFlow` card between the Deposit card and `WithdrawFlow` (fund the spend wallet, or send anywhere). Same multi-step pattern as `WithdrawFlow`:

```tsx
/* -------------------------------------------------------------------------- */
/* Treasury transfer: amount -> PIN challenge. Funds the spend wallet by       */
/* default; "someone else" reveals a destination field for external withdraws. */
/* -------------------------------------------------------------------------- */

function TreasuryTransferFlow({
  accessToken,
  spendWalletAddress,
}: {
  accessToken: string | undefined;
  spendWalletAddress: string | undefined;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [external, setExternal] = useState(false);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const destination = external ? to.trim() : (spendWalletAddress ?? "");
  const destinationValid = /^0x[0-9a-fA-F]{40}$/.test(destination);

  async function send() {
    if (!accessToken) return;
    const circle = loadCircleSession();
    if (!circle) {
      setError("Circle session expired — sign in again from Onboarding to approve transfers.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { challengeId } = await treasuryTransferChallenge({
        data: { accessToken, userToken: circle.userToken, amount: amount.trim(), destinationAddress: destination },
      });
      await executeChallenge(challengeId, circle); // Circle's PIN UI approves the move
      setDone(true);
      await queryClient.invalidateQueries({ queryKey: ["treasury-wallet"] });
      await queryClient.invalidateQueries({ queryKey: ["spend-wallet"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "transfer failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-card p-5 space-y-3">
      <h3 className="font-semibold text-sm">Fund spend wallet</h3>
      <p className="text-xs text-muted-foreground">
        Moves USDC from your treasury. You approve with your Circle PIN.
      </p>
      {done ? (
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2 rounded-lg bg-success/15 py-2.5 text-sm text-success">
            <Check className="h-4 w-4" /> Approved
          </div>
          <Button variant="ghost" className="w-full border border-border" onClick={() => { setDone(false); setAmount(""); }}>
            New transfer
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Label className="text-xs">Amount (USDC)</Label>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="font-mono bg-card border-border" />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={external} onChange={(e) => setExternal(e.target.checked)} />
            Send somewhere else instead
          </label>
          {external && (
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Destination address (0x…)" className="font-mono bg-card border-border" />
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={busy || !amount.trim() || !destinationValid}
            onClick={send}
          >
            {busy ? "Waiting for PIN…" : "Approve with PIN"}
          </Button>
        </div>
      )}
    </div>
  );
}
```

Mount it in the sheet body (after the Deposit card):

```tsx
          <TreasuryTransferFlow accessToken={accessToken} spendWalletAddress={data?.address} />
```

- [ ] **Step 2: Type-check + build**

Run: `bunx tsc --noEmit && bun run build`
Expected: clean + green.

- [ ] **Step 3: Commit**

```bash
git add src/components/site/WalletSheet.tsx
git commit -m "feat(identity): wallet sheet funds the spend wallet via a circle PIN challenge"
```

---

## Task 10: Env, docs, full gates

**Files:**
- Modify: root `.env.example`, root `.env`, `README.md` (env table if present)

- [ ] **Step 1: Env churn**

Root `.env.example`: remove `VITE_CIRCLE_CLIENT_KEY` / `VITE_CIRCLE_CLIENT_URL` / `AUTH_NONCE_SECRET` (passkey-era) and add:

```
# Circle user-controlled wallets (identity + treasury; email OTP + PIN).
# App ID from the developer console (probe-verified: the same account carries both the
# entity secret and this). Email login also needs the console's SMTP setting completed.
VITE_CIRCLE_APP_ID=b4abe630-9089-5bfb-a089-7c2b70eabdee
# Server-side verification + challenge creation (same key as services/.env).
CIRCLE_API_KEY=
```

Root `.env`: add `VITE_CIRCLE_APP_ID`, confirm `CIRCLE_API_KEY` is present (copy from `services/.env` if not), and remove the three passkey-era vars.

- [ ] **Step 2: Full gates**

Run: `bun test src/lib mcp/src && bunx tsc --noEmit && bun run build && cd services && bun test src/wallet && bunx tsc --noEmit`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs(identity): user-controlled wallet gate env"
```

---

## Task 11: Live acceptance (browser handoff)

WebAuthn is gone but the PIN/OTP ceremonies still need a real browser + inbox. Checklist for the user (after the SMTP console setting is done):

- [ ] Fresh registration: `/onboarding` → email → OTP from the inbox → Circle PIN setup → Arc wallet created → lands signed in; `profiles` has the wallet address + `circle_user_id`.
- [ ] Returning login: same email → OTP → straight to a session (no PIN-setup challenge), same profile row.
- [ ] Fund spend wallet: WalletSheet → amount → PIN approval → treasury balance drops, spend wallet balance rises (this also answers the **gas model** question: watch whether Circle's `feeLevel: MEDIUM` fee comes out of the wallet's USDC on Arc; note the observed fee in the memory/plan).
- [ ] External withdraw: "Send somewhere else" → PIN → arrives at the destination.
- [ ] A rejected token: clear `sessionStorage` mid-session and hit "Approve with PIN" — should get the "sign in again" error, not a crash.

---

## Self-review notes

- **Spec coverage:** front door email OTP (Tasks 5-7), bridge steps 1-4 (Tasks 2, 4, 5; C1-C5 preserved via `mintSessionForWallet` keyed on wallet address), `circle_user_id` (Tasks 1, 3, 4), treasury actions incl. fund-spend-wallet + external withdraw with unchanged sheet structure (Task 9), migration = fresh start + passkey removal (Task 8), gate-zero outcomes locked (header), testing section (bridge stub tests Task 4, seam tests Task 2, onboarding SSR Task 7, live acceptance Task 11). Social login, identity migration, streaming changes, display-name: out of scope, untouched.
- **Placeholder scan:** the one deliberate soft spot is `getTreasuryBalance`'s call into `makeOnchain` — the exact method name must be mirrored from `src/lib/wallet/server-fns.ts` at execution time (called out inline in Task 5).
- **Type consistency:** `CircleUserGate.{startEmailLogin,status,arcWallet,createArcWalletChallenge,createTransferChallenge}` (Tasks 2, 5); `CircleBridgeDeps`/`circleGateLogin` result union `{kind:"challenge"|"session"}` (Tasks 4, 5, 7); `mintSessionForWallet({address,walletId,circleUserId?})` (Tasks 3, 4, 5); `CircleSession {userToken,encryptionKey,refreshToken?}` (Tasks 6, 7, 9); server-fns `startEmailLogin`/`completeCircleLogin`/`treasuryTransferChallenge`/`getTreasuryBalance` (Tasks 5, 7, 9).
- **Known judgment calls:** Circle session triple in `sessionStorage` (PIN still gates funds; tab-scoped beats localStorage); `circle_user_id` stamped by service-role UPDATE after find-or-create rather than widening the `handle_new_user` trigger (keeps the shared-auth.users trigger machinery untouched per spec, and backfills pre-v2 profiles on first Circle login); token expiry handled by re-running the email OTP rather than `refreshUserToken` (YAGNI for v1; the refresh token is saved so it's an additive follow-up).

## Execution handoff

Ordering: Task 1 (schema) and Task 2 (seam) are independent; 3→4→5 build the bridge; 6→7 the client ceremony; 8 tears down passkey only after 7 replaces it; 9 rides on 5+6; 10-11 close out. Tasks 5-7 can only be verified live after the user completes the Circle console SMTP setting (Prerequisite 1). Task 11 needs a real browser + inbox.
