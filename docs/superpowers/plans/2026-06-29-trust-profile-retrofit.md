# Trust Profile Retrofit Implementation Plan (Plan 9 of N)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mandatory-stake trust check (`Provider.stakeAmount > 0`) with a pluggable `TrustProfile { tier, signals }` and a deterministic tier gate (`provider.tier >= rent.requiredTrustTier`, default `Community`), so trust becomes future-proof (tiers can later be earned by stake/slash, verification, or SLA) without touching the gate again.

**Architecture:** A new foundational `services/src/trust/` module owns the `Tier` ordering, the `TrustProfile` shape, the `meetsTier` gate, and a `defaultTrust()` builder. `Provider.stakeAmount: number` becomes `Provider.trust: TrustProfile`; `RentSpec` gains an optional `requiredTrustTier?: Tier` (defaulted to `Community` at the gate, so the dozens of existing `{ resourceType, region }` rent specs need no change). The two existing gates (`hardFilter` in `scoring.ts`, `revalidateProvider` in `guardrails.ts`) swap their `stake` check for `meetsTier`. The Supabase row mapping and a new migration carry `trust_tier` + `trust_signals` (and `rents.required_trust_tier`). The `InMemoryRegistry` needs no structural change (it spreads `NewProvider`). Everything else is a mechanical fixture sweep (`stakeAmount: N` → `trust: defaultTrust()`).

**Tech Stack:** Bun + TypeScript, `bun test`. `noUncheckedIndexedAccess` is on, so guard index access. Builds on Plans 1-8.

**Spec:** [`docs/superpowers/specs/2026-06-29-soul-policy-agent-runtime-design.md`](../specs/2026-06-29-soul-policy-agent-runtime-design.md) — the "TrustProfile" block (tier + signals, `provider.tier >= rent.requiredTrustTier`, "Bonded" defined generically, why dropping mandatory stake is safe), and "How this realigns the existing code (Plan 6)" bullet on `Provider.stakeAmount` → `Provider.trust`.

**Naming:** entity is `Rent`, billing unit is `Charge`, provider compute endpoint is `/compute`. No `job`/`tick` anywhere in `services/` (this plan also renames the leftover `job` parameter in `scoring.ts` to `spec`).

**Branch:** `git checkout -b feat/trust-profile off main`.

**Scope note (read first):** This plan does the trust retrofit only. The memory's "Plan 9" also listed re-expressing **ranking** as a `decide()` instance and **persisting `DecisionLog`** to `rent_decisions`. Migrate/hold-as-`decide()` already shipped in Plan 8 (`degradation.ts`). Ranking-as-`decide()` and `DecisionLog` persistence are carved into **Plan 10** because they touch the runtime + a new DB table and are independently shippable. The tier gate built here is the prerequisite the Plan 10 validator reuses.

---

## File Structure

**Created:**
- `services/src/trust/trust.ts` — `Tier`, `TIERS`, `TrustProfile`, `DEFAULT_TIER`, `meetsTier`, `defaultTrust`
- `services/src/trust/trust.test.ts`
- `services/supabase/migrations/0002_trust.sql` — add `providers.trust_tier`/`trust_signals`, `rents.required_trust_tier`; drop `providers.stake_amount`

**Modified:**
- `services/src/domain.ts` — `Provider.stakeAmount` → `Provider.trust`; `RentSpec` gains `requiredTrustTier?`
- `services/src/scoring.ts` — `hardFilter` gates on `meetsTier`; rename `job` param to `spec`
- `services/src/scoring.test.ts` — tier-gate tests replace stake tests
- `services/src/broker/guardrails.ts` — `revalidateProvider` gates on `meetsTier`
- `services/src/broker/guardrails.test.ts` — tier-gate test replaces stake test
- `services/src/registry/contract.ts` — fixture uses `trust`; add a tier round-trip test
- `services/src/registry/supabase.ts` — map `trust_tier`/`trust_signals` + `required_trust_tier`
- `services/src/broker/matching.test.ts`, `migrate.test.ts`, `stream.test.ts`, `degradation.test.ts`, `runner.test.ts`, `llm-rank.test.ts` — fixture sweep
- `services/scripts/integration-roundtrip.ts`, `seed-providers.ts`, `broker-roundtrip.ts`, `services/probes/llm-rank.ts` — fixture sweep

