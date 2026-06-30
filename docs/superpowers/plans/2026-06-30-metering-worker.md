# Metering worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An always-on backend service that provisions queued leases and streams real per-second USDC nano-charges from each user's own Arc spend wallet, so billing continues whether or not the user's browser is open.

**Architecture:** A long-lived Bun process (`services/src/worker/`) runs a loop: a provision pass turns `queued` leases into `running` ones (match provider, fund from the user's spend wallet), and a meter pass charges each `running` lease one unit per tick through a per-user `GatewaySettlementAdapter`. All state lives in Supabase, so the worker is fully resumable: on restart it re-scans `running` leases and continues, and `last_charged_at` plus monotonic charge `seq` make a restart neither double-charge nor skip. A tiny HTTP `/health` endpoint lets it run as a Render free web service kept warm by an external pinger.

**Tech Stack:** Bun + TypeScript, the existing `services/` registry / matching / settlement / spend-wallet modules (plan 1), viem, Supabase, Circle Gateway x402.

This is spec 1, layer 2 of `docs/superpowers/specs/2026-06-30-live-nano-payments-design.md`, building directly on the per-user spend wallets from `2026-06-30-per-user-spend-wallets.md` (merged). It reuses the tested `matchProviders` / `revalidateProvider` primitives but implements a single-tick, resumable meter rather than the whole-stream `runRent` loop, because per-second resumability and interruptibility are the point. Mid-stream migration-on-degrade (the `streamWithMigration` path) and health-based provider give-up are deliberate follow-ups; v1 stays on the matched provider, retries transient pay failures, and only `suspended`s a lease on a genuine spend-cap/balance stop.

---

## File structure

- `services/src/worker/meter.ts` - `provisionLease` and `meterTick`, the pure-ish core. One job: advance one lease by one step against an injected registry + settlement adapter.
- `services/src/worker/loop.ts` - `workerPass`, the orchestration over all active leases, plus the per-lease budget rule.
- `services/src/worker/settlement-factory.ts` - `makeSettlementFactory`, builds (and caches per lease) a per-user `GatewaySettlementAdapter` from the spend-wallet store.
- `services/src/worker/index.ts` - the entrypoint: wiring, the `setInterval` loop, and the `/health` HTTP server.
- `services/supabase/migrations/0007_lease_metering.sql` - widen the status check, add `last_charged_at` and `lease_access_token`.
- Modified: `services/src/domain.ts`, `services/src/rent-transitions.ts`, `services/src/registry/registry.ts`, `services/src/registry/supabase.ts`, `services/src/registry/in-memory.ts` (the `suspended` status + two new rent fields).
- Modified: `src/routes/dashboard.tsx` (connect credentials + real cost on a running lease).
- `services/scripts/seed-provider.ts` - register one first-party provider so the meter pays a real endpoint.

---

## Task 1: Lifecycle types (`suspended` + two rent fields)

**Files:**
- Modify: `services/src/domain.ts`
- Modify: `services/src/rent-transitions.ts`
- Test: `services/src/rent-transitions.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `services/src/rent-transitions.test.ts`:

```ts
import { canResume } from "./rent-transitions";
import type { Rent } from "./domain";

function rent(status: Rent["status"]): Rent {
  return {
    id: "r", name: "n", userId: "u", spec: { resourceType: "GPU", region: null },
    estimatedUsage: null, autonomyArmed: false, status, providerId: null, totalCost: 0,
    createdAt: "", startedAt: null, endedAt: null, lastChargedAt: null, leaseAccessToken: null,
  };
}

test("a suspended lease can be resumed", () => {
  expect(canResume(rent("suspended"))).toBe(true);
  expect(canResume(rent("paused"))).toBe(true);
  expect(canResume(rent("running"))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services && bun test src/rent-transitions.test.ts`
Expected: FAIL (type error: `lastChargedAt`/`leaseAccessToken` not on `Rent`, and `canResume("suspended")` is false).

- [ ] **Step 3: Add the status and fields to `domain.ts`**

In `services/src/domain.ts`, add `"suspended"` to `RentStatus`:

```ts
export type RentStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed"
  | "suspended";
```

And add two fields to the `Rent` type (after `endedAt`):

```ts
  startedAt: string | null;
  endedAt: string | null;
  lastChargedAt: string | null;     // when the meter last charged this lease (resumability)
  leaseAccessToken: string | null;  // shown to the user as the connect credential
};
```

- [ ] **Step 4: Update `rent-transitions.ts`**

```ts
import type { Rent, RentStatus } from "./domain";

const NON_TERMINAL: RentStatus[] = ["queued", "running", "paused", "suspended"];

export function canPause(rent: Rent): boolean {
  return rent.status === "running";
}

export function canResume(rent: Rent): boolean {
  return rent.status === "paused" || rent.status === "suspended";
}

export function canCancel(rent: Rent): boolean {
  return NON_TERMINAL.includes(rent.status);
}
```

- [ ] **Step 5: Run the test**

Run: `cd services && bun test src/rent-transitions.test.ts`
Expected: PASS. (Other `rent-transitions` tests stay green.)

- [ ] **Step 6: Commit**

```bash
git add services/src/domain.ts services/src/rent-transitions.ts services/src/rent-transitions.test.ts
git commit -m "feat(domain): add suspended status + lease metering fields"
```

---

## Task 2: Registry mapping for the new fields

**Files:**
- Modify: `services/src/registry/registry.ts` (RentPatch)
- Modify: `services/src/registry/supabase.ts` (toRent + updateRent)
- Modify: `services/src/registry/in-memory.ts` (none needed beyond spread; verify)
- Test: `services/src/registry/contract.ts` (shared contract, runs against both impls)

- [ ] **Step 1: Write the failing test**

In `services/src/registry/contract.ts`, inside the existing rent section, add a contract case (follow the surrounding `it(...)` style of that file):

```ts
it("persists lastChargedAt and leaseAccessToken through updateRent", async () => {
  const reg = await make();
  const rent = await reg.createRent({ name: "j", userId: "u1", spec: { resourceType: "GPU", region: null } });
  expect(rent.lastChargedAt).toBeNull();
  expect(rent.leaseAccessToken).toBeNull();
  const ts = new Date().toISOString();
  const updated = await reg.updateRent(rent.id, { lastChargedAt: ts, leaseAccessToken: "tok-123", status: "running" });
  expect(updated.lastChargedAt).toBe(ts);
  expect(updated.leaseAccessToken).toBe("tok-123");
  const reread = await reg.getRent(rent.id);
  expect(reread?.leaseAccessToken).toBe("tok-123");
});
```

- [ ] **Step 2: Run it (in-memory path) to verify it fails**

Run: `cd services && bun test src/registry/in-memory.test.ts`
Expected: FAIL (type error: `lastChargedAt`/`leaseAccessToken` not in `RentPatch`).

- [ ] **Step 3: Widen `RentPatch`**

In `services/src/registry/registry.ts`:

```ts
export type RentPatch = Partial<
  Pick<Rent, "status" | "providerId" | "totalCost" | "startedAt" | "endedAt" | "lastChargedAt" | "leaseAccessToken">
>;
```

- [ ] **Step 4: Map the columns in `supabase.ts`**

In `toRent` (the row -> Rent mapper), add:

```ts
    lastChargedAt: (r.last_charged_at as string) ?? null,
    leaseAccessToken: (r.lease_access_token as string) ?? null,
```

In `updateRent`'s `dbPatch` building, add:

```ts
    if (patch.lastChargedAt !== undefined) dbPatch.last_charged_at = patch.lastChargedAt;
    if (patch.leaseAccessToken !== undefined) dbPatch.lease_access_token = patch.leaseAccessToken;
```

- [ ] **Step 5: Confirm the in-memory mapper**

`InMemoryRegistry.createRent` builds the `Rent` object literally; add the two fields defaulting to null there (find the `createRent` object literal and add `lastChargedAt: null, leaseAccessToken: null`). `updateRent` already spreads the patch, so no change there.

- [ ] **Step 6: Run the in-memory contract**

Run: `cd services && bun test src/registry/in-memory.test.ts`
Expected: PASS (the new case + all existing).

- [ ] **Step 7: Commit**

```bash
git add services/src/registry/registry.ts services/src/registry/supabase.ts services/src/registry/in-memory.ts services/src/registry/contract.ts
git commit -m "feat(registry): persist lastChargedAt + leaseAccessToken on rents"
```

---

## Task 3: Migration 0007 (status + columns)

**Files:**
- Create: `services/supabase/migrations/0007_lease_metering.sql`

- [ ] **Step 1: Write the migration**

```sql
-- services/supabase/migrations/0007_lease_metering.sql
-- The metering worker needs a recoverable balance-stall state and per-lease resumability +
-- connect credentials. Additive: widen the status check and add two nullable columns.

alter table rents drop constraint if exists rents_status_check;
alter table rents add constraint rents_status_check
  check (status in ('queued','running','paused','completed','cancelled','failed','suspended'));

alter table rents add column if not exists last_charged_at timestamptz;
alter table rents add column if not exists lease_access_token text;
```

- [ ] **Step 2: Apply to the live Supabase project**

Apply via the Supabase MCP `apply_migration` (project `xwxuqcougmanzonypoym`, name `0007_lease_metering`) or the dashboard SQL editor. Purely additive (constraint widened, two nullable columns).

Verify: `select status from rents limit 1;` runs, and a row can be updated to `status='suspended'` without error.

- [ ] **Step 3: Commit**

```bash
git add services/supabase/migrations/0007_lease_metering.sql
git commit -m "feat(registry): migration for suspended status + lease metering columns"
```

---

## Task 4: The meter core (`provisionLease` + `meterTick`)

**Files:**
- Create: `services/src/worker/meter.ts`
- Test: `services/src/worker/meter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/src/worker/meter.test.ts
import { test, expect } from "bun:test";
import { InMemoryRegistry } from "../registry/in-memory";
import { FakeSettlementAdapter } from "../settlement/fake";
import { defaultTrust } from "../trust/trust";
import { provisionLease, meterTick } from "./meter";

async function seed() {
  const reg = new InMemoryRegistry();
  await reg.registerProvider({
    alias: "p1", ownerWallet: "0xseller", endpointUrl: "http://localhost:1", resourceType: "GPU",
    region: "US-East", specs: { gpu: "H100" }, online: true, trust: defaultTrust(),
    pricePerCharge: 0.0001, computeScore: 90, avgLatencyMs: 5,
  });
  const rent = await reg.createRent({ name: "demo", userId: "u1", spec: { resourceType: "GPU", region: null }, estimatedUsage: 3 });
  return { reg, rent };
}

test("provisionLease matches a provider and flips the lease to running", async () => {
  const { reg, rent } = await seed();
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 10_000n });
  const res = await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 3 });
  expect(res.status).toBe("running");
  const r = await reg.getRent(rent.id);
  expect(r?.status).toBe("running");
  expect(r?.providerId).toBeTruthy();
  expect(r?.leaseAccessToken).toBeTruthy();
});

