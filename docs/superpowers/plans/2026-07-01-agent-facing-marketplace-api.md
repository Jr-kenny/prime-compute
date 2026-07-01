# Agent-facing marketplace API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let autonomous agents self-register, fund their own Arc wallet, and rent compute or list servers through a versioned REST API (`/api/v1/`) plus a thin MCP wrapper, all machine-to-machine with no human approval.

**Architecture:** Two authenticators (`requireUser`, `requireAgent`) resolve to one `Principal`; a principal-parameterized service layer is the single business-logic path. Agents are a new principal type with their own tables and permanent Arc wallet. The REST API lives as TanStack Start API routes inside the existing Cloudflare-Worker app and reuses the registry + wallet crypto. The metering worker stays the sole authority for lease lifecycle and billing. A standalone MCP server wraps the REST API with zero business logic.

**Tech Stack:** TanStack Start (React, SSR, Cloudflare Worker), Bun + TypeScript, the `@services` registry/wallet/settlement modules, Supabase (service-role), Web Crypto (`crypto.subtle`), `@modelcontextprotocol/sdk`.

This implements `docs/superpowers/specs/2026-07-01-agent-facing-marketplace-api-design.md`. It is phased: Phase 1 (agent identity), Phase 2 (rent ownership + service layer), Phase 3 (REST v1), Phase 4 (MCP). Each phase ends green and is independently testable.

---

## File structure

- `services/src/domain.ts` - add the shared `Principal` type; `Rent.userId` becomes nullable; add `Rent.agentId`.
- `services/supabase/migrations/0008_agents.sql` - agents/agent_wallets/agent_api_keys tables + rents ownership columns.
- `services/src/wallet/supabase-store.ts` - generalize the Supabase wallet store to a configurable table/id column.
- `services/src/registry/*` - `NewRent` takes `owner: Principal`; `RentFilter` gains `agentId`; both impls + contract.
- `src/lib/agents/keys.ts` - `generateApiKey` + `hashApiKey` (pure, Web Crypto).
- `src/lib/agents/store.ts` - `createAgent` and `requireAgent` (Supabase-backed, returns a `Principal`).
- `src/lib/marketplace/service.ts` - the principal-parameterized service layer (rent + provider + wallet ops).
- `src/lib/marketplace/wallet.ts` - `walletStoreFor(principal)` picking user vs agent wallet store.
- `src/lib/agents/http.ts` - REST helpers: bearer extraction, `requireAgent` -> principal, JSON + error responses.
- `src/routes/api.v1.agents.ts`, `api.v1.wallet.ts`, `api.v1.providers.ts`, `api.v1.providers.mine.ts`, `api.v1.rents.ts`, `api.v1.rents.$id.ts`, `api.v1.rents.$id.cancel.ts` - the REST routes.
- `src/lib/broker/server-fns.ts` - migrate the human rent/provider fns onto the service layer.
- `mcp/` - standalone MCP server package (`package.json`, `src/index.ts`, `src/client.ts`, tests).

---

# Phase 1: Agent identity

## Task 1: Migration 0008 (agent tables + rent ownership)

**Files:**
- Create: `services/supabase/migrations/0008_agents.sql`

- [ ] **Step 1: Write the migration**

```sql
-- services/supabase/migrations/0008_agents.sql
-- Autonomous agents are a first-class principal alongside human users. They self-register, hold a
-- permanent Arc spend wallet, and authenticate with hashed API keys. Rents gain an explicit agent
-- owner beside the existing user owner (exactly one is set). Providers are unchanged (wallet-owned).
-- All new tables are service-role only (RLS on, no policies), like spend_wallets.

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  label text,
  created_at timestamptz not null default now()
);
alter table agents enable row level security;

create table if not exists agent_wallets (
  agent_id uuid primary key references agents(id) on delete cascade,
  address text not null unique,
  enc_private_key text not null,
  created_at timestamptz not null default now()
);
alter table agent_wallets enable row level security;

create table if not exists agent_api_keys (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table agent_api_keys enable row level security;
create index if not exists agent_api_keys_agent_id_idx on agent_api_keys (agent_id);

-- Rent ownership: user_id becomes nullable, add agent_id, exactly one must be set.
alter table rents alter column user_id drop not null;
alter table rents add column if not exists agent_id text;
alter table rents drop constraint if exists rents_one_owner;
alter table rents add constraint rents_one_owner
  check ((user_id is not null) <> (agent_id is not null));
```

- [ ] **Step 2: Apply to the live Supabase project**

Apply via the Supabase MCP `apply_migration` (project `xwxuqcougmanzonypoym`, name `0008_agents`).

Verify: `select count(*) from agents;` runs, and an existing rent still satisfies the new check
(`select count(*) from rents where (user_id is not null) <> (agent_id is not null);` equals total rows).

- [ ] **Step 3: Commit**

```bash
git add services/supabase/migrations/0008_agents.sql
git commit -m "feat(agents): migration for agent identity tables + rent ownership"
```

---

## Task 2: `Principal` type + nullable rent owner in the domain

**Files:**
- Modify: `services/src/domain.ts`

- [ ] **Step 1: Add the `Principal` type and adjust `Rent`**

In `services/src/domain.ts`, add near the top (after the imports):

```ts
export type Principal =
  | { kind: "user"; id: string; walletAddress: string }
  | { kind: "agent"; id: string; walletAddress: string };
```

Change the `Rent` type's `userId` line and add `agentId` (right after `userId`):

```ts
  userId: string | null;
  agentId: string | null;
```

- [ ] **Step 2: Type-check (expected to fail, drives the next tasks)**