---

## Task 1: The trust module

A pure, foundational module (no imports from `domain` — `domain` will import *it*). Tier ordering, the gate, and a default-profile builder used everywhere a `Provider` literal is constructed.

**Files:**
- Create: `services/src/trust/trust.ts`
- Test: `services/src/trust/trust.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/trust/trust.test.ts`:

```ts
import { test, expect } from "bun:test";
import { TIERS, DEFAULT_TIER, meetsTier, defaultTrust } from "./trust";

test("TIERS go from open to strongest and DEFAULT_TIER is the open one", () => {
  expect(TIERS).toEqual(["Community", "Verified", "Bonded", "Enterprise"]);
  expect(DEFAULT_TIER).toBe("Community");
});

test("meetsTier: equal and higher pass, lower fails", () => {
  expect(meetsTier("Community", "Community")).toBe(true);
  expect(meetsTier("Bonded", "Verified")).toBe(true);
  expect(meetsTier("Enterprise", "Community")).toBe(true);
  expect(meetsTier("Community", "Verified")).toBe(false);
  expect(meetsTier("Verified", "Bonded")).toBe(false);
});

test("defaultTrust builds a Community profile with neutral signals", () => {
  const t = defaultTrust();
  expect(t.tier).toBe("Community");
  expect(t.signals).toEqual({ uptime: 1, successfulRentals: 0, health: "healthy", verification: false });
});

test("defaultTrust accepts a tier override and returns a fresh object each call", () => {
  expect(defaultTrust("Bonded").tier).toBe("Bonded");
  expect(defaultTrust()).not.toBe(defaultTrust());
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/trust/trust.test.ts`
Expected: FAIL — `Cannot find module "./trust"`.

- [ ] **Step 3: Write the module**

Write `services/src/trust/trust.ts`:

```ts
// Trust is a pluggable profile, not a hardcoded stake check. The runtime reasons only
// over `tier` (a deterministic gate); the broker soul reasons over `signals`. How a
// provider reaches a tier (verification, collateral, SLA) is not the runtime's concern.

export const TIERS = ["Community", "Verified", "Bonded", "Enterprise"] as const;
export type Tier = (typeof TIERS)[number];

export const DEFAULT_TIER: Tier = "Community";

export interface TrustProfile {
  tier: Tier;
  signals: {
    uptime: number;            // observed reliability (0..1)
    successfulRentals: number; // history
    health: "healthy" | "degraded";
    verification: boolean;     // identity / hardware verified
    collateral?: { amount: number; asset: "USDC" }; // optional economic bond (a Bonded signal)
  };
}

// The whole trust gate: does a provider's tier meet (or exceed) what a rent requires?
export function meetsTier(have: Tier, need: Tier): boolean {
  return TIERS.indexOf(have) >= TIERS.indexOf(need);
}

// A neutral Community profile. Used wherever a Provider is constructed without a richer
// profile (seeds, tests, the default a registry assigns). Returns a fresh object so
// callers can mutate signals without aliasing.
export function defaultTrust(tier: Tier = DEFAULT_TIER): TrustProfile {
  return { tier, signals: { uptime: 1, successfulRentals: 0, health: "healthy", verification: false } };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/trust/trust.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/trust/trust.ts services/src/trust/trust.test.ts
git commit -m "feat(trust): TrustProfile + tier gate (meetsTier, defaultTrust)"
```

---

## Task 2: Domain types + the two gates

Swap `Provider.stakeAmount` for `Provider.trust`, add the optional `RentSpec.requiredTrustTier`, and flip both gates (`hardFilter`, `revalidateProvider`) from the stake check to `meetsTier`. This is the behavioral heart of the plan.

**Note on incremental compilation:** changing the `Provider` type breaks every `Provider`/`NewProvider` literal in the suite at once. That is expected and gets cleaned up in Task 3 (registry) and Task 4 (sweep). `bun test <file>` compiles per-file, so the scoped runs below still pass before the whole suite type-checks. The global `bunx tsc --noEmit` gate lives at the end of Task 4.

**Files:**
- Modify: `services/src/domain.ts`
- Modify: `services/src/scoring.ts`
- Modify: `services/src/scoring.test.ts`
- Modify: `services/src/broker/guardrails.ts`
- Modify: `services/src/broker/guardrails.test.ts`

