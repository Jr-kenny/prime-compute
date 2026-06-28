# Matching + Stream Engine Implementation Plan (Plan 5 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the broker's deterministic money loop: pick a provider (hard filter + rank), re-validate it against the guardrails before any money moves, then stream gasless charges through the settlement adapter one unit at a time, recording every `Charge`, stopping instantly on cancel / spend cap / health failure, and reconciling settled charges.

**Architecture:** A single matching engine (`hardFilter` then a rank strategy, deterministic by default with an LLM strategy pluggable and the scorer always the fallback) feeds a deterministic guardrail check, which feeds a stream engine that loops over the `SettlementAdapter`. Everything is built against the `Registry` and `SettlementAdapter` interfaces, so the whole loop tests offline with `InMemoryRegistry` + `FakeSettlementAdapter` and runs for real with `SupabaseRegistry` + `GatewaySettlementAdapter` unchanged. A `runRent` orchestrator ties it together for one rent. Model-driven migration on degrade, Lumen, and the dashboard are Plan 6; this plan makes the loop itself correct and provable.

**Tech Stack:** Bun + TypeScript, `bun test`. Builds on Plans 1-4 (`domain`, `Registry`, `scoring`, `SettlementAdapter` + `FakeSettlementAdapter`, `checkSpend`/`SpendCapError`).

**Spec:** [`docs/superpowers/specs/2026-06-28-autonomous-compute-broker-design.md`](../specs/2026-06-28-autonomous-compute-broker-design.md) — The broker's decision loop and guardrails, Error handling, Data flow steps 2-3 and 5-8, Testing (unit + cancel-mid-stream).

**Naming:** entity is `Rent`, billing unit is `Charge`, provider compute endpoint is `/compute`, price is `pricePerCharge`. Amounts are USDC atomic units (`Charge.amount` is a number; the adapter speaks `bigint`).

**Branch:** `git checkout -b feat/stream-engine` off `main`.

**Handoff note:** Tasks 1-7 run fully offline (`InMemoryRegistry` + `FakeSettlementAdapter`); the `SupabaseRegistry` contract for Task 3 runs live only when `SUPABASE_*` is set. Task 8 is a gated real-chain script needing `BROKER_WALLET_PRIVATE_KEY` + `PROVIDER_WALLET_PRIVATE_KEY`. Migration-on-degrade, the live LLM ranker, Lumen, and the dashboard are out of scope (Plan 6).

---

## File Structure

**Created:**
- `services/src/broker/matching.ts` — `matchProviders` (hard filter + rank strategy) + `deterministicRank`
- `services/src/broker/matching.test.ts`
- `services/src/broker/guardrails.ts` — `revalidateProvider` deterministic re-check
- `services/src/broker/guardrails.test.ts`
- `services/src/broker/health.ts` — `HealthMonitor`
- `services/src/broker/health.test.ts`
- `services/src/broker/stream.ts` — `streamRent` (the per-rent payment loop)
- `services/src/broker/stream.test.ts`
- `services/src/broker/reconcile.ts` — `reconcileRent` (mark settled charges)
- `services/src/broker/reconcile.test.ts`
- `services/src/broker/runner.ts` — `runRent` orchestration
- `services/src/broker/runner.test.ts`
- `services/scripts/broker-roundtrip.ts` — gated full-loop run on Arc testnet

**Modified:**
- `services/src/registry/registry.ts` — add `markChargeSettled`
- `services/src/registry/in-memory.ts` — implement `markChargeSettled`
- `services/src/registry/supabase.ts` — implement `markChargeSettled`
- `services/src/registry/contract.ts` — cover `markChargeSettled`
- `services/package.json` — add `broker:roundtrip` script

---

## Task 1: Matching engine

**Files:**
- Create: `services/src/broker/matching.ts`
- Test: `services/src/broker/matching.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/broker/matching.test.ts`:

```ts
import { test, expect } from "bun:test";
import { matchProviders, deterministicRank } from "./matching";
import { InMemoryRegistry } from "../registry/in-memory";
import type { NewProvider } from "../registry/registry";

const base: Omit<NewProvider, "alias" | "resourceType" | "region" | "online" | "stakeAmount" | "pricePerCharge" | "computeScore"> = {
  ownerWallet: "0x0",
  endpointUrl: "http://x",
  specs: {},
  avgLatencyMs: 5,
};

async function seed() {
  const reg = new InMemoryRegistry();
  await reg.registerProvider({ ...base, alias: "A", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.000006, computeScore: 70 });
  await reg.registerProvider({ ...base, alias: "B", resourceType: "GPU", region: "EU-West", online: true, stakeAmount: 100, pricePerCharge: 0.000004, computeScore: 92 });
  await reg.registerProvider({ ...base, alias: "C", resourceType: "GPU", region: "US-East", online: false, stakeAmount: 100, pricePerCharge: 0.000003, computeScore: 99 });
  await reg.registerProvider({ ...base, alias: "D", resourceType: "CPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.000002, computeScore: 80 });
  return reg;
}

test("matchProviders filters then ranks; picks the best GPU and excludes offline/wrong-type", async () => {
  const reg = await seed();
  const result = await matchProviders(reg, { resourceType: "GPU", region: null }, deterministicRank);
  expect(result.chosen?.alias).toBe("B"); // cheaper + higher score than A; C offline; D is CPU
  const aliases = result.candidates.length;
  expect(aliases).toBe(2); // A and B only
  expect(result.rationale).toBeTruthy();
});

test("matchProviders returns chosen null when nothing matches", async () => {
  const reg = await seed();
  const result = await matchProviders(reg, { resourceType: "Storage", region: null }, deterministicRank);
  expect(result.chosen).toBeNull();
  expect(result.candidates).toEqual([]);
});

test("a throwing rank strategy falls back to the deterministic scorer", async () => {
  const reg = await seed();
  const boom = async () => { throw new Error("model down"); };
  const result = await matchProviders(reg, { resourceType: "GPU", region: null }, boom);
  expect(result.chosen?.alias).toBe("B"); // still ranked by the fallback
  expect(result.rationale).toMatch(/fell back/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/broker/matching.test.ts`
Expected: FAIL — `Cannot find module "./matching"`.

- [ ] **Step 3: Write the matching engine**

Write `services/src/broker/matching.ts`:

```ts
import type { Provider, RentSpec } from "../domain";
import type { Registry } from "../registry/registry";
import { hardFilter, scoreProviders } from "../scoring";

export type MatchResult = {
  candidates: { providerId: string; rank: number }[];
  chosen: Provider | null;
  rationale: string;
};

// Ranks pre-filtered candidates. Default is deterministic; an LLM strategy can
// replace it (Plan 6), with the deterministic scorer always the fallback.
export type RankStrategy = (providers: Provider[], spec: RentSpec) => Promise<Provider[]>;

export const deterministicRank: RankStrategy = async (providers, spec) =>
  scoreProviders(providers, spec);

export async function matchProviders(
  registry: Registry,
  spec: RentSpec,
  rank: RankStrategy = deterministicRank,
): Promise<MatchResult> {
  const candidatesRaw = await registry.listProviders({ resourceType: spec.resourceType, onlineOnly: true });
  const filtered = hardFilter(candidatesRaw, spec);
  if (filtered.length === 0) {
    return { candidates: [], chosen: null, rationale: "no providers match the hard requirements" };
  }

  let ranked: Provider[];
  let rationale: string;
  try {
    ranked = await rank(filtered, spec);
    rationale = rank === deterministicRank
      ? "ranked by deterministic price/score/latency blend"
      : "ranked by the broker model";
  } catch (err) {
    ranked = scoreProviders(filtered, spec);
    rationale = `model rank failed (${err instanceof Error ? err.message : "unknown"}); fell back to deterministic scorer`;
  }

  return {
    candidates: ranked.map((p, i) => ({ providerId: p.id, rank: i })),
    chosen: ranked[0] ?? null,
    rationale,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/broker/matching.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/broker/matching.ts services/src/broker/matching.test.ts
git commit -m "feat(broker): matching engine (hard filter + pluggable rank + fallback)"
```

---

## Task 2: Guardrails

**Files:**
- Create: `services/src/broker/guardrails.ts`
- Test: `services/src/broker/guardrails.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/broker/guardrails.test.ts`:

```ts
import { test, expect } from "bun:test";
import { revalidateProvider } from "./guardrails";
import type { Provider } from "../domain";

const ok: Provider = {
  id: "p", alias: "n", ownerWallet: "0x0", endpointUrl: "http://x", resourceType: "GPU",
  region: "US-East", specs: {}, online: true, stakeAmount: 100, pricePerCharge: 0.000006,
  computeScore: 90, avgLatencyMs: 5,
};

test("passes a healthy, staked, matching provider", () => {
  expect(revalidateProvider(ok, { resourceType: "GPU", region: null })).toEqual({ ok: true });
});

test("rejects an offline provider", () => {
  expect(revalidateProvider({ ...ok, online: false }, { resourceType: "GPU", region: null }).ok).toBe(false);
});

test("rejects a provider with no active stake", () => {
  const d = revalidateProvider({ ...ok, stakeAmount: 0 }, { resourceType: "GPU", region: null });
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.reason).toMatch(/stake/);
});

test("rejects a resource-type or region mismatch", () => {
  expect(revalidateProvider(ok, { resourceType: "CPU", region: null }).ok).toBe(false);
  expect(revalidateProvider(ok, { resourceType: "GPU", region: "EU-West" }).ok).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/broker/guardrails.test.ts`