Run: `cd services && bunx tsc --noEmit`
Expected: FAIL where `NewRent`/registry mapping still assume a non-null `userId`. Those are fixed in Task 4.

- [ ] **Step 3: Commit**

```bash
git add services/src/domain.ts
git commit -m "feat(agents): Principal type + nullable rent owner (userId|agentId)"
```

---

## Task 3: Generalize the Supabase wallet store to any principal table

**Files:**
- Modify: `services/src/wallet/supabase-store.ts`
- Test: `services/src/wallet/supabase-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/src/wallet/supabase-store.test.ts
import { test, expect } from "bun:test";
import { SupabaseSpendWalletStore } from "./supabase-store";

// Minimal fake Supabase client: one in-memory table keyed by the configured id column.
function fakeDb() {
  const tables: Record<string, any[]> = {};
  return {
    _tables: tables,
    from(table: string) {
      tables[table] ??= [];
      const rows = tables[table];
      let col = "", val: unknown, cols = "*";
      const api: any = {
        select(c = "*") { cols = c; return api; },
        eq(c: string, v: unknown) { col = c; val = v; return api; },
        async maybeSingle() {
          const r = rows.find((x) => x[col] === val) ?? null;
          return { data: r, error: null };
        },
        async insert(row: any) { rows.push(row); return { error: null }; },
      };
      return api;
    },
  } as any;
}

const KEY = "3q2+7wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32-byte base64

test("stores agent wallets in the configured table + id column", async () => {
  const db = fakeDb();
  const store = new SupabaseSpendWalletStore(db, KEY, { table: "agent_wallets", idColumn: "agent_id" });
  const { address } = await store.getOrCreate("agent-1");
  expect(address).toMatch(/^0x/);
  expect(db._tables.agent_wallets[0].agent_id).toBe("agent-1");
  const signer = await store.loadSigner("agent-1");
  expect(signer?.address).toBe(address);
  expect(signer?.privateKey).toMatch(/^0x/);
});

test("defaults to spend_wallets / user_id when no opts given", async () => {
  const db = fakeDb();
  const store = new SupabaseSpendWalletStore(db, KEY);
  await store.getOrCreate("user-1");
  expect(db._tables.spend_wallets[0].user_id).toBe("user-1");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/wallet/supabase-store.test.ts`
Expected: FAIL (constructor takes no opts; queries are hardcoded to `spend_wallets`/`user_id`).

- [ ] **Step 3: Generalize the store**