- [ ] **Step 1: Change the domain types**

In `services/src/domain.ts`, add the import at the top of the file (above `export type ResourceType`):

```ts
import type { Tier, TrustProfile } from "./trust/trust";
```

In the `Provider` type, replace this line:

```ts
  stakeAmount: number;
```

with:

```ts
  trust: TrustProfile;
```

In the `RentSpec` type, change:

```ts
export type RentSpec = {
  resourceType: ResourceType;
  region: string | null;
};
```

to:

```ts
export type RentSpec = {
  resourceType: ResourceType;
  region: string | null;
  requiredTrustTier?: Tier; // default Community (open); the gate applies the default
};
```

- [ ] **Step 2: Rewrite the scoring test for the tier gate**

Replace the entire contents of `services/src/scoring.test.ts` with:

```ts
import { test, expect } from "bun:test";
import { hardFilter, scoreProviders } from "./scoring";
import type { Provider, RentSpec } from "./domain";
import { defaultTrust } from "./trust/trust";

const base = { alias: "n", ownerWallet: "0x0", endpointUrl: "http://x", specs: {} };
const providers: Provider[] = [
  { id: "A", ...base, resourceType: "GPU", region: "US-East", online: true, trust: defaultTrust(), pricePerCharge: 0.000006, computeScore: 70, avgLatencyMs: 5 },
  { id: "B", ...base, resourceType: "GPU", region: "EU-West", online: true, trust: defaultTrust(), pricePerCharge: 0.000004, computeScore: 92, avgLatencyMs: 8 },
  { id: "C", ...base, resourceType: "GPU", region: "US-East", online: false, trust: defaultTrust(), pricePerCharge: 0.000003, computeScore: 99, avgLatencyMs: 4 },
  { id: "D", ...base, resourceType: "CPU", region: "US-East", online: true, trust: defaultTrust(), pricePerCharge: 0.000002, computeScore: 80, avgLatencyMs: 4 },
];

const spec: RentSpec = { resourceType: "GPU", region: null };

test("hardFilter drops offline and wrong-type providers", () => {
  const kept = hardFilter(providers, spec).map((p) => p.id);
  expect(kept).toEqual(["A", "B"]); // C offline, D wrong type
});

test("hardFilter drops providers below the required trust tier", () => {
  const mixed: Provider[] = [
    { id: "lo", ...base, resourceType: "GPU", region: "US-East", online: true, trust: defaultTrust("Community"), pricePerCharge: 0.000004, computeScore: 90, avgLatencyMs: 5 },
    { id: "hi", ...base, resourceType: "GPU", region: "US-East", online: true, trust: defaultTrust("Bonded"), pricePerCharge: 0.000006, computeScore: 80, avgLatencyMs: 5 },
  ];
  const kept = hardFilter(mixed, { resourceType: "GPU", region: null, requiredTrustTier: "Bonded" }).map((p) => p.id);
  expect(kept).toEqual(["hi"]); // Community is below Bonded
});

test("scoreProviders ranks by a weighted blend (cheaper + higher score first)", () => {
  const ranked = scoreProviders(hardFilter(providers, spec), spec).map((p) => p.id);
  expect(ranked[0]).toBe("B"); // cheaper and higher score than A
});
```

- [ ] **Step 3: Rewrite `scoring.ts` to gate on tier**

Replace the entire contents of `services/src/scoring.ts` with:

```ts
import type { Provider, RentSpec } from "./domain";
import { meetsTier, DEFAULT_TIER } from "./trust/trust";

export function hardFilter(providers: Provider[], spec: RentSpec): Provider[] {
  const need = spec.requiredTrustTier ?? DEFAULT_TIER;
  return providers.filter(
    (p) =>
      p.online &&
      meetsTier(p.trust.tier, need) &&
      p.resourceType === spec.resourceType &&
      (spec.region === null || p.region === spec.region),
  );
}

// Lower price is better; higher score is better; lower latency is better.
// Normalize each dimension across the candidate set, then weight.
export function scoreProviders(providers: Provider[], _spec: RentSpec): Provider[] {
  if (providers.length === 0) return [];
  const prices = providers.map((p) => p.pricePerCharge);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const norm = (v: number, lo: number, hi: number) =>
    hi === lo ? 1 : (v - lo) / (hi - lo);

  function rank(p: Provider): number {
    const priceTerm = 1 - norm(p.pricePerCharge, minP, maxP); // cheaper => higher
    const scoreTerm = p.computeScore / 100;
    const latencyTerm = 1 - norm(p.avgLatencyMs, 0, 20);
    return 0.4 * priceTerm + 0.45 * scoreTerm + 0.15 * latencyTerm;
  }

  return [...providers].sort((a, b) => rank(b) - rank(a));
}
```