Expected: FAIL — `Cannot find module "./guardrails"`.

- [ ] **Step 3: Write the guardrails**

Write `services/src/broker/guardrails.ts`:

```ts
import type { Provider, RentSpec } from "../domain";

export type GuardResult = { ok: true } | { ok: false; reason: string };

// Re-validate the AI's pick against the hard requirements before any money moves.
// The spend/balance guard lives in the settlement adapter (checkSpend +
// ensureFunded); this covers liveness, stake, and requirement fit.
export function revalidateProvider(p: Provider, spec: RentSpec): GuardResult {
  if (!p.online) return { ok: false, reason: `provider ${p.id} is offline` };
  if (p.stakeAmount <= 0) return { ok: false, reason: `provider ${p.id} has no active stake` };
  if (p.resourceType !== spec.resourceType) {
    return { ok: false, reason: `provider ${p.id} is ${p.resourceType}, need ${spec.resourceType}` };
  }
  if (spec.region !== null && p.region !== spec.region) {
    return { ok: false, reason: `provider ${p.id} is in ${p.region}, need ${spec.region}` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/broker/guardrails.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/broker/guardrails.ts services/src/broker/guardrails.test.ts
git commit -m "feat(broker): deterministic provider re-validation guardrail"
```

---

## Task 3: Registry — markChargeSettled

**Files:**
- Modify: `services/src/registry/registry.ts`, `services/src/registry/in-memory.ts`, `services/src/registry/supabase.ts`, `services/src/registry/contract.ts`

- [ ] **Step 1: Add to the contract suite**

In `services/src/registry/contract.ts`, add this test inside the `describe` block,
after the existing `recordCharge + rentCost` test:

```ts
    test("markChargeSettled flips a charge to settled", async () => {
      const provider = await reg.registerProvider(sampleProvider);
      const rent = await reg.createRent({ name: "j", userId: "u1", spec: { resourceType: "GPU", region: null } });
      const charge = await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: 0, amount: 100, authorizationRef: null, settled: false, settlementRef: "ref-0" });
      await reg.markChargeSettled(charge.id);
      const charges = await reg.listCharges(rent.id);
      expect(charges[0]?.settled).toBe(true);
    });
```

- [ ] **Step 2: Add to the interface**

In `services/src/registry/registry.ts`, add to the `Registry` interface after
`recordCharge`:

```ts
  markChargeSettled(chargeId: string): Promise<void>;
```

- [ ] **Step 3: Run the contract tests to verify they fail**

Run: `cd services && bun test src/registry/in-memory.test.ts`
Expected: FAIL — `markChargeSettled` does not exist on `InMemoryRegistry` (type error / runtime).

- [ ] **Step 4: Implement on InMemoryRegistry**

In `services/src/registry/in-memory.ts`, add this method (the charges are stored in
the `this.charges` array):

```ts
  async markChargeSettled(chargeId: string): Promise<void> {
    const c = this.charges.find((x) => x.id === chargeId);
    if (c) c.settled = true;
  }
```

- [ ] **Step 5: Implement on SupabaseRegistry**

In `services/src/registry/supabase.ts`, add:

```ts
  async markChargeSettled(chargeId: string): Promise<void> {
    const { error } = await this.db.from("charges").update({ settled: true }).eq("id", chargeId);
    if (error) throw new Error(`markChargeSettled: ${error.message}`);
  }
```

- [ ] **Step 6: Run it to verify it passes**

Run: `cd services && bun test src/registry/in-memory.test.ts && bunx tsc --noEmit`
Expected: PASS (contract incl. the new test), tsc exit 0. (The Supabase contract
runs the same test live when `SUPABASE_*` is set.)

- [ ] **Step 7: Commit**

```bash
git add services/src/registry/registry.ts services/src/registry/in-memory.ts services/src/registry/supabase.ts services/src/registry/contract.ts
git commit -m "feat(registry): markChargeSettled for reconciliation"
```

---

## Task 4: Health monitor

**Files:**
- Create: `services/src/broker/health.ts`
- Test: `services/src/broker/health.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/broker/health.test.ts`:

```ts
import { test, expect } from "bun:test";
import { HealthMonitor } from "./health";

test("stays healthy on a good sample", () => {
  const h = new HealthMonitor();
  expect(h.observe({ ok: true }).healthy).toBe(true);
});

test("goes unhealthy after N consecutive failures", () => {
  const h = new HealthMonitor({ maxConsecutiveFailures: 3 });
  expect(h.observe({ ok: false }).healthy).toBe(true); // 1
  expect(h.observe({ ok: false }).healthy).toBe(true); // 2
  expect(h.observe({ ok: false }).healthy).toBe(false); // 3 -> trips
});

test("a success resets the failure streak", () => {
  const h = new HealthMonitor({ maxConsecutiveFailures: 2 });
  h.observe({ ok: false });
  expect(h.observe({ ok: true }).healthy).toBe(true);
  expect(h.observe({ ok: false }).healthy).toBe(true); // streak was reset, so 1 not 2
});

test("trips on latency over the threshold", () => {
  const h = new HealthMonitor({ maxLatencyMs: 100 });
  expect(h.observe({ ok: true, latencyMs: 250 }).healthy).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/broker/health.test.ts`
Expected: FAIL — `Cannot find module "./health"`.

- [ ] **Step 3: Write the health monitor**

Write `services/src/broker/health.ts`:

```ts
export type Health = { healthy: boolean; reason: string };
export type HealthSample = { ok: boolean; latencyMs?: number };

export class HealthMonitor {
  private consecutiveFailures = 0;
  constructor(private opts: { maxConsecutiveFailures?: number; maxLatencyMs?: number } = {}) {}

  observe(sample: HealthSample): Health {
    const maxFail = this.opts.maxConsecutiveFailures ?? 3;
    const maxLatency = this.opts.maxLatencyMs ?? Number.POSITIVE_INFINITY;

    if (!sample.ok) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= maxFail) {
        return { healthy: false, reason: `${this.consecutiveFailures} consecutive failures` };
      }
      return { healthy: true, reason: "transient failure within tolerance" };
    }

    this.consecutiveFailures = 0;
    if (sample.latencyMs !== undefined && sample.latencyMs > maxLatency) {
      return { healthy: false, reason: `latency ${sample.latencyMs}ms over ${maxLatency}ms` };
    }
    return { healthy: true, reason: "ok" };
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/broker/health.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/broker/health.ts services/src/broker/health.test.ts
git commit -m "feat(broker): health monitor (failure streak + latency)"
```

---

## Task 5: Stream engine

**Files:**
- Create: `services/src/broker/stream.ts`
- Test: `services/src/broker/stream.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/broker/stream.test.ts`:

```ts
import { test, expect } from "bun:test";
import { streamRent } from "./stream";
import { InMemoryRegistry } from "../registry/in-memory";
import { FakeSettlementAdapter } from "../settlement/fake";
import type { SettlementAdapter, PaidCompute, SettlementStatus } from "../settlement/adapter";
import type { Provider, Rent } from "../domain";

const provider: Provider = {
  id: "p1", alias: "n", ownerWallet: "0x0", endpointUrl: "http://prov", resourceType: "GPU",
  region: "US-East", specs: {}, online: true, stakeAmount: 100, pricePerCharge: 0.0001,
  computeScore: 90, avgLatencyMs: 5,
};

async function makeRent(reg: InMemoryRegistry): Promise<Rent> {
  return reg.createRent({ name: "r", userId: "u1", spec: { resourceType: "GPU", region: null } });
}

test("streams maxUnits, records a charge each, cost is exact", async () => {
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  const result = await streamRent(rent, provider, { registry: reg, settlement }, { maxUnits: 3 });
  expect(result.units).toBe(3);
  expect(result.stoppedBy).toBe("maxUnits");
  expect(await reg.rentCost(rent.id)).toBe(300);
  expect((await reg.listCharges(rent.id)).length).toBe(3);
});

test("stops cleanly when the spend cap is hit, cost stays exact", async () => {
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 250n });
  const result = await streamRent(rent, provider, { registry: reg, settlement }, { maxUnits: 10 });
  expect(result.stoppedBy).toBe("cap");
  expect(result.units).toBe(2); // 100 + 100 = 200; third would breach 250
  expect(await reg.rentCost(rent.id)).toBe(200);
});

test("cancel stops within one unit", async () => {
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  let n = 0;
  const result = await streamRent(rent, provider, { registry: reg, settlement }, {
    maxUnits: 100,
    shouldStop: () => n++ >= 2, // allow 2 units, then cancel
  });
  expect(result.stoppedBy).toBe("cancel");
  expect(result.units).toBe(2);
});

test("a persistently failing provider trips unhealthy and stops", async () => {
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  // An adapter whose payForCompute always throws a non-cap error (x402 failure).
  const failing: SettlementAdapter = {
    buyerAddress: "0xB",
    async ensureFunded() { return { deposited: false }; },
    async payForCompute(): Promise<PaidCompute> { throw new Error("402 not honored"); },
    async reconcile(ref): Promise<SettlementStatus> { return { ref, status: "unknown", settled: false }; },
  };
  const result = await streamRent(rent, provider, { registry: reg, settlement: failing }, { maxUnits: 100 });
  expect(result.stoppedBy).toBe("unhealthy");
  expect(result.units).toBe(0); // never paid
  expect((await reg.listCharges(rent.id)).length).toBe(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/broker/stream.test.ts`