Replace the body of `services/src/wallet/supabase-store.ts` with a configurable table/id column (defaults preserve today's behavior):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encryptSecret, decryptSecret } from "./crypto";
import type { SpendWalletStore, SpendWallet, SpendSigner } from "./store";

type StoreOpts = { table?: string; idColumn?: string };

// One wallet per principal id. Defaults to the user spend-wallet table; pass opts to back a
// different principal (e.g. agents). The encrypted key never leaves the server/worker.
export class SupabaseSpendWalletStore implements SpendWalletStore {
  private table: string;
  private idColumn: string;
  constructor(private db: SupabaseClient, private encKey: string, opts: StoreOpts = {}) {
    this.table = opts.table ?? "spend_wallets";
    this.idColumn = opts.idColumn ?? "user_id";
  }

  async getOrCreate(id: string): Promise<SpendWallet> {
    const found = await this.getAddress(id);
    if (found) return { address: found };
    const pk = generatePrivateKey();
    const address = privateKeyToAccount(pk).address;
    const enc_private_key = await encryptSecret(pk, this.encKey);
    const { error } = await this.db
      .from(this.table)
      .insert({ [this.idColumn]: id, address, enc_private_key });
    if (error) {
      const again = await this.getAddress(id);
      if (again) return { address: again };
      throw error;
    }
    return { address };
  }

  async getAddress(id: string): Promise<string | null> {
    const { data, error } = await this.db
      .from(this.table)
      .select("address")
      .eq(this.idColumn, id)
      .maybeSingle();
    if (error) throw error;
    return (data?.address as string | undefined) ?? null;
  }

  async loadSigner(id: string): Promise<SpendSigner | null> {
    const { data, error } = await this.db
      .from(this.table)
      .select("address, enc_private_key")
      .eq(this.idColumn, id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const privateKey = (await decryptSecret(data.enc_private_key as string, this.encKey)) as `0x${string}`;
    return { address: data.address as string, privateKey };
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/wallet/supabase-store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/wallet/supabase-store.ts services/src/wallet/supabase-store.test.ts
git commit -m "feat(wallet): configurable table/id column so agents get their own wallets"
```

---

## Task 4: Registry owns rents by principal

**Files:**
- Modify: `services/src/registry/registry.ts` (`NewRent`, `RentFilter`)
- Modify: `services/src/registry/in-memory.ts` (`createRent`, `listRents`)
- Modify: `services/src/registry/supabase.ts` (`toRent`, `createRent`, `listRents`)
- Test: `services/src/registry/contract.ts`

- [ ] **Step 1: Write the failing contract case**

In `services/src/registry/contract.ts`, add inside the `describe` block (after the existing rent cases):

```ts
    test("creates and lists an agent-owned rent", async () => {
      const rent = await reg.createRent({
        name: "agent-rent",
        owner: { kind: "agent", id: "agent-1", walletAddress: "0xagent" },
        spec: { resourceType: "GPU", region: null },
      });
      expect(rent.agentId).toBe("agent-1");
      expect(rent.userId).toBeNull();
      const mine = await reg.listRents({ agentId: "agent-1" });
      expect(mine.map((r) => r.id)).toContain(rent.id);
      const notMine = await reg.listRents({ userId: "u1" });
      expect(notMine.map((r) => r.id)).not.toContain(rent.id);
    }, T);

    test("creates a user-owned rent from a user principal", async () => {
      const rent = await reg.createRent({
        name: "user-rent",
        owner: { kind: "user", id: "u1", walletAddress: "0xuser" },
        spec: { resourceType: "GPU", region: null },
      });
      expect(rent.userId).toBe("u1");
      expect(rent.agentId).toBeNull();
    }, T);
```

- [ ] **Step 2: Run it (in-memory) to verify it fails**

Run: `cd services && bun test src/registry/in-memory.test.ts`
Expected: FAIL (type error: `NewRent` has no `owner`; `RentFilter` has no `agentId`).

- [ ] **Step 3: Update `NewRent` and `RentFilter`**

In `services/src/registry/registry.ts`, add the `Principal` import and change the types:

```ts
import type { Principal } from "../domain";
```

```ts
export type NewRent = {
  name: string;
  owner: Principal;
  spec: RentSpec;
  estimatedUsage?: number | null;
  autonomyArmed?: boolean;
};
```

```ts
export type RentFilter = {
  userId?: string;
  agentId?: string;
  providerId?: string;
  status?: RentStatus;
};
```

- [ ] **Step 4: Update the in-memory registry**

In `services/src/registry/in-memory.ts`, change `createRent`'s object literal owner fields and the `listRents` filter:

```ts
  async createRent(r: NewRent): Promise<Rent> {
    const rent: Rent = {
      id: crypto.randomUUID(),
      name: r.name,
      userId: r.owner.kind === "user" ? r.owner.id : null,
      agentId: r.owner.kind === "agent" ? r.owner.id : null,
      spec: r.spec,
      estimatedUsage: r.estimatedUsage ?? null,
      autonomyArmed: r.autonomyArmed ?? false,
      status: "queued",
      providerId: null,
      totalCost: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
      lastChargedAt: null,
      leaseAccessToken: null,
    };
    this.rents.set(rent.id, rent);
    return rent;
  }
```

In `listRents`, add the agent filter alongside the user one:

```ts
    if (filter?.userId) out = out.filter((r) => r.userId === filter.userId);
    if (filter?.agentId) out = out.filter((r) => r.agentId === filter.agentId);
```

- [ ] **Step 5: Update the Supabase registry**

In `services/src/registry/supabase.ts`, `toRent` maps both owners (find the `userId:` line, replace it):

```ts
    userId: (r.user_id as string) ?? null,
    agentId: (r.agent_id as string) ?? null,
```

`createRent` writes the right column:

```ts
  async createRent(r: NewRent): Promise<Rent> {
    const row = await this.one(
      this.db.from("rents").insert({
        name: r.name,
        user_id: r.owner.kind === "user" ? r.owner.id : null,
        agent_id: r.owner.kind === "agent" ? r.owner.id : null,
        resource_type: r.spec.resourceType, region: r.spec.region,
        required_trust_tier: r.spec.requiredTrustTier ?? "Community",
        estimated_usage: r.estimatedUsage ?? null, autonomy_armed: r.autonomyArmed ?? false,
      }).select().single(),
      "createRent",
    );
    return toRent(row);
  }
```

`listRents` gains the agent filter (after the `userId` filter line):

```ts
    if (filter?.agentId) q = q.eq("agent_id", filter.agentId);
```

- [ ] **Step 6: Fix existing `createRent` callers to pass an owner principal**

Any code calling `registry.createRent({ ..., userId })` must switch to `owner`. Update the app's human rent creation in `src/lib/broker/server-fns.ts` `createRent` handler:

```ts
    return getRegistry().createRent({
      name: data.name,
      owner: { kind: "user", id: user.id, walletAddress: user.walletAddress },
      spec: data.spec,
      estimatedUsage: data.estimatedUsage ?? null,
    });
```

- [ ] **Step 7: Run the in-memory contract + type-check both projects**

Run: `cd services && bun test src/registry/in-memory.test.ts`
Expected: PASS (new cases + existing).

Run: `cd services && bunx tsc --noEmit` then `cd .. && bunx tsc --noEmit`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add services/src/registry src/lib/broker/server-fns.ts
git commit -m "feat(registry): own rents by Principal (user or agent)"
```

---

## Task 5: Agent API keys (pure) + agent store + `requireAgent`

**Files:**
- Create: `src/lib/agents/keys.ts`
- Create: `src/lib/agents/store.ts`
- Test: `src/lib/agents/keys.test.ts`

- [ ] **Step 1: Write the failing test for key utils**

```ts
// src/lib/agents/keys.test.ts
import { test, expect } from "bun:test";
import { generateApiKey, hashApiKey } from "./keys";

test("generateApiKey is prefixed and high-entropy; hash is stable + hex", async () => {
  const a = generateApiKey();
  const b = generateApiKey();
  expect(a.startsWith("pc_")).toBe(true);
  expect(a).not.toBe(b);
  expect(a.length).toBeGreaterThan(20);

  const h1 = await hashApiKey(a);
  const h2 = await hashApiKey(a);
  expect(h1).toBe(h2);                 // deterministic
  expect(h1).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
  expect(await hashApiKey(b)).not.toBe(h1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/agents/keys.test.ts`
Expected: FAIL, "Cannot find module './keys'".

- [ ] **Step 3: Implement the key utils (Web Crypto, runs in CF Worker + Bun)**

```ts
// src/lib/agents/keys.ts
// Opaque bearer tokens for agents. We store only the SHA-256 hash; the plaintext is shown once at
// creation. Web Crypto so the same code runs in the Cloudflare-Worker app and any Bun context.
export function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `pc_${b64}`;
}

export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test src/lib/agents/keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the agent store + `requireAgent`**

```ts
// src/lib/agents/store.ts
import { supabaseAdmin } from "../supabase/server";
import { SupabaseSpendWalletStore } from "@services/wallet/supabase-store";
import type { Principal } from "@services/domain";
import { generateApiKey, hashApiKey } from "./keys";

function agentWalletStore() {
  const encKey = process.env.SPEND_WALLET_ENC_KEY;
  if (!encKey) throw new Error("SPEND_WALLET_ENC_KEY required");
  return new SupabaseSpendWalletStore(supabaseAdmin(), encKey, { table: "agent_wallets", idColumn: "agent_id" });
}

// Open self-serve registration: create the agent, provision its permanent wallet, issue the first
// key. The plaintext key is returned exactly once; only its hash is stored.
export async function createAgent(label?: string): Promise<{ agentId: string; apiKey: string; walletAddress: string }> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("agents").insert({ label: label ?? null }).select("id").single();
  if (error) throw error;
  const agentId = data.id as string;

  const { address } = await agentWalletStore().getOrCreate(agentId);

  const apiKey = generateApiKey();
  const { error: keyErr } = await db.from("agent_api_keys").insert({ agent_id: agentId, key_hash: await hashApiKey(apiKey) });
  if (keyErr) throw keyErr;

  return { agentId, apiKey, walletAddress: address };
}

// Resolve a bearer key to an agent Principal, or null. Stamps last_used_at for anomaly detection.
export async function requireAgent(apiKey: string): Promise<Principal | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_api_keys")
    .select("id, agent_id, revoked_at")
    .eq("key_hash", await hashApiKey(apiKey))
    .maybeSingle();
  if (error) throw error;
  if (!data || data.revoked_at) return null;

  const walletAddress = await agentWalletStore().getAddress(data.agent_id as string);
  if (!walletAddress) return null; // wallet must exist for a real agent
  await db.from("agent_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { kind: "agent", id: data.agent_id as string, walletAddress };
}
```

- [ ] **Step 6: Type-check**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/agents/keys.ts src/lib/agents/keys.test.ts src/lib/agents/store.ts
git commit -m "feat(agents): API key hashing, agent creation, and requireAgent"
```

---

# Phase 2: Service layer

## Task 6: Principal-parameterized marketplace service

**Files:**
- Create: `src/lib/marketplace/wallet.ts`
- Create: `src/lib/marketplace/service.ts`
- Test: `src/lib/marketplace/service.test.ts`

- [ ] **Step 1: Write the failing test (over the in-memory registry)**

```ts
// src/lib/marketplace/service.test.ts
import { test, expect } from "bun:test";
import { InMemoryRegistry } from "@services/registry/in-memory";
import { defaultTrust } from "@services/trust/trust";
import type { Principal } from "@services/domain";
import { createRentFor, listRentsFor, getRentFor, cancelRentFor, registerProviderFor, listMyProvidersFor } from "./service";

const agent: Principal = { kind: "agent", id: "agent-1", walletAddress: "0xAGENT" };
const other: Principal = { kind: "agent", id: "agent-2", walletAddress: "0xOTHER" };

test("createRentFor + listRentsFor scope to the principal", async () => {
  const reg = new InMemoryRegistry();
  const rent = await createRentFor(reg, agent, { name: "j", spec: { resourceType: "GPU", region: null } });
  expect(rent.agentId).toBe("agent-1");
  expect((await listRentsFor(reg, agent)).map((r) => r.id)).toEqual([rent.id]);
  expect(await listRentsFor(reg, other)).toEqual([]);
});

test("getRentFor / cancelRentFor enforce ownership", async () => {
  const reg = new InMemoryRegistry();
  const rent = await createRentFor(reg, agent, { name: "j", spec: { resourceType: "GPU", region: null } });
  expect((await getRentFor(reg, agent, rent.id))?.id).toBe(rent.id);
  expect(await getRentFor(reg, other, rent.id)).toBeNull();
  await expect(cancelRentFor(reg, other, rent.id)).rejects.toThrow(/not your rent/);
  const cancelled = await cancelRentFor(reg, agent, rent.id);
  expect(cancelled.status).toBe("cancelled");
});

test("registerProviderFor sets ownerWallet + listMyProvidersFor filters by it", async () => {
  const reg = new InMemoryRegistry();
  const p = await registerProviderFor(reg, agent, {
    alias: "a1", endpointUrl: "http://x", resourceType: "GPU", region: "US-East",
    specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 5,
  });
  expect(p.ownerWallet).toBe("0xAGENT");
  expect((await listMyProvidersFor(reg, agent)).map((x) => x.id)).toEqual([p.id]);
  expect(await listMyProvidersFor(reg, other)).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/marketplace/service.test.ts`
Expected: FAIL, "Cannot find module './service'".

- [ ] **Step 3: Implement the wallet resolver**

```ts
// src/lib/marketplace/wallet.ts
import { supabaseAdmin } from "../supabase/server";
import { SupabaseSpendWalletStore } from "@services/wallet/supabase-store";
import type { SpendWalletStore } from "@services/wallet/store";
import type { Principal } from "@services/domain";

// The right wallet store for a principal: users in spend_wallets, agents in agent_wallets.
export function walletStoreFor(principal: Principal): SpendWalletStore {
  const encKey = process.env.SPEND_WALLET_ENC_KEY;
  if (!encKey) throw new Error("SPEND_WALLET_ENC_KEY required");
  return principal.kind === "agent"
    ? new SupabaseSpendWalletStore(supabaseAdmin(), encKey, { table: "agent_wallets", idColumn: "agent_id" })
    : new SupabaseSpendWalletStore(supabaseAdmin(), encKey);
}
```

- [ ] **Step 4: Implement the service layer**

```ts
// src/lib/marketplace/service.ts
import type { Registry, NewProvider } from "@services/registry/registry";
import type { Principal, Rent, Provider, RentSpec } from "@services/domain";
import { canCancel } from "@services/rent-transitions";
import { walletStoreFor } from "./wallet";

export type NewRentInput = { name: string; spec: RentSpec; estimatedUsage?: number | null };
// Provider input minus the fields the service derives (ownerWallet from the principal).
export type NewProviderInput = Omit<NewProvider, "ownerWallet">;

export function createRentFor(reg: Registry, principal: Principal, input: NewRentInput): Promise<Rent> {
  return reg.createRent({ name: input.name, owner: principal, spec: input.spec, estimatedUsage: input.estimatedUsage ?? null });
}

export function listRentsFor(reg: Registry, principal: Principal): Promise<Rent[]> {
  return reg.listRents(principal.kind === "agent" ? { agentId: principal.id } : { userId: principal.id });
}

function ownsRent(principal: Principal, rent: Rent): boolean {
  return principal.kind === "agent" ? rent.agentId === principal.id : rent.userId === principal.id;
}

export async function getRentFor(reg: Registry, principal: Principal, rentId: string): Promise<Rent | null> {
  const rent = await reg.getRent(rentId);
  return rent && ownsRent(principal, rent) ? rent : null;
}

export async function cancelRentFor(reg: Registry, principal: Principal, rentId: string): Promise<Rent> {
  const rent = await reg.getRent(rentId);
  if (!rent || !ownsRent(principal, rent)) throw new Error("not your rent");
  if (!canCancel(rent)) throw new Error(`cannot cancel a rent with status "${rent.status}"`);
  return reg.updateRent(rentId, { status: "cancelled", endedAt: new Date().toISOString() });
}

export function registerProviderFor(reg: Registry, principal: Principal, input: NewProviderInput): Promise<Provider> {
  return reg.registerProvider({ ...input, ownerWallet: principal.walletAddress });
}

export function listMyProvidersFor(reg: Registry, principal: Principal): Promise<Provider[]> {
  return reg.listProviders({ ownerWallet: principal.walletAddress });
}

export async function walletFor(principal: Principal): Promise<{ address: string }> {
  const store = walletStoreFor(principal);
  return store.getOrCreate(principal.id);
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `bun test src/lib/marketplace/service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/marketplace/wallet.ts src/lib/marketplace/service.ts src/lib/marketplace/service.test.ts
git commit -m "feat(marketplace): principal-parameterized service layer"
```

---

## Task 7: Migrate the human server-fns onto the service layer

**Files:**
- Modify: `src/lib/broker/server-fns.ts`

- [ ] **Step 1: Route the human rent/provider fns through the service**

In `src/lib/broker/server-fns.ts`, build a user principal from `requireUser` and call the shared service.
Replace the bodies of `listMyRents`, `getMyRent`, `createRent`, the three transitions, `registerProvider`, and
`listMyProviders` to delegate (imports first):

```ts
import { createRentFor, listRentsFor, getRentFor, cancelRentFor, registerProviderFor, listMyProvidersFor } from "@/lib/marketplace/service";
import type { Principal } from "@services/domain";
```

For each, resolve `const user = await requireUser(data.accessToken)` then
`const principal: Principal = { kind: "user", id: user.id, walletAddress: user.walletAddress }` and call the
matching `*For(getRegistry(), principal, ...)`. Example (`createRent`):

```ts
export const createRent = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; name: string; spec: RentSpec; estimatedUsage?: number | null }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    const principal: Principal = { kind: "user", id: user.id, walletAddress: user.walletAddress };
    return createRentFor(getRegistry(), principal, { name: data.name, spec: data.spec, estimatedUsage: data.estimatedUsage });
  });