test("meterTick charges one unit and stamps lastChargedAt, completing at the budget", async () => {
  const { reg, rent } = await seed();
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 10_000n });
  await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 3 });

  let clock = 1_000_000;
  const deps = { registry: reg, settlement, tickMs: 1000, maxUnits: 3, nowMs: () => clock };

  const a = await meterTick(rent.id, deps);
  expect(a.charged).toBe(true);
  expect((await reg.listCharges(rent.id)).length).toBe(1);

  // Same instant: rate-limited, no second charge.
  const b = await meterTick(rent.id, deps);
  expect(b.charged).toBe(false);
  expect((await reg.listCharges(rent.id)).length).toBe(1);

  // Advance past the tick window twice more -> 3 charges, then completes at the budget.
  clock += 1001; await meterTick(rent.id, deps);
  clock += 1001; await meterTick(rent.id, deps);
  expect((await reg.listCharges(rent.id)).length).toBe(3);
  clock += 1001; const done = await meterTick(rent.id, deps);
  expect(done.status).toBe("completed");
  expect((await reg.getRent(rent.id))?.status).toBe("completed");
});

test("meterTick suspends on a spend-cap stop", async () => {
  const { reg, rent } = await seed();
  // cap below one charge -> FakeSettlementAdapter throws SpendCapError on payForCompute.
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 0n });
  await reg.updateRent(rent.id, { status: "running", providerId: (await reg.listProviders())[0]!.id, startedAt: new Date().toISOString() });
  const res = await meterTick(rent.id, { registry: reg, settlement, tickMs: 1000, maxUnits: 3, nowMs: () => 5 });
  expect(res.status).toBe("suspended");
  expect((await reg.getRent(rent.id))?.status).toBe("suspended");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services && bun test src/worker/meter.test.ts`
Expected: FAIL, "Cannot find module './meter'".

- [ ] **Step 3: Write the implementation**

```ts
// services/src/worker/meter.ts
import type { Registry } from "../registry/registry";
import type { SettlementAdapter } from "../settlement/adapter";
import type { RankStrategy } from "../broker/matching";
import { matchProviders } from "../broker/matching";
import { revalidateProvider } from "../broker/guardrails";
import { SpendCapError } from "../settlement/spend-policy";
import type { RentStatus } from "../domain";

