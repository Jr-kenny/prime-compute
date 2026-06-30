# Per-user spend wallets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every user their own Arc EOA spend wallet, custodied server-side with the private key encrypted at rest, with live balance, deposit, and withdraw surfaced in the app.

**Architecture:** A new `services/src/wallet/` module owns the wallet: a Web Crypto AES-256-GCM cipher, a `SpendWalletStore` (in-memory + Supabase) that persists the encrypted key, and an on-chain helper that reads USDC balance and signs USDC transfers on Arc. The frontend reaches it through two TanStack Start server functions. Encryption uses Web Crypto (`crypto.subtle`) so the exact same code runs in the Cloudflare Worker web runtime and the Bun metering worker (plan 2).

**Tech Stack:** Bun + TypeScript (services), viem (Arc reads/writes), Web Crypto (encryption), Supabase (storage), TanStack Start server fns + React Query (frontend), this is the foundation the metering worker (plan 2) builds on.

This plan is spec 1, layer 1 of `docs/superpowers/specs/2026-06-30-live-nano-payments-design.md`. After it lands a user can create, view, fund, and empty their own spend wallet; the metering worker that spends from it is plan 2.

---

## File structure

- `services/src/wallet/crypto.ts` — Web Crypto AES-256-GCM encrypt/decrypt of the private key. One job: turn a key string into ciphertext and back.
- `services/src/wallet/store.ts` — `SpendWalletStore` interface + `InMemorySpendWalletStore`. Owns get-or-create and signer loading. No chain, no crypto details leaking out.
- `services/src/wallet/supabase-store.ts` — `SupabaseSpendWalletStore`, the persistent implementation.
- `services/src/wallet/onchain.ts` — Arc USDC balance read and transfer via viem. The only place that touches the chain.
- `services/src/wallet/config.ts` — reads the wallet env (`ARC_RPC_URL`, `ARC_CHAIN_ID`, `USDC_ADDRESS`, `SPEND_WALLET_ENC_KEY`) once.
- `services/supabase/migrations/0006_spend_wallets.sql` — the table.
- `src/lib/wallet/store.ts` — server-only singleton wiring `SupabaseSpendWalletStore` to the app's Supabase admin client (mirrors `src/lib/broker/registry.ts`).
- `src/lib/wallet/server-fns.ts` — `getSpendWalletBalance`, `withdrawFromSpendWallet`.
- `src/routes/wallet.tsx` — the Wallet surface (balance, address + QR, deposit, withdraw, spend history).
- `src/components/site/WalletBalance.tsx` — the small balance chip reused on the dashboard and in Lumen.

---

## Task 1: Encryption module

**Files:**
- Create: `services/src/wallet/crypto.ts`
- Test: `services/src/wallet/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/src/wallet/crypto.test.ts
import { expect, test, describe } from "bun:test";
import { encryptSecret, decryptSecret, generateEncKey } from "./crypto";

describe("wallet crypto", () => {
  test("round-trips a secret", async () => {
    const key = await generateEncKey();
    const secret = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    const blob = await encryptSecret(secret, key);
    expect(blob).not.toContain(secret); // ciphertext, not plaintext
    expect(await decryptSecret(blob, key)).toBe(secret);
  });

  test("rejects a tampered blob", async () => {
    const key = await generateEncKey();
    const blob = await encryptSecret("hello", key);
    const tampered = blob.slice(0, -2) + (blob.endsWith("AA") ? "BB" : "AA");
    await expect(decryptSecret(tampered, key)).rejects.toThrow();
  });

  test("rejects the wrong key", async () => {
    const blob = await encryptSecret("hello", await generateEncKey());
    await expect(decryptSecret(blob, await generateEncKey())).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services && bun test src/wallet/crypto.test.ts`
Expected: FAIL, "Cannot find module './crypto'".

- [ ] **Step 3: Write the implementation**