```

Leave `pauseRent`/`resumeRent` as-is (they call the existing `transitionRent`; cancel can delegate to
`cancelRentFor`, pause/resume stay since the service layer only owns cancel per the spec's rent-transition set).

- [ ] **Step 2: Type-check + run the frontend broker tests**

Run: `bunx tsc --noEmit`
Expected: clean.

Run: `bun test src/lib/broker/rent-phase.test.ts src/lib/marketplace/service.test.ts`
Expected: PASS.

- [ ] **Step 3: Build (the app still compiles for the CF Worker)**

Run: `bun run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/lib/broker/server-fns.ts
git commit -m "refactor(broker): route human server-fns through the shared service layer"
```

---

# Phase 3: REST v1

## Task 8: REST helpers (bearer auth + JSON/error responses)

**Files:**
- Create: `src/lib/agents/http.ts`
- Test: `src/lib/agents/http.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/agents/http.test.ts
import { test, expect } from "bun:test";
import { bearer, json, errorResponse } from "./http";

test("bearer extracts the token or null", () => {
  expect(bearer(new Request("http://x", { headers: { authorization: "Bearer pc_abc" } }))).toBe("pc_abc");
  expect(bearer(new Request("http://x"))).toBeNull();
  expect(bearer(new Request("http://x", { headers: { authorization: "Basic zzz" } }))).toBeNull();
});