- [ ] **Step 4: Run the scoring test**

Run: `cd services && bun test src/scoring.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Rewrite the guardrails test for the tier gate**

Replace the entire contents of `services/src/broker/guardrails.test.ts` with:

```ts
import { test, expect } from "bun:test";
import { revalidateProvider } from "./guardrails";
import type { Provider } from "../domain";
import { defaultTrust } from "../trust/trust";

const ok: Provider = {
  id: "p", alias: "n", ownerWallet: "0x0", endpointUrl: "http://x", resourceType: "GPU",
  region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.000006,
  computeScore: 90, avgLatencyMs: 5,
};

test("passes a healthy, in-tier, matching provider", () => {
  expect(revalidateProvider(ok, { resourceType: "GPU", region: null })).toEqual({ ok: true });
});

test("rejects an offline provider", () => {
  expect(revalidateProvider({ ...ok, online: false }, { resourceType: "GPU", region: null }).ok).toBe(false);
});

test("rejects a provider below the required trust tier", () => {
  const d = revalidateProvider(ok, { resourceType: "GPU", region: null, requiredTrustTier: "Bonded" });
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.reason).toMatch(/tier/);
});

test("rejects a resource-type or region mismatch", () => {
  expect(revalidateProvider(ok, { resourceType: "CPU", region: null }).ok).toBe(false);
  expect(revalidateProvider(ok, { resourceType: "GPU", region: "EU-West" }).ok).toBe(false);
});
```

- [ ] **Step 6: Rewrite `guardrails.ts` to gate on tier**

Replace the entire contents of `services/src/broker/guardrails.ts` with:

```ts
import type { Provider, RentSpec } from "../domain";
import { meetsTier, DEFAULT_TIER } from "../trust/trust";

export type GuardResult = { ok: true } | { ok: false; reason: string };

// Re-validate the AI's pick against the hard requirements before any money moves.
// The spend/balance guard lives in the settlement adapter (checkSpend +
// ensureFunded); this covers liveness, trust tier, and requirement fit.
export function revalidateProvider(p: Provider, spec: RentSpec): GuardResult {
  if (!p.online) return { ok: false, reason: `provider ${p.id} is offline` };
  const need = spec.requiredTrustTier ?? DEFAULT_TIER;
  if (!meetsTier(p.trust.tier, need)) {
    return { ok: false, reason: `provider ${p.id} tier ${p.trust.tier} is below required ${need}` };
  }
  if (p.resourceType !== spec.resourceType) {
    return { ok: false, reason: `provider ${p.id} is ${p.resourceType}, need ${spec.resourceType}` };
  }
  if (spec.region !== null && p.region !== spec.region) {
    return { ok: false, reason: `provider ${p.id} is in ${p.region}, need ${spec.region}` };
  }
  return { ok: true };
}
```

- [ ] **Step 7: Run the guardrails test**

Run: `cd services && bun test src/broker/guardrails.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add services/src/domain.ts services/src/scoring.ts services/src/scoring.test.ts services/src/broker/guardrails.ts services/src/broker/guardrails.test.ts
git commit -m "feat(trust): Provider.trust + tier gate in hardFilter/revalidateProvider"
```

---

## Task 3: Registry retrofit (mapping, migration, contract test)

`InMemoryRegistry` needs no change (it spreads `NewProvider`, which now carries `trust`). The Supabase mapping and the schema need the new columns, and the shared contract suite needs its fixture updated plus a tier round-trip test that runs against both registries (including the live DB).

**Files:**
- Modify: `services/src/registry/contract.ts`
- Modify: `services/src/registry/supabase.ts`
- Create: `services/supabase/migrations/0002_trust.sql`

- [ ] **Step 1: Update the contract fixture and add a tier round-trip test**

In `services/src/registry/contract.ts`, add this import after the existing imports at the top:

```ts
import { defaultTrust } from "../trust/trust";
```

In the `sampleProvider` literal, replace this line:

```ts
  stakeAmount: 100,