```ts
// services/src/wallet/crypto.ts
// AES-256-GCM via Web Crypto so the SAME code runs in the Cloudflare Worker web
// runtime and the Bun metering worker. node:crypto is NOT available in CF Workers.
// SPEND_WALLET_ENC_KEY is a base64-encoded 32-byte key.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = b64decode(base64Key);
  if (raw.length !== 32) throw new Error("SPEND_WALLET_ENC_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// Returns base64(iv[12] || ciphertext+tag).
export async function encryptSecret(plaintext: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64encode(out);
}

export async function decryptSecret(blob: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const bytes = b64decode(blob);
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct); // throws on tamper/wrong key
  return dec.decode(pt);
}

// Convenience for tests and one-off key generation (print to set SPEND_WALLET_ENC_KEY).
export async function generateEncKey(): Promise<string> {
  return b64encode(crypto.getRandomValues(new Uint8Array(32)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services && bun test src/wallet/crypto.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/wallet/crypto.ts services/src/wallet/crypto.test.ts
git commit -m "feat(wallet): AES-256-GCM secret crypto on Web Crypto"
```

---

## Task 2: Spend-wallet store interface and in-memory implementation

**Files:**
- Create: `services/src/wallet/store.ts`
- Test: `services/src/wallet/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/src/wallet/store.test.ts
import { expect, test, describe } from "bun:test";
import { InMemorySpendWalletStore } from "./store";
import { generateEncKey } from "./crypto";

describe("InMemorySpendWalletStore", () => {
  test("get-or-create is idempotent and returns a real address", async () => {
    const store = new InMemorySpendWalletStore(await generateEncKey());
    const a = await store.getOrCreate("user-1");
    const b = await store.getOrCreate("user-1");
    expect(a.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(b.address).toBe(a.address); // same user -> same wallet
  });

  test("different users get different wallets", async () => {
    const store = new InMemorySpendWalletStore(await generateEncKey());
    const a = await store.getOrCreate("user-1");
    const b = await store.getOrCreate("user-2");
    expect(b.address).not.toBe(a.address);
  });

  test("loadSigner returns the matching key, getAddress reads without creating", async () => {
    const store = new InMemorySpendWalletStore(await generateEncKey());
    expect(await store.getAddress("ghost")).toBeNull();
    const { address } = await store.getOrCreate("user-1");
    const signer = await store.loadSigner("user-1");
    expect(signer?.address.toLowerCase()).toBe(address.toLowerCase());
    expect(signer?.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services && bun test src/wallet/store.test.ts`
Expected: FAIL, "Cannot find module './store'".

- [ ] **Step 3: Write the implementation**

```ts
// services/src/wallet/store.ts
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encryptSecret, decryptSecret } from "./crypto";

export type SpendWallet = { address: string };
export type SpendSigner = { address: string; privateKey: `0x${string}` };

// One wallet per user. The encrypted private key never leaves the server/worker.
export interface SpendWalletStore {
  getOrCreate(userId: string): Promise<SpendWallet>;
  getAddress(userId: string): Promise<string | null>;
  loadSigner(userId: string): Promise<SpendSigner | null>; // server/worker-only
}

type Row = { address: string; encPrivateKey: string };

export class InMemorySpendWalletStore implements SpendWalletStore {
  private rows = new Map<string, Row>();
  constructor(private encKey: string) {}

  async getOrCreate(userId: string): Promise<SpendWallet> {
    const existing = this.rows.get(userId);
    if (existing) return { address: existing.address };
    const pk = generatePrivateKey();
    const address = privateKeyToAccount(pk).address;
    this.rows.set(userId, { address, encPrivateKey: await encryptSecret(pk, this.encKey) });
    return { address };
  }

  async getAddress(userId: string): Promise<string | null> {
    return this.rows.get(userId)?.address ?? null;
  }

  async loadSigner(userId: string): Promise<SpendSigner | null> {
    const row = this.rows.get(userId);
    if (!row) return null;
    const privateKey = (await decryptSecret(row.encPrivateKey, this.encKey)) as `0x${string}`;
    return { address: row.address, privateKey };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services && bun test src/wallet/store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/wallet/store.ts services/src/wallet/store.test.ts
git commit -m "feat(wallet): SpendWalletStore interface + in-memory impl"
```