test("json + errorResponse shape the body and status", async () => {
  const ok = json({ a: 1 }, 201);
  expect(ok.status).toBe(201);
  expect(await ok.json()).toEqual({ a: 1 });

  const err = errorResponse(404, "not_found", "no such rent");
  expect(err.status).toBe(404);
  expect(await err.json()).toEqual({ error: { code: "not_found", message: "no such rent" } });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/agents/http.test.ts`
Expected: FAIL, "Cannot find module './http'".

- [ ] **Step 3: Implement the helpers**

```ts
// src/lib/agents/http.ts
import { requireAgent } from "./store";
import type { Principal } from "@services/domain";

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function errorResponse(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

// Resolve the bearer key to an agent principal, or an error Response the caller returns directly.
export async function authAgent(req: Request): Promise<Principal | Response> {
  const key = bearer(req);
  if (!key) return errorResponse(401, "unauthorized", "missing bearer API key");
  const principal = await requireAgent(key);
  if (!principal) return errorResponse(401, "unauthorized", "invalid or revoked API key");
  return principal;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test src/lib/agents/http.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/http.ts src/lib/agents/http.test.ts
git commit -m "feat(api): REST helpers for bearer auth + json/error responses"
```

---

## Task 9: Registration + wallet routes

**Files:**
- Create: `src/routes/api.v1.agents.ts`
- Create: `src/routes/api.v1.wallet.ts`

- [ ] **Step 1: Registration route (open, no auth)**

```ts
// src/routes/api.v1.agents.ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { createAgent } from "@/lib/agents/store";
import { json, errorResponse } from "@/lib/agents/http";

export const Route = createFileRoute("/api/v1/agents")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let label: string | undefined;
        try {
          const body = request.headers.get("content-type")?.includes("application/json") ? await request.json() : {};
          if (typeof body?.label === "string") label = body.label.slice(0, 120);
        } catch {
          return errorResponse(400, "bad_request", "invalid JSON body");
        }
        const agent = await createAgent(label);
        return json(agent, 201); // { agentId, apiKey, walletAddress } — apiKey shown once
      },
    },
  },
});
```

- [ ] **Step 2: Wallet route (agent's address + balance)**

```ts
// src/routes/api.v1.wallet.ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { authAgent, json } from "@/lib/agents/http";
import { walletFor } from "@/lib/marketplace/service";
import { makeOnchain } from "@services/wallet/onchain";
import { loadWalletConfig } from "@services/wallet/config";

