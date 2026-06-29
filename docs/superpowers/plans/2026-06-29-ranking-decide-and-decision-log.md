# Ranking-as-decide() + DecisionLog Persistence Implementation Plan (Plan 10 of N)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the runtime wiring. (A) Re-express provider ranking as a soul-driven `decide()` instance so the broker's ordering heuristics come from `broker.soul.md`, not a hardcoded prompt, with the deterministic `scoreProviders` as the fallback. (B) Persist the structured `DecisionLog` (decision id, soul/policy versions, proposals, chosen action, rejected reason, fallback flag) for every soul-driven migrate/hold decision, so autonomous behavior is auditable and attributable to a soul+policy version.

**Architecture:** Two independent additions on the proven runtime.

(A) A new `rankDecideStrategy({ soul, policy, client })` returns a `RankStrategy` (the seam `matchProviders` already accepts). It builds a `DecisionContext` from the candidate providers, asks the runtime `decide()` for one ranked `select` proposal per provider (`target` = provider id), and reorders the providers by that order with the same superset-permutation guarantee the old ranker had (invented ids dropped, omitted candidates appended). `decide()`'s own `fallback` is the deterministic `scoreProviders` order, so a model outage degrades to the scorer without throwing. This *replaces* the Plan 6 hardcoded-prompt `llm-rank.ts` (retired here; nothing in any real path used it).

(B) The runtime already builds a `Decision` + `Selection` + `buildDecisionLog` inside `decideMigrateOrHold`; today it throws the log away and persists only a rationale string. This plan returns the `DecisionLog` from `decideMigrateOrHold` and adds two `Registry` methods, `recordDecisionLog(rentId, log)` and `listDecisionLogs(rentId)`, backed by new nullable structured columns on the existing `rent_decisions` table (additive migration). `streamWithMigration` persists the log on each soul-driven hold/migrate. Offline tests use `InMemoryRegistry`; the live `SupabaseRegistry` contract proves the columns round-trip.

**Tech Stack:** Bun + TypeScript, `bun test`. `noUncheckedIndexedAccess` is on, so guard index access. Builds on Plans 1-9 (`decide`/`selectProposal`/`buildDecisionLog`/`assemblePrompt`, `loadBrokerAgent`, `matchProviders`/`RankStrategy`/`scoreProviders`, `decideMigrateOrHold`, `streamWithMigration`, `Registry`, `TrustProfile`).

**Spec:** [`docs/superpowers/specs/2026-06-29-soul-policy-agent-runtime-design.md`](../specs/2026-06-29-soul-policy-agent-runtime-design.md) — "How this realigns the existing code (Plan 6)": *"Ranking … becomes a `decide()` instance whose heuristics come from the soul, not a hardcoded prompt. The deterministic `scoreProviders` stays as the fallback."* Plus the decision-log shape (versioned, attributable) from the runtime section.

**Naming:** entity is `Rent`, billing unit is `Charge`, provider compute endpoint is `/compute`. No `job`/`tick` anywhere in `services/`.

**Branch:** `git checkout -b feat/ranking-decide-decisionlog off main`.

**Scope note:** Persisting a structured log for the *ranking* decision is deliberately out of scope: a ranking is an ordering, not an action-selection with a validator/rejection, so `buildDecisionLog`'s `chosenAction`/`rejectedReason` shape does not fit it. Ranking keeps its existing `recordDecision` rationale text ("ranked by the broker model"). The structured `DecisionLog` is persisted for the migrate/hold decisions, which is where the runtime actually validates and selects an action.

**Handoff note:** Tasks 1, 2, 3, 5 run fully offline. Task 4's live `SupabaseRegistry` contract needs `services/.env` and applies an additive migration to the shared PrimeBot DB (ref `xwxuqcougmanzonypoym`) — additive only, no destructive change. The gated `rank:soul` probe (Task 2) needs `LLM_BASE_URL`/`LLM_API_KEY`.

---

## File Structure

**Created:**
- `services/src/broker/rank-decide.ts` — `rankDecideStrategy({ soul, policy, client })` (soul-driven `RankStrategy`)
- `services/src/broker/rank-decide.test.ts`
- `services/probes/rank-soul.ts` — gated: two souls rank the same providers differently via one runtime
- `services/src/broker/decision-log.test.ts` — end-to-end: a soul-driven migrate persists a structured log
- `services/supabase/migrations/0004_decision_log.sql` — additive structured columns on `rent_decisions`