---

## Task 3: Spend-wallet table migration

**Files:**
- Create: `services/supabase/migrations/0006_spend_wallets.sql`

- [ ] **Step 1: Write the migration**

```sql
-- services/supabase/migrations/0006_spend_wallets.sql
-- Per-user Arc spend wallet. The EOA that streams a user's nano-payments and whose
-- balance the app shows. The passkey Modular Wallet stays identity-only; this is the
-- payer. enc_private_key is AES-256-GCM ciphertext (Web Crypto, key = SPEND_WALLET_ENC_KEY)
-- and is service-role only: NO client RLS policy, never selectable from the browser,
-- never returned by any server function.

create table if not exists spend_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  address text not null unique,
  enc_private_key text not null,
  created_at timestamptz not null default now()
);

-- RLS on with no policies = service role only (the app already talks to this table
-- exclusively through the service-role client). This DB is shared with PrimeBot;
-- this table is new and unreferenced by it.
alter table spend_wallets enable row level security;
```

- [ ] **Step 2: Apply to the live Supabase project**

This DB is the shared PrimeBot project (`xwxuqcougmanzonypoym`). Apply the migration through the Supabase MCP `apply_migration` tool (name `0006_spend_wallets`) or the dashboard SQL editor. The change is purely additive (one new table), so it does not touch any existing table.

Expected: `spend_wallets` listed by `list_tables`, with RLS enabled and zero policies.

- [ ] **Step 3: Commit**

```bash
git add services/supabase/migrations/0006_spend_wallets.sql
git commit -m "feat(wallet): spend_wallets table migration (service-role only)"
```

---

## Task 4: Supabase spend-wallet store

**Files:**
- Create: `services/src/wallet/supabase-store.ts`
- Test: `services/src/wallet/supabase-store.test.ts`

- [ ] **Step 1: Write the failing test**

This test runs against the live Supabase project, mirroring how `services/src/registry/supabase.test.ts` is gated. It is skipped unless `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SPEND_WALLET_ENC_KEY` are set.

```ts
// services/src/wallet/supabase-store.test.ts
import { expect, test, describe, afterAll } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import { SupabaseSpendWalletStore } from "./supabase-store";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const encKey = process.env.SPEND_WALLET_ENC_KEY;
const gated = url && key && encKey ? describe : describe.skip;

gated("SupabaseSpendWalletStore (live)", () => {
  const admin = createClient(url!, key!, { auth: { persistSession: false } });
  const store = new SupabaseSpendWalletStore(admin, encKey!);
  const userId = crypto.randomUUID();

  afterAll(async () => {
    await admin.from("spend_wallets").delete().eq("user_id", userId);
  });

  test("creates once, reads back the same address, loads the matching signer", async () => {
    const a = await store.getOrCreate(userId);
    const b = await store.getOrCreate(userId);
    expect(b.address).toBe(a.address);
    expect(await store.getAddress(userId)).toBe(a.address);
    const signer = await store.loadSigner(userId);
    expect(signer?.address.toLowerCase()).toBe(a.address.toLowerCase());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services && bun test src/wallet/supabase-store.test.ts`
Expected: FAIL, "Cannot find module './supabase-store'".

- [ ] **Step 3: Write the implementation**

```ts
// services/src/wallet/supabase-store.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encryptSecret, decryptSecret } from "./crypto";
import type { SpendWalletStore, SpendWallet, SpendSigner } from "./store";

export class SupabaseSpendWalletStore implements SpendWalletStore {
  constructor(private db: SupabaseClient, private encKey: string) {}

  async getOrCreate(userId: string): Promise<SpendWallet> {
    const found = await this.getAddress(userId);
    if (found) return { address: found };

    const pk = generatePrivateKey();
    const address = privateKeyToAccount(pk).address;
    const enc_private_key = await encryptSecret(pk, this.encKey);
    const { error } = await this.db
      .from("spend_wallets")
      .insert({ user_id: userId, address, enc_private_key });
    // A concurrent create may have won the race; re-read rather than fail.
    if (error) {
      const again = await this.getAddress(userId);
      if (again) return { address: again };
      throw error;
    }
    return { address };
  }

  async getAddress(userId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from("spend_wallets")
      .select("address")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return (data?.address as string | undefined) ?? null;
  }

  async loadSigner(userId: string): Promise<SpendSigner | null> {
    const { data, error } = await this.db
      .from("spend_wallets")
      .select("address, enc_private_key")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const privateKey = (await decryptSecret(data.enc_private_key as string, this.encKey)) as `0x${string}`;
    return { address: data.address as string, privateKey };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services && SPEND_WALLET_ENC_KEY=$(bun -e 'console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"))') bun test src/wallet/supabase-store.test.ts`