Expected: FAIL — `Cannot find module "./stream"`.

- [ ] **Step 3: Write the stream engine**

Write `services/src/broker/stream.ts`:

```ts
import type { Registry } from "../registry/registry";
import type { SettlementAdapter } from "../settlement/adapter";
import type { Provider, Rent } from "../domain";
import { SpendCapError } from "../settlement/spend-policy";
import { HealthMonitor } from "./health";

export type StreamDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  health?: HealthMonitor;
};

export type StreamOptions = {
  maxUnits?: number; // safety bound on iterations
  shouldStop?: () => boolean; // external cancel signal, checked before each unit
};

export type StoppedBy = "cancel" | "cap" | "maxUnits" | "unhealthy";

export type StreamResult = {
  units: number;
  totalCostAtomic: bigint;
  stoppedBy: StoppedBy;
  reason: string;
};

// The per-rent payment loop. Pays one charge per unit, records it, watches health,
// and stops instantly on cancel / spend cap / health failure. Migration to another
// provider on degrade is Plan 6; here an unhealthy provider just stops the stream.
export async function streamRent(
  rent: Rent,
  provider: Provider,
  deps: StreamDeps,
  opts: StreamOptions = {},
): Promise<StreamResult> {
  const url = `${provider.endpointUrl}/compute?session=${rent.id}`;
  const maxUnits = opts.maxUnits ?? Number.POSITIVE_INFINITY;
  const health = deps.health ?? new HealthMonitor();

  let units = 0;
  let totalCostAtomic = 0n;
  let seq = 0;

  const done = (stoppedBy: StoppedBy, reason: string): StreamResult =>
    ({ units, totalCostAtomic, stoppedBy, reason });

  while (units < maxUnits) {
    if (opts.shouldStop?.()) return done("cancel", "cancelled by caller");

    let paid;
    try {
      paid = await deps.settlement.payForCompute(url);
    } catch (err) {
      if (err instanceof SpendCapError) return done("cap", err.message);
      const h = health.observe({ ok: false }); // x402/facilitator failure: no charge advances
      if (!h.healthy) return done("unhealthy", h.reason);
      continue; // transient: try the next unit
    }

    await deps.registry.recordCharge({
      rentId: rent.id,
      providerId: provider.id,
      seq: seq++,
      amount: Number(paid.amountAtomic),
      authorizationRef: null,
      settled: false,
      settlementRef: paid.settlementRef,
    });
    totalCostAtomic += paid.amountAtomic;
    units++;

    const h = health.observe({ ok: true });
    if (!h.healthy) return done("unhealthy", h.reason);
  }

  return done("maxUnits", `reached maxUnits=${maxUnits}`);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/broker/stream.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/broker/stream.ts services/src/broker/stream.test.ts
git commit -m "feat(broker): stream engine (pay/record per unit; stop on cancel/cap/health)"
```

---

## Task 6: Reconcile pass

**Files:**
- Create: `services/src/broker/reconcile.ts`
- Test: `services/src/broker/reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/broker/reconcile.test.ts`:

```ts
import { test, expect } from "bun:test";
import { reconcileRent } from "./reconcile";
import { InMemoryRegistry } from "../registry/in-memory";
import { FakeSettlementAdapter } from "../settlement/fake";

test("reconcileRent marks settled charges and counts them", async () => {
  const reg = new InMemoryRegistry();
  const rent = await reg.createRent({ name: "r", userId: "u1", spec: { resourceType: "GPU", region: null } });
  // Two charges recorded optimistically (settled: false), with refs the fake knows.
  const a = await reg.recordCharge({ rentId: rent.id, providerId: "p", seq: 0, amount: 100, authorizationRef: null, settled: false, settlementRef: "fake-settlement-0" });
  const b = await reg.recordCharge({ rentId: rent.id, providerId: "p", seq: 1, amount: 100, authorizationRef: null, settled: false, settlementRef: "fake-settlement-1" });

  // A fake adapter that reports refs it has issued as settled.
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1000n });
  await settlement.payForCompute("u"); // issues fake-settlement-0
  await settlement.payForCompute("u"); // issues fake-settlement-1

  const settledCount = await reconcileRent(reg, settlement, rent.id);
  expect(settledCount).toBe(2);
  const charges = await reg.listCharges(rent.id);
  expect(charges.every((c) => c.settled)).toBe(true);
  expect([a.id, b.id].length).toBe(2);
});

test("reconcileRent leaves unsettled charges alone", async () => {
  const reg = new InMemoryRegistry();
  const rent = await reg.createRent({ name: "r", userId: "u1", spec: { resourceType: "GPU", region: null } });
  await reg.recordCharge({ rentId: rent.id, providerId: "p", seq: 0, amount: 100, authorizationRef: null, settled: false, settlementRef: "never-issued" });
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1000n });
  const settledCount = await reconcileRent(reg, settlement, rent.id);
  expect(settledCount).toBe(0);
  expect((await reg.listCharges(rent.id))[0]?.settled).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/broker/reconcile.test.ts`