**Modified:**
- `services/src/registry/registry.ts` — add `recordDecisionLog` + `listDecisionLogs` to the `Registry` interface
- `services/src/registry/in-memory.ts` — implement both
- `services/src/registry/supabase.ts` — implement both (map structured columns)
- `services/src/registry/contract.ts` — add a decision-log round-trip test
- `services/src/broker/degradation.ts` — `decideMigrateOrHold` returns the `DecisionLog`
- `services/src/broker/migrate.ts` — persist the log via `recordDecisionLog` on soul hold/migrate
- `services/package.json` — replace `rank:llm` with `rank:soul`

**Deleted:**
- `services/src/broker/llm-rank.ts`, `services/src/broker/llm-rank.test.ts`, `services/probes/llm-rank.ts` (the superseded hardcoded-prompt ranker)

---

## Task 1: Soul-driven ranking strategy

`rankDecideStrategy` turns the broker agent (soul + policy) plus a `DecideClient` into a `RankStrategy`. It asks the runtime to rank candidates and reorders providers by the returned `target` ids, never losing a provider. The deterministic `scoreProviders` is `decide()`'s fallback, so a model outage silently degrades to the scorer.

**Files:**
- Create: `services/src/broker/rank-decide.ts`
- Test: `services/src/broker/rank-decide.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/broker/rank-decide.test.ts`:

```ts
import { test, expect } from "bun:test";
import { rankDecideStrategy } from "./rank-decide";
import { defaultTrust } from "../trust/trust";
import type { DecideClient } from "../runtime/decide";
import type { Soul, Policy, Proposal } from "../runtime/types";
import type { Provider, RentSpec } from "../domain";

const soul: Soul = { schema: "soul/v1", version: "1.0.0", name: "Broker", body: "s" };
const policy: Policy = { schema: "policy/v1", version: "1.0.0", body: "p" };
const spec: RentSpec = { resourceType: "GPU", region: null };

function p(id: string, over: Partial<Provider> = {}): Provider {
  return {
    id, alias: id, ownerWallet: "0x0", endpointUrl: "http://x", resourceType: "GPU",
    region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001,
    computeScore: 80, avgLatencyMs: 5, ...over,
  };
}

const selects = (...ids: (string | undefined)[]): Proposal[] =>
  ids.map((id, i) => ({ action: "select", target: id, score: 1 - i / 10, rationale: ["r"], userExplanation: "e" }));
const stub = (proposals: Proposal[]): DecideClient => ({ propose: async () => proposals });

test("reorders providers by the proposal target order", async () => {
  const client = stub(selects("c", "a", "b"));
  const ranked = await rankDecideStrategy({ soul, policy, client })([p("a"), p("b"), p("c")], spec);
  expect(ranked.map((x) => x.id)).toEqual(["c", "a", "b"]);
});

test("drops invented target ids and appends omitted candidates in original order", async () => {
  const client = stub(selects("b", "ghost"));
  const ranked = await rankDecideStrategy({ soul, policy, client })([p("a"), p("b"), p("c")], spec);
  expect(ranked.map((x) => x.id)).toEqual(["b", "a", "c"]); // b named; a,c appended; ghost dropped
});

test("ignores duplicate and target-less proposals", async () => {
  const client = stub([...selects("a", "a"), { action: "select", score: 0.1, rationale: [], userExplanation: "" }]);
  const ranked = await rankDecideStrategy({ soul, policy, client })([p("a"), p("b")], spec);
  expect(ranked.map((x) => x.id)).toEqual(["a", "b"]);
});

test("a dead model falls back to the deterministic scorer order (no throw)", async () => {
  const client: DecideClient = { propose: async () => { throw new Error("model down"); } };
  // b is cheaper + higher score than a, so scoreProviders ranks b first.
  const ranked = await rankDecideStrategy({ soul, policy, client })(
    [p("a", { pricePerCharge: 0.0002, computeScore: 70 }), p("b", { pricePerCharge: 0.0001, computeScore: 92 })],
    spec,
  );
  expect(ranked[0]?.id).toBe("b");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/broker/rank-decide.test.ts`
Expected: FAIL — `Cannot find module "./rank-decide"`.

- [ ] **Step 3: Write the strategy**

Write `services/src/broker/rank-decide.ts`:

```ts
import type { Provider, RentSpec } from "../domain";
import type { RankStrategy } from "./matching";
import { scoreProviders } from "../scoring";
import { decide, type DecideClient } from "../runtime/decide";
import type { Soul, Policy, DecisionContext, ActionSpec, Proposal } from "../runtime/types";

export type RankDeps = { soul: Soul; policy: Policy; client: DecideClient };

// Ranking is a single-action decision: the model proposes one `select` per candidate,
// ordered best-first, with the provider id as the target.
const RANK_ACTIONS: ActionSpec[] = [
  {
    name: "select",
    description:
      "rank this candidate provider for the rent; pass the provider id as `target`. " +
      "Propose one `select` per candidate, ordered best-first.",
  },
];

// A soul-driven RankStrategy. The ordering heuristics come from the soul (the prompt is
// assembled by the runtime from policy + soul + context), not a hardcoded weighting. The
// result is always a superset-permutation of the input: invented ids are dropped and
// candidates the model omitted are appended in their original order, so no provider is
// ever lost. `decide()`'s fallback is the deterministic scorer, so a model outage degrades
// to scoreProviders without throwing.
export function rankDecideStrategy(deps: RankDeps): RankStrategy {
  return async (providers, spec) => {
    const context: DecisionContext = {
      objective: "rank-providers",
      candidates: providers.map((p) => ({
        id: p.id,
        pricePerCharge: p.pricePerCharge,
        computeScore: p.computeScore,
        avgLatencyMs: p.avgLatencyMs,
        region: p.region,
        tier: p.trust.tier,
      })),
      constraints: { resourceType: spec.resourceType, region: spec.region },
    };

    const fallback = (): Proposal[] =>
      scoreProviders(providers, spec).map((p, i) => ({
        action: "select",
        target: p.id,
        score: providers.length > 1 ? 1 - i / providers.length : 1,
        rationale: ["deterministic score fallback"],
        userExplanation: `Ranked ${p.alias} by the price/score/latency blend.`,
      }));

    const decision = await decide({
      soul: deps.soul,
      policy: deps.policy,
      context,
      actions: RANK_ACTIONS,
      client: deps.client,
      fallback,
    });

    const byId = new Map(providers.map((p) => [p.id, p]));
    const ranked: Provider[] = [];
    const seen = new Set<string>();
    for (const prop of decision.proposals) {
      const id = prop.target;
      if (!id || seen.has(id)) continue;
      const p = byId.get(id);
      if (p) {
        ranked.push(p);
        seen.add(id);
      }
    }
    for (const p of providers) if (!seen.has(p.id)) ranked.push(p);
    return ranked;
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/broker/rank-decide.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/broker/rank-decide.ts services/src/broker/rank-decide.test.ts
git commit -m "feat(broker): soul-driven ranking as a decide() instance (scorer fallback)"
```

---

## Task 2: Retire the hardcoded ranker; add the soul-ranking probe

`llm-rank.ts` was the Plan 6 model-backed ranker with its own hardcoded prompt. It is superseded by Task 1 and used by nothing but its own test and the `rank:llm` probe. Delete it, and replace the probe with `rank:soul`, which shows two souls producing different rankings through the *same* runtime (the ranking analogue of `soul:divergence`).

**Files:**
- Delete: `services/src/broker/llm-rank.ts`, `services/src/broker/llm-rank.test.ts`, `services/probes/llm-rank.ts`
- Create: `services/probes/rank-soul.ts`
- Modify: `services/package.json`

- [ ] **Step 1: Delete the superseded ranker**

```bash
cd services && rm src/broker/llm-rank.ts src/broker/llm-rank.test.ts probes/llm-rank.ts
```

- [ ] **Step 2: Write the soul-ranking probe**

Write `services/probes/rank-soul.ts`:

```ts
import { parseSoul } from "../src/runtime/soul";
import { parsePolicy } from "../src/runtime/policy";
import { makeDecideClient } from "../src/runtime/decide";
import { rankDecideStrategy } from "../src/broker/rank-decide";
import { defaultTrust } from "../src/trust/trust";
import type { Provider, RentSpec } from "../src/domain";

// Gated: needs LLM_BASE_URL / LLM_API_KEY. Proves that swapping ONLY the soul changes the
// ranking while the runtime, policy, context, and candidates are identical.
const policy = parsePolicy(await Bun.file(new URL("../agent/policy.md", import.meta.url)).text());
const costFirst = parseSoul(await Bun.file(new URL("../agent/souls/cost-first.soul.md", import.meta.url)).text());
const uptimeFirst = parseSoul(await Bun.file(new URL("../agent/souls/uptime-first.soul.md", import.meta.url)).text());

function p(id: string, over: Partial<Provider>): Provider {
  return {
    id, alias: id, ownerWallet: "0x0", endpointUrl: `http://${id}`, resourceType: "GPU",
    region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001,
    computeScore: 80, avgLatencyMs: 5, ...over,
  };
}

// "cheap" is the cheapest but lowest score/uptime; "solid" is pricier but best score.
const providers: Provider[] = [
  p("cheap", { pricePerCharge: 0.00003, computeScore: 60, avgLatencyMs: 12 }),
  p("solid", { pricePerCharge: 0.00009, computeScore: 95, avgLatencyMs: 4, trust: defaultTrust("Bonded") }),
];
const spec: RentSpec = { resourceType: "GPU", region: null };

const client = makeDecideClient();