const isoNow = () => new Date().toISOString();

export type ProvisionDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  rank?: RankStrategy;
  maxUnits: number; // budget bound (estimatedUsage or a default)
};

export type ProvisionResult = { status: RentStatus; reason: string };

// queued -> running: match, guard, record the decision, fund the lease budget. A lease that can't
// be matched/guarded fails; one that can't be funded suspends (recoverable once topped up).
export async function provisionLease(rentId: string, deps: ProvisionDeps): Promise<ProvisionResult> {
  const { registry, settlement, rank, maxUnits } = deps;
  const rent = await registry.getRent(rentId);
  if (!rent) throw new Error(`rent not found: ${rentId}`);
  if (rent.status !== "queued") return { status: rent.status, reason: "not queued" };

  const match = await matchProviders(registry, rent.spec, rank);
  if (!match.chosen) {
    await registry.updateRent(rentId, { status: "failed", endedAt: isoNow() });
    return { status: "failed", reason: match.rationale };
  }
  const guard = revalidateProvider(match.chosen, rent.spec);
  if (!guard.ok) {
    await registry.updateRent(rentId, { status: "failed", endedAt: isoNow() });
    return { status: "failed", reason: guard.reason };
  }
  await registry.recordDecision({
    rentId, candidates: match.candidates, chosenProviderId: match.chosen.id, rationale: match.rationale,
  });

  const minAtomic = BigInt(maxUnits) * BigInt(Math.round(match.chosen.pricePerCharge * 1_000_000));
  try {
    if (minAtomic > 0n) await settlement.ensureFunded(minAtomic);
  } catch (e) {
    await registry.updateRent(rentId, { status: "suspended" });
    return { status: "suspended", reason: e instanceof Error ? e.message : "funding failed" };
  }

  await registry.updateRent(rentId, {
    status: "running",
    providerId: match.chosen.id,
    startedAt: isoNow(),
    leaseAccessToken: crypto.randomUUID(),
  });
  return { status: "running", reason: "provisioned" };
}