export const Route = createFileRoute("/api/v1/wallet")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        const { address } = await walletFor(principal);
        let balanceAtomic = "0";
        try {
          const onchain = makeOnchain(loadWalletConfig());
          balanceAtomic = (await onchain.balanceOf(address)).toString();
        } catch {
          // balance is best-effort; the address is what the agent needs to fund
        }
        return json({ address, balanceAtomic });
      },
    },
  },
});
```

(Confirm the `makeOnchain`/`loadWalletConfig` names against `services/src/wallet/onchain.ts` and `config.ts`;
if `balanceOf` differs, use the exported reader. If unavailable in this runtime, return `balanceAtomic: null`.)

- [ ] **Step 3: Type-check + build**

Run: `bunx tsc --noEmit` then `bun run build`
Expected: both succeed; the build registers `/api/v1/agents` and `/api/v1/wallet`.

- [ ] **Step 4: Smoke-test registration against the live DB**

Run `bun run dev`, then:
`curl -s -X POST http://localhost:8080/api/v1/agents -H 'content-type: application/json' -d '{"label":"smoke"}'`
Expected: `201` JSON with `agentId`, `apiKey` (starts `pc_`), `walletAddress` (starts `0x`).
Then `curl -s http://localhost:8080/api/v1/wallet -H "authorization: Bearer <apiKey>"` returns the address + balance.
(These insert a real agent row; that's fine, it's an isolated test agent.)

- [ ] **Step 5: Commit**

```bash
git add src/routes/api.v1.agents.ts src/routes/api.v1.wallet.ts
git commit -m "feat(api): agent registration + wallet endpoints"
```

---

## Task 10: Provider routes

**Files:**
- Create: `src/routes/api.v1.providers.ts`
- Create: `src/routes/api.v1.providers.mine.ts`

- [ ] **Step 1: Discover + register providers**

```ts
// src/routes/api.v1.providers.ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { getRegistry } from "@/lib/broker/registry";
import { registerProviderFor } from "@/lib/marketplace/service";
import { authAgent, json, errorResponse } from "@/lib/agents/http";
import { defaultTrust } from "@services/trust/trust";
import type { ResourceType } from "@services/domain";

export const Route = createFileRoute("/api/v1/providers")({
  server: {
    handlers: {
      GET: async () => json(await getRegistry().listProviders()),
      POST: async ({ request }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        let b: any;
        try { b = await request.json(); } catch { return errorResponse(400, "bad_request", "invalid JSON body"); }
        if (!b?.alias || !b?.endpointUrl || !b?.resourceType || !b?.region || typeof b?.pricePerCharge !== "number") {
          return errorResponse(400, "bad_request", "alias, endpointUrl, resourceType, region, pricePerCharge are required");
        }
        const provider = await registerProviderFor(getRegistry(), principal, {
          alias: String(b.alias), endpointUrl: String(b.endpointUrl),
          resourceType: b.resourceType as ResourceType, region: String(b.region),
          specs: (b.specs ?? {}) as Record<string, unknown>, online: b.online ?? true,
          trust: defaultTrust(), pricePerCharge: b.pricePerCharge, avgLatencyMs: b.avgLatencyMs ?? 0,
        });
        return json(provider, 201);
      },
    },
  },
});
```

- [ ] **Step 2: List my providers**

```ts
// src/routes/api.v1.providers.mine.ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { getRegistry } from "@/lib/broker/registry";
import { listMyProvidersFor } from "@/lib/marketplace/service";
import { authAgent, json } from "@/lib/agents/http";

export const Route = createFileRoute("/api/v1/providers/mine")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        return json(await listMyProvidersFor(getRegistry(), principal));
      },
    },
  },
});
```

