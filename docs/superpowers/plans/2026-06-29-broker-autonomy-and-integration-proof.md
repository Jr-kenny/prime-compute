# Broker Autonomy & On-Chain Integration Proof Implementation Plan (Plan 6 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the autonomous payments engine: the broker genuinely ranks providers with the LLM (deterministic scorer always the fallback) and, when a provider degrades mid-rent, autonomously re-points the live payment stream to the next-best provider without losing a charge or double-paying, proven end to end on Arc testnet.

**Architecture:** Two clean additions on top of the proven Plan 5 loop. (1) A live LLM `RankStrategy` behind a thin `RankClient` seam so the model call is unit-testable offline and `matchProviders` keeps the deterministic scorer as its catch-all. (2) A migration layer (`streamWithMigration`) that wraps the existing `streamRent`: when a leg stops `unhealthy` it re-runs the matching engine excluding providers already tried, re-validates the pick through the same guardrail, records a migration decision, re-points the stream, and continues with continuous charge sequencing and a shared spend budget. `runRent` gains a `maxMigrations` option (default 0 = today's behavior) and a correct final-status mapping. Everything stays behind the `Registry` + `SettlementAdapter` interfaces, so it all tests offline with `InMemoryRegistry` + a fake adapter and runs for real with `SupabaseRegistry` + `GatewaySettlementAdapter` unchanged. A gated integration script proves the headline (degrade → migrate) and cancel-mid-stream on Arc.

**Tech Stack:** Bun + TypeScript, `bun test`. Builds on Plans 1-5 (`domain`, `Registry`, `scoring`, `matchProviders`/`deterministicRank`/`RankStrategy`, `revalidateProvider`, `HealthMonitor`, `streamRent`, `reconcileRent`, `runRent`, `SettlementAdapter` + `FakeSettlementAdapter`, `SpendCapError`, `makeModel`, the x402 provider template).

**Spec:** [`docs/superpowers/specs/2026-06-28-autonomous-compute-broker-design.md`](../specs/2026-06-28-autonomous-compute-broker-design.md) — "The broker's decision loop and guardrails" (the autonomous loop + one matching engine, two surfaces), "Error handling" (provider drops mid-job → migrate, model flaky → deterministic fallback), Data flow steps 2-7, Testing (degrade: simulator drops heartbeat, broker re-points the stream; cancel-mid-stream; the full Arc integration thread).

**Naming:** entity is `Rent`, billing unit is `Charge`, provider compute endpoint is `/compute`, price is `pricePerCharge`. Amounts are USDC atomic units (`Charge.amount` is a number; the adapter speaks `bigint`). No `job`/`tick` anywhere in `services/`.

**Branch:** `git checkout -b feat/broker-autonomy` off `main`.

**Scope note (read first):** This plan completes the *payments engine*. The documented Plan 6 also listed a product-UI layer (Lumen's conversational select/deploy flow + a Supabase-realtime dashboard + the HTTP bridge between the frontend and the broker). That is a separate subsystem with its own unpinned decisions (frontend anon key + RLS, realtime replication on the registry tables, CORS, how a cancel from the UI reaches a running `runRent`), and it is the "product later" bucket rather than "payments now". It is carved out as **Plan 7** and is explicitly out of scope here. This plan touches only `services/`; it does not touch `src/`.

**Handoff note:** Tasks 1-4 run fully offline (`InMemoryRegistry` + inline/fake adapters, no network, no model). Task 4's gated probe (`rank:llm`) needs `LLM_BASE_URL`/`LLM_API_KEY` set. Task 5 is a gated real-chain script needing `BROKER_WALLET_PRIVATE_KEY` + `PROVIDER_WALLET_PRIVATE_KEY` and a funded buyer.

---

## File Structure

**Created:**
- `services/src/broker/migrate.ts` — `streamWithMigration` (degrade → re-match → re-point the stream)
- `services/src/broker/migrate.test.ts`
- `services/src/broker/llm-rank.ts` — `llmRankStrategy(client)` + `makeRankClient()` (the live model-backed ranker)
- `services/src/broker/llm-rank.test.ts`
- `services/probes/llm-rank.ts` — gated probe: real model ranks sample providers
- `services/scripts/integration-roundtrip.ts` — gated full thread on Arc: degrade → migrate, then cancel-mid-stream

**Modified:**
- `services/src/broker/stream.ts` — add optional `startSeq` to `StreamOptions` (continuous charge sequencing across migration legs)
- `services/src/broker/runner.ts` — use `streamWithMigration`; add `maxMigrations` option; correct final-status mapping
- `services/src/broker/runner.test.ts` — add a migration finalize test
- `services/package.json` — add `rank:llm` and `integration:roundtrip` scripts
- `feedback.md` — log any Circle/x402 friction hit while wiring the migration round-trip

---

## Task 1: Continuous charge sequencing across legs (`startSeq`)

Migration streams across more than one provider for a single rent. Each leg must keep counting charge `seq` from where the previous leg stopped, so `listCharges` stays ordered and gap-free. This is a tiny, backward-compatible option on `streamRent`.

**Files:**
- Modify: `services/src/broker/stream.ts`
- Modify: `services/src/broker/stream.test.ts`

- [ ] **Step 1: Add the failing test**

In `services/src/broker/stream.test.ts`, add this test at the end of the file (it reuses the `provider` and `makeRent` helpers already defined there):

```ts
test("startSeq continues charge numbering from a previous leg", async () => {
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  const result = await streamRent(rent, provider, { registry: reg, settlement }, { maxUnits: 2, startSeq: 5 });
  expect(result.units).toBe(2);
  const seqs = (await reg.listCharges(rent.id)).map((c) => c.seq);
  expect(seqs).toEqual([5, 6]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/broker/stream.test.ts`
Expected: FAIL — the new test sees `seqs` `[0, 1]` because `startSeq` is ignored.

- [ ] **Step 3: Implement `startSeq`**

In `services/src/broker/stream.ts`, add `startSeq?: number;` to the `StreamOptions` type (with a one-line comment), and change the seq initializer.

Add to `StreamOptions`:

```ts
  startSeq?: number; // first charge seq for this leg (migration continues numbering)
```

Change:

```ts
  let seq = 0;
```

to:

```ts
  let seq = opts.startSeq ?? 0;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/broker/stream.test.ts`
Expected: PASS (all stream tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add services/src/broker/stream.ts services/src/broker/stream.test.ts
git commit -m "feat(broker): continuous charge seq across legs (startSeq option)"
```

---

## Task 2: Migration engine (`streamWithMigration`)

The autonomous heart of this plan. Wrap `streamRent` in a loop: stream a leg on the current provider; if it stops for any reason other than `unhealthy`, return that result; if it stops `unhealthy` and migrations remain, re-run the matching engine, pick the best candidate not already tried that still passes the guardrail, record a migration decision, re-point the rent, and stream the next leg with the remaining budget and continuous `seq`. Each leg gets a fresh `HealthMonitor` (a new provider must not inherit the failed one's failure streak). If no untried, valid alternative exists, stop with `no-alternative`.

**Files:**
- Create: `services/src/broker/migrate.ts`
- Test: `services/src/broker/migrate.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/broker/migrate.test.ts`:

```ts
import { test, expect } from "bun:test";
import { streamWithMigration } from "./migrate";
import { InMemoryRegistry } from "../registry/in-memory";
import type { NewProvider } from "../registry/registry";
import type { SettlementAdapter, PaidCompute, SettlementStatus } from "../settlement/adapter";
import { SpendCapError } from "../settlement/spend-policy";
import type { Provider, Rent } from "../domain";

const base: Pick<NewProvider, "ownerWallet" | "specs" | "avgLatencyMs"> = {
  ownerWallet: "0x0", specs: {}, avgLatencyMs: 5,
};

// A url-keyed fake: payForCompute throws for any url containing a "down" marker
// (a dead provider endpoint), and otherwise pays and enforces the spend cap. This
// models reality: the broker wallet is fine; a specific provider's endpoint is not.
function urlAdapter(downMarkers: string[], pricePerChargeAtomic = 100n, capAtomic = 1_000_000n): SettlementAdapter {
  let spent = 0n;
  let seq = 0;
  const refs = new Set<string>();
  return {
    buyerAddress: "0xBROKER",
    async ensureFunded(): Promise<{ deposited: boolean }> { return { deposited: false }; },
    async payForCompute(url: string): Promise<PaidCompute> {
      if (downMarkers.some((d) => url.includes(d))) throw new Error(`x402 failed: ${url} unreachable`);
      if (spent + pricePerChargeAtomic > capAtomic) throw new SpendCapError(`cap ${capAtomic} reached`);
      spent += pricePerChargeAtomic;
      const settlementRef = `ref-${seq++}`;
      refs.add(settlementRef);
      return { amountAtomic: pricePerChargeAtomic, settlementRef, data: { ok: true }, status: 200 };
    },
    async reconcile(ref: string): Promise<SettlementStatus> {
      return { ref, status: refs.has(ref) ? "completed" : "unknown", settled: refs.has(ref) };
    },
  };
}

async function seedTwo(reg: InMemoryRegistry) {
  // A ranks first (higher score) so it is chosen first; its endpoint is the dead one.
  const a = await reg.registerProvider({ ...base, alias: "A", endpointUrl: "http://aaa", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 99 });
  const b = await reg.registerProvider({ ...base, alias: "B", endpointUrl: "http://bbb", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 80 });
  return { a, b };
}

async function makeRent(reg: InMemoryRegistry): Promise<Rent> {
  return reg.createRent({ name: "r", userId: "u1", spec: { resourceType: "GPU", region: null }, autonomyArmed: true });
}

test("migrates from a degraded provider to the next-best, continuing the stream", async () => {
  const reg = new InMemoryRegistry();
  const { a, b } = await seedTwo(reg);
  const rent = await makeRent(reg);
  const settlement = urlAdapter(["aaa"]); // provider A is dead from the first charge

  const result = await streamWithMigration(rent, a as Provider, { registry: reg, settlement }, { maxUnits: 3, maxMigrations: 1 });

  expect(result.stoppedBy).toBe("maxUnits");
  expect(result.migrations).toBe(1);
  expect(result.providersUsed).toEqual([a.id, b.id]);
  expect(result.units).toBe(3); // all three charges came from B
  // The rent now points at B and a migration decision was recorded.
  expect((await reg.getRent(rent.id))?.providerId).toBe(b.id);
  const charges = await reg.listCharges(rent.id);
  expect(charges.every((c) => c.providerId === b.id)).toBe(true);
  expect(charges.map((c) => c.seq)).toEqual([0, 1, 2]);
});

test("a healthy first provider streams to maxUnits with zero migrations", async () => {
  const reg = new InMemoryRegistry();
  const { a } = await seedTwo(reg);
  const rent = await makeRent(reg);
  const settlement = urlAdapter([]); // nobody is down
  const result = await streamWithMigration(rent, a as Provider, { registry: reg, settlement }, { maxUnits: 3, maxMigrations: 1 });
  expect(result.stoppedBy).toBe("maxUnits");
  expect(result.migrations).toBe(0);
  expect(result.providersUsed).toEqual([a.id]);
  expect(result.units).toBe(3);
});

test("with no valid alternative, stops as no-alternative", async () => {
  const reg = new InMemoryRegistry();
  // Only A exists, and A is down.
  const a = await reg.registerProvider({ ...base, alias: "A", endpointUrl: "http://aaa", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 99 });
  const rent = await makeRent(reg);
  const settlement = urlAdapter(["aaa"]);
  const result = await streamWithMigration(rent, a as Provider, { registry: reg, settlement }, { maxUnits: 3, maxMigrations: 2 });
  expect(result.stoppedBy).toBe("no-alternative");
  expect(result.units).toBe(0);
  expect(result.migrations).toBe(0);
});

test("maxMigrations 0 stops unhealthy without re-pointing (matches Plan 5 behavior)", async () => {
  const reg = new InMemoryRegistry();
  const { a } = await seedTwo(reg);
  const rent = await makeRent(reg);
  const settlement = urlAdapter(["aaa"]);
  const result = await streamWithMigration(rent, a as Provider, { registry: reg, settlement }, { maxUnits: 3, maxMigrations: 0 });
  expect(result.stoppedBy).toBe("unhealthy");
  expect(result.migrations).toBe(0);
  expect(result.providersUsed).toEqual([a.id]);
});

test("cancel during a leg stops the whole stream", async () => {
  const reg = new InMemoryRegistry();
  const { a } = await seedTwo(reg);
  const rent = await makeRent(reg);
  const settlement = urlAdapter([]);
  let n = 0;
  const result = await streamWithMigration(rent, a as Provider, { registry: reg, settlement }, {
    maxUnits: 100, maxMigrations: 1, shouldStop: () => n++ >= 2,
  });
  expect(result.stoppedBy).toBe("cancel");
  expect(result.units).toBe(2);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/broker/migrate.test.ts`
Expected: FAIL — `Cannot find module "./migrate"`.

- [ ] **Step 3: Write the migration engine**

Write `services/src/broker/migrate.ts`:

```ts
import type { Registry } from "../registry/registry";
import type { SettlementAdapter } from "../settlement/adapter";
import type { Provider, Rent } from "../domain";
import { matchProviders, type RankStrategy } from "./matching";
import { revalidateProvider } from "./guardrails";
import { streamRent, type StreamOptions, type StoppedBy } from "./stream";
import { HealthMonitor } from "./health";

export type MigrationDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  rank?: RankStrategy;
  healthOpts?: { maxConsecutiveFailures?: number; maxLatencyMs?: number };
};

export type MigrationOptions = StreamOptions & {
  maxMigrations?: number; // how many times the broker may re-point the stream
};

export type MigrationStoppedBy = StoppedBy | "no-alternative";

export type MigrationResult = {
  units: number;
  stoppedBy: MigrationStoppedBy;
  reason: string;
  providersUsed: string[];
  migrations: number;
};

// Stream a rent with autonomous migration on degradation. Each leg runs the proven
// streamRent; when a leg stops `unhealthy` and migrations remain, the broker re-runs
// the matching engine, takes the best candidate it has not tried that still passes
// the guardrail, records the decision, re-points the rent, and continues with the
// remaining budget and continuous charge seq. A fresh HealthMonitor per leg means a
// new provider never inherits a dead one's failure streak.
export async function streamWithMigration(
  rent: Rent,
  firstProvider: Provider,
  deps: MigrationDeps,
  opts: MigrationOptions = {},
): Promise<MigrationResult> {
  const { registry, settlement } = deps;
  const maxUnits = opts.maxUnits ?? Number.POSITIVE_INFINITY;
  const maxMigrations = opts.maxMigrations ?? 0;

  const used = new Set<string>([firstProvider.id]);
  let provider = firstProvider;
  let totalUnits = 0;
  let migrations = 0;

  while (true) {
    const remaining = maxUnits === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : maxUnits - totalUnits;
    if (remaining <= 0) {
      return { units: totalUnits, stoppedBy: "maxUnits", reason: `reached maxUnits=${maxUnits}`, providersUsed: [...used], migrations };
    }

    const leg = await streamRent(
      rent,
      provider,
      { registry, settlement, health: new HealthMonitor(deps.healthOpts) },
      { maxUnits: remaining, shouldStop: opts.shouldStop, startSeq: totalUnits },
    );
    totalUnits += leg.units;

    if (leg.stoppedBy !== "unhealthy") {
      return { units: totalUnits, stoppedBy: leg.stoppedBy, reason: leg.reason, providersUsed: [...used], migrations };
    }

    // Provider degraded. Try to re-point the stream if we are allowed to.
    if (migrations >= maxMigrations) {
      return { units: totalUnits, stoppedBy: "unhealthy", reason: leg.reason, providersUsed: [...used], migrations };
    }

    const next = await pickAlternative(registry, rent, used, deps.rank);
    if (!next) {
      return { units: totalUnits, stoppedBy: "no-alternative", reason: `no healthy alternative after ${provider.id} degraded`, providersUsed: [...used], migrations };
    }

    await registry.recordDecision({
      rentId: rent.id,
      candidates: [{ providerId: next.id, rank: 0 }],
      chosenProviderId: next.id,
      rationale: `migrated from ${provider.id} after degradation (${leg.reason}) to ${next.id}`,
    });
    await registry.updateRent(rent.id, { providerId: next.id });

    used.add(next.id);
    provider = next;
    migrations++;
  }
}

// Re-run the matching engine and return the best ranked candidate that has not been
// tried and still passes the deterministic guardrail. Returns null if none.
async function pickAlternative(
  registry: Registry,
  rent: Rent,
  used: Set<string>,
  rank?: RankStrategy,
): Promise<Provider | null> {
  const match = await matchProviders(registry, rent.spec, rank);
  for (const c of match.candidates) {
    if (used.has(c.providerId)) continue;
    const p = await registry.getProvider(c.providerId);
    if (!p) continue;
    if (revalidateProvider(p, rent.spec).ok) return p;
  }
  return null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/broker/migrate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/broker/migrate.ts services/src/broker/migrate.test.ts
git commit -m "feat(broker): migration-on-degrade (re-match + re-point the stream)"
```

---

## Task 3: Wire migration into `runRent`

`runRent` should drive `streamWithMigration` instead of `streamRent`, expose a `maxMigrations` option (default 0 keeps today's single-provider behavior and all existing runner tests green), and map the richer stop reasons to a correct final rent status: `cancel` → `cancelled`, `unhealthy`/`no-alternative` → `failed`, everything else (`maxUnits`/`cap`) → `completed`.

**Files:**
- Modify: `services/src/broker/runner.ts`
- Modify: `services/src/broker/runner.test.ts`

- [ ] **Step 1: Add the failing test**

In `services/src/broker/runner.test.ts`, add these imports/helpers and a migration test. Add this test at the end of the file:

```ts
test("autonomy: finalizes failed when the only provider degrades with no alternative", async () => {
  const reg = new InMemoryRegistry();
  await reg.registerProvider({ ...base, alias: "A", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 95 });
  const rent = await reg.createRent({ name: "x", userId: "u1", spec: { resourceType: "GPU", region: null }, autonomyArmed: true });

  // An adapter that always throws a non-cap error: the provider never serves.
  const failing: SettlementAdapter = {
    buyerAddress: "0xB",
    async ensureFunded() { return { deposited: false }; },
    async payForCompute(): Promise<PaidCompute> { throw new Error("402 not honored"); },
    async reconcile(ref): Promise<SettlementStatus> { return { ref, status: "unknown", settled: false }; },
  };

  const result = await runRent(rent.id, { registry: reg, settlement: failing }, { maxUnits: 5, maxMigrations: 1 });
  expect(result.stoppedBy).toBe("no-alternative");
  expect((await reg.getRent(rent.id))?.status).toBe("failed");
  expect(await reg.rentCost(rent.id)).toBe(0);
});
```

Add these imports at the top of `runner.test.ts` (alongside the existing imports):

```ts
import type { SettlementAdapter, PaidCompute, SettlementStatus } from "../settlement/adapter";
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/broker/runner.test.ts`
Expected: FAIL — `runRent` does not accept `maxMigrations` / returns `unhealthy` (and finalizes `completed`) rather than `no-alternative`/`failed`.

- [ ] **Step 3: Rewrite `runner.ts` to use migration**

Replace the entire contents of `services/src/broker/runner.ts` with:

```ts
import type { Registry } from "../registry/registry";
import type { SettlementAdapter } from "../settlement/adapter";
import type { RentStatus } from "../domain";
import { matchProviders, type RankStrategy } from "./matching";
import { revalidateProvider } from "./guardrails";
import { type StreamOptions } from "./stream";
import { streamWithMigration, type MigrationStoppedBy } from "./migrate";

export type RunDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  rank?: RankStrategy;
};

export type RunOptions = StreamOptions & {
  maxMigrations?: number; // 0 = no autonomous re-pointing (single provider)
};

export type RunResult = {
  stoppedBy: MigrationStoppedBy | "no-provider" | "guard-failed";
  reason: string;
  units: number;
  migrations: number;
};

const now = () => new Date().toISOString();

// Map how the stream stopped to the rent's terminal status. A clean budget/iteration
// stop is completed; a user cancel is cancelled; a degradation we could not recover
// from is failed.
function finalStatus(stoppedBy: MigrationStoppedBy): RentStatus {
  if (stoppedBy === "cancel") return "cancelled";
  if (stoppedBy === "unhealthy" || stoppedBy === "no-alternative") return "failed";
  return "completed"; // maxUnits | cap
}

// One rent end to end: match -> guard -> record decision -> fund -> stream (with
// autonomous migration on degrade) -> finalize.
export async function runRent(rentId: string, deps: RunDeps, opts: RunOptions = {}): Promise<RunResult> {
  const { registry, settlement } = deps;
  const rent = await registry.getRent(rentId);
  if (!rent) throw new Error(`rent not found: ${rentId}`);

  const match = await matchProviders(registry, rent.spec, deps.rank);
  if (!match.chosen) {
    await registry.updateRent(rentId, { status: "failed", endedAt: now() });
    return { stoppedBy: "no-provider", reason: match.rationale, units: 0, migrations: 0 };
  }

  const guard = revalidateProvider(match.chosen, rent.spec);
  if (!guard.ok) {
    await registry.updateRent(rentId, { status: "failed", endedAt: now() });
    return { stoppedBy: "guard-failed", reason: guard.reason, units: 0, migrations: 0 };
  }

  await registry.recordDecision({
    rentId,
    candidates: match.candidates,
    chosenProviderId: match.chosen.id,
    rationale: match.rationale,
  });

  // Fund enough for the safety bound when it is finite; otherwise a sane floor.
  const cushion = Number.isFinite(opts.maxUnits) ? BigInt(opts.maxUnits ?? 0) : 0n;
  const minAtomic = cushion * BigInt(Math.round(match.chosen.pricePerCharge * 1_000_000));
  if (minAtomic > 0n) await settlement.ensureFunded(minAtomic);

  await registry.updateRent(rentId, { status: "running", providerId: match.chosen.id, startedAt: now() });

  const stream = await streamWithMigration(
    rent,
    match.chosen,
    { registry, settlement, rank: deps.rank },
    opts,
  );

  await registry.updateRent(rentId, {
    status: finalStatus(stream.stoppedBy),
    totalCost: await registry.rentCost(rentId),
    endedAt: now(),
  });

  return { stoppedBy: stream.stoppedBy, reason: stream.reason, units: stream.units, migrations: stream.migrations };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/broker/runner.test.ts`
Expected: PASS (existing 3 runner tests + the new migration test). The existing
"happy path" (maxUnits → completed, totalCost 300) and "cancel" (→ cancelled) tests
still pass because `maxMigrations` defaults to 0 and `finalStatus` maps `maxUnits`→
completed and `cancel`→cancelled exactly as before.

- [ ] **Step 5: Commit**

```bash
git add services/src/broker/runner.ts services/src/broker/runner.test.ts
git commit -m "feat(broker): runRent drives migration + correct terminal status"
```

---

## Task 4: Live LLM rank strategy

The "genuinely decides" half. A `RankStrategy` backed by the broker model through a thin `RankClient` seam: `llmRankStrategy(client)` reorders the pre-filtered candidates by the ids the client returns (dropping unknown ids, appending any the model omitted so a provider is never silently lost), and `makeRankClient()` is the real model call (tool-calling via the AI SDK). When the model is down or returns nothing usable the strategy throws, and `matchProviders` already catches that and falls back to the deterministic scorer, so the money path never blocks on the model. The strategy itself is unit-tested offline with a fake client; the real call is exercised by the gated probe.

**Files:**
- Create: `services/src/broker/llm-rank.ts`
- Test: `services/src/broker/llm-rank.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/broker/llm-rank.test.ts`:

```ts
import { test, expect } from "bun:test";
import { llmRankStrategy, type RankClient } from "./llm-rank";
import type { Provider, RentSpec } from "../domain";

function p(id: string, over: Partial<Provider> = {}): Provider {
  return {
    id, alias: id, ownerWallet: "0x0", endpointUrl: "http://x", resourceType: "GPU",
    region: "US-East", specs: {}, online: true, stakeAmount: 100, pricePerCharge: 0.0001,
    computeScore: 80, avgLatencyMs: 5, ...over,
  };
}

const spec: RentSpec = { resourceType: "GPU", region: null };

test("reorders candidates by the client's returned id order", async () => {
  const client: RankClient = { rankProviderIds: async () => ["c", "a", "b"] };
  const ranked = await llmRankStrategy(client)([p("a"), p("b"), p("c")], spec);
  expect(ranked.map((x) => x.id)).toEqual(["c", "a", "b"]);
});

test("drops ids the model invented and appends candidates it omitted", async () => {
  const client: RankClient = { rankProviderIds: async () => ["b", "ghost"] };
  const ranked = await llmRankStrategy(client)([p("a"), p("b"), p("c")], spec);
  // b first (named), then a and c appended in original order; ghost dropped.
  expect(ranked.map((x) => x.id)).toEqual(["b", "a", "c"]);
});

test("ignores a duplicate id from the model", async () => {
  const client: RankClient = { rankProviderIds: async () => ["a", "a", "b"] };
  const ranked = await llmRankStrategy(client)([p("a"), p("b")], spec);
  expect(ranked.map((x) => x.id)).toEqual(["a", "b"]);
});

test("throws when the model returns nothing usable (so matchProviders falls back)", async () => {
  const client: RankClient = { rankProviderIds: async () => [] };
  await expect(llmRankStrategy(client)([p("a")], spec)).rejects.toThrow();
});

test("propagates a client error (matchProviders catches it for the scorer fallback)", async () => {
  const client: RankClient = { rankProviderIds: async () => { throw new Error("model down"); } };
  await expect(llmRankStrategy(client)([p("a")], spec)).rejects.toThrow(/model down/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/broker/llm-rank.test.ts`
Expected: FAIL — `Cannot find module "./llm-rank"`.

- [ ] **Step 3: Write the live ranker**

Write `services/src/broker/llm-rank.ts`:

```ts
import { generateText, tool } from "ai";
import { z } from "zod";
import type { Provider, RentSpec } from "../domain";
import type { RankStrategy } from "./matching";
import { makeModel } from "../llm";

// The seam: hand the candidates to something that returns them ordered best-first.
// Real implementation is the model; tests inject a deterministic fake.
export type RankClient = {
  rankProviderIds(providers: Provider[], spec: RentSpec): Promise<string[]>;
};

// Turn a RankClient into a RankStrategy. The result is always a superset-permutation
// of the input: ids the model invented are dropped, candidates it omitted are
// appended in their original order, so no provider is ever silently lost. Throws if
// the client yields no usable ordering, which matchProviders catches and falls back
// to the deterministic scorer.
export function llmRankStrategy(client: RankClient): RankStrategy {
  return async (providers, spec) => {
    const order = await client.rankProviderIds(providers, spec);
    const byId = new Map(providers.map((p) => [p.id, p]));
    const ranked: Provider[] = [];
    const seen = new Set<string>();
    for (const id of order) {
      const p = byId.get(id);
      if (p && !seen.has(id)) {
        ranked.push(p);
        seen.add(id);
      }
    }
    for (const p of providers) if (!seen.has(p.id)) ranked.push(p);
    if (ranked.length === 0) throw new Error("llm rank returned no usable ordering");
    return ranked;
  };
}

// The real model-backed client. Network + tool-calling live only here.
export function makeRankClient(): RankClient {
  const { provider, modelId } = makeModel();
  return {
    async rankProviderIds(providers, spec) {
      const result = await generateText({
        model: provider(modelId),
        prompt: buildPrompt(providers, spec),
        tools: {
          rank_providers: tool({
            description:
              "Return every candidate provider id ordered best-first for this rent, " +
              "weighing price, compute score, latency, and fit.",
            parameters: z.object({
              ordered_provider_ids: z.array(z.string()).describe("provider ids, best first"),
            }),
          }),
        },
        maxSteps: 1,
      });
      const call = result.toolCalls.find((c) => c.toolName === "rank_providers");
      if (!call) throw new Error("model did not call rank_providers");
      return (call.args as { ordered_provider_ids: string[] }).ordered_provider_ids;
    },
  };
}

function buildPrompt(providers: Provider[], spec: RentSpec): string {
  const lines = providers.map(
    (p) =>
      `- id=${p.id} price/charge=${p.pricePerCharge} score=${p.computeScore} latencyMs=${p.avgLatencyMs} region=${p.region}`,
  );
  return [
    "You are an autonomous compute broker. Rank these providers best-first for the rent.",
    `Rent needs: resourceType=${spec.resourceType}` + (spec.region ? `, region=${spec.region}` : ""),
    "Cheaper price is better, higher compute score is better, lower latency is better.",
    "Candidates:",
    ...lines,
    "Call rank_providers with every id, ordered best first.",
  ].join("\n");
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/broker/llm-rank.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the gated probe**

Write `services/probes/llm-rank.ts`:

```ts
import { makeRankClient } from "../src/broker/llm-rank";
import type { Provider } from "../src/domain";

// Gated: needs LLM_BASE_URL / LLM_API_KEY. Proves the real model emits a usable
// ranking through the tool call; if it cannot, the broker uses scoring.ts instead.
const sample: Provider[] = [
  { id: "alpha", alias: "alpha", ownerWallet: "0x0", endpointUrl: "http://a", resourceType: "GPU", region: "US-East", specs: {}, online: true, stakeAmount: 100, pricePerCharge: 0.000006, computeScore: 70, avgLatencyMs: 9 },
  { id: "bravo", alias: "bravo", ownerWallet: "0x0", endpointUrl: "http://b", resourceType: "GPU", region: "EU-West", specs: {}, online: true, stakeAmount: 100, pricePerCharge: 0.000004, computeScore: 92, avgLatencyMs: 4 },
  { id: "charlie", alias: "charlie", ownerWallet: "0x0", endpointUrl: "http://c", resourceType: "GPU", region: "US-East", specs: {}, online: true, stakeAmount: 100, pricePerCharge: 0.000009, computeScore: 60, avgLatencyMs: 14 },
];

try {
  const client = makeRankClient();
  const order = await client.rankProviderIds(sample, { resourceType: "GPU", region: null });
  console.log("model ranking (best first):", order);
  const known = new Set(sample.map((p) => p.id));
  const usable = order.filter((id) => known.has(id));
  if (usable.length > 0) {
    console.log("\n✅ live LLM ranking works; broker will use it (scorer stays the fallback).");
  } else {
    console.log("\n⚠️  model returned no known ids; broker falls back to the deterministic scorer.");
  }
} catch (err) {
  console.error("\n❌ ranker probe failed:", err instanceof Error ? err.message : err);
  console.error("Broker still works via the deterministic scorer. Set LLM_BASE_URL/LLM_API_KEY to test the model path.");
  process.exitCode = 1;
}
```

- [ ] **Step 6: Add the probe script + run the offline gates**

In `services/package.json` add to scripts: `"rank:llm": "bun run probes/llm-rank.ts"`.

Run: `cd services && bun test src/broker/llm-rank.test.ts && bunx tsc --noEmit`
Expected: tests PASS, tsc exit 0. (The live `rank:llm` probe is run by hand when `LLM_*` is set.)

- [ ] **Step 7: Commit**

```bash
git add services/src/broker/llm-rank.ts services/src/broker/llm-rank.test.ts services/probes/llm-rank.ts services/package.json
git commit -m "feat(broker): live LLM rank strategy (model-backed, scorer fallback)"
```

---

## Task 5: On-chain integration proof (handoff: needs funded wallets)

The real proof the spec asks for. One gated script, two scenarios on Arc testnet:

1. **Degrade → migrate.** Two real x402 provider apps (A and B). The broker starts on
   A (ranked first). After A has served a few real paid charges, A's server is closed
   to simulate a dropped provider; the next charge to A fails, the broker trips
   unhealthy, autonomously re-points the stream to B, and keeps paying B to the budget.
   Assert: both providers used, exactly one migration, rent `completed`, and the
   charges split across A then B with gap-free seq.
2. **Cancel-mid-stream.** A fresh rent on the healthy provider, cancelled after 2
   charges. Assert ticking stopped at 2, rent `cancelled`, and `totalCost` equals
   exactly two charges (unused budget never spent).

Then reconcile and report what settled (batches land async, so the count is often 0
right after paying, which is expected).

**Files:**
- Create: `services/scripts/integration-roundtrip.ts`
- Modify: `services/package.json`

- [ ] **Step 1: Write the script**

Write `services/scripts/integration-roundtrip.ts`:

```ts
import { privateKeyToAccount } from "viem/accounts";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createProviderApp } from "../src/provider/server";
import { SimulatedExecutor } from "../src/provider/executor";
import { InMemoryRegistry } from "../src/registry/in-memory";
import { GatewaySettlementAdapter } from "../src/settlement/gateway";
import { runRent } from "../src/broker/runner";
import { reconcileRent } from "../src/broker/reconcile";
import type { Provider } from "../src/domain";

const brokerKey = process.env.BROKER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
const providerKey = process.env.PROVIDER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com";

if (!brokerKey || !providerKey) {
  throw new Error("Set BROKER_WALLET_PRIVATE_KEY and PROVIDER_WALLET_PRIVATE_KEY in services/.env");
}

const sellerAddress = privateKeyToAccount(providerKey).address;

function startProvider(alias: string): { server: Server; port: number } {
  const app = createProviderApp({
    executor: new SimulatedExecutor({ hasGpu: true }),
    sellerAddress,
    price: "$0.0001",
    facilitatorUrl,
    meta: { alias, resourceType: "GPU", region: "US-East", specs: { gpu: "H100" } },
  });
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const reg = new InMemoryRegistry();
const settlement = new GatewaySettlementAdapter({ privateKey: brokerKey, capAtomic: 5_000n });
console.log("broker buyer:", settlement.buyerAddress);

// ---- Scenario 1: degrade -> migrate -------------------------------------------
const a = startProvider("prov-A");
const b = startProvider("prov-B");
let aClosed = false;

try {
  // A ranks first (higher score) so the broker starts there, then we kill A.
  const provA = await reg.registerProvider({
    alias: "prov-A", ownerWallet: sellerAddress, endpointUrl: `http://localhost:${a.port}`,
    resourceType: "GPU", region: "US-East", specs: { gpu: "H100" }, online: true,
    stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 99, avgLatencyMs: 4,
  });
  const provB = await reg.registerProvider({
    alias: "prov-B", ownerWallet: sellerAddress, endpointUrl: `http://localhost:${b.port}`,
    resourceType: "GPU", region: "US-East", specs: { gpu: "H100" }, online: true,
    stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 80, avgLatencyMs: 6,
  });
  const rent = await reg.createRent({ name: "degrade-demo", userId: "u1", spec: { resourceType: "GPU", region: null }, autonomyArmed: true });

  // Watcher: once A has served 2 real charges, drop it so the next charge fails.
  const watcher = setInterval(async () => {
    const onA = (await reg.listCharges(rent.id)).filter((c: { providerId: string }) => c.providerId === provA.id).length;
    if (!aClosed && onA >= 2) {
      aClosed = true;
      a.server.close();
      console.log("  ⚡ provider A dropped after", onA, "charges; broker should migrate to B");
    }
  }, 25);

  console.log("running degrade -> migrate rent (maxUnits 4, maxMigrations 1)...");
  const result = await runRent(rent.id, { registry: reg, settlement }, { maxUnits: 4, maxMigrations: 1 });
  clearInterval(watcher);

  const finalized = await reg.getRent(rent.id);
  const charges = await reg.listCharges(rent.id);
  const onA = charges.filter((c) => c.providerId === provA.id);
  const onB = charges.filter((c) => c.providerId === provB.id);
  console.log("  stoppedBy:", result.stoppedBy, "migrations:", result.migrations, "units:", result.units);
  console.log("  status:", finalized?.status, "totalCost (atomic):", finalized?.totalCost);
  console.log("  charges on A:", onA.length, "on B:", onB.length, "seq:", charges.map((c) => c.seq).join(","));

  const seqOk = charges.map((c) => c.seq).every((s, i) => s === i);
  if (result.migrations === 1 && onA.length > 0 && onB.length > 0 && finalized?.status === "completed" && seqOk) {
    console.log("  ✅ scenario 1: broker autonomously migrated A -> B and finished on-chain.");
  } else {
    throw new Error("scenario 1 did not migrate cleanly");
  }

  // ---- Scenario 2: cancel-mid-stream ------------------------------------------
  console.log("\nrunning cancel-mid-stream rent on B (cancel after 2)...");
  const rent2 = await reg.createRent({ name: "cancel-demo", userId: "u1", spec: { resourceType: "GPU", region: null }, autonomyArmed: true });
  // Only B is up now; point the spec at it via region to be safe, but B is the only GPU online.
  let n = 0;
  const result2 = await runRent(rent2.id, { registry: reg, settlement }, { maxUnits: 100, maxMigrations: 0, shouldStop: () => n++ >= 2 });
  const finalized2 = await reg.getRent(rent2.id);
  console.log("  stoppedBy:", result2.stoppedBy, "units:", result2.units, "status:", finalized2?.status, "totalCost (atomic):", finalized2?.totalCost);
  if (result2.stoppedBy === "cancel" && result2.units === 2 && finalized2?.status === "cancelled" && finalized2?.totalCost === 200) {
    console.log("  ✅ scenario 2: ticking stopped within one charge; only consumed charges were paid.");
  } else {
    throw new Error("scenario 2 did not cancel cleanly");
  }

  console.log("\nreconciling all charges...");
  const settled = (await reconcileRent(reg, settlement, rent.id)) + (await reconcileRent(reg, settlement, rent2.id));
  console.log("  newly settled:", settled, "(batches may still be pending right after paying)");

  console.log("\n✅ full autonomous broker thread ran on Arc testnet.");
} catch (err) {
  console.error("\n❌ integration run failed:", err instanceof Error ? err.message : err);
  console.error("If the buyer has no testnet USDC, fund it at https://faucet.circle.com and retry.");
  process.exitCode = 1;
} finally {
  if (!aClosed) a.server.close();
  b.server.close();
}
```

Note on `Provider` import: it is imported for clarity even though the script reads
charges structurally; if `bunx tsc --noEmit` flags it as unused, drop the import.

- [ ] **Step 2: Add the script to package.json**

In `services/package.json` add to scripts: `"integration:roundtrip": "bun run scripts/integration-roundtrip.ts"`.

- [ ] **Step 3: Run it (handoff)**

With both keys set and the buyer funded:
Run: `cd services && bun run integration:roundtrip`
Expected: prints the buyer address; scenario 1 logs A dropping after 2 charges, a
migration to B, `stoppedBy: maxUnits migrations: 1`, status `completed`, charges split
A then B with seq `0,1,2,3`; scenario 2 logs `stoppedBy: cancel units: 2`, status
`cancelled`, `totalCost (atomic): 200`; then a reconcile count. Without the keys it
throws the clear "Set ..." error and does nothing on-chain.

- [ ] **Step 4: Log any Circle/x402 friction**

If anything in the round-trip was rough (facilitator behavior on a dropped seller,
batch-status latency, error shapes when the paid request fails, etc.), add an entry to
`feedback.md` at the repo root using that file's existing format. If nothing new came
up, skip this step.

- [ ] **Step 5: Commit**

```bash
git add services/scripts/integration-roundtrip.ts services/package.json
git commit -m "test(broker): on-chain degrade->migrate + cancel integration on Arc"
```

---

## Task 6: Wrap-up

- [ ] **Step 1: Full suite + type-check**

Run: `cd services && bun test && bunx tsc --noEmit`
Expected: all tests pass (the existing suite plus the new `startSeq`, `migrate`, the
extra `runner` migration test, and `llm-rank`). tsc exit 0.

- [ ] **Step 2: No frontend touched**

This plan changes only `services/`. `src/` is untouched, so no frontend lint/build is
needed here (that is Plan 7).

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch (verify tests, present options, execute
choice). Default to merging `feat/broker-autonomy` to `main` once green.

- [ ] **Step 4: Update the project memory**

Update `autonomous-compute-broker-project.md`: Plan 6 (broker autonomy: live LLM rank
+ migration-on-degrade + on-chain integration proof) DONE and merged; note that the
conversational-Lumen + Supabase-realtime dashboard + HTTP bridge are now **Plan 7**
(the product-UI layer) and remain unbuilt.

---

## Self-Review Notes

**Spec coverage:** Implements the autonomous loop's missing pieces. "One matching
engine, two surfaces" gets its real model surface (`llmRankStrategy` + `makeRankClient`)
with the deterministic scorer as the always-present fallback inside `matchProviders`
(spec: "degrades to still works, less smart, never stuck"). "On a degradation signal,
the broker asks the model: migrate / pause / hold" and "migration in slice 1 means
re-pointing the payment stream to a new provider (stop paying A, start paying B)" is
`streamWithMigration`: re-match (excluding tried providers) → re-validate through the
same guardrail → record the decision → re-point → continue. Error-handling "provider
drops mid-job → broker migrates → paying stops instantly" and "model flaky → falls back
to the deterministic scorer" are both covered. The gated integration script is the
spec's "real proof" (post → pick → stream → settle → cancel on Arc) plus the named
degrade and cancel-mid-stream cases.

**Placeholder scan:** No TBDs. The failing-provider adapters are complete inline
objects, not stubs. The migration test's url-keyed adapter models per-provider failure
(the broker wallet is fine, one endpoint is dead), which is what really happens. Task 5
is a gated environment script with exact expected output and a degrade trigger driven
by real recorded charges.

**Type consistency:** `StreamOptions.startSeq` (Task 1) is consumed by `streamRent` and
passed by `streamWithMigration` (Task 2). `MigrationStoppedBy` = `StoppedBy |
"no-alternative"` (Task 2) is reused in `runner`'s `RunResult` (Task 3) and its
`finalStatus` covers every variant. `streamWithMigration` takes `MigrationDeps` (with
optional `rank: RankStrategy`) and `MigrationOptions` (= `StreamOptions & {
maxMigrations }`); `runRent` builds those from `RunDeps`/`RunOptions`. `RankStrategy`
(Plan 5, `matching.ts`) is what `llmRankStrategy` returns (Task 4) and what `runRent`/
`pickAlternative` thread through. `RankClient.rankProviderIds` returns `string[]` (ids),
consumed by `llmRankStrategy`. Amounts stay atomic; `Charge.amount` is a number, the
adapter speaks `bigint`, converted at the single `recordCharge` in `streamRent`. The
provider endpoint stays `/compute`; price is `pricePerCharge`.

**Behavior preserved:** `maxMigrations` defaults to 0, so `streamWithMigration` runs a
single leg and returns the same `StoppedBy` values as Plan 5's `streamRent`, and
`finalStatus` maps `maxUnits`→completed / `cancel`→cancelled exactly as the old runner
did. All existing Plan 5 tests pass unchanged.

**Out of scope (Plan 7, the product-UI layer):** Lumen's conversational
search/recommend/confirm/name/deploy flow, the dashboard rendering rents/charges/
decisions off Supabase realtime, and the HTTP bridge (provider search, create+run a
rent, cancel a running rent) between the frontend and the broker, with the frontend
anon key + RLS, realtime replication, CORS, and cancel-signal plumbing that layer needs.
```