try {
  const a = await rankDecideStrategy({ soul: costFirst, policy, client })(providers, spec);
  const b = await rankDecideStrategy({ soul: uptimeFirst, policy, client })(providers, spec);
  console.log("cost-first   ranking:", a.map((x) => x.id).join(" > "));
  console.log("uptime-first ranking:", b.map((x) => x.id).join(" > "));
  if (a[0]?.id === "cheap" && b[0]?.id === "solid") {
    console.log("\n✅ same runtime, different soul, divergent ranking (cost-first picks cheap, uptime-first picks solid).");
  } else {
    console.log("\n⚠️  rankings did not diverge as expected; souls/prompt may need tuning or the model hedged.");
    console.log("    (The architecture still holds; this probe just tests soul sensitivity of ranking.)");
  }
} catch (err) {
  console.error("\n❌ rank-soul probe failed:", err instanceof Error ? err.message : err);
  console.error("Broker still ranks via the deterministic scorer. Set LLM_BASE_URL/LLM_API_KEY to test the model path.");
  process.exitCode = 1;
}
```

- [ ] **Step 3: Swap the script in package.json**

In `services/package.json`, replace the `"rank:llm"` line with:

```json
    "rank:soul": "bun run probes/rank-soul.ts",
```

- [ ] **Step 4: Run the offline gates**

Run: `cd services && bun test src/broker/ && bunx tsc --noEmit`
Expected: all broker tests pass (no `llm-rank` references remain), tsc exit 0. Confirm with `grep -rn "llm-rank\|llmRankStrategy\|makeRankClient" src/ scripts/ probes/ --include="*.ts"` printing nothing.

- [ ] **Step 5: Commit**

```bash
git add -A services/src/broker/ services/probes/ services/package.json
git commit -m "refactor(broker): retire hardcoded llm-rank; add gated rank:soul probe"
```

---

## Task 3: Registry decision-log methods (interface + in-memory + contract)

Add `recordDecisionLog(rentId, log)` and `listDecisionLogs(rentId)` to the `Registry` interface and the in-memory implementation, and a contract test that runs against both registries.

**Files:**
- Modify: `services/src/registry/registry.ts`
- Modify: `services/src/registry/in-memory.ts`
- Modify: `services/src/registry/contract.ts`

- [ ] **Step 1: Add the contract test**

In `services/src/registry/contract.ts`, add this import near the top imports:

```ts
import type { DecisionLog } from "../runtime/types";
```

Then add this test inside the `describe(...)` block, after the trust round-trip test:

```ts
    test("recordDecisionLog persists structured provenance and lists it back", async () => {
      const provider = await reg.registerProvider({ ...sampleProvider, alias: "log-target" });
      const rent = await reg.createRent({ name: "log-rent", userId: "u1", spec: { resourceType: "GPU", region: null } });
      const log: DecisionLog = {
        decisionId: crypto.randomUUID(),
        soulVersion: "1.2.3",
        policyVersion: "0.9.0",
        objective: "respond-to-degradation",
        proposals: [{ action: "migrate", target: provider.id, score: 0.9, rationale: ["pricier but healthy"], userExplanation: "moving to log-target" }],
        chosenAction: { action: "migrate", target: provider.id },
        rejectedReason: null,
        usedFallback: false,
        createdAt: new Date().toISOString(),
      };
      await reg.recordDecisionLog(rent.id, log);
      const logs = await reg.listDecisionLogs(rent.id);
      expect(logs).toHaveLength(1);
      expect(logs[0]?.soulVersion).toBe("1.2.3");
      expect(logs[0]?.policyVersion).toBe("0.9.0");
      expect(logs[0]?.objective).toBe("respond-to-degradation");
      expect(logs[0]?.chosenAction).toEqual({ action: "migrate", target: provider.id });
      expect(logs[0]?.usedFallback).toBe(false);
      expect(logs[0]?.proposals).toHaveLength(1);
    }, T);
```

- [ ] **Step 2: Extend the Registry interface**

In `services/src/registry/registry.ts`, add the import of `DecisionLog` to the existing `import type { ... } from "../domain";`? No — `DecisionLog` lives in the runtime. Add a new import line after the domain import:

```ts
import type { DecisionLog } from "../runtime/types";
```

Then add these two methods to the `Registry` interface, right after `recordDecision(...)`:

```ts
  recordDecisionLog(rentId: string, log: DecisionLog): Promise<DecisionLog>;
  listDecisionLogs(rentId: string): Promise<DecisionLog[]>;