- [ ] **Step 3: Type-check + build**

Run: `bunx tsc --noEmit` then `bun run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api.v1.providers.ts src/routes/api.v1.providers.mine.ts
git commit -m "feat(api): provider discover / register / list-mine endpoints"
```

---

## Task 11: Rent routes

**Files:**
- Create: `src/routes/api.v1.rents.ts`
- Create: `src/routes/api.v1.rents.$id.ts`
- Create: `src/routes/api.v1.rents.$id.cancel.ts`

- [ ] **Step 1: Create + list rents**

```ts
// src/routes/api.v1.rents.ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { getRegistry } from "@/lib/broker/registry";
import { createRentFor, listRentsFor } from "@/lib/marketplace/service";
import { authAgent, json, errorResponse } from "@/lib/agents/http";
import type { ResourceType } from "@services/domain";

export const Route = createFileRoute("/api/v1/rents")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        return json(await listRentsFor(getRegistry(), principal));
      },
      POST: async ({ request }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        let b: any;
        try { b = await request.json(); } catch { return errorResponse(400, "bad_request", "invalid JSON body"); }
        if (!b?.name || !b?.resourceType) return errorResponse(400, "bad_request", "name and resourceType are required");
        const rent = await createRentFor(getRegistry(), principal, {
          name: String(b.name),
          spec: { resourceType: b.resourceType as ResourceType, region: b.region ?? null },
          estimatedUsage: typeof b.estimatedUsage === "number" ? b.estimatedUsage : null,
        });
        return json(rent, 201); // queued; the metering worker provisions + meters it
      },
    },
  },
});
```

- [ ] **Step 2: Get one rent (connect creds when running)**

```ts
// src/routes/api.v1.rents.$id.ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { getRegistry } from "@/lib/broker/registry";
import { getRentFor } from "@/lib/marketplace/service";
import { authAgent, json, errorResponse } from "@/lib/agents/http";

export const Route = createFileRoute("/api/v1/rents/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        const rent = await getRentFor(getRegistry(), principal, params.id);
        if (!rent) return errorResponse(404, "not_found", "no such rent");
        const provider = rent.providerId ? await getRegistry().getProvider(rent.providerId) : null;
        const connect = rent.status === "running" && rent.leaseAccessToken && provider
          ? { endpointUrl: provider.endpointUrl, accessToken: rent.leaseAccessToken }
          : null;
        return json({ ...rent, connect });
      },
    },
  },
});
```

- [ ] **Step 3: Cancel a rent**

```ts
// src/routes/api.v1.rents.$id.cancel.ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { getRegistry } from "@/lib/broker/registry";
import { cancelRentFor } from "@/lib/marketplace/service";
import { authAgent, json, errorResponse } from "@/lib/agents/http";

export const Route = createFileRoute("/api/v1/rents/$id/cancel")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        try {
          return json(await cancelRentFor(getRegistry(), principal, params.id));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "cancel failed";
          return errorResponse(msg === "not your rent" ? 404 : 409, "cannot_cancel", msg);
        }
      },
    },
  },
});
```

- [ ] **Step 4: Type-check + build**

Run: `bunx tsc --noEmit` then `bun run build`
Expected: both succeed; all `/api/v1/rents*` routes register.

- [ ] **Step 5: Smoke-test the rent path**

With `bun run dev` and a test agent's key (from Task 9 smoke):
`curl -s -X POST http://localhost:8080/api/v1/rents -H "authorization: Bearer <key>" -H 'content-type: application/json' -d '{"name":"api-rent","resourceType":"GPU"}'`
Expected: `201` with a rent whose `agentId` is set and `status` is `queued`. Then `GET /api/v1/rents/<id>` returns it.

- [ ] **Step 6: Commit**

```bash
git add src/routes/api.v1.rents.ts "src/routes/api.v1.rents.\$id.ts" "src/routes/api.v1.rents.\$id.cancel.ts"
git commit -m "feat(api): rent create / list / get / cancel endpoints"
```

---

# Phase 4: MCP server

## Task 12: Thin MCP wrapper over the REST API

**Files:**
- Create: `mcp/package.json`
- Create: `mcp/src/client.ts`
- Create: `mcp/src/index.ts`
- Test: `mcp/src/client.test.ts`

- [ ] **Step 1: Package + dependency**

```json
// mcp/package.json
{
  "name": "@prime-compute/mcp",
  "private": true,
  "type": "module",
  "scripts": { "start": "bun run src/index.ts", "test": "bun test" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

Run: `cd mcp && bun install`
Expected: installs the SDK.

- [ ] **Step 2: Write the failing test for the REST client**

```ts
// mcp/src/client.test.ts
import { test, expect } from "bun:test";
import { PrimeClient } from "./client";

