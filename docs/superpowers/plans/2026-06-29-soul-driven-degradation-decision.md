# Soul-Driven Degradation Decision (migrate/hold on the runtime) Implementation Plan (Plan 8 of N)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the broker's response to a degrading provider genuinely soul-driven: when a provider trips unhealthy mid-rent, the broker asks the model (reasoning from `broker.soul.md`) to choose `migrate` or `hold`, the runtime validates the choice (a migrate target must pass the guardrail; a hold must fit the retry budget), and a deterministic best-alternative migration is the fallback when the model is unavailable or its choices are all rejected.

**Architecture:** This wires the Plan 6 migration loop onto the Plan 7 runtime. A small broker-specific decision (`decideMigrateOrHold`) builds a `DecisionContext` from the degradation situation and the untried candidates, calls the generic `decide()` with the broker's soul + policy, then runs the ranked proposals through `selectProposal` with a validator (`revalidateProvider` for migrate targets, a per-rent `RetryLeash` for hold). `streamWithMigration` gains optional decision deps: when present it uses this soul-driven choice; when absent it behaves exactly as Plan 6 (deterministic migrate-to-best), so every existing test stays green and the soul path is opt-in. "Hold" is new behavior: it gives the current provider another bounded leg instead of switching. Nothing here changes the trust model or persists a structured decision log to its own table (those are later plans); the choice's provenance is recorded through the existing `recordDecision`.

**Tech Stack:** Bun + TypeScript, `bun test`. Builds on Plan 6 (`streamRent`, `streamWithMigration`, `matchProviders`, `revalidateProvider`, `HealthMonitor`) and Plan 7 (`decide`, `DecideClient`, `selectProposal`, `RetryLeash`, `parseSoul`/`parsePolicy`, the shipped `agent/broker.soul.md` + `agent/policy.md`).

**Spec:** [`docs/superpowers/specs/2026-06-29-soul-policy-agent-runtime-design.md`](../specs/2026-06-29-soul-policy-agent-runtime-design.md) — "The broker's decision loop and guardrails" (migrate/hold reasoned from the soul), the validator walk, the retry-budget hold backstop, and "model down → deterministic fallback."

**Naming:** `Rent`/`Charge`/`/compute`/`pricePerCharge` unchanged. Atomic USDC units throughout; `RetryLeash` speaks `bigint`.

**Branch:** `git checkout -b feat/soul-degradation` off `main`.

**Handoff note:** All tasks run fully offline with a stub `DecideClient` and the url-keyed fake settlement. No network, no chain. A later plan does the trust-profile retrofit, re-expresses ranking as a `decide()` too, and persists the full `DecisionLog`.

---

## File Structure

**Created:**
- `services/src/broker/agent.ts` — `loadBrokerAgent()` (reads the shipped soul + policy)
- `services/src/broker/agent.test.ts`
- `services/src/broker/degradation.ts` — `decideMigrateOrHold()` (the broker decision, on the runtime)
- `services/src/broker/degradation.test.ts`

**Modified:**
- `services/src/broker/migrate.ts` — optional decision deps; the migrate/hold/fallback loop; expose `untriedValidProviders`
- `services/src/broker/migrate.test.ts` — soul-driven migrate / hold-then-recover / fallback tests
- `services/src/broker/runner.ts` — thread optional decision deps through `runRent`

---

## Task 1: Load the broker agent (soul + policy)

**Files:**
- Create: `services/src/broker/agent.ts`, `services/src/broker/agent.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/broker/agent.test.ts`:

```ts
import { test, expect } from "bun:test";
import { loadBrokerAgent } from "./agent";

test("loads the shipped broker soul + platform policy", async () => {
  const { soul, policy } = await loadBrokerAgent();
  expect(soul.name).toBe("Broker");
  expect(soul.schema).toBe("soul/v1");
  expect(soul.version).toBeTruthy();
  expect(policy.schema).toBe("policy/v1");
  expect(policy.body).toContain("Never fabricate execution results");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/broker/agent.test.ts`
Expected: FAIL — `Cannot find module "./agent"`.