```

with:

```ts
  trust: defaultTrust(),
```

Then add this test inside the `describe(...)` block, right after the existing `registerProvider assigns an id...` test:

```ts
    test("a provider's trust tier round-trips", async () => {
      const p = await reg.registerProvider({ ...sampleProvider, alias: "bonded-1", trust: defaultTrust("Bonded") });
      const fetched = await reg.getProvider(p.id);
      expect(fetched?.trust.tier).toBe("Bonded");
      expect(fetched?.trust.signals.health).toBe("healthy");
    }, T);
```

- [ ] **Step 2: Run the in-memory contract**

Run: `cd services && bun test src/registry/in-memory.test.ts`
Expected: PASS (the in-memory contract, including the new tier round-trip test). If the in-memory contract file is named differently, find it with `grep -rl "registryContract(\"in-memory\"" src/registry` and run that file.

- [ ] **Step 3: Map the new columns in `supabase.ts`**

In `services/src/registry/supabase.ts`, add this import after the existing `import type { Registry, ... }` line:

```ts
import { defaultTrust, type Tier, type TrustProfile } from "../trust/trust";
```

In `toProvider`, replace this line:

```ts
    stakeAmount: Number(r.stake_amount),
```

with:

```ts
    trust: {
      tier: (r.trust_tier as Tier | null) ?? "Community",
      signals: (r.trust_signals as TrustProfile["signals"] | null) ?? defaultTrust().signals,
    },
```

In `toRent`, change the `spec` line from:

```ts
    spec: { resourceType: r.resource_type as Rent["spec"]["resourceType"], region: (r.region as string) ?? null },
```

to:

```ts
    spec: {
      resourceType: r.resource_type as Rent["spec"]["resourceType"],
      region: (r.region as string) ?? null,
      requiredTrustTier: (r.required_trust_tier as Tier | null) ?? "Community",
    },
```

In `registerProvider`, replace this line inside the `.insert({ ... })`:

```ts
        online: p.online, stake_amount: p.stakeAmount, price_per_charge: p.pricePerCharge,
```

with:

```ts
        online: p.online, trust_tier: p.trust.tier, trust_signals: p.trust.signals,
        price_per_charge: p.pricePerCharge,
```

In `createRent`, replace this line inside the `.insert({ ... })`:

```ts
        resource_type: r.spec.resourceType, region: r.spec.region,
```

with:

```ts
        resource_type: r.spec.resourceType, region: r.spec.region,
        required_trust_tier: r.spec.requiredTrustTier ?? "Community",
```

- [ ] **Step 4: Write the migration**

Write `services/supabase/migrations/0002_trust.sql`:

```sql
-- prime-compute trust retrofit (Plan 9): stake_amount -> TrustProfile {tier, signals}

alter table providers
  add column if not exists trust_tier text not null default 'Community'
    check (trust_tier in ('Community','Verified','Bonded','Enterprise')),
  add column if not exists trust_signals jsonb not null default
    '{"uptime":1,"successfulRentals":0,"health":"healthy","verification":false}';

alter table providers drop column if exists stake_amount;

alter table rents
  add column if not exists required_trust_tier text not null default 'Community'
    check (required_trust_tier in ('Community','Verified','Bonded','Enterprise'));