Expected: PASS (1 test), or SKIP if env is unset. (Set a real persistent `SPEND_WALLET_ENC_KEY` in `services/.env` and root `.env` for app use; the inline one above is only to exercise the test.)

- [ ] **Step 5: Commit**

```bash
git add services/src/wallet/supabase-store.ts services/src/wallet/supabase-store.test.ts
git commit -m "feat(wallet): Supabase spend-wallet store"
```

---

## Task 5: On-chain helpers (Arc USDC balance + transfer)

**Files:**
- Create: `services/src/wallet/config.ts`
- Create: `services/src/wallet/onchain.ts`
- Test: `services/src/wallet/onchain.test.ts`

- [ ] **Step 1: Write the wallet config loader**

```ts
// services/src/wallet/config.ts
type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

// Arc chain + USDC + encryption key, read once. Spend wallets live on Arc (settlement
// already runs there); the passkey identity wallet's baseSepolia chain is unrelated.
export function loadWalletConfig(env: Env = process.env) {
  return {
    rpcUrl: required(env, "ARC_RPC_URL"),
    chainId: Number(required(env, "ARC_CHAIN_ID")),
    explorerUrl: env.ARC_EXPLORER_URL ?? "",
    usdc: required(env, "USDC_ADDRESS") as `0x${string}`,
    encKey: required(env, "SPEND_WALLET_ENC_KEY"),
  };
}

export type WalletConfig = ReturnType<typeof loadWalletConfig>;
```

- [ ] **Step 2: Write the failing test**

This test asserts the pure ABI-encoding/decoding seam without hitting the network: `onchain.ts` exposes a thin `erc20` helper object the chain calls go through, which the test stubs.

```ts
// services/src/wallet/onchain.test.ts
import { expect, test, describe } from "bun:test";
import { makeOnchain } from "./onchain";

const cfg = {
  rpcUrl: "http://localhost:0",
  chainId: 9999,
  explorerUrl: "",
  usdc: "0x0000000000000000000000000000000000000001" as `0x${string}`,
  encKey: "x",
};

describe("onchain USDC", () => {
  test("usdcBalance reads balanceOf for the given address", async () => {
    const calls: unknown[] = [];
    const onchain = makeOnchain(cfg, {
      readContract: async (args) => {
        calls.push(args);
        return 1_500_000n; // 1.5 USDC (6 decimals)
      },
      writeTransfer: async () => "0xhash",
    });
    const bal = await onchain.usdcBalance("0x00000000000000000000000000000000000000aa");
    expect(bal).toBe(1_500_000n);
    expect((calls[0] as { functionName: string }).functionName).toBe("balanceOf");
  });

  test("usdcTransfer rejects an over-balance amount before signing", async () => {
    const onchain = makeOnchain(cfg, {
      readContract: async () => 100n,
      writeTransfer: async () => "0xhash",
    });
    await expect(
      onchain.usdcTransfer(
        { address: "0x00000000000000000000000000000000000000aa", privateKey: ("0x" + "1".repeat(64)) as `0x${string}` },
        "0x00000000000000000000000000000000000000bb",
        200n,
      ),
    ).rejects.toThrow(/insufficient/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services && bun test src/wallet/onchain.test.ts`
Expected: FAIL, "Cannot find module './onchain'".

- [ ] **Step 4: Write the implementation**