- [ ] **Step 3: Write the loader**

Write `services/src/broker/agent.ts`:

```ts
import { parseSoul } from "../runtime/soul";
import { parsePolicy } from "../runtime/policy";
import type { Soul, Policy } from "../runtime/types";

// Load the shipped agent: the broker soul + the platform policy. Resolved relative to this
// file so it works regardless of the process cwd.
export async function loadBrokerAgent(): Promise<{ soul: Soul; policy: Policy }> {
  const soulSrc = await Bun.file(new URL("../../agent/broker.soul.md", import.meta.url)).text();
  const policySrc = await Bun.file(new URL("../../agent/policy.md", import.meta.url)).text();
  return { soul: parseSoul(soulSrc), policy: parsePolicy(policySrc) };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/broker/agent.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add services/src/broker/agent.ts services/src/broker/agent.test.ts
git commit -m "feat(broker): loadBrokerAgent (shipped soul + policy)"
```

---

## Task 2: The degradation decision (`decideMigrateOrHold`)

The broker-specific decision, built entirely on the generic runtime. Given the current
provider, the failure reason, and the untried-valid candidates, it asks the model to rank
`migrate`/`hold`, validates the ranked proposals (`revalidateProvider` for a migrate
target, the `RetryLeash` for a hold), and returns a typed choice. The deterministic
`fallback` (migrate to the first candidate) means a dead model still produces a sane plan.

**Files:**
- Create: `services/src/broker/degradation.ts`, `services/src/broker/degradation.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/broker/degradation.test.ts`:

```ts
import { test, expect } from "bun:test";
import { decideMigrateOrHold } from "./degradation";
import { RetryLeash } from "../runtime/budget";
import type { DecideClient } from "../runtime/decide";
import type { Soul, Policy, Proposal } from "../runtime/types";
import type { Provider, RentSpec } from "../domain";

const soul: Soul = { schema: "soul/v1", version: "1.0.0", name: "Broker", body: "s" };
const policy: Policy = { schema: "policy/v1", version: "1.0.0", body: "p" };
const spec: RentSpec = { resourceType: "GPU", region: null };

function provider(id: string): Provider {
  return {
    id, alias: id, ownerWallet: "0x0", endpointUrl: `http://${id}`, resourceType: "GPU",
    region: "US-East", specs: {}, online: true, stakeAmount: 100, pricePerCharge: 0.0001,
    computeScore: 90, avgLatencyMs: 5,
  };
}
const stubClient = (proposals: Proposal[]): DecideClient => ({ propose: async () => proposals });

const args = (over: Partial<Parameters<typeof decideMigrateOrHold>[1]> = {}) => ({
  current: provider("A"),
  reason: "3 consecutive failures",
  candidates: [provider("B"), provider("C")],
  spec,
  leash: new RetryLeash({ maxRetries: 2, maxDurationMs: 60_000, maxExtraSpend: 10_000n }),
  nextChargeAtomic: 100n,
  ...over,
});

test("migrate with a named target picks that provider", async () => {
  const client = stubClient([{ action: "migrate", target: "C", score: 0.9, rationale: ["named C"], userExplanation: "moving to C" }]);
  const choice = await decideMigrateOrHold({ soul, policy, client }, args());
  expect(choice.action).toBe("migrate");
  if (choice.action === "migrate") expect(choice.target.id).toBe("C");
});

test("hold is taken when the retry budget allows it", async () => {
  const client = stubClient([{ action: "hold", score: 0.9, rationale: ["transient"], userExplanation: "holding" }]);
  const choice = await decideMigrateOrHold({ soul, policy, client }, args());
  expect(choice.action).toBe("hold");
});

test("a hold past the retry budget falls through to fallback", async () => {
  const client = stubClient([{ action: "hold", score: 0.9, rationale: ["transient"], userExplanation: "holding" }]);
  const leash = new RetryLeash({ maxRetries: 0, maxDurationMs: 60_000, maxExtraSpend: 10_000n }); // no holds left
  const choice = await decideMigrateOrHold({ soul, policy, client }, args({ leash }));
  expect(choice.action).toBe("fallback");
});