Expected: FAIL — `Cannot find module "./reconcile"`.

- [ ] **Step 3: Write the reconcile pass**

Write `services/src/broker/reconcile.ts`:

```ts
import type { Registry } from "../registry/registry";
import type { SettlementAdapter } from "../settlement/adapter";

// Walk a rent's unsettled charges and mark the ones whose batch has landed.
// Returns how many were newly settled. Safe to run repeatedly.
export async function reconcileRent(
  registry: Registry,
  settlement: SettlementAdapter,
  rentId: string,
): Promise<number> {
  const charges = await registry.listCharges(rentId);
  let settled = 0;
  for (const c of charges) {
    if (c.settled || !c.settlementRef) continue;
    const status = await settlement.reconcile(c.settlementRef);
    if (status.settled) {
      await registry.markChargeSettled(c.id);
      settled++;
    }
  }
  return settled;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/broker/reconcile.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/broker/reconcile.ts services/src/broker/reconcile.test.ts
git commit -m "feat(broker): reconcile pass (mark settled charges)"
```

---

## Task 7: runRent orchestration

**Files:**
- Create: `services/src/broker/runner.ts`
- Test: `services/src/broker/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/broker/runner.test.ts`:

```ts
import { test, expect } from "bun:test";
import { runRent } from "./runner";
import { InMemoryRegistry } from "../registry/in-memory";
import { FakeSettlementAdapter } from "../settlement/fake";
import type { NewProvider } from "../registry/registry";

const base: Pick<NewProvider, "ownerWallet" | "endpointUrl" | "specs" | "avgLatencyMs"> = {
  ownerWallet: "0x0", endpointUrl: "http://prov", specs: {}, avgLatencyMs: 5,
};

async function seeded() {
  const reg = new InMemoryRegistry();
  await reg.registerProvider({ ...base, alias: "A", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 95 });
  const rent = await reg.createRent({ name: "train", userId: "u1", spec: { resourceType: "GPU", region: null }, autonomyArmed: true });
  return { reg, rent };
}

test("happy path: records a decision, streams, finalizes completed with exact cost", async () => {
  const { reg, rent } = await seeded();
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  const result = await runRent(rent.id, { registry: reg, settlement }, { maxUnits: 3 });
  expect(result.stoppedBy).toBe("maxUnits");
  const finalized = await reg.getRent(rent.id);
  expect(finalized?.status).toBe("completed");
  expect(finalized?.providerId).toBeTruthy();
  expect(finalized?.totalCost).toBe(300);
});

test("cancel finalizes the rent as cancelled", async () => {
  const { reg, rent } = await seeded();
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  let n = 0;
  const result = await runRent(rent.id, { registry: reg, settlement }, { maxUnits: 100, shouldStop: () => n++ >= 1 });
  expect(result.stoppedBy).toBe("cancel");
  expect((await reg.getRent(rent.id))?.status).toBe("cancelled");
});

test("no matching provider fails the rent without spending", async () => {
  const reg = new InMemoryRegistry();
  const rent = await reg.createRent({ name: "x", userId: "u1", spec: { resourceType: "Storage", region: null } });
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  const result = await runRent(rent.id, { registry: reg, settlement }, { maxUnits: 3 });
  expect(result.stoppedBy).toBe("no-provider");
  expect((await reg.getRent(rent.id))?.status).toBe("failed");
  expect(await reg.rentCost(rent.id)).toBe(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/broker/runner.test.ts`
Expected: FAIL — `Cannot find module "./runner"`.

- [ ] **Step 3: Write the orchestrator**

Write `services/src/broker/runner.ts`:

```ts
import type { Registry } from "../registry/registry";
import type { SettlementAdapter } from "../settlement/adapter";
import { matchProviders, type RankStrategy } from "./matching";
import { revalidateProvider } from "./guardrails";
import { streamRent, type StreamOptions, type StoppedBy } from "./stream";
import { HealthMonitor } from "./health";

export type RunDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  health?: HealthMonitor;
  rank?: RankStrategy;
};

export type RunResult = {
  stoppedBy: StoppedBy | "no-provider" | "guard-failed";
  reason: string;
  units: number;
};

const now = () => new Date().toISOString();

// One rent end to end: match -> guard -> record decision -> fund -> stream ->
// finalize. Single provider; model-driven migration on degrade is Plan 6.
export async function runRent(rentId: string, deps: RunDeps, opts: StreamOptions = {}): Promise<RunResult> {
  const { registry, settlement } = deps;
  const rent = await registry.getRent(rentId);
  if (!rent) throw new Error(`rent not found: ${rentId}`);

  const match = await matchProviders(registry, rent.spec, deps.rank);
  if (!match.chosen) {
    await registry.updateRent(rentId, { status: "failed", endedAt: now() });
    return { stoppedBy: "no-provider", reason: match.rationale, units: 0 };
  }

  const guard = revalidateProvider(match.chosen, rent.spec);
  if (!guard.ok) {
    await registry.updateRent(rentId, { status: "failed", endedAt: now() });
    return { stoppedBy: "guard-failed", reason: guard.reason, units: 0 };
  }

  await registry.recordDecision({
    rentId,
    candidates: match.candidates,
    chosenProviderId: match.chosen.id,
    rationale: match.rationale,
  });

  // Fund enough for the safety bound when it is finite; otherwise a sane floor.
  const cushion = Number.isFinite(opts.maxUnits) ? BigInt((opts.maxUnits ?? 0)) : 0n;
  const minAtomic = cushion * BigInt(Math.round(match.chosen.pricePerCharge * 1_000_000));
  if (minAtomic > 0n) await settlement.ensureFunded(minAtomic);

  await registry.updateRent(rentId, { status: "running", providerId: match.chosen.id, startedAt: now() });

  const stream = await streamRent(rent, match.chosen, { registry, settlement, health: deps.health }, opts);

  await registry.updateRent(rentId, {
    status: stream.stoppedBy === "cancel" ? "cancelled" : "completed",
    totalCost: await registry.rentCost(rentId),
    endedAt: now(),
  });

  return { stoppedBy: stream.stoppedBy, reason: stream.reason, units: stream.units };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/broker/runner.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite + types**

Run: `cd services && bun test && bunx tsc --noEmit`
Expected: all pass, tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add services/src/broker/runner.ts services/src/broker/runner.test.ts
git commit -m "feat(broker): runRent orchestration (match -> guard -> stream -> finalize)"
```

---

## Task 8: Real full-loop script (handoff: needs a funded wallet)

**Files:**
- Create: `services/scripts/broker-roundtrip.ts`
- Modify: `services/package.json`

Proves the whole loop on Arc testnet: an in-process provider registered in an
in-memory registry, then `runRent` driving the real `GatewaySettlementAdapter`.

- [ ] **Step 1: Write the script**

Write `services/scripts/broker-roundtrip.ts`:

```ts
import { privateKeyToAccount } from "viem/accounts";
import type { AddressInfo } from "node:net";
import { createProviderApp } from "../src/provider/server";
import { SimulatedExecutor } from "../src/provider/executor";
import { InMemoryRegistry } from "../src/registry/in-memory";
import { GatewaySettlementAdapter } from "../src/settlement/gateway";
import { runRent } from "../src/broker/runner";
import { reconcileRent } from "../src/broker/reconcile";

const brokerKey = process.env.BROKER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
const providerKey = process.env.PROVIDER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com";

if (!brokerKey || !providerKey) {
  throw new Error("Set BROKER_WALLET_PRIVATE_KEY and PROVIDER_WALLET_PRIVATE_KEY in services/.env");
}

const sellerAddress = privateKeyToAccount(providerKey).address;
const app = createProviderApp({
  executor: new SimulatedExecutor({ hasGpu: true }),
  sellerAddress,
  price: "$0.0001",
  facilitatorUrl,
  meta: { alias: "node-broker", resourceType: "GPU", region: "US-East", specs: { gpu: "H100" } },
});
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;

try {
  const reg = new InMemoryRegistry();
  await reg.registerProvider({
    alias: "node-broker", ownerWallet: sellerAddress, endpointUrl: `http://localhost:${port}`,
    resourceType: "GPU", region: "US-East", specs: { gpu: "H100" }, online: true,
    stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 95, avgLatencyMs: 5,
  });
  const rent = await reg.createRent({ name: "broker-demo", userId: "u1", spec: { resourceType: "GPU", region: null }, autonomyArmed: true });

  const settlement = new GatewaySettlementAdapter({ privateKey: brokerKey, capAtomic: 1000n });
  console.log("broker buyer:", settlement.buyerAddress);

  console.log("running the rent for 3 units...");
  const result = await runRent(rent.id, { registry: reg, settlement }, { maxUnits: 3 });
  console.log("  stoppedBy:", result.stoppedBy, "units:", result.units);

  const finalized = await reg.getRent(rent.id);
  console.log("  rent status:", finalized?.status, "totalCost (atomic):", finalized?.totalCost);
  console.log("  charges:", (await reg.listCharges(rent.id)).map((c) => `${c.seq}:${c.amount}:${c.settlementRef}`));

  console.log("reconciling...");
  const settled = await reconcileRent(reg, settlement, rent.id);
  console.log("  newly settled:", settled, "(batches may still be pending right after paying)");

  console.log("\n✅ full broker loop ran on Arc testnet.");
} catch (err) {
  console.error("\n❌ broker loop failed:", err instanceof Error ? err.message : err);
  console.error("If the buyer has no testnet USDC, fund it at https://faucet.circle.com and retry.");
  process.exitCode = 1;
} finally {
  server.close();
}
```

- [ ] **Step 2: Add the script to package.json**

Add to `services/package.json` scripts: `"broker:roundtrip": "bun run scripts/broker-roundtrip.ts"`.

- [ ] **Step 3: Run it (handoff)**

With both keys set and the buyer funded:
Run: `cd services && bun run broker:roundtrip`
Expected: prints the buyer address, `stoppedBy: maxUnits units: 3`, rent status
`completed`, `totalCost (atomic): 300`, three charges with settlement-ref UUIDs, and
a reconcile count (often 0 immediately after paying, since the batch lands async).
Without the keys it throws the clear "Set ..." error and does nothing on-chain.

- [ ] **Step 4: Commit**

```bash
git add services/scripts/broker-roundtrip.ts services/package.json
git commit -m "test(broker): full-loop run on Arc testnet (register -> runRent -> reconcile)"
```

---

## Task 9: Wrap-up

- [ ] **Step 1: Full suite + type-check**

Run: `cd services && bun test && bunx tsc --noEmit`
Expected: all tests pass (existing + matching, guardrails, health, stream, reconcile,
runner, and the registry contract's new `markChargeSettled`). tsc exit 0.

- [ ] **Step 2: Lint the touched frontend? (none)** — this plan does not touch `src/`.

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch (verify tests, present options,
execute choice). Default to merging to `main` once green.

---

## Self-Review Notes

**Spec coverage:** Implements the matching engine ("one matching engine, two
surfaces": deterministic hard pre-filter then a rank strategy, with the scorer as the
always-present fallback per the spec's "degrades to still works, less smart"), the
deterministic guardrails ("any provider the AI picks is re-validated before money
moves", "active stake required"; balance/spend-cap already enforced in the Plan 4
adapter), and the stream engine (data-flow step 5: pay per unit, record a `Charge`,
watch health; data-flow step 7: stop on cancel/completion within one unit, unused
budget never spent). Reconciliation (data-flow step 6, error-handling "recorded
optimistically and reconciled when the batch lands") is `reconcileRent` +
`markChargeSettled`. Covers the spec's unit tests (matching filter+rank, guardrail
checks, charge accounting = sum exactly) and cancel-mid-stream.

**Placeholder scan:** No TBDs. The failing-provider stream test uses a complete
inline `SettlementAdapter`, not a stub. Task 8 is a gated environment script with
exact expected output. Funding math in `runRent` converts `pricePerCharge` (USDC
decimal) to atomic via `* 1_000_000` and only funds when `maxUnits` is finite.

**Type consistency:** `matchProviders`/`RankStrategy`/`deterministicRank` (Task 1)
are used by `runRent` (Task 7). `revalidateProvider` (Task 2) and `HealthMonitor`
(Task 4) feed `streamRent` (Task 5) and `runRent`. `markChargeSettled` (Task 3) is
used by `reconcileRent` (Task 6). `streamRent`'s `StoppedBy` union is reused in
`runRent`'s `RunResult`. All amounts are atomic units; `Charge.amount` is a number
and the adapter speaks `bigint`, converted at the single `recordCharge` call.
Providers/rents come from the Plan 2 `Registry`; payment from the Plan 4
`SettlementAdapter`; the provider endpoint is `/compute` (Plan 3).

**Not in scope (Plan 6):** model-driven re-pick + migration on degrade (here an
unhealthy provider stops the stream cleanly rather than re-pointing), the live LLM
rank strategy wired to `makeModel()`, Lumen's conversational selection/deploy flow,
the dashboard's Supabase-realtime rendering, and the full post→pick→stream→settle→
cancel integration test with on-chain settlement assertions.