```ts
// services/src/wallet/onchain.ts
import { createPublicClient, createWalletClient, http, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcChain } from "../arc";
import type { WalletConfig } from "./config";
import type { SpendSigner } from "./store";

// The chain calls are injected so the unit test runs without a network. In production
// makeOnchain(cfg) builds the real viem-backed seam.
export type ChainIO = {
  readContract: (args: {
    address: `0x${string}`;
    abi: typeof erc20Abi;
    functionName: "balanceOf";
    args: [`0x${string}`];
  }) => Promise<bigint>;
  writeTransfer: (signer: SpendSigner, to: `0x${string}`, amount: bigint) => Promise<`0x${string}`>;
};

export function makeOnchain(cfg: WalletConfig, io: ChainIO = realChainIO(cfg)) {
  return {
    async usdcBalance(address: string): Promise<bigint> {
      return io.readContract({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      });
    },
    async usdcTransfer(signer: SpendSigner, to: string, amount: bigint): Promise<`0x${string}`> {
      if (amount <= 0n) throw new Error("amount must be positive");
      const bal = await io.readContract({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [signer.address as `0x${string}`],
      });
      if (amount > bal) throw new Error("insufficient balance");
      return io.writeTransfer(signer, to as `0x${string}`, amount);
    },
  };
}

function realChainIO(cfg: WalletConfig): ChainIO {
  const chain = arcChain(cfg.chainId, cfg.rpcUrl, cfg.explorerUrl);
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  return {
    readContract: (args) => publicClient.readContract(args) as Promise<bigint>,
    writeTransfer: (signer, to, amount) => {
      const wallet = createWalletClient({
        account: privateKeyToAccount(signer.privateKey),
        chain,
        transport: http(cfg.rpcUrl),
      });
      return wallet.writeContract({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "transfer",
        args: [to, amount],
      });
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services && bun test src/wallet/onchain.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add services/src/wallet/config.ts services/src/wallet/onchain.ts services/src/wallet/onchain.test.ts
git commit -m "feat(wallet): Arc USDC balance read + guarded transfer"
```

---

## Task 6: Frontend store singleton

**Files:**
- Create: `src/lib/wallet/store.ts`

- [ ] **Step 1: Write the singleton (mirrors `src/lib/broker/registry.ts`)**

```ts
// src/lib/wallet/store.ts
import { supabaseAdmin } from "../supabase/server";
import { SupabaseSpendWalletStore } from "@services/wallet/supabase-store";
import { loadWalletConfig } from "@services/wallet/config";
import { makeOnchain } from "@services/wallet/onchain";

let store: SupabaseSpendWalletStore | null = null;

export function getSpendWalletStore(): SupabaseSpendWalletStore {
  const cfg = loadWalletConfig();
  store ??= new SupabaseSpendWalletStore(supabaseAdmin(), cfg.encKey);
  return store;
}

export function getOnchain() {
  return makeOnchain(loadWalletConfig());
}
```

- [ ] **Step 2: Type-check**