```

- [ ] **Step 3: Run the in-memory contract to verify it fails**

Run: `cd services && bun test src/registry/in-memory.test.ts`
Expected: FAIL — `InMemoryRegistry` does not implement `recordDecisionLog`/`listDecisionLogs` (type error / missing method).

- [ ] **Step 4: Implement in `InMemoryRegistry`**

In `services/src/registry/in-memory.ts`, add the import after the existing imports:

```ts
import type { DecisionLog } from "../runtime/types";
```

Add a field next to the other private collections (near `private charges: Charge[] = [];`):

```ts
  private decisionLogs: { rentId: string; log: DecisionLog }[] = [];
```

Add these two methods (e.g. right after `recordDecision`):

```ts
  async recordDecisionLog(rentId: string, log: DecisionLog): Promise<DecisionLog> {
    this.decisionLogs.push({ rentId, log });
    return log;
  }

  async listDecisionLogs(rentId: string): Promise<DecisionLog[]> {
    return this.decisionLogs.filter((d) => d.rentId === rentId).map((d) => d.log);
  }
```

- [ ] **Step 5: Run the in-memory contract to verify it passes**

Run: `cd services && bun test src/registry/in-memory.test.ts`
Expected: PASS (existing contract tests plus the new decision-log round-trip).

- [ ] **Step 6: Commit**

```bash
git add services/src/registry/registry.ts services/src/registry/in-memory.ts services/src/registry/contract.ts
git commit -m "feat(registry): recordDecisionLog + listDecisionLogs (interface + in-memory)"
```

---

## Task 4: Persist decision logs in Supabase (migration + mapping + live contract)

Add the structured columns to `rent_decisions` (additive), implement the two methods on `SupabaseRegistry`, apply the additive migration to the live PrimeBot DB, and run the live contract.

**Files:**
- Create: `services/supabase/migrations/0004_decision_log.sql`
- Modify: `services/src/registry/supabase.ts`

- [ ] **Step 1: Write the migration**

Write `services/supabase/migrations/0004_decision_log.sql`:

```sql
-- prime-compute (Plan 10): structured runtime DecisionLog columns on rent_decisions.
-- Additive and nullable: legacy recordDecision rows leave these null; recordDecisionLog
-- rows populate them. A row is a "decision log" iff decision_id is not null.

alter table rent_decisions
  add column if not exists decision_id uuid,
  add column if not exists soul_version text,
  add column if not exists policy_version text,
  add column if not exists objective text,
  add column if not exists proposals jsonb not null default '[]',
  add column if not exists chosen_action text,
  add column if not exists rejected_reason text,
  add column if not exists used_fallback boolean not null default false;
```

- [ ] **Step 2: Implement the two methods on `SupabaseRegistry`**

In `services/src/registry/supabase.ts`, add the import after the existing trust import:

```ts
import type { DecisionLog, Proposal } from "../runtime/types";
```

Add a mapper next to the other `to*` mappers (after `toCharge`):

```ts
function toDecisionLog(raw: unknown): DecisionLog {
  const r = raw as Row;
  const action = (r.chosen_action as string | null) ?? null;
  const target = (r.chosen_provider_id as string | null) ?? undefined;
  return {
    decisionId: r.decision_id as string,
    soulVersion: (r.soul_version as string) ?? "",
    policyVersion: (r.policy_version as string) ?? "",
    objective: (r.objective as string) ?? "",
    proposals: (r.proposals as Proposal[] | null) ?? [],
    chosenAction: action ? { action, target } : null,
    rejectedReason: (r.rejected_reason as string | null) ?? null,
    usedFallback: (r.used_fallback as boolean | null) ?? false,
    createdAt: r.created_at as string,
  };
}
```

Add these two methods to the `SupabaseRegistry` class (after `recordDecision`):

```ts
  async recordDecisionLog(rentId: string, log: DecisionLog): Promise<DecisionLog> {
    // Derive the legacy provider-choice columns from the structured log so a single table
    // serves both audits: candidates = the ranked targets, chosen = the chosen action's target.
    const candidates = log.proposals
      .map((p, i) => ({ providerId: p.target, rank: i }))
      .filter((c): c is { providerId: string; rank: number } => typeof c.providerId === "string");
    const chosen = log.proposals.find(
      (p) => p.action === log.chosenAction?.action && p.target === log.chosenAction?.target,
    );
    const rationale = chosen?.userExplanation ?? log.rejectedReason ?? "";
    await this.one(
      this.db.from("rent_decisions").insert({
        rent_id: rentId,
        candidates,
        chosen_provider_id: log.chosenAction?.target ?? null,
        rationale,
        decision_id: log.decisionId,
        soul_version: log.soulVersion,
        policy_version: log.policyVersion,
        objective: log.objective,
        proposals: log.proposals,
        chosen_action: log.chosenAction?.action ?? null,
        rejected_reason: log.rejectedReason,
        used_fallback: log.usedFallback,
      }).select().single(),
      "recordDecisionLog",
    );
    return log;
  }

  async listDecisionLogs(rentId: string): Promise<DecisionLog[]> {
    const { data, error } = await this.db
      .from("rent_decisions")
      .select()
      .eq("rent_id", rentId)
      .not("decision_id", "is", null)
      .order("created_at");
    if (error) throw new Error(`listDecisionLogs: ${error.message}`);
    return (data ?? []).map((r) => toDecisionLog(r));
  }