export type TickDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  tickMs: number;          // minimum ms between charges for one lease
  maxUnits: number;        // budget bound
  nowMs?: () => number;    // injectable clock (tests)
};

export type TickResult = { charged: boolean; status: RentStatus | "missing"; reason: string };

// One metering step for one running lease. Charges at most one unit per tickMs (this is also what
// makes a worker restart safe: a just-charged lease isn't charged again until tickMs elapses, and
// charge seq comes from the persisted count). Genuine spend-cap stops suspend the lease; transient
// pay failures leave it running to retry next tick.
export async function meterTick(rentId: string, deps: TickDeps): Promise<TickResult> {
  const { registry, settlement, tickMs, maxUnits } = deps;
  const clock = deps.nowMs ?? Date.now;

  const rent = await registry.getRent(rentId);
  if (!rent) return { charged: false, status: "missing", reason: "rent not found" };
  if (rent.status !== "running") return { charged: false, status: rent.status, reason: "not running" };

  if (rent.lastChargedAt && clock() - new Date(rent.lastChargedAt).getTime() < tickMs) {
    return { charged: false, status: "running", reason: "not yet" };
  }

  const charges = await registry.listCharges(rentId);
  if (charges.length >= maxUnits) {
    await registry.updateRent(rentId, { status: "completed", totalCost: await registry.rentCost(rentId), endedAt: isoNow() });
    return { charged: false, status: "completed", reason: "budget reached" };
  }

  const provider = rent.providerId ? await registry.getProvider(rent.providerId) : null;
  if (!provider) {
    await registry.updateRent(rentId, { status: "suspended" });
    return { charged: false, status: "suspended", reason: "no provider" };
  }

  const url = `${provider.endpointUrl}/compute?session=${rent.id}`;
  try {
    const paid = await settlement.payForCompute(url);
    await registry.recordCharge({
      rentId, providerId: provider.id, seq: charges.length,
      amount: Number(paid.amountAtomic), authorizationRef: null, settled: false, settlementRef: paid.settlementRef,
    });
    await registry.updateRent(rentId, {
      totalCost: await registry.rentCost(rentId),
      lastChargedAt: new Date(clock()).toISOString(),
    });
    return { charged: true, status: "running", reason: "charged" };
  } catch (e) {
    if (e instanceof SpendCapError) {
      await registry.updateRent(rentId, { status: "suspended" });
      return { charged: false, status: "suspended", reason: e.message };
    }
    return { charged: false, status: "running", reason: e instanceof Error ? e.message : "transient" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services && bun test src/worker/meter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/worker/meter.ts services/src/worker/meter.test.ts
git commit -m "feat(worker): provisionLease + meterTick, the resumable meter core"
```

---

## Task 5: Per-user settlement factory

**Files:**
- Create: `services/src/worker/settlement-factory.ts`
- Test: `services/src/worker/settlement-factory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/src/worker/settlement-factory.test.ts
import { test, expect } from "bun:test";
import { InMemorySpendWalletStore } from "../wallet/store";
import { generateEncKey } from "../wallet/crypto";
import { makeSettlementFactory } from "./settlement-factory";
import type { Rent } from "../domain";

function rent(userId: string): Rent {
  return {
    id: "r1", name: "n", userId, spec: { resourceType: "GPU", region: null }, estimatedUsage: null,
    autonomyArmed: false, status: "queued", providerId: null, totalCost: 0, createdAt: "",
    startedAt: null, endedAt: null, lastChargedAt: null, leaseAccessToken: null,
  };
}

test("caches one adapter per lease and throws when the user has no wallet", async () => {
  const store = new InMemorySpendWalletStore(await generateEncKey());
  await store.getOrCreate("u1");
  let built = 0;
  const factory = makeSettlementFactory(store, {
    capAtomic: 5_000n,
    build: (signer, cap) => { built++; return { buyerAddress: signer.address, capAtomic: cap } as never; },
  });
  const a = await factory(rent("u1"), 10);
  const b = await factory(rent("u1"), 10);
  expect(a).toBe(b);        // cached per lease id
  expect(built).toBe(1);
  await expect(factory(rent("ghost"), 10)).rejects.toThrow(/no spend wallet/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services && bun test src/worker/settlement-factory.test.ts`
Expected: FAIL, "Cannot find module './settlement-factory'".

- [ ] **Step 3: Write the implementation**

```ts
// services/src/worker/settlement-factory.ts
import type { Rent } from "../domain";
import type { SettlementAdapter } from "../settlement/adapter";
import { GatewaySettlementAdapter } from "../settlement/gateway";
import type { SpendWalletStore, SpendSigner } from "../wallet/store";

export type SettlementFactory = (rent: Rent, maxUnits: number) => Promise<SettlementAdapter>;

type Options = {
  capAtomic: bigint;          // per-lease money backstop (the worker also bounds by unit count)
  rpcUrl?: string;            // Arc RPC (point at the Canteen endpoint)
  // Seam so the unit test doesn't construct a real GatewayClient.
  build?: (signer: SpendSigner, capAtomic: bigint, rpcUrl?: string) => SettlementAdapter;
};

// Builds (once per lease) a settlement adapter that pays from THAT user's spend wallet. The
// decrypted key only lives inside this adapter; it never leaves the worker.
export function makeSettlementFactory(store: SpendWalletStore, opts: Options): SettlementFactory {
  const cache = new Map<string, SettlementAdapter>();
  const build =
    opts.build ??
    ((signer, capAtomic, rpcUrl) =>
      new GatewaySettlementAdapter({ privateKey: signer.privateKey, capAtomic, chain: "arcTestnet", rpcUrl }));

  return async (rent, _maxUnits) => {
    const existing = cache.get(rent.id);
    if (existing) return existing;
    const signer = await store.loadSigner(rent.userId);
    if (!signer) throw new Error(`no spend wallet for user ${rent.userId}`);
    const adapter = build(signer, opts.capAtomic, opts.rpcUrl);
    cache.set(rent.id, adapter);
    return adapter;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services && bun test src/worker/settlement-factory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/src/worker/settlement-factory.ts services/src/worker/settlement-factory.test.ts
git commit -m "feat(worker): per-user settlement factory from the spend-wallet store"
```

---

## Task 6: The worker pass (orchestration)

**Files:**
- Create: `services/src/worker/loop.ts`
- Test: `services/src/worker/loop.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/src/worker/loop.test.ts
import { test, expect } from "bun:test";
import { InMemoryRegistry } from "../registry/in-memory";
import { FakeSettlementAdapter } from "../settlement/fake";
import { defaultTrust } from "../trust/trust";
import { workerPass } from "./loop";

test("a queued lease provisions then charges across passes, completing at its estimatedUsage", async () => {
  const reg = new InMemoryRegistry();
  await reg.registerProvider({
    alias: "p1", ownerWallet: "0xseller", endpointUrl: "http://localhost:1", resourceType: "GPU",
    region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001,
    computeScore: 90, avgLatencyMs: 5,
  });
  await reg.createRent({ name: "demo", userId: "u1", spec: { resourceType: "GPU", region: null }, estimatedUsage: 2 });

  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 10_000n });
  let clock = 1_000_000;
  const deps = {
    registry: reg,
    settlementFor: async () => settlement,
    tickMs: 1000,
    defaultMaxUnits: 100,
    nowMs: () => clock,
  };

  await workerPass(deps); // provisions, then charges its first unit
  clock += 1001;
  await workerPass(deps); // second unit
  clock += 1001;
  await workerPass(deps); // budget reached -> completed

  const rents = await reg.listRents({ userId: "u1" });
  expect(rents[0]?.status).toBe("completed");
  expect((await reg.listCharges(rents[0]!.id)).length).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services && bun test src/worker/loop.test.ts`
Expected: FAIL, "Cannot find module './loop'".

- [ ] **Step 3: Write the implementation**

```ts
// services/src/worker/loop.ts
import type { Registry } from "../registry/registry";
import type { Rent } from "../domain";
import type { RankStrategy } from "../broker/matching";
import type { SettlementFactory } from "./settlement-factory";
import { provisionLease, meterTick } from "./meter";

export type WorkerDeps = {
  registry: Registry;
  settlementFor: SettlementFactory;
  rank?: RankStrategy;
  tickMs: number;
  defaultMaxUnits: number;
  nowMs?: () => number;
};

// estimatedUsage is the lease's unit budget; fall back to a sane default when unset.
function budget(rent: Rent, defaultMaxUnits: number): number {
  return rent.estimatedUsage != null && rent.estimatedUsage > 0 ? Math.floor(rent.estimatedUsage) : defaultMaxUnits;
}

// One sweep: provision every queued lease, then tick every running lease. Reads all state from the
// registry, so it is safe to run on an interval and safe to resume after a restart. Per-lease errors
// are swallowed (logged) so one bad lease never stalls the others.
export async function workerPass(deps: WorkerDeps): Promise<void> {
  const { registry } = deps;

  for (const rent of await registry.listRents({ status: "queued" })) {
    try {
      const maxUnits = budget(rent, deps.defaultMaxUnits);
      const settlement = await deps.settlementFor(rent, maxUnits);
      await provisionLease(rent.id, { registry, settlement, rank: deps.rank, maxUnits });
    } catch (e) {
      console.error(`[worker] provision ${rent.id} failed:`, e instanceof Error ? e.message : e);
    }
  }

  for (const rent of await registry.listRents({ status: "running" })) {
    try {
      const maxUnits = budget(rent, deps.defaultMaxUnits);
      const settlement = await deps.settlementFor(rent, maxUnits);
      await meterTick(rent.id, { registry, settlement, tickMs: deps.tickMs, maxUnits, nowMs: deps.nowMs });
    } catch (e) {
      console.error(`[worker] tick ${rent.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services && bun test src/worker/loop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/src/worker/loop.ts services/src/worker/loop.test.ts
git commit -m "feat(worker): the provision + meter orchestration pass"
```

---

## Task 7: Entrypoint and health server

**Files:**
- Create: `services/src/worker/index.ts`
- Modify: `services/package.json` (a `worker` script)

- [ ] **Step 1: Write the entrypoint**

```ts
// services/src/worker/index.ts
import { SupabaseRegistry } from "../registry/supabase";
import { SupabaseSpendWalletStore } from "../wallet/supabase-store";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../config";
import { liveBrokerDeps } from "../broker/deps";
import { makeSettlementFactory } from "./settlement-factory";
import { workerPass, type WorkerDeps } from "./loop";

const cfg = loadConfig();
if (!cfg.supabase) throw new Error("worker needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
const encKey = process.env.SPEND_WALLET_ENC_KEY;
if (!encKey) throw new Error("worker needs SPEND_WALLET_ENC_KEY");

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? "1000");
const DEFAULT_MAX_UNITS = Number(process.env.WORKER_DEFAULT_MAX_UNITS ?? "600"); // ~10 min at 1/s
const LEASE_CAP_ATOMIC = BigInt(process.env.WORKER_LEASE_CAP_ATOMIC ?? "1000000"); // 1 USDC backstop

const registry = new SupabaseRegistry(cfg.supabase.url, cfg.supabase.serviceRoleKey);
const admin = createClient(cfg.supabase.url, cfg.supabase.serviceRoleKey, { auth: { persistSession: false } });
const store = new SupabaseSpendWalletStore(admin, encKey);
const settlementFor = makeSettlementFactory(store, { capAtomic: LEASE_CAP_ATOMIC, rpcUrl: process.env.ARC_RPC_URL });

// The soul-driven ranker, with the deterministic scorer as the built-in fallback inside decide().
// If LLM_* is unset, fall back to no ranker (matchProviders uses its deterministic default).
let rank;
try {
  rank = (await liveBrokerDeps()).rank;
} catch {
  console.warn("[worker] LLM_* not configured; using the deterministic ranker");
}

const deps: WorkerDeps = { registry, settlementFor, rank, tickMs: TICK_MS, defaultMaxUnits: DEFAULT_MAX_UNITS };

let running = false;
async function tick() {
  if (running) return; // never overlap passes
  running = true;
  try {
    await workerPass(deps);
  } catch (e) {
    console.error("[worker] pass failed:", e instanceof Error ? e.message : e);
  } finally {
    running = false;
  }
}
setInterval(tick, TICK_MS);
console.log(`[worker] metering loop started (tick ${TICK_MS}ms)`);

// Render's free tier is a WEB service: expose /health so it stays up and an external pinger can keep
// it warm. The metering loop runs regardless; this is just the liveness surface.
const port = Number(process.env.PORT ?? "8787");
Bun.serve({
  port,
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/health") return new Response("ok", { status: 200 });
    return new Response("metering worker", { status: 200 });
  },
});
console.log(`[worker] health server on :${port}`);
```

- [ ] **Step 2: Add the run script**

In `services/package.json` `scripts`, add:

```json
    "worker": "bun run src/worker/index.ts",
```

- [ ] **Step 3: Smoke-test it boots**

Run: `cd services && timeout 5 bun run worker` (with `services/.env` populated).
Expected: logs `metering loop started` and `health server on :8787`, no throw. In another shell: `curl -s localhost:8787/health` returns `ok`. (If no leases exist, passes are no-ops.)

- [ ] **Step 4: Commit**

```bash
git add services/src/worker/index.ts services/package.json
git commit -m "feat(worker): entrypoint, metering interval, and /health server"
```

---

## Task 8: Seed provider registration

**Files:**
- Create: `services/scripts/seed-provider.ts`

- [ ] **Step 1: Write the script**

```ts
// services/scripts/seed-provider.ts
// Register one first-party provider so the meter pays a real endpoint. Run the x402 seller
// (bun run run-provider) somewhere reachable and pass its public URL as PROVIDER_ENDPOINT_URL.
import { SupabaseRegistry } from "../src/registry/supabase";
import { defaultTrust } from "../src/trust/trust";
import { loadConfig } from "../src/config";

const cfg = loadConfig();
if (!cfg.supabase) throw new Error("need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
const endpointUrl = process.env.PROVIDER_ENDPOINT_URL;
const ownerWallet = process.env.PROVIDER_OWNER_WALLET;
if (!endpointUrl || !ownerWallet) throw new Error("set PROVIDER_ENDPOINT_URL and PROVIDER_OWNER_WALLET");

const reg = new SupabaseRegistry(cfg.supabase.url, cfg.supabase.serviceRoleKey);
const provider = await reg.registerProvider({
  alias: process.env.PROVIDER_ALIAS ?? "seed-gpu-1",
  ownerWallet,
  endpointUrl,
  resourceType: "GPU",
  region: process.env.PROVIDER_REGION ?? "US-East",
  specs: { gpu: "H100", vramGb: 80 },
  online: true,
  trust: defaultTrust("Verified"),
  pricePerCharge: Number(process.env.PROVIDER_PRICE_PER_CHARGE ?? "0.0001"),
  computeScore: 95,
  avgLatencyMs: 6,
});
console.log("registered seed provider:", provider.id, provider.alias, "->", provider.endpointUrl);
```

- [ ] **Step 2: Add a script alias**

In `services/package.json` `scripts`, add:

```json
    "seed:provider": "bun run scripts/seed-provider.ts",
```

- [ ] **Step 3: Verify (with a reachable provider URL)**

Run: `cd services && PROVIDER_ENDPOINT_URL=https://<your-seller> PROVIDER_OWNER_WALLET=0x... bun run seed:provider`
Expected: prints the registered provider id; the row appears in the marketplace.

- [ ] **Step 4: Commit**

```bash
git add services/scripts/seed-provider.ts services/package.json
git commit -m "feat(worker): seed-provider registration script"
```

---

## Task 9: Connect credentials + real cost on a running lease

**Files:**
- Modify: `src/routes/dashboard.tsx`

- [ ] **Step 1: Surface the endpoint, token, and real cost in the rent sheet**

In `src/routes/dashboard.tsx`, inside `RentDetailSheet`, below the streaming-spend card (after the `glass-card` that holds the `StreamingTicker`), add a connect-info block shown only while the lease is running and has a token. The `rent` already carries `leaseAccessToken`; the `provider` carries `endpointUrl`:

```tsx
{rent.status === "running" && rent.leaseAccessToken && (
  <div className="glass-card p-4 space-y-2">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Connect</div>
    <div className="space-y-1 text-xs">
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Endpoint</span>
        <span className="font-mono truncate">{provider?.endpointUrl ?? "—"}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Access token</span>
        <span className="font-mono truncate">{rent.leaseAccessToken}</span>
      </div>
    </div>
  </div>
)}
<div className="text-xs text-muted-foreground">
  Charged so far <span className="font-mono text-foreground">${(rent.totalCost / 1_000_000).toFixed(6)}</span>
</div>
```

(Note: `totalCost` is stored in atomic USDC by the worker, hence `/1_000_000`. The existing history tab divides `totalCost` differently because it predates the worker; leave that pass alone here, it is corrected when the worker is the source of truth.)

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: clean (the `Rent` type now has `leaseAccessToken`).

- [ ] **Step 3: Verify the route still renders**

Run: `bun run dev`, then `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8081/dashboard` (expect a 307 to onboarding when signed out, proving it compiles and the guard runs).

- [ ] **Step 4: Commit**

```bash
git add src/routes/dashboard.tsx
git commit -m "feat(dashboard): show connect credentials + real charged cost on a running lease"
```

---

## Task 10: Worker env + Render deploy docs

**Files:**
- Modify: `services/.env.example`
- Create: `docs/WORKER_DEPLOY.md`

- [ ] **Step 1: Document the worker env**

Add to `services/.env.example`:

```bash
# Metering worker
WORKER_TICK_MS=1000
WORKER_DEFAULT_MAX_UNITS=600
WORKER_LEASE_CAP_ATOMIC=1000000
PORT=8787
# Seed provider registration (scripts/seed-provider.ts)
PROVIDER_ENDPOINT_URL=
PROVIDER_OWNER_WALLET=
```

- [ ] **Step 2: Write the deploy doc**

```markdown
# Deploying the metering worker

The worker (`services/src/worker/index.ts`) is the always-on half of Prime Compute: it streams
real USDC charges for active leases whether or not anyone's browser is open. The web app (a
Cloudflare Worker) only reads/writes the registry; this process moves the money.

## Render (free tier)

Render's free tier is web-services only and spins down after ~15 min idle, so the worker ships a
`/health` endpoint and must be kept warm:

1. New Web Service, root `services/`, build `bun install`, start `bun run worker`.
2. Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SPEND_WALLET_ENC_KEY` (same value as the web
   app), `ARC_RPC_URL` (your Canteen endpoint), `ARC_CHAIN_ID`, `USDC_ADDRESS`, the `LLM_*` set
   (optional; deterministic ranker if absent), and `WORKER_*`/`PORT`.
3. Keep it warm: point an external pinger (cron-job.org / UptimeRobot, free) at
   `https://<service>/health` every ~10 min.

It is fully resumable: on restart it re-scans `running` leases and continues. `last_charged_at` plus
the persisted charge `seq` mean a restart never double-charges or skips, so the spin-down/restart
behaviour of the free tier is non-fatal.
```

- [ ] **Step 3: Commit**

```bash
git add services/.env.example docs/WORKER_DEPLOY.md
git commit -m "docs(worker): env vars and Render deploy guide"
```

---

## Self-review notes

- **Spec coverage (spec 1 worker pieces):** always-on worker hosting the meter (Tasks 4,6,7) ✓; provision queued -> running incl. fund-from-user-wallet (Task 4 `provisionLease`, Task 5 factory) ✓; per-second real charges from the user's spend wallet (Tasks 4,5) ✓; `suspended` balance-stall state + resume (Tasks 1,4; resume via existing `resumeRent` now that `canResume` covers suspended) ✓; resumability via `last_charged_at` + per-seq charges (Task 4 rate-limit + Task 6 stateless pass) ✓; connect credentials on a running lease (Task 9) ✓; real recorded charges drive the cost shown (Task 4 updates `totalCost`; Task 9 reads it) ✓; Render free web-service + `/health` + keep-alive + resumable (Tasks 7,10) ✓; seed provider (Task 8) ✓; Canteen RPC via `ARC_RPC_URL` (Task 5 factory passes `rpcUrl`) ✓.
- **Deliberate follow-ups (noted, not gaps):** mid-stream migration-on-degrade (`streamWithMigration`) and health-based give-up on a permanently dead provider. v1 retries transient failures and suspends only on a real spend-cap/balance stop. Spec 2 owns real compute behind the endpoint.
- **Type consistency:** `provisionLease`/`meterTick` deps and results, `SettlementFactory` signature `(rent, maxUnits) => Promise<SettlementAdapter>`, and `WorkerDeps` all line up across Tasks 4-7. `Rent.lastChargedAt`/`leaseAccessToken` (Task 1) are used identically in registry mapping (Task 2), the meter (Task 4), and the UI (Task 9). `RentStatus` includes `suspended` everywhere it's set.
- **No placeholders:** every code step is complete; Task 9 is a described insertion into a known file region with the exact JSX shown.

---

## Execution handoff

This is plan 2 of spec 1, building on the merged per-user spend wallets. After it lands, creating a rent (from the marketplace or Lumen) results in a real, metered, on-chain payment stream that the user can walk away from. Spec 2 (real sandboxed compute behind the provider endpoint + provider self-onboarding) is the next body of work.