Run: `bun run build` (or `bunx tsc --noEmit` if configured)
Expected: no type errors from this file. (The `@services/*` alias already resolves; it is used throughout `src/lib/broker/`.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/wallet/store.ts
git commit -m "feat(wallet): frontend spend-wallet store singleton"
```

---

## Task 7: Balance and withdraw server functions

**Files:**
- Create: `src/lib/wallet/server-fns.ts`

- [ ] **Step 1: Write the server functions**

```ts
// src/lib/wallet/server-fns.ts
import { createServerFn } from "@tanstack/react-start";
import { requireUser } from "../auth/require-user";
import { getSpendWalletStore, getOnchain } from "./store";

// USDC has 6 decimals. Atomic -> human string for the UI.
function formatUsdc(atomic: bigint): string {
  const neg = atomic < 0n;
  const v = (neg ? -atomic : atomic).toString().padStart(7, "0");
  const whole = v.slice(0, v.length - 6);
  const frac = v.slice(v.length - 6).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

// Returns the user's spend-wallet address and live USDC balance on Arc. Creates the
// wallet on first call so a brand-new user immediately has an address to fund.
export const getSpendWalletBalance = createServerFn({ method: "GET" })
  .validator((d: { accessToken: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    const { address } = await getSpendWalletStore().getOrCreate(user.id);
    const usdcAtomic = await getOnchain().usdcBalance(address);
    return {
      address,
      usdcAtomic: usdcAtomic.toString(),
      usdcFormatted: formatUsdc(usdcAtomic),
    };
  });

// Signs an ERC-20 USDC transfer out of the user's spend wallet on Arc. The signer (and
// thus the private key) never leaves the server. Amount is a decimal USDC string.
export const withdrawFromSpendWallet = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; toAddress: string; amount: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    if (!/^0x[0-9a-fA-F]{40}$/.test(data.toAddress)) throw new Error("invalid destination address");
    const atomic = parseUsdc(data.amount);
    if (atomic <= 0n) throw new Error("amount must be positive");

    const signer = await getSpendWalletStore().loadSigner(user.id);
    if (!signer) throw new Error("no spend wallet for user");
    const txHash = await getOnchain().usdcTransfer(signer, data.toAddress, atomic);
    return { txHash };
  });

function parseUsdc(s: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(s.trim())) throw new Error("invalid amount");
  const [whole, frac = ""] = s.trim().split(".");
  return BigInt(whole + frac.padEnd(6, "0"));
}
```

- [ ] **Step 2: Type-check**

Run: `bun run build`
Expected: no type errors. `createServerFn` usage matches the existing pattern in `src/lib/broker/server-fns.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/wallet/server-fns.ts
git commit -m "feat(wallet): balance + withdraw server functions"
```

---

## Task 8: Reusable balance chip

**Files:**
- Create: `src/components/site/WalletBalance.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/site/WalletBalance.tsx
import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { useSession } from "@/lib/auth/session";
import { getSpendWalletBalance } from "@/lib/wallet/server-fns";