```

- [ ] **Step 3: Apply the additive migration to the live DB**

Apply `0004_decision_log.sql` to the PrimeBot project (ref `xwxuqcougmanzonypoym`) via the Supabase MCP `apply_migration` (name `0004_decision_log`, the SQL above) or the SQL editor. It is additive (only `add column if not exists`), so it carries no destructive risk.

- [ ] **Step 4: Run the live Supabase contract**

Run: `cd services && bun test src/registry/supabase.test.ts`
Expected: PASS, including the decision-log round-trip. If `.env`/the DB is unavailable, note the handoff; the in-memory contract already proves the mapping shape.

- [ ] **Step 5: Commit**

```bash
git add services/supabase/migrations/0004_decision_log.sql services/src/registry/supabase.ts
git commit -m "feat(registry): persist DecisionLog to rent_decisions (migration 0004 + supabase mapping)"
```

---

## Task 5: Wire log persistence into the degradation flow

`decideMigrateOrHold` already composes a `Decision` + `Selection`; have it also build and return the `DecisionLog`, then persist it from `streamWithMigration` on each soul-driven hold/migrate.

**Files:**
- Modify: `services/src/broker/degradation.ts`
- Modify: `services/src/broker/migrate.ts`
- Create: `services/src/broker/decision-log.test.ts`

- [ ] **Step 1: Write the end-to-end failing test**

Write `services/src/broker/decision-log.test.ts`:

```ts
import { test, expect } from "bun:test";
import { streamWithMigration } from "./migrate";
import { InMemoryRegistry } from "../registry/in-memory";
import { defaultTrust } from "../trust/trust";
import type { SettlementAdapter, PaidCompute, SettlementStatus } from "../settlement/adapter";
import { SpendCapError } from "../settlement/spend-policy";
import type { DecideClient } from "../runtime/decide";
import type { Soul, Policy } from "../runtime/types";
import type { Provider } from "../domain";

const soul: Soul = { schema: "soul/v1", version: "9.9.9", name: "Broker", body: "s" };
const policy: Policy = { schema: "policy/v1", version: "0.0.1", body: "p" };