```

- [ ] **Step 5: Apply the migration to the live PrimeBot DB**

The registry lives in the existing PrimeBot Supabase project (ref `xwxuqcougmanzonypoym`). Apply `0002_trust.sql` against it so the live `SupabaseRegistry` contract passes. Use the Supabase MCP `apply_migration` (name `0002_trust`, the SQL above) on project `xwxuqcougmanzonypoym`, or run the SQL in the project's SQL editor. This is the one networked step in this task.

- [ ] **Step 6: Run the live Supabase contract**

With `services/.env` present (service-role key), run the live contract file (find it with `grep -rl "registryContract(\"supabase" src/registry`):

Run: `cd services && bun test src/registry/supabase.test.ts`
Expected: PASS (the live contract, including the tier round-trip; reset DELETEs the 5 registry tables each run, which is the established behavior). If the live DB is unreachable or `.env` is absent, this is a handoff — note it and proceed; the in-memory contract already proves the mapping shape.

- [ ] **Step 7: Commit**

```bash
git add services/src/registry/contract.ts services/src/registry/supabase.ts services/supabase/migrations/0002_trust.sql
git commit -m "feat(trust): registry maps trust_tier/trust_signals + required_trust_tier; migration 0002"
```

---

## Task 4: Sweep the remaining fixtures + global type-check

Every remaining `Provider`/`NewProvider` literal still says `stakeAmount: N`. Replace each with `trust: defaultTrust()` and add the `defaultTrust` import to each file. One file (`matching.test.ts`) also names `"stakeAmount"` in an `Omit<...>` key list that must become `"trust"`. After the sweep, the whole suite and `tsc` must be green.

**Files (each gets `stakeAmount: N` → `trust: defaultTrust()` and a `defaultTrust` import):**
- `services/src/broker/matching.test.ts` (also fix the `Omit` key)
- `services/src/broker/migrate.test.ts`
- `services/src/broker/stream.test.ts`
- `services/src/broker/degradation.test.ts`
- `services/src/broker/runner.test.ts`
- `services/src/broker/llm-rank.test.ts`
- `services/scripts/integration-roundtrip.ts`
- `services/scripts/seed-providers.ts`
- `services/scripts/broker-roundtrip.ts`
- `services/probes/llm-rank.ts`

- [ ] **Step 1: Find every remaining site**

Run: `cd services && grep -rn "stakeAmount" src/ scripts/ probes/ --include="*.ts"`
Expected: only the ten files above (Tasks 1-3 already cleared `domain.ts`, `scoring*.ts`, `guardrails*.ts`, `contract.ts`, `supabase.ts`).

- [ ] **Step 2: Fix the `matching.test.ts` Omit key**

In `services/src/broker/matching.test.ts`, change:

```ts
const base: Omit<NewProvider, "alias" | "resourceType" | "region" | "online" | "stakeAmount" | "pricePerCharge" | "computeScore"> = {
```

to:

```ts
const base: Omit<NewProvider, "alias" | "resourceType" | "region" | "online" | "trust" | "pricePerCharge" | "computeScore"> = {
```

- [ ] **Step 3: Sweep each file**

In each of the ten files: add `import { defaultTrust } from "<rel>/trust/trust";` near the other imports (relative path: `../trust/trust` for files in `src/broker/`; `../src/trust/trust` for files in `scripts/` and `probes/`). Then replace every `stakeAmount: <number>,` with `trust: defaultTrust(),` (the numeric value is meaningless now; all of them were positive "has stake" markers, so the neutral Community profile is the faithful translation).

For reference, the exact occurrences are:
- `matching.test.ts`: lines registering A/B/C/D (4 sites)
- `migrate.test.ts`: the `seedTwo` and single-provider helpers (8 sites)
- `stream.test.ts`: the `provider` literal `base`/spread (1 site, line ~10)
- `degradation.test.ts`: the provider literal (1 site, line ~15)
- `runner.test.ts`: three `registerProvider` calls (3 sites)
- `llm-rank.test.ts`: the `p()` helper literal (1 site, line ~8)
- `integration-roundtrip.ts`: provA/provB (2 sites)
- `seed-providers.ts`: four seed rows (4 sites)
- `broker-roundtrip.ts`: one provider (1 site)
- `probes/llm-rank.ts`: alpha/bravo/charlie (3 sites)

- [ ] **Step 4: Run the full suite**

Run: `cd services && bun test`
Expected: all tests pass (the prior 106 minus the removed stake assertions, plus Task 1's 4 trust tests and Task 3's tier round-trip). No `stakeAmount` failures.

- [ ] **Step 5: Global type-check**

Run: `cd services && grep -rn "stakeAmount" src/ scripts/ probes/ --include="*.ts"; bunx tsc --noEmit`
Expected: the grep prints nothing (zero `stakeAmount` left in `services/`); `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add services/src/broker/matching.test.ts services/src/broker/migrate.test.ts services/src/broker/stream.test.ts services/src/broker/degradation.test.ts services/src/broker/runner.test.ts services/src/broker/llm-rank.test.ts services/scripts/integration-roundtrip.ts services/scripts/seed-providers.ts services/scripts/broker-roundtrip.ts services/probes/llm-rank.ts
git commit -m "refactor(trust): sweep remaining stakeAmount fixtures to defaultTrust()"
```

---

## Task 5: Wrap-up

- [ ] **Step 1: Full suite + type-check (final gate)**

Run: `cd services && bun test && bunx tsc --noEmit`
Expected: all tests pass, `tsc` exit 0.

- [ ] **Step 2: No frontend touched**

This plan changes only `services/`. `src/` is untouched, so no frontend lint/build is needed.

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch (verify tests, present options, execute choice). Default to merging `feat/trust-profile` to `main` once green.

- [ ] **Step 4: Update the project memory**

Update `autonomous-compute-broker-project.md`: Plan 9 (trust retrofit) DONE and merged — `Provider.stakeAmount` is gone, replaced by `Provider.trust: TrustProfile`; `hardFilter`/`revalidateProvider` gate on `meetsTier(tier, requiredTrustTier)` (default `Community`); `RentSpec.requiredTrustTier?` added; Supabase migration `0002_trust` applied to PrimeBot. Note Plan 10 is now the remaining runtime wiring: ranking-as-`decide()` instance + `DecisionLog` persistence to `rent_decisions`. Still pending from earlier: the on-chain `integration:roundtrip` run on Arc.

---

## Self-Review Notes

**Spec coverage:** Implements the spec's "TrustProfile" block exactly — the `{ tier, signals }` shape with `uptime`/`successfulRentals`/`health`/`verification`/optional `collateral` (Task 1), the deterministic `provider.tier >= rent.requiredTrustTier` gate via `meetsTier` (Tasks 1-2), `requiredTrustTier` default `Community` (Task 2, defaulted at the gate so existing specs need no change), and "Bonded defined generically" (it is just a tier in the ordering, no collateral logic in the gate). Realizes the "How this realigns the existing code" bullet: `Provider.stakeAmount` → `Provider.trust`; `hardFilter` and `revalidateProvider` stop gating on `stakeAmount > 0` and gate on tier instead; the spend/balance guards are untouched. Collateral is carried as an optional signal and never enters the gate or the scorer, honoring "never auto-boosts ranking." Ranking-as-`decide()` and `DecisionLog` persistence are explicitly carved to Plan 10 (scope note).

**Placeholder scan:** No TBDs. Every file edit gives the exact before/after text. The one networked step (apply migration `0002` to the live DB) names the project ref and the tool, with a stated handoff fallback. The sweep task lists each file, the exact import path per directory, the exact replacement, and a grep that must return empty as the completion check.

**Type consistency:** `Tier`/`TrustProfile`/`meetsTier`/`DEFAULT_TIER`/`defaultTrust` are defined once in `trust/trust.ts` (Task 1) and imported everywhere after (`domain.ts`, `scoring.ts`, `guardrails.ts`, `supabase.ts`, every test/script). `Provider.trust: TrustProfile` (Task 2) is what `defaultTrust()` returns (Task 1) and what `toProvider` builds (Task 3). `RentSpec.requiredTrustTier?: Tier` (Task 2) is read by both gates with the same `?? DEFAULT_TIER` default and persisted/restored as `required_trust_tier` (Task 3). `NewProvider = Omit<Provider, "id" | "computeScore"> & { computeScore? }` (unchanged) now requires `trust`, which is why the `matching.test.ts` `Omit` key list changes `"stakeAmount"` → `"trust"` (Task 4).

**Behavior preserved:** With every provider defaulting to `Community` and every rent defaulting to `requiredTrustTier = Community`, `meetsTier("Community","Community")` is `true`, so the gate admits exactly the providers the old `stakeAmount > 0` admitted for all existing tests (all of which used positive stake). The only assertions that change are the two that specifically tested "no stake" rejection, which become "below required tier" rejection. Ranking, streaming, migration, settlement, and the runner's terminal-status mapping are all untouched.

**Out of scope (Plan 10):** ranking re-expressed as a `decide()` instance reasoning from the soul (deterministic `scoreProviders` stays the fallback), and persisting the structured `DecisionLog` to a `rent_decisions`-backed table (today decisions are recorded only as `recordDecision` rationale text).
```