test("an invalid migrate target is rejected; a valid lower-ranked hold is taken instead", async () => {
  const client = stubClient([
    { action: "migrate", target: "ghost", score: 0.9, rationale: ["bad target"], userExplanation: "move" },
    { action: "hold", score: 0.5, rationale: ["fallback"], userExplanation: "hold instead" },
  ]);
  const choice = await decideMigrateOrHold({ soul, policy, client }, args());
  expect(choice.action).toBe("hold");
});

test("a dead model falls back to a deterministic migrate to the first candidate", async () => {
  const client: DecideClient = { propose: async () => { throw new Error("model down"); } };
  const choice = await decideMigrateOrHold({ soul, policy, client }, args());
  expect(choice.action).toBe("migrate");
  if (choice.action === "migrate") expect(choice.target.id).toBe("B"); // first candidate
});

test("no candidates and an exhausted hold budget yields fallback", async () => {
  const client = stubClient([{ action: "hold", score: 0.9, rationale: [], userExplanation: "" }]);
  const leash = new RetryLeash({ maxRetries: 0, maxDurationMs: 60_000, maxExtraSpend: 10_000n });
  const choice = await decideMigrateOrHold({ soul, policy, client }, args({ candidates: [], leash }));
  expect(choice.action).toBe("fallback");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/broker/degradation.test.ts`
Expected: FAIL — `Cannot find module "./degradation"`.

- [ ] **Step 3: Write the decision**

Write `services/src/broker/degradation.ts`:

```ts
import { decide, type DecideClient } from "../runtime/decide";
import { selectProposal, type Validation } from "../runtime/select";
import { RetryLeash } from "../runtime/budget";
import type { Soul, Policy, DecisionContext, ActionSpec, Proposal } from "../runtime/types";
import { revalidateProvider } from "./guardrails";
import type { Provider, RentSpec } from "../domain";

export type DegradationDeps = { soul: Soul; policy: Policy; client: DecideClient };

export type DegradationArgs = {
  current: Provider;
  reason: string;
  candidates: Provider[];   // untried providers that already pass the hard requirements
  spec: RentSpec;
  leash: RetryLeash;        // the per-rent hold retry budget
  nextChargeAtomic: bigint; // what one more charge on the current provider would cost
};

export type DegradationChoice =
  | { action: "hold"; rationale: string }
  | { action: "migrate"; target: Provider; rationale: string }
  | { action: "fallback"; rationale: string };

const ACTIONS: ActionSpec[] = [
  { name: "migrate", description: "stop paying the degraded provider and re-point the stream to a healthy alternative (give its id as target)" },
  { name: "hold", description: "keep the current provider for another short attempt while the retry budget allows; use only if the degradation looks transient" },
];

// Ask the model (reasoning from the soul) to choose migrate/hold for a degrading provider,
// then let deterministic validation decide what is actually allowed. The model proposes; the
// guardrail and the retry budget dispose. A dead model degrades to a deterministic migrate.
export async function decideMigrateOrHold(deps: DegradationDeps, args: DegradationArgs): Promise<DegradationChoice> {
  const context: DecisionContext = {
    objective: "respond-to-degradation",
    telemetry: { current: { id: args.current.id, pricePerCharge: args.current.pricePerCharge, failure: args.reason } },
    candidates: args.candidates.map((c) => ({ id: c.id, pricePerCharge: c.pricePerCharge, computeScore: c.computeScore, avgLatencyMs: c.avgLatencyMs, region: c.region })),
    constraints: { resourceType: args.spec.resourceType, region: args.spec.region },
  };

  const fallback = (): Proposal[] => {
    const first = args.candidates[0];
    if (!first) return [];
    return [{ action: "migrate", target: first.id, score: 1, rationale: ["deterministic fallback"], userExplanation: `Model unavailable; migrating to ${first.alias}.` }];
  };

  const decision = await decide({ soul: deps.soul, policy: deps.policy, context, actions: ACTIONS, client: deps.client, fallback });

  const byId = new Map(args.candidates.map((c) => [c.id, c]));
  const validate = (p: Proposal): Validation => {
    if (p.action === "hold") {
      const v = args.leash.tryConsume(args.nextChargeAtomic);
      return v.ok ? { ok: true } : { ok: false, reason: v.reason };
    }
    if (p.action === "migrate") {
      const target = p.target ? byId.get(p.target) : args.candidates[0];
      if (!target) return { ok: false, reason: `migrate target ${p.target ?? "(none)"} is not an untried candidate` };
      const g = revalidateProvider(target, args.spec);
      return g.ok ? { ok: true } : { ok: false, reason: g.reason };
    }
    return { ok: false, reason: `unknown action ${p.action}` };
  };

  const { chosen } = selectProposal(decision, validate);
  if (!chosen) return { action: "fallback", rationale: "no proposal passed validation" };

  const stamp = `[soul ${decision.soulVersion}/policy ${decision.policyVersion}${decision.usedFallback ? "; deterministic fallback" : ""}]`;
  if (chosen.action === "hold") {
    return { action: "hold", rationale: `${chosen.userExplanation} ${stamp}` };
  }
  const target = (chosen.target ? byId.get(chosen.target) : args.candidates[0])!; // validated non-null above
  return { action: "migrate", target, rationale: `${chosen.userExplanation} ${stamp}` };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/broker/degradation.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/broker/degradation.ts services/src/broker/degradation.test.ts
git commit -m "feat(broker): decideMigrateOrHold (soul-driven degradation choice on the runtime)"
```

---

## Task 3: Wire the decision into `streamWithMigration`

When decision deps are present, the unhealthy branch asks `decideMigrateOrHold` instead of
always migrating to the deterministic best. `hold` re-runs a leg on the same provider (the
`RetryLeash` bounds how long); `migrate` re-points to the chosen target; `fallback` (and the
no-deps case) keeps the exact Plan 6 deterministic behavior. Also exposes
`untriedValidProviders` so the candidate list and `pickAlternative` share one source.

**Files:**
- Modify: `services/src/broker/migrate.ts`
- Modify: `services/src/broker/migrate.test.ts`

- [ ] **Step 1: Add the failing tests**

Add to the top of `services/src/broker/migrate.test.ts` (after the existing imports):

```ts
import { decideMigrateOrHold } from "./degradation";
import type { DecideClient } from "../runtime/decide";
import type { Soul, Policy, Proposal } from "../runtime/types";

const soul: Soul = { schema: "soul/v1", version: "1.0.0", name: "Broker", body: "s" };
const policy: Policy = { schema: "policy/v1", version: "1.0.0", body: "p" };
const stubClient = (proposals: Proposal[]): DecideClient => ({ propose: async () => proposals });

// A url-keyed fake that fails a marker's first `failFor` charges, then recovers — to model
// a transient blip the broker may choose to hold through.
function recoveringAdapter(marker: string, failFor: number, pricePerChargeAtomic = 100n, capAtomic = 1_000_000n): SettlementAdapter {
  let spent = 0n; let seq = 0; let downHits = 0; const refs = new Set<string>();
  return {
    buyerAddress: "0xBROKER",
    async ensureFunded() { return { deposited: false }; },
    async payForCompute(url: string): Promise<PaidCompute> {
      if (url.includes(marker) && downHits < failFor) { downHits++; throw new Error(`x402 failed: ${url} (transient)`); }
      if (spent + pricePerChargeAtomic > capAtomic) throw new SpendCapError(`cap ${capAtomic} reached`);
      spent += pricePerChargeAtomic;
      const settlementRef = `ref-${seq++}`; refs.add(settlementRef);
      return { amountAtomic: pricePerChargeAtomic, settlementRef, data: { ok: true }, status: 200 };
    },
    async reconcile(ref: string): Promise<SettlementStatus> { return { ref, status: refs.has(ref) ? "completed" : "unknown", settled: refs.has(ref) }; },
  };
}
```

Then add these tests at the end of `services/src/broker/migrate.test.ts`:

```ts
test("soul-driven: the model's migrate target is honored over the deterministic best", async () => {
  const reg = new InMemoryRegistry();
  // A degrades; B and C are both valid. Deterministic best would be B (higher score); the
  // soul names C, so we must end on C.
  const a = await reg.registerProvider({ ...base, alias: "A", endpointUrl: "http://aaa", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 99 });
  const b = await reg.registerProvider({ ...base, alias: "B", endpointUrl: "http://bbb", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 90 });
  const c = await reg.registerProvider({ ...base, alias: "C", endpointUrl: "http://ccc", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 80 });
  const rent = await makeRent(reg);
  const settlement = urlAdapter(["aaa"]); // A is dead

  const client = stubClient([{ action: "migrate", target: c.id, score: 1, rationale: ["chosen C"], userExplanation: "C fits best" }]);
  const result = await streamWithMigration(rent, a as Provider, {
    registry: reg, settlement, degradation: { soul, policy, client },
  }, { maxUnits: 3, maxMigrations: 1, holdBudget: { maxRetries: 2, maxDurationMs: 60_000, maxExtraSpend: 10_000n } });

  expect(result.stoppedBy).toBe("maxUnits");
  expect(result.providersUsed).toEqual([a.id, c.id]); // C, not B
  expect((await reg.getRent(rent.id))?.providerId).toBe(c.id);
});

test("soul-driven: hold gives a transiently-degraded provider another chance and it recovers", async () => {
  const reg = new InMemoryRegistry();
  const a = await reg.registerProvider({ ...base, alias: "A", endpointUrl: "http://aaa", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 99 });
  const b = await reg.registerProvider({ ...base, alias: "B", endpointUrl: "http://bbb", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 80 });
  const rent = await makeRent(reg);
  // A fails 3 times (trips unhealthy with the default monitor), then recovers.
  const settlement = recoveringAdapter("aaa", 3);

  const client = stubClient([{ action: "hold", score: 1, rationale: ["transient blip"], userExplanation: "holding A" }]);
  const result = await streamWithMigration(rent, a as Provider, {
    registry: reg, settlement, degradation: { soul, policy, client },
  }, { maxUnits: 3, maxMigrations: 1, holdBudget: { maxRetries: 2, maxDurationMs: 60_000, maxExtraSpend: 10_000n } });

  expect(result.stoppedBy).toBe("maxUnits");
  expect(result.providersUsed).toEqual([a.id]); // stayed on A, never migrated
  expect(result.migrations).toBe(0);
  expect(result.units).toBe(3);
});

test("soul-driven: a dead model falls back to the deterministic migrate", async () => {
  const reg = new InMemoryRegistry();
  const { a, b } = await seedTwo(reg);
  const rent = await makeRent(reg);
  const settlement = urlAdapter(["aaa"]); // A dead
  const deadClient: DecideClient = { propose: async () => { throw new Error("model down"); } };
  const result = await streamWithMigration(rent, a as Provider, {
    registry: reg, settlement, degradation: { soul, policy, client: deadClient },
  }, { maxUnits: 3, maxMigrations: 1, holdBudget: { maxRetries: 2, maxDurationMs: 60_000, maxExtraSpend: 10_000n } });

  expect(result.stoppedBy).toBe("maxUnits");
  expect(result.providersUsed).toEqual([a.id, b.id]); // deterministic migrate to B
  expect(result.migrations).toBe(1);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd services && bun test src/broker/migrate.test.ts`
Expected: FAIL — `streamWithMigration` does not accept `degradation` / `holdBudget`.

- [ ] **Step 3: Rewrite `migrate.ts`**

Replace the entire contents of `services/src/broker/migrate.ts` with:

```ts
import type { Registry } from "../registry/registry";
import type { SettlementAdapter } from "../settlement/adapter";
import type { Provider, Rent, RentSpec } from "../domain";
import { matchProviders, type RankStrategy } from "./matching";
import { revalidateProvider } from "./guardrails";
import { streamRent, type StreamOptions, type StoppedBy } from "./stream";
import { HealthMonitor } from "./health";
import { RetryLeash, type RetryBudget } from "../runtime/budget";
import { decideMigrateOrHold, type DegradationDeps } from "./degradation";

export type MigrationDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  rank?: RankStrategy;
  healthOpts?: { maxConsecutiveFailures?: number; maxLatencyMs?: number };
  degradation?: DegradationDeps; // when set, the broker asks the soul migrate/hold on degrade
};

export type MigrationOptions = StreamOptions & {
  maxMigrations?: number;   // how many times the broker may re-point the stream
  holdBudget?: RetryBudget; // bounds soul-chosen holds; required for the degradation path
};

export type MigrationStoppedBy = StoppedBy | "no-alternative";

export type MigrationResult = {
  units: number;
  stoppedBy: MigrationStoppedBy;
  reason: string;
  providersUsed: string[];
  migrations: number;
};

const atomicPerCharge = (p: Provider): bigint => BigInt(Math.round(p.pricePerCharge * 1_000_000));

// Stream a rent, responding to provider degradation. When `degradation` deps are present the
// broker asks the soul to choose migrate/hold (validated by the runtime); otherwise it keeps
// the deterministic Plan 6 behavior (migrate to the best untried alternative). A fresh
// HealthMonitor per leg means a new (or re-held) provider never inherits a stale streak.
export async function streamWithMigration(
  rent: Rent,
  firstProvider: Provider,
  deps: MigrationDeps,
  opts: MigrationOptions = {},
): Promise<MigrationResult> {
  const { registry, settlement } = deps;
  const maxUnits = opts.maxUnits ?? Number.POSITIVE_INFINITY;
  const maxMigrations = opts.maxMigrations ?? 0;
  const leash = opts.holdBudget ? new RetryLeash(opts.holdBudget) : null;

  const used = new Set<string>([firstProvider.id]);
  let provider = firstProvider;
  let totalUnits = 0;
  let migrations = 0;

  const result = (stoppedBy: MigrationStoppedBy, reason: string): MigrationResult =>
    ({ units: totalUnits, stoppedBy, reason, providersUsed: [...used], migrations });

  while (true) {
    const remaining = maxUnits === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : maxUnits - totalUnits;
    if (remaining <= 0) return result("maxUnits", `reached maxUnits=${maxUnits}`);

    const leg = await streamRent(
      rent,
      provider,
      { registry, settlement, health: new HealthMonitor(deps.healthOpts) },
      { maxUnits: remaining, shouldStop: opts.shouldStop, startSeq: totalUnits },
    );
    totalUnits += leg.units;

    if (leg.stoppedBy !== "unhealthy") return result(leg.stoppedBy, leg.reason);

    // The provider degraded. Decide what to do.
    if (deps.degradation && leash) {
      const candidates = await untriedValidProviders(registry, rent.spec, used, deps.rank);
      const choice = await decideMigrateOrHold(deps.degradation, {
        current: provider,
        reason: leg.reason,
        candidates,
        spec: rent.spec,
        leash,
        nextChargeAtomic: atomicPerCharge(provider),
      });

      if (choice.action === "hold") {
        await registry.recordDecision({ rentId: rent.id, candidates: [{ providerId: provider.id, rank: 0 }], chosenProviderId: provider.id, rationale: `hold ${provider.id}: ${choice.rationale}` });
        continue; // another bounded leg on the same provider
      }
      if (choice.action === "migrate") {
        if (migrations >= maxMigrations) return result("unhealthy", `migration cap reached after ${provider.id} degraded`);
        await registry.recordDecision({ rentId: rent.id, candidates: [{ providerId: choice.target.id, rank: 0 }], chosenProviderId: choice.target.id, rationale: `migrate ${provider.id} -> ${choice.target.id}: ${choice.rationale}` });
        await registry.updateRent(rent.id, { providerId: choice.target.id });
        used.add(choice.target.id);
        provider = choice.target;
        migrations++;
        continue;
      }
      // choice.action === "fallback": drop into the deterministic block below.
    }

    // Deterministic path (no decision deps, or the soul path bounced to fallback).
    if (migrations >= maxMigrations) return result("unhealthy", leg.reason);
    const next = (await untriedValidProviders(registry, rent.spec, used, deps.rank))[0] ?? null;
    if (!next) return result("no-alternative", `no healthy alternative after ${provider.id} degraded`);

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

// Best-first untried providers that still pass the deterministic guardrail.
export async function untriedValidProviders(
  registry: Registry,
  spec: RentSpec,
  used: Set<string>,
  rank?: RankStrategy,
): Promise<Provider[]> {
  const match = await matchProviders(registry, spec, rank);
  const out: Provider[] = [];
  for (const c of match.candidates) {
    if (used.has(c.providerId)) continue;
    const p = await registry.getProvider(c.providerId);
    if (p && revalidateProvider(p, spec).ok) out.push(p);
  }
  return out;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd services && bun test src/broker/migrate.test.ts`
Expected: PASS (the existing 5 migration tests plus the 3 new soul-driven ones). The
existing tests pass unchanged because they never pass `degradation`, so the deterministic
block runs exactly as in Plan 6.

- [ ] **Step 5: Commit**

```bash
git add services/src/broker/migrate.ts services/src/broker/migrate.test.ts
git commit -m "feat(broker): soul-driven migrate/hold on degrade (deterministic fallback preserved)"
```

---

## Task 4: Thread the decision through `runRent`

`runRent` should pass optional decision deps to `streamWithMigration` so a caller can arm the
soul path per rent. Default (no deps) is unchanged Plan 6 behavior.

**Files:**
- Modify: `services/src/broker/runner.ts`

- [ ] **Step 1: Add the failing test**

Add this test at the end of `services/src/broker/runner.test.ts`:

```ts
test("autonomy: a held-then-recovered provider finishes completed on the same provider", async () => {
  const { decideMigrateOrHold } = await import("./degradation"); // ensure module wires
  void decideMigrateOrHold;
  const reg = new InMemoryRegistry();
  await reg.registerProvider({ ...base, alias: "A", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 95 });
  const rent = await reg.createRent({ name: "x", userId: "u1", spec: { resourceType: "GPU", region: null }, autonomyArmed: true });

  // A fails twice then recovers; the soul holds; default monitor trips at 3, so use a monitor
  // that trips at 2 to exercise the hold path quickly.
  let downHits = 0;
  const settlement: SettlementAdapter = {
    buyerAddress: "0xB",
    async ensureFunded() { return { deposited: false }; },
    async payForCompute(): Promise<PaidCompute> {
      if (downHits < 2) { downHits++; throw new Error("transient"); }
      return { amountAtomic: 100n, settlementRef: `r-${downHits++}`, data: {}, status: 200 };
    },
    async reconcile(ref): Promise<SettlementStatus> { return { ref, status: "completed", settled: true }; },
  };

  const client = { propose: async () => [{ action: "hold", score: 1, rationale: ["transient"], userExplanation: "holding" }] };
  const soul = { schema: "soul/v1", version: "1.0.0", name: "Broker", body: "s" };
  const policy = { schema: "policy/v1", version: "1.0.0", body: "p" };

  const result = await runRent(rent.id, {
    registry: reg, settlement, degradation: { soul, policy, client },
    healthOpts: { maxConsecutiveFailures: 2 },
  }, { maxUnits: 2, maxMigrations: 1, holdBudget: { maxRetries: 3, maxDurationMs: 60_000, maxExtraSpend: 10_000n } });

  expect(result.stoppedBy).toBe("maxUnits");
  expect((await reg.getRent(rent.id))?.status).toBe("completed");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/broker/runner.test.ts`
Expected: FAIL — `RunDeps` does not accept `degradation` / `healthOpts`.

- [ ] **Step 3: Update `runner.ts`**

In `services/src/broker/runner.ts`, change the imports and `RunDeps`, and pass the deps to
`streamWithMigration`.

Change the import line:

```ts
import { streamWithMigration, type MigrationStoppedBy } from "./migrate";
```

to:

```ts
import { streamWithMigration, type MigrationStoppedBy } from "./migrate";
import type { DegradationDeps } from "./degradation";
```

Change `RunDeps`:

```ts
export type RunDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  rank?: RankStrategy;
  degradation?: DegradationDeps;
  healthOpts?: { maxConsecutiveFailures?: number; maxLatencyMs?: number };
};
```

Change the `streamWithMigration` call from:

```ts
  const stream = await streamWithMigration(
    rent,
    match.chosen,
    { registry, settlement, rank: deps.rank },
    opts,
  );
```

to:

```ts
  const stream = await streamWithMigration(
    rent,
    match.chosen,
    { registry, settlement, rank: deps.rank, degradation: deps.degradation, healthOpts: deps.healthOpts },
    opts,
  );
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/broker/runner.test.ts`
Expected: PASS (existing runner tests + the new held-then-recovered test).

- [ ] **Step 5: Commit**

```bash
git add services/src/broker/runner.ts services/src/broker/runner.test.ts
git commit -m "feat(broker): thread soul-driven degradation deps through runRent"
```

---

## Task 5: Wrap-up

- [ ] **Step 1: Full suite + type-check**

Run: `cd services && bun test && bunx tsc --noEmit`
Expected: all tests pass (existing suite + `agent`, `degradation`, the new `migrate` and
`runner` tests). tsc exit 0.

- [ ] **Step 2: Finish the branch**

Use superpowers:finishing-a-development-branch (verify tests, present options, execute
choice). Default to merging `feat/soul-degradation` to `main` once green.

- [ ] **Step 3: Update the project memory**

Update `autonomous-compute-broker-project.md`: the broker's migrate/hold-on-degrade is now
soul-driven via the runtime (`decideMigrateOrHold` + `streamWithMigration` decision deps;
deterministic migrate-to-best is the fallback; hold is bounded by the `RetryLeash`). Next:
the trust-profile retrofit, re-expressing ranking as a `decide()` instance, and persisting
the full `DecisionLog`.

---

## Self-Review Notes

**Spec coverage:** Implements the spec's "on a degradation signal, the broker asks the
model: migrate / pause / hold? (slice 1: migrate or hold) ... the model genuinely decides"
via `decideMigrateOrHold` reasoning from `broker.soul.md` over the runtime. The validator
walk (`selectProposal` + `revalidateProvider` + `RetryLeash`) is the "model proposes, code
disposes" gate; the retry-budget hold backstop bounds holds; the deterministic
migrate-to-best `fallback` is "model down → still works, less smart." Provenance (soul/policy
versions, usedFallback) is stamped into the recorded decision's rationale.

**Placeholder scan:** No TBDs. Every test uses a complete stub `DecideClient` and complete
settlement fakes (`urlAdapter` from Plan 6 already in this file; `recoveringAdapter` defined
inline). The `target!` in `degradation.ts` is justified: the migrate branch only runs after
the validator confirmed a non-null target.

**Type consistency:** `DegradationDeps`/`DegradationArgs`/`DegradationChoice` (Task 2) are
used by `streamWithMigration` (Task 3) and re-exported through `runRent` (Task 4).
`decideMigrateOrHold` consumes Plan 7's `decide`/`DecideClient`/`selectProposal`/`RetryLeash`/
`Validation` and Plan 6's `revalidateProvider`. `MigrationDeps` gains `degradation?` and
`MigrationOptions` gains `holdBudget?`, both optional so Plan 6 callers and tests are
unchanged. Amounts stay atomic (`atomicPerCharge`, `nextChargeAtomic: bigint`).

**Behavior preserved:** Without `degradation` deps (every existing test, and any caller that
doesn't opt in), `streamWithMigration` runs the same deterministic block as Plan 6, so
`maxMigrations`, `no-alternative`, and the existing stop reasons are unchanged.

**Out of scope (later plans):** the trust-profile retrofit (`TrustProfile` + tier gate
replacing `stakeAmount`), re-expressing provider ranking as a `decide()` instance, and
persisting the structured `DecisionLog` to its own table (here the choice is recorded through
the existing `recordDecision`).
```