// A url-keyed fake: payForCompute throws for any url containing a "down" marker, otherwise
// pays and enforces the spend cap. Models a dead provider endpoint with a healthy wallet.
function urlAdapter(downMarkers: string[], pricePerChargeAtomic = 100n, capAtomic = 1_000_000n): SettlementAdapter {
  let spent = 0n;
  let seq = 0;
  const refs = new Set<string>();
  return {
    buyerAddress: "0xBROKER",
    async ensureFunded() { return { deposited: false }; },
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

test("a soul-driven migrate persists a structured decision log", async () => {
  const reg = new InMemoryRegistry();
  const baseP = { ownerWallet: "0x0", resourceType: "GPU" as const, region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 5 };
  const a = await reg.registerProvider({ ...baseP, alias: "A", endpointUrl: "http://aaa", computeScore: 99 });
  const b = await reg.registerProvider({ ...baseP, alias: "B", endpointUrl: "http://bbb", computeScore: 80 });
  const rent = await reg.createRent({ name: "r", userId: "u1", spec: { resourceType: "GPU", region: null }, autonomyArmed: true });
  const settlement = urlAdapter(["aaa"]); // A is dead from the first charge

  const client: DecideClient = {
    propose: async () => [{ action: "migrate", target: b.id, score: 0.9, rationale: ["A degraded, B healthy"], userExplanation: "moving to B" }],
  };

  const result = await streamWithMigration(
    rent,
    a as Provider,
    { registry: reg, settlement, degradation: { soul, policy, client } },
    { maxUnits: 3, maxMigrations: 1, holdBudget: { maxRetries: 1, maxDurationMs: 60_000, maxExtraSpend: 10_000n } },
  );

  expect(result.migrations).toBe(1);
  const logs = await reg.listDecisionLogs(rent.id);
  expect(logs.length).toBeGreaterThanOrEqual(1);
  const last = logs.at(-1);
  expect(last?.soulVersion).toBe("9.9.9");
  expect(last?.policyVersion).toBe("0.0.1");
  expect(last?.chosenAction).toEqual({ action: "migrate", target: b.id });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/broker/decision-log.test.ts`
Expected: FAIL — `listDecisionLogs` returns `[]` because `streamWithMigration` records only text decisions, not structured logs (and `decideMigrateOrHold` does not yet return a `log`).

- [ ] **Step 3: Return the `DecisionLog` from `decideMigrateOrHold`**

In `services/src/broker/degradation.ts`:

Add `buildDecisionLog` and `DecisionLog` to the runtime imports. Change the top imports:

```ts
import { decide, type DecideClient } from "../runtime/decide";
import { selectProposal, type Validation } from "../runtime/select";
import { RetryLeash } from "../runtime/budget";
import { buildDecisionLog } from "../runtime/log";
import type { Soul, Policy, DecisionContext, ActionSpec, Proposal, DecisionLog } from "../runtime/types";
```

Add `log: DecisionLog` to every `DegradationChoice` variant:

```ts
export type DegradationChoice =
  | { action: "hold"; rationale: string; log: DecisionLog }
  | { action: "migrate"; target: Provider; rationale: string; log: DecisionLog }
  | { action: "fallback"; rationale: string; log: DecisionLog };
```

Replace the selection + return block at the end of `decideMigrateOrHold`. Change:

```ts
  const { chosen } = selectProposal(decision, validate);
  if (!chosen) return { action: "fallback", rationale: "no proposal passed validation" };

  const stamp = `[soul ${decision.soulVersion}/policy ${decision.policyVersion}${decision.usedFallback ? "; deterministic fallback" : ""}]`;
  if (chosen.action === "hold") {
    return { action: "hold", rationale: `${chosen.userExplanation} ${stamp}` };
  }
  const target = (chosen.target ? byId.get(chosen.target) : args.candidates[0])!; // validated non-null above
  return { action: "migrate", target, rationale: `${chosen.userExplanation} ${stamp}` };
```

to:

```ts
  const selection = selectProposal(decision, validate);
  const log = buildDecisionLog(decision, context, selection);
  const { chosen } = selection;
  if (!chosen) return { action: "fallback", rationale: "no proposal passed validation", log };

  const stamp = `[soul ${decision.soulVersion}/policy ${decision.policyVersion}${decision.usedFallback ? "; deterministic fallback" : ""}]`;
  if (chosen.action === "hold") {
    return { action: "hold", rationale: `${chosen.userExplanation} ${stamp}`, log };
  }
  const target = (chosen.target ? byId.get(chosen.target) : args.candidates[0])!; // validated non-null above
  return { action: "migrate", target, rationale: `${chosen.userExplanation} ${stamp}`, log };
```

- [ ] **Step 4: Persist the log in `streamWithMigration`**

In `services/src/broker/migrate.ts`, in the soul-decision block, replace the two `recordDecision` calls with `recordDecisionLog`.

Change the hold branch:

```ts
      if (choice.action === "hold") {
        await registry.recordDecision({ rentId: rent.id, candidates: [{ providerId: provider.id, rank: 0 }], chosenProviderId: provider.id, rationale: `hold ${provider.id}: ${choice.rationale}` });
        continue; // another bounded leg on the same provider
      }
```

to:

```ts
      if (choice.action === "hold") {
        await registry.recordDecisionLog(rent.id, choice.log);
        continue; // another bounded leg on the same provider
      }
```

Change the migrate branch:

```ts
      if (choice.action === "migrate") {
        if (migrations >= maxMigrations) return result("unhealthy", `migration cap reached after ${provider.id} degraded`);
        await registry.recordDecision({ rentId: rent.id, candidates: [{ providerId: choice.target.id, rank: 0 }], chosenProviderId: choice.target.id, rationale: `migrate ${provider.id} -> ${choice.target.id}: ${choice.rationale}` });
        await registry.updateRent(rent.id, { providerId: choice.target.id });
        used.add(choice.target.id);
        provider = choice.target;
        migrations++;
        continue;
      }
```

to:

```ts
      if (choice.action === "migrate") {
        if (migrations >= maxMigrations) return result("unhealthy", `migration cap reached after ${provider.id} degraded`);
        await registry.recordDecisionLog(rent.id, choice.log);
        await registry.updateRent(rent.id, { providerId: choice.target.id });
        used.add(choice.target.id);
        provider = choice.target;
        migrations++;
        continue;
      }
```

(The deterministic fallback block lower down keeps its `recordDecision` text call: it is not a soul decision and has no structured log.)

- [ ] **Step 5: Run the targeted tests**

Run: `cd services && bun test src/broker/decision-log.test.ts src/broker/degradation.test.ts src/broker/migrate.test.ts`
Expected: PASS. The existing `degradation.test.ts` still passes because `log` is additive (those tests assert only `action`/`target`). `migrate.test.ts` still passes because its tests do not pass `degradation` deps (they exercise the deterministic path, which is unchanged).

- [ ] **Step 6: Commit**

```bash
git add services/src/broker/degradation.ts services/src/broker/migrate.ts services/src/broker/decision-log.test.ts
git commit -m "feat(broker): persist structured DecisionLog on soul-driven migrate/hold"
```

---

## Task 6: Wrap-up

- [ ] **Step 1: Full suite + type-check**

Run: `cd services && bun test && bunx tsc --noEmit`
Expected: all tests pass (the prior suite minus the deleted `llm-rank` tests, plus `rank-decide`, the contract decision-log test, and `decision-log.test.ts`), tsc exit 0.

- [ ] **Step 2: No frontend touched**

This plan changes only `services/`. `src/` is untouched.

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch (verify tests, present options, execute choice). Default to merging `feat/ranking-decide-decisionlog` to `main` once green.

- [ ] **Step 4: Update the project memory**

Update `autonomous-compute-broker-project.md`: Plan 10 DONE and merged — ranking is now a soul-driven `decide()` instance (`rank-decide.ts`, deterministic `scoreProviders` the fallback); the hardcoded `llm-rank.ts` is retired and the gated probe is now `rank:soul`. Structured `DecisionLog` is persisted to `rent_decisions` (additive migration `0004`, `recordDecisionLog`/`listDecisionLogs`) for soul-driven migrate/hold. Note what's still pending: the on-chain `integration:roundtrip` proof on Arc, the deferred `0003_drop_stake_amount.sql`, wiring `rankDecideStrategy` as the default broker ranker in scripts/`runRent`, and the product-UI layer.

---

## Self-Review Notes

**Spec coverage:** Implements the spec's two named realignments. "Ranking becomes a `decide()` instance whose heuristics come from the soul, not a hardcoded prompt; the deterministic `scoreProviders` stays as the fallback" → Task 1 (`rankDecideStrategy` assembles policy+soul+context via the runtime; `decide()`'s fallback is `scoreProviders`) and Task 2 (the hardcoded `llm-rank.ts` is deleted, and `rank:soul` proves the soul actually drives the ranking). The versioned, attributable decision log → Tasks 3-5 persist the full `DecisionLog` (decision id + soul/policy versions + proposals + chosen action + rejected reason + fallback flag) so a later behavior change is attributable to a soul or policy version.

**Placeholder scan:** No TBDs. Every file edit shows exact before/after text. The one networked step (apply additive migration `0004` to the live DB) names the project ref and tool and is non-destructive (`add column if not exists` only), with a stated handoff fallback. Deletions are explicit `rm` of three named files, justified by the grep that proves nothing else imports them.

**Type consistency:** `RankStrategy` (Plan 5, `matching.ts`) is what `rankDecideStrategy` returns (Task 1) and what `matchProviders`/`runRent` already accept. `DecideClient`/`Soul`/`Policy`/`DecisionContext`/`ActionSpec`/`Proposal`/`Decision` come from the existing runtime (`decide.ts`/`types.ts`); `decide()`'s `fallback: () => Proposal[]` is satisfied by the `scoreProviders`-derived proposals. `DecisionLog` (Plan 7, `types.ts`) is produced by `buildDecisionLog(decision, context, selection)` (Plan 7, `log.ts`) inside `decideMigrateOrHold` (Task 5), carried on every `DegradationChoice` variant (Task 5), and consumed by `recordDecisionLog(rentId, log)` / produced by `listDecisionLogs(rentId)` (Tasks 3-4) on both registries. The Supabase mapper derives the legacy `candidates`/`chosen_provider_id`/`rationale` columns from the log so one `rent_decisions` table serves both the legacy and structured audits; `listDecisionLogs` filters to rows where `decision_id is not null`.

**Behavior preserved:** `decideMigrateOrHold` gains a `log` field but its `action`/`target`/`rationale` outputs are unchanged, so the existing `degradation.test.ts` passes untouched. `streamWithMigration`'s soul branches swap `recordDecision` text for `recordDecisionLog`; the deterministic (no-deps) path is unchanged, so `migrate.test.ts` and `runner.test.ts` (which never pass `degradation` deps) pass untouched. Removing `llm-rank.ts` removes only code nothing else imported (proved by grep in Task 2). The default `runRent` ranker stays `deterministicRank`; the soul-driven ranker is opt-in via `deps.rank`, so offline runner tests stay deterministic.

**Out of scope:** Persisting a structured log for the *ranking* decision (a ranking is an ordering, not a validated action-selection, so the `DecisionLog` shape does not fit; ranking keeps its `recordDecision` rationale). Wiring `rankDecideStrategy` as the default ranker in `runRent`/scripts (a follow-up; it stays opt-in here). The on-chain `integration:roundtrip` proof and the deferred `0003` stake-column drop.
```