function stubFetch(calls: any[]) {
  return async (url: string, init?: any) => {
    calls.push({ url, method: init?.method ?? "GET", auth: init?.headers?.authorization, body: init?.body });
    return new Response(JSON.stringify({ ok: true, url }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

test("rentCompute POSTs to /api/v1/rents with the bearer key", async () => {
  const calls: any[] = [];
  const c = new PrimeClient("http://api", "pc_key", stubFetch(calls) as any);
  await c.rentCompute({ name: "j", resourceType: "GPU" });
  expect(calls[0].url).toBe("http://api/api/v1/rents");
  expect(calls[0].method).toBe("POST");
  expect(calls[0].auth).toBe("Bearer pc_key");
  expect(JSON.parse(calls[0].body)).toEqual({ name: "j", resourceType: "GPU" });
});

test("walletBalance GETs /api/v1/wallet", async () => {
  const calls: any[] = [];
  const c = new PrimeClient("http://api", "pc_key", stubFetch(calls) as any);
  await c.walletBalance();
  expect(calls[0].url).toBe("http://api/api/v1/wallet");
  expect(calls[0].method).toBe("GET");
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd mcp && bun test src/client.test.ts`
Expected: FAIL, "Cannot find module './client'".

- [ ] **Step 4: Implement the REST client**

```ts
// mcp/src/client.ts
type Fetch = typeof fetch;

// Thin typed wrapper over the REST API. No business logic; every method is one HTTP call.
export class PrimeClient {
  constructor(private baseUrl: string, private apiKey: string, private fetchImpl: Fetch = fetch) {}

  private async call(path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.apiKey}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
    return json;
  }

  discoverProviders() { return this.call("/api/v1/providers", "GET"); }
  rentCompute(input: { name: string; resourceType: string; region?: string; estimatedUsage?: number }) {
    return this.call("/api/v1/rents", "POST", input);
  }
  rentStatus(id: string) { return this.call(`/api/v1/rents/${id}`, "GET"); }
  registerServer(input: { alias: string; endpointUrl: string; resourceType: string; region: string; pricePerCharge: number; specs?: Record<string, unknown> }) {
    return this.call("/api/v1/providers", "POST", input);
  }
  walletBalance() { return this.call("/api/v1/wallet", "GET"); }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd mcp && bun test src/client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Implement the MCP server (tools map 1:1 to client calls)**

```ts
// mcp/src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PrimeClient } from "./client";

const baseUrl = process.env.PRIME_API_URL ?? "https://primecomputelive.vercel.app";
const apiKey = process.env.PRIME_API_KEY;
if (!apiKey) throw new Error("PRIME_API_KEY required (register once via POST /api/v1/agents)");
const client = new PrimeClient(baseUrl, apiKey);

const server = new McpServer({ name: "prime-compute", version: "1.0.0" });
const asText = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

server.tool("discover_providers", "List available compute providers on the marketplace", {}, async () => asText(await client.discoverProviders()));
server.tool("rent_compute", "Rent compute; returns a queued lease that the worker provisions and meters", {
  name: z.string(), resourceType: z.enum(["GPU", "CPU", "Storage", "Full Server"]), region: z.string().optional(), estimatedUsage: z.number().optional(),
}, async (a) => asText(await client.rentCompute(a)));
server.tool("rent_status", "Get one rent's status and connect credentials when running", { id: z.string() }, async (a) => asText(await client.rentStatus(a.id)));
server.tool("register_server", "List your own server on the marketplace", {
  alias: z.string(), endpointUrl: z.string(), resourceType: z.enum(["GPU", "CPU", "Storage", "Full Server"]), region: z.string(), pricePerCharge: z.number(), specs: z.record(z.unknown()).optional(),
}, async (a) => asText(await client.registerServer(a)));
server.tool("wallet_balance", "Your agent wallet address and USDC balance; fund by sending USDC to the address", {}, async () => asText(await client.walletBalance()));

await server.connect(new StdioServerTransport());
```

- [ ] **Step 7: Type-check the package**

Run: `cd mcp && bunx tsc --noEmit --moduleResolution bundler --module esnext --target es2022 --skipLibCheck src/index.ts src/client.ts`
Expected: clean (or resolve any SDK export-path drift against the installed `@modelcontextprotocol/sdk` version).

- [ ] **Step 8: Commit**

```bash
git add mcp/
git commit -m "feat(mcp): thin MCP server wrapping the agent REST API"
```

---

## Self-review notes

- **Spec coverage:** Principal model (Task 2,5,7) ✓; agents/agent_wallets/agent_api_keys tables + hashed keys with rotation columns (Task 1,5) ✓; permanent agent wallet reusing crypto (Task 3,5) ✓; rents nullable user_id + agent_id + one-owner check (Task 1,4) ✓; providers unchanged, wallet-owned (Task 6 registerProviderFor) ✓; shared service layer + human-fn migration (Task 6,7) ✓; `/api/v1` REST surface: agents, wallet, providers(+mine), rents(list/create/get/cancel) (Task 9,10,11) ✓; MCP thin wrapper, no business logic, registration deliberately not an MCP tool (Task 12) ✓; worker stays sole lease authority (nothing here transitions leases except cancel, which is a user/agent action already in the transition set) ✓; money-gate is inherent (agents pay from their own funded wallet via the existing worker path) ✓.
- **Future hardening** (rate limits, quotas, key anomaly) is intentionally not built; the seams (authAgent, service layer) are where it lands later.
- **Placeholder scan:** none; every code step is complete. Task 9 Step 2 flags one name to confirm against `wallet/onchain.ts` (balance is best-effort and degrades to null, so it can't block).
- **Type consistency:** `Principal` (Task 2) is used identically in the registry (Task 4), agents (Task 5), service (Task 6), server-fns (Task 7), and http (Task 8). `NewRent.owner` (Task 4) matches every `createRent`/`createRentFor` call. `SupabaseSpendWalletStore(db, encKey, opts)` (Task 3) is called with the same shape in Task 5 and Task 6. REST routes all go through `authAgent` (Task 8) and the service layer (Task 6). MCP tools map 1:1 to `PrimeClient` methods (Task 12).

---

## Execution handoff

After this lands, an agent does: `POST /api/v1/agents` (get key + wallet), fund the wallet address with Arc USDC, then `rent_compute` / `register_server` via REST or the MCP server, with the metering worker doing the real billing exactly as it does for human users. The natural next work is spec 2 (real sandboxed compute behind provider endpoints + the endpoint-verification handshake) and, when this opens publicly, switching on the documented Future hardening.