// Live spend-wallet balance. Polls so it visibly drops while the meter (plan 2) runs.
export function WalletBalance({ className = "" }: { className?: string }) {
  const { session } = useSession();
  const accessToken = session?.access_token;
  const { data } = useQuery({
    queryKey: ["spend-wallet", accessToken],
    queryFn: () => getSpendWalletBalance({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken,
    refetchInterval: 5000,
  });
  if (!accessToken) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-sm ${className}`}>
      <Wallet className="h-4 w-4 text-glow" />
      {data ? `$${data.usdcFormatted} USDC` : "…"}
    </span>
  );
}
```

- [ ] **Step 2: Mount it on the dashboard header**

In `src/routes/dashboard.tsx`, import `WalletBalance` and render it in the header row next to the "streaming" line (around line 64-72, inside the `flex flex-wrap` stats row):

```tsx
import { WalletBalance } from "@/components/site/WalletBalance";
// ...inside the stats row:
<WalletBalance />
```

- [ ] **Step 3: Replace Lumen's removed balance**

In `src/components/site/LumenOverlay.tsx`, render `<WalletBalance />` in the header (next to the "AI broker" subtitle, around line 180), so Lumen shows the real balance the old fake `$1,284.93` used to occupy.

- [ ] **Step 4: Verify in the browser**

Run: `bun run dev`, sign in, open the dashboard and Lumen.
Expected: a real `$… USDC` chip appears (0 for a fresh wallet), and the spend-wallet row exists in Supabase `spend_wallets` for the user.

- [ ] **Step 5: Commit**

```bash
git add src/components/site/WalletBalance.tsx src/routes/dashboard.tsx src/components/site/LumenOverlay.tsx
git commit -m "feat(wallet): live balance chip on dashboard and Lumen"
```

---

## Task 9: Wallet surface (address, deposit, withdraw, history)

**Files:**
- Create: `src/routes/wallet.tsx`
- Modify: `src/components/site/Sidebar.tsx` (add a Wallet nav entry)

- [ ] **Step 1: Write the route**

```tsx
// src/routes/wallet.tsx
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { AppShell } from "@/components/site/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authGuard } from "@/lib/auth/guard";
import { useSession } from "@/lib/auth/session";
import { getSpendWalletBalance, withdrawFromSpendWallet } from "@/lib/wallet/server-fns";

export const Route = createFileRoute("/wallet")({
  beforeLoad: authGuard,
  head: () => ({ meta: [{ title: "Wallet — Prime Compute" }] }),
  component: WalletPage,
});

function WalletPage() {
  const { session } = useSession();
  const accessToken = session?.access_token;
  const queryClient = useQueryClient();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["spend-wallet", accessToken],
    queryFn: () => getSpendWalletBalance({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken,
    refetchInterval: 5000,
  });

  async function withdraw() {
    if (!accessToken) return;
    setBusy(true);
    setMsg(null);
    try {
      const { txHash } = await withdrawFromSpendWallet({ data: { accessToken, toAddress: to, amount } });
      setMsg(`Sent. Tx ${txHash.slice(0, 10)}…`);
      setTo("");
      setAmount("");
      await queryClient.invalidateQueries({ queryKey: ["spend-wallet"] });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "withdraw failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 space-y-6">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-glow">Wallet</div>
          <h1 className="mt-1 text-3xl md:text-4xl font-bold">Your spend wallet</h1>
        </div>

        <div className="glass-card p-6">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Balance</div>
          <div className="mt-2 text-3xl font-bold font-mono">${data?.usdcFormatted ?? "…"} USDC</div>
          <div className="mt-3 flex items-center gap-2">
            <Input readOnly value={data?.address ?? ""} className="font-mono bg-card border-border text-xs" />
            <Button
              variant="ghost"
              size="icon"
              className="border border-border"
              onClick={() => data && navigator.clipboard.writeText(data.address)}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="glass-card p-6 space-y-2">
          <h3 className="font-semibold">Deposit</h3>
          <p className="text-sm text-muted-foreground">
            Send USDC on Arc to the address above to fund streaming. Need testnet USDC?{" "}
            <a className="text-glow underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
              Circle faucet
            </a>
            .
          </p>
        </div>

        <div className="glass-card p-6 space-y-4">
          <h3 className="font-semibold">Withdraw</h3>
          <div className="space-y-2">
            <Label>Destination address</Label>
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" className="font-mono bg-card border-border" />
          </div>
          <div className="space-y-2">
            <Label>Amount (USDC)</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="font-mono bg-card border-border" />
          </div>
          <Button onClick={withdraw} disabled={busy || !to || !amount} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {busy ? "Sending…" : "Withdraw"}
          </Button>
          {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        </div>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 2: Add the nav entry**

In `src/components/site/Sidebar.tsx`, add a link to `/wallet` (follow the existing nav-item pattern in that file; use the `Wallet` icon from `lucide-react`).

- [ ] **Step 3: Regenerate the route tree and verify**

Run: `bun run dev` (TanStack regenerates `src/routeTree.gen.ts` on dev start).
Expected: `/wallet` loads behind the auth guard, shows the real address and balance, the faucet link works, and a withdraw to a valid address returns a tx hash (or a clear error if the wallet is empty).

- [ ] **Step 4: Commit**

```bash
git add src/routes/wallet.tsx src/components/site/Sidebar.tsx src/routeTree.gen.ts
git commit -m "feat(wallet): wallet page with address, deposit, withdraw"
```

---

## Task 10: Spend history

**Files:**
- Create: `src/lib/wallet/history-fns.ts`
- Modify: `src/routes/wallet.tsx` (render the list)

- [ ] **Step 1: Write the history server function**

The user's charges across all their rents form the spend history. Add a server fn that joins the user's rents to their charges via the existing registry.

```ts
// src/lib/wallet/history-fns.ts
import { createServerFn } from "@tanstack/react-start";
import { requireUser } from "../auth/require-user";
import { getRegistry } from "../broker/registry";

// Flat list of the user's nano-charges, newest first, for the wallet history view.
export const listMySpend = createServerFn({ method: "GET" })
  .validator((d: { accessToken: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    const registry = getRegistry();
    const rents = await registry.listRents({ userId: user.id });
    const rows: { rentName: string; amountAtomic: number; settled: boolean; createdAt: string }[] = [];
    for (const r of rents) {
      const charges = await registry.listCharges(r.id);
      for (const c of charges) {
        rows.push({ rentName: r.name, amountAtomic: c.amount, settled: c.settled, createdAt: c.createdAt });
      }
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows;
  });
```

- [ ] **Step 2: Render it in the wallet page**

In `src/routes/wallet.tsx`, add a `useQuery` for `listMySpend` and a "Spend history" `glass-card` below withdraw that maps the rows to a small table (rent name, amount as `$ (amountAtomic/1e6).toFixed(6)`, settled/pending, date). Show an empty state when there are no charges yet.

- [ ] **Step 3: Verify**

Run: `bun run dev`, open `/wallet`.
Expected: empty history for a new user; once plan 2's meter has run, real charges appear here.

- [ ] **Step 4: Commit**

```bash
git add src/lib/wallet/history-fns.ts src/routes/wallet.tsx
git commit -m "feat(wallet): spend history from the charge ledger"
```

---

## Task 11: Environment and docs

**Files:**
- Modify: `services/.env`, root `.env` (local only, gitignored), `services/.env.example`, `README.md`

- [ ] **Step 1: Generate and set the encryption key**

Run: `cd services && bun -e 'console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"))'`
Add the output as `SPEND_WALLET_ENC_KEY=<value>` to BOTH `services/.env` and root `.env` (the web app's server fns read root `.env`; the metering worker reads `services/.env`). Use the SAME value in both, or wallets created in one runtime cannot be decrypted in the other.

- [ ] **Step 2: Document it**

Add `SPEND_WALLET_ENC_KEY` (with a one-line "base64 32-byte AES-256-GCM key, must match across web and worker") to `services/.env.example`, and a sentence in `README.md`'s env section. Confirm `USDC_ADDRESS`, `ARC_RPC_URL`, `ARC_CHAIN_ID` are present in `services/.env` (they are) and add `VITE`-free `ARC_RPC_URL`/`ARC_CHAIN_ID`/`USDC_ADDRESS` to root `.env` so the web server fns reach Arc.

- [ ] **Step 3: Commit**

```bash
git add services/.env.example README.md
git commit -m "docs(wallet): document SPEND_WALLET_ENC_KEY and Arc spend env"
```

---

## Self-review notes

- **Spec coverage (spec 1 wallet pieces):** per-user EOA store (Tasks 2,4) ✓; encrypted at rest, service-role only, never returned over the wire (Tasks 1,3,7) ✓; balance read on Arc (Tasks 5,7,8) ✓; deposit via address + faucet (Task 9) ✓; withdraw signs ERC-20 transfer (Tasks 5,7,9) ✓; spend history from charges (Task 10) ✓; balance on dashboard + Lumen (Task 8) ✓; chain is Arc (Task 5 config) ✓. Deferred to plan 2 (correctly out of this plan): the metering worker, `ensureFunded` EOA→Gateway, `suspended` lifecycle, connect credentials, seed provider, low-balance warning wiring (the chip exists; the threshold alert ties to the worker).
- **Type consistency:** `SpendWalletStore` / `SpendWallet` / `SpendSigner` used identically in Tasks 2, 4, 5, 6. `makeOnchain(cfg, io?)` signature matches its test and its caller in Task 6. `getSpendWalletBalance` return shape (`address`, `usdcAtomic`, `usdcFormatted`) matches its consumers in Tasks 8 and 9.
- **No placeholders:** every code step has full code; Tasks 8-step-2/3, 9-step-2, 10-step-2 describe edits to existing files in prose because they are small insertions into files whose surrounding code is shown by line reference, not new logic.

---

## Execution handoff

This is plan 1 of spec 1. Plan 2 (the metering worker: provision queued leases, stream real per-second charges from these wallets, `ensureFunded` EOA→Gateway, the `suspended` lifecycle, connect credentials, seed provider, and the always-on Render host) is written separately and depends on this one.
