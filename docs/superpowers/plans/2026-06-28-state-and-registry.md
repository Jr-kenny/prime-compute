# State & Registry Implementation Plan (Plan 2 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared state layer every other piece reads from: the domain types, a `Registry` interface, an in-memory implementation for tests/dev, the Supabase schema, and a Supabase-backed implementation, plus a provider seed script.

**Architecture:** All persistence goes through one `Registry` interface so the backing store can later move on-chain (spec Approach 2) without touching callers. A reusable "registry contract" test suite pins the behavior; both `InMemoryRegistry` (unit tests, local dev) and `SupabaseRegistry` (real) must pass the same suite. Domain types live in one `src/domain.ts` shared by the scorer and the registry.

**Tech Stack:** Bun + TypeScript, `bun test`, `@supabase/supabase-js`, Supabase Postgres. Builds on the `services/` workspace from Plan 1.

**Spec:** [`docs/superpowers/specs/2026-06-28-autonomous-compute-broker-design.md`](../specs/2026-06-28-autonomous-compute-broker-design.md) — Data model + State + registry sections.

**Foundations:** [`docs/superpowers/foundations-report.md`](../foundations-report.md) (locked APIs/config from Plan 1).

**Branch:** `git checkout -b feat/state-registry` off `main`.

**Handoff note:** Tasks 1-3 and 7 run fully offline. Tasks 4-6 (Supabase schema + `SupabaseRegistry` + integration test) need a Supabase project (URL + service-role key in `services/.env`), provisionable via the Supabase MCP or a Supabase project. The integration test is skipped automatically when those env vars are absent, so the suite stays green offline.

---

## File Structure

**Created:**
- `services/src/domain.ts` — canonical domain types (Provider, Job, JobDecision, Tick, etc.)
- `services/src/registry/registry.ts` — the `Registry` interface + input types
- `services/src/registry/contract.ts` — reusable contract test suite (any Registry must pass)
- `services/src/registry/in-memory.ts` — `InMemoryRegistry`
- `services/src/registry/in-memory.test.ts` — runs the contract against `InMemoryRegistry`
- `services/src/registry/supabase.ts` — `SupabaseRegistry`
- `services/src/registry/supabase.test.ts` — runs the contract against a real Supabase (skipped if no env)
- `services/supabase/migrations/0001_init.sql` — schema (providers, jobs, job_decisions, ticks, settlements)
- `services/scripts/seed-providers.ts` — inserts demo providers as real rows

**Modified:**
- `services/src/scoring.ts` — import `Provider`/`JobSpec` from `./domain` instead of defining them locally
- `services/src/config.ts` — add optional `supabase` config (url + service key)
- `services/src/config.test.ts` — cover the optional supabase config
- `services/.env.example` — add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

---

## Task 1: Domain types + scorer refactor

**Files:**
- Create: `services/src/domain.ts`
- Modify: `services/src/scoring.ts`
- Test: existing `services/src/scoring.test.ts` must still pass

- [ ] **Step 1: Write the domain types**

Write `services/src/domain.ts`:

```ts
export type ResourceType = "GPU" | "CPU" | "Storage" | "Full Server";
export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export type Provider = {
  id: string;
  alias: string;
  ownerWallet: string;
  endpointUrl: string;
  resourceType: ResourceType;
  region: string;
  specs: Record<string, unknown>;
  online: boolean;
  stakeAmount: number;
  pricePerTick: number;
  computeScore: number;
  avgLatencyMs: number;
};

export type JobSpec = {
  resourceType: ResourceType;
  region: string | null;
};

export type Job = {
  id: string;
  name: string;
  userId: string;
  spec: JobSpec;
  estimatedUsage: number | null;
  autonomyArmed: boolean;
  status: JobStatus;
  providerId: string | null;
  totalCost: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
};

export type JobDecision = {
  id: string;
  jobId: string;
  candidates: { providerId: string; rank: number }[];
  chosenProviderId: string | null;
  rationale: string;
  createdAt: string;
};

export type Tick = {
  id: string;
  jobId: string;
  providerId: string;
  seq: number;
  amount: number; // atomic USDC units (6 decimals)
  authorizationRef: string | null;
  settled: boolean;
  settlementRef: string | null;
  createdAt: string;
};
```

- [ ] **Step 2: Point the scorer at the shared types**

Edit `services/src/scoring.ts`: delete the local `Provider` and `JobSpec` type
definitions and import them instead. Replace the top of the file:

```ts
import type { Provider, JobSpec } from "./domain";
```

Keep `hardFilter` and `scoreProviders` exactly as they are (they read a subset of
`Provider`, which still type-checks against the fuller shape). Update the
re-export line at the bottom if present so `Provider`/`JobSpec` are no longer
declared here. The scorer's logic does not change.

- [ ] **Step 3: Fix the scorer test's imports**

Edit `services/src/scoring.test.ts`: the test builds `Provider` objects inline.
Add the new required fields to each test provider so they satisfy the fuller type.
Replace the `providers` array with:

```ts
const base = { alias: "n", ownerWallet: "0x0", endpointUrl: "http://x", specs: {} };
const providers: Provider[] = [
  { id: "A", ...base, resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerTick: 0.000006, computeScore: 70, avgLatencyMs: 5 },
  { id: "B", ...base, resourceType: "GPU", region: "EU-West", online: true, stakeAmount: 100, pricePerTick: 0.000004, computeScore: 92, avgLatencyMs: 8 },
  { id: "C", ...base, resourceType: "GPU", region: "US-East", online: false, stakeAmount: 100, pricePerTick: 0.000003, computeScore: 99, avgLatencyMs: 4 },
  { id: "D", ...base, resourceType: "CPU", region: "US-East", online: true, stakeAmount: 0, pricePerTick: 0.000002, computeScore: 80, avgLatencyMs: 4 },
];
```

Keep the `import { hardFilter, scoreProviders } from "./scoring";` and add
`import type { Provider, JobSpec } from "./domain";`.

- [ ] **Step 4: Verify scorer tests + types**

Run: `cd services && bun test src/scoring.test.ts && bunx tsc --noEmit`
Expected: 2 tests pass, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/src/domain.ts services/src/scoring.ts services/src/scoring.test.ts
git commit -m "refactor(services): shared domain types; scorer reads from domain.ts"
```

---

## Task 2: The Registry interface

**Files:**
- Create: `services/src/registry/registry.ts`

- [ ] **Step 1: Write the interface**

Write `services/src/registry/registry.ts`:

```ts
import type {
  Provider,
  Job,
  JobDecision,
  Tick,
  JobSpec,
  ResourceType,
} from "../domain";

export type NewProvider = Omit<Provider, "id" | "computeScore"> & {
  computeScore?: number;
};

export type NewJob = {
  name: string;
  userId: string;
  spec: JobSpec;
  estimatedUsage?: number | null;
  autonomyArmed?: boolean;
};

export type JobPatch = Partial<
  Pick<Job, "status" | "providerId" | "totalCost" | "startedAt" | "endedAt">
>;

export type ProviderFilter = {
  resourceType?: ResourceType;
  onlineOnly?: boolean;
};

export interface Registry {
  registerProvider(p: NewProvider): Promise<Provider>;
  listProviders(filter?: ProviderFilter): Promise<Provider[]>;
  getProvider(id: string): Promise<Provider | null>;
  setProviderOnline(id: string, online: boolean): Promise<void>;
  bumpComputeScore(id: string, delta: number): Promise<Provider>;

  createJob(j: NewJob): Promise<Job>;
  getJob(id: string): Promise<Job | null>;
  updateJob(id: string, patch: JobPatch): Promise<Job>;

  recordDecision(d: Omit<JobDecision, "id" | "createdAt">): Promise<JobDecision>;
  recordTick(t: Omit<Tick, "id" | "createdAt">): Promise<Tick>;
  listTicks(jobId: string): Promise<Tick[]>;
  jobCost(jobId: string): Promise<number>;
}
```

- [ ] **Step 2: Type-check**

Run: `cd services && bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add services/src/registry/registry.ts
git commit -m "feat(registry): Registry interface + input types"
```

---

## Task 3: Reusable contract suite + InMemoryRegistry

**Files:**
- Create: `services/src/registry/contract.ts`
- Create: `services/src/registry/in-memory.ts`
- Test: `services/src/registry/in-memory.test.ts`

- [ ] **Step 1: Write the contract suite**

Write `services/src/registry/contract.ts`. It defines tests that any `Registry`
must satisfy, given a factory that returns a fresh, empty registry.

```ts
import { describe, test, expect, beforeEach } from "bun:test";
import type { Registry, NewProvider } from "./registry";

const sampleProvider: NewProvider = {
  alias: "node-astral-1",
  ownerWallet: "0xprovider",
  endpointUrl: "http://localhost:4001",
  resourceType: "GPU",
  region: "US-East",
  specs: { gpu: "H100", vramGb: 80 },
  online: true,
  stakeAmount: 100,
  pricePerTick: 0.000006,
  avgLatencyMs: 5,
};

export function registryContract(
  name: string,
  makeRegistry: () => Promise<Registry>,
) {
  describe(`Registry contract: ${name}`, () => {
    let reg: Registry;
    beforeEach(async () => {
      reg = await makeRegistry();
    });

    test("registerProvider assigns an id and default computeScore", async () => {
      const p = await reg.registerProvider(sampleProvider);
      expect(p.id).toBeTruthy();
      expect(p.alias).toBe("node-astral-1");
      expect(typeof p.computeScore).toBe("number");
    });

    test("listProviders filters by resourceType and onlineOnly", async () => {
      await reg.registerProvider(sampleProvider);
      await reg.registerProvider({ ...sampleProvider, alias: "cpu-1", resourceType: "CPU" });
      await reg.registerProvider({ ...sampleProvider, alias: "off-1", online: false });

      const gpus = await reg.listProviders({ resourceType: "GPU" });
      expect(gpus.map((p) => p.alias).sort()).toEqual(["node-astral-1", "off-1"]);

      const onlineGpus = await reg.listProviders({ resourceType: "GPU", onlineOnly: true });
      expect(onlineGpus.map((p) => p.alias)).toEqual(["node-astral-1"]);
    });

    test("getProvider returns null for unknown id", async () => {
      expect(await reg.getProvider("nope")).toBeNull();
    });

    test("bumpComputeScore adjusts and persists the score", async () => {
      const p = await reg.registerProvider({ ...sampleProvider, computeScore: 90 });
      const bumped = await reg.bumpComputeScore(p.id, -5);
      expect(bumped.computeScore).toBe(85);
      const fetched = await reg.getProvider(p.id);
      expect(fetched?.computeScore).toBe(85);
    });

    test("createJob defaults status to queued and autonomy to false", async () => {
      const job = await reg.createJob({
        name: "train-x",
        userId: "u1",
        spec: { resourceType: "GPU", region: null },
      });
      expect(job.id).toBeTruthy();
      expect(job.status).toBe("queued");
      expect(job.autonomyArmed).toBe(false);
      expect(job.totalCost).toBe(0);
    });

    test("updateJob patches fields", async () => {
      const job = await reg.createJob({ name: "j", userId: "u1", spec: { resourceType: "GPU", region: null } });
      const updated = await reg.updateJob(job.id, { status: "running", providerId: "p1" });
      expect(updated.status).toBe("running");
      expect(updated.providerId).toBe("p1");
    });

    test("recordTick + jobCost sums consumed ticks exactly", async () => {
      const job = await reg.createJob({ name: "j", userId: "u1", spec: { resourceType: "GPU", region: null } });
      await reg.recordTick({ jobId: job.id, providerId: "p1", seq: 0, amount: 100, authorizationRef: "a0", settled: false, settlementRef: null });
      await reg.recordTick({ jobId: job.id, providerId: "p1", seq: 1, amount: 100, authorizationRef: "a1", settled: false, settlementRef: null });
      expect(await reg.jobCost(job.id)).toBe(200);
      expect((await reg.listTicks(job.id)).length).toBe(2);
    });

    test("recordDecision stores candidates + rationale", async () => {
      const job = await reg.createJob({ name: "j", userId: "u1", spec: { resourceType: "GPU", region: null } });
      const d = await reg.recordDecision({
        jobId: job.id,
        candidates: [{ providerId: "B", rank: 0 }, { providerId: "A", rank: 1 }],
        chosenProviderId: "B",
        rationale: "B is cheaper and higher score",
      });
      expect(d.id).toBeTruthy();
      expect(d.chosenProviderId).toBe("B");
    });
  });
}
```

- [ ] **Step 2: Write the InMemoryRegistry**

Write `services/src/registry/in-memory.ts`:

```ts
import type { Provider, Job, JobDecision, Tick } from "../domain";
import type { Registry, NewProvider, NewJob, JobPatch, ProviderFilter } from "./registry";

export class InMemoryRegistry implements Registry {
  private providers = new Map<string, Provider>();
  private jobs = new Map<string, Job>();
  private decisions: JobDecision[] = [];
  private ticks: Tick[] = [];

  async registerProvider(p: NewProvider): Promise<Provider> {
    const provider: Provider = { id: crypto.randomUUID(), computeScore: p.computeScore ?? 80, ...p, ...{ computeScore: p.computeScore ?? 80 } };
    this.providers.set(provider.id, provider);
    return provider;
  }

  async listProviders(filter?: ProviderFilter): Promise<Provider[]> {
    let out = [...this.providers.values()];
    if (filter?.resourceType) out = out.filter((p) => p.resourceType === filter.resourceType);
    if (filter?.onlineOnly) out = out.filter((p) => p.online);
    return out;
  }

  async getProvider(id: string): Promise<Provider | null> {
    return this.providers.get(id) ?? null;
  }

  async setProviderOnline(id: string, online: boolean): Promise<void> {
    const p = this.providers.get(id);
    if (p) this.providers.set(id, { ...p, online });
  }

  async bumpComputeScore(id: string, delta: number): Promise<Provider> {
    const p = this.providers.get(id);
    if (!p) throw new Error(`provider not found: ${id}`);
    const next = { ...p, computeScore: p.computeScore + delta };
    this.providers.set(id, next);
    return next;
  }

  async createJob(j: NewJob): Promise<Job> {
    const job: Job = {
      id: crypto.randomUUID(),
      name: j.name,
      userId: j.userId,
      spec: j.spec,
      estimatedUsage: j.estimatedUsage ?? null,
      autonomyArmed: j.autonomyArmed ?? false,
      status: "queued",
      providerId: null,
      totalCost: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async getJob(id: string): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }

  async updateJob(id: string, patch: JobPatch): Promise<Job> {
    const j = this.jobs.get(id);
    if (!j) throw new Error(`job not found: ${id}`);
    const next = { ...j, ...patch };
    this.jobs.set(id, next);
    return next;
  }

  async recordDecision(d: Omit<JobDecision, "id" | "createdAt">): Promise<JobDecision> {
    const decision: JobDecision = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...d };
    this.decisions.push(decision);
    return decision;
  }

  async recordTick(t: Omit<Tick, "id" | "createdAt">): Promise<Tick> {
    const tick: Tick = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...t };
    this.ticks.push(tick);
    return tick;
  }

  async listTicks(jobId: string): Promise<Tick[]> {
    return this.ticks.filter((t) => t.jobId === jobId).sort((a, b) => a.seq - b.seq);
  }

  async jobCost(jobId: string): Promise<number> {
    return this.ticks.filter((t) => t.jobId === jobId).reduce((s, t) => s + t.amount, 0);
  }
}
```

> Note: in `registerProvider`, write it cleanly as
> `const provider: Provider = { id: crypto.randomUUID(), ...p, computeScore: p.computeScore ?? 80 };`
> (the duplicated spread above is a copy artifact — use this single-spread form so
> the explicit `computeScore` wins).

- [ ] **Step 3: Wire the contract test**

Write `services/src/registry/in-memory.test.ts`:

```ts
import { registryContract } from "./contract";
import { InMemoryRegistry } from "./in-memory";

registryContract("InMemoryRegistry", async () => new InMemoryRegistry());
```

- [ ] **Step 4: Run it**

Run: `cd services && bun test src/registry/in-memory.test.ts`
Expected: all contract tests pass.

- [ ] **Step 5: Full suite + types**

Run: `cd services && bun test && bunx tsc --noEmit`
Expected: all pass, tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add services/src/registry/contract.ts services/src/registry/in-memory.ts services/src/registry/in-memory.test.ts
git commit -m "feat(registry): contract suite + InMemoryRegistry (passes the contract)"
```

---

## Task 4: Supabase schema

**Files:**
- Create: `services/supabase/migrations/0001_init.sql`

- [ ] **Step 1: Write the migration**

Write `services/supabase/migrations/0001_init.sql`:

```sql
-- prime-compute registry schema (Plan 2)

create table if not exists providers (
  id uuid primary key default gen_random_uuid(),
  alias text not null,
  owner_wallet text not null,
  endpoint_url text not null,
  resource_type text not null check (resource_type in ('GPU','CPU','Storage','Full Server')),
  region text not null,
  specs jsonb not null default '{}',
  online boolean not null default true,
  stake_amount numeric not null default 0,
  price_per_tick numeric not null,
  compute_score numeric not null default 80,
  avg_latency_ms numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  user_id text not null,
  resource_type text not null check (resource_type in ('GPU','CPU','Storage','Full Server')),
  region text,
  estimated_usage numeric,
  autonomy_armed boolean not null default false,
  status text not null default 'queued'
    check (status in ('queued','running','paused','completed','cancelled','failed')),
  provider_id uuid references providers(id),
  total_cost numeric not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);

create table if not exists job_decisions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  candidates jsonb not null default '[]',
  chosen_provider_id uuid references providers(id),
  rationale text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists ticks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  provider_id uuid not null references providers(id),
  seq integer not null,
  amount numeric not null,
  authorization_ref text,
  settled boolean not null default false,
  settlement_ref text,
  created_at timestamptz not null default now()
);

create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  batch_ref text,
  tx_hash text,
  tick_ids uuid[] not null default '{}',
  amount numeric not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists idx_ticks_job on ticks(job_id);
create index if not exists idx_jobs_status on jobs(status);
create index if not exists idx_providers_type_online on providers(resource_type, online);
```

> The frontend's realtime read policies (RLS) are deliberately deferred to Plan 6;
> the broker uses the service-role key, which bypasses RLS.

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP (preferred in this environment) or `supabase db push`
against the project. If using the MCP, run the SQL in `0001_init.sql` through the
`apply_migration` tool. Record the project ref in `services/.env`.

- [ ] **Step 3: Commit**

```bash
git add services/supabase/migrations/0001_init.sql
git commit -m "feat(registry): supabase schema for providers/jobs/decisions/ticks/settlements"
```

---

## Task 5: SupabaseRegistry + config

**Files:**
- Create: `services/src/registry/supabase.ts`
- Modify: `services/src/config.ts`, `services/src/config.test.ts`, `services/.env.example`

- [ ] **Step 1: Add the Supabase client dep**

Run: `cd services && bun add @supabase/supabase-js`
Expected: installs, exit 0. Record the resolved version.

- [ ] **Step 2: Add optional supabase config**

Edit `services/src/config.ts` to add an optional `supabase` block (only required
when actually using `SupabaseRegistry`). Add a helper and extend the return:

```ts
export function loadConfig(env: Env = process.env) {
  return {
    llm: {
      baseUrl: required(env, "LLM_BASE_URL"),
      apiKey: required(env, "LLM_API_KEY"),
      model: env.LLM_MODEL ?? "meta/llama-3.3-70b-instruct",
    },
    supabase:
      env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
        ? { url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }
        : null,
  };
}
```

- [ ] **Step 3: Cover it in the config test**

Add to `services/src/config.test.ts`:

```ts
test("supabase config is null when its vars are absent", () => {
  const cfg = loadConfig({ LLM_BASE_URL: "x", LLM_API_KEY: "y" });
  expect(cfg.supabase).toBeNull();
});

test("supabase config is populated when both vars are present", () => {
  const cfg = loadConfig({
    LLM_BASE_URL: "x",
    LLM_API_KEY: "y",
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  expect(cfg.supabase).toEqual({ url: "https://proj.supabase.co", serviceRoleKey: "service-key" });
});
```

- [ ] **Step 4: Add env docs**

Append to `services/.env.example`:

```bash

# Supabase (registry state + realtime)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 5: Write the SupabaseRegistry**

Write `services/src/registry/supabase.ts`. It maps snake_case rows to the
camelCase domain and back.

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Provider, Job, JobDecision, Tick } from "../domain";
import type { Registry, NewProvider, NewJob, JobPatch, ProviderFilter } from "./registry";

type Row = Record<string, unknown>;

function toProvider(r: Row): Provider {
  return {
    id: r.id as string,
    alias: r.alias as string,
    ownerWallet: r.owner_wallet as string,
    endpointUrl: r.endpoint_url as string,
    resourceType: r.resource_type as Provider["resourceType"],
    region: r.region as string,
    specs: (r.specs as Record<string, unknown>) ?? {},
    online: r.online as boolean,
    stakeAmount: Number(r.stake_amount),
    pricePerTick: Number(r.price_per_tick),
    computeScore: Number(r.compute_score),
    avgLatencyMs: Number(r.avg_latency_ms),
  };
}

function toJob(r: Row): Job {
  return {
    id: r.id as string,
    name: r.name as string,
    userId: r.user_id as string,
    spec: { resourceType: r.resource_type as Job["spec"]["resourceType"], region: (r.region as string) ?? null },
    estimatedUsage: r.estimated_usage === null ? null : Number(r.estimated_usage),
    autonomyArmed: r.autonomy_armed as boolean,
    status: r.status as Job["status"],
    providerId: (r.provider_id as string) ?? null,
    totalCost: Number(r.total_cost),
    createdAt: r.created_at as string,
    startedAt: (r.started_at as string) ?? null,
    endedAt: (r.ended_at as string) ?? null,
  };
}

function toTick(r: Row): Tick {
  return {
    id: r.id as string,
    jobId: r.job_id as string,
    providerId: r.provider_id as string,
    seq: Number(r.seq),
    amount: Number(r.amount),
    authorizationRef: (r.authorization_ref as string) ?? null,
    settled: r.settled as boolean,
    settlementRef: (r.settlement_ref as string) ?? null,
    createdAt: r.created_at as string,
  };
}

export class SupabaseRegistry implements Registry {
  private db: SupabaseClient;
  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  private async one<T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>, ctx: string): Promise<T> {
    const { data, error } = await q;
    if (error) throw new Error(`${ctx}: ${error.message}`);
    if (data === null) throw new Error(`${ctx}: no row returned`);
    return data;
  }

  async registerProvider(p: NewProvider): Promise<Provider> {
    const row = await this.one(
      this.db.from("providers").insert({
        alias: p.alias, owner_wallet: p.ownerWallet, endpoint_url: p.endpointUrl,
        resource_type: p.resourceType, region: p.region, specs: p.specs,
        online: p.online, stake_amount: p.stakeAmount, price_per_tick: p.pricePerTick,
        compute_score: p.computeScore ?? 80, avg_latency_ms: p.avgLatencyMs,
      }).select().single(),
      "registerProvider",
    );
    return toProvider(row as Row);
  }

  async listProviders(filter?: ProviderFilter): Promise<Provider[]> {
    let q = this.db.from("providers").select();
    if (filter?.resourceType) q = q.eq("resource_type", filter.resourceType);
    if (filter?.onlineOnly) q = q.eq("online", true);
    const { data, error } = await q;
    if (error) throw new Error(`listProviders: ${error.message}`);
    return (data ?? []).map((r) => toProvider(r as Row));
  }

  async getProvider(id: string): Promise<Provider | null> {
    const { data, error } = await this.db.from("providers").select().eq("id", id).maybeSingle();
    if (error) throw new Error(`getProvider: ${error.message}`);
    return data ? toProvider(data as Row) : null;
  }

  async setProviderOnline(id: string, online: boolean): Promise<void> {
    const { error } = await this.db.from("providers").update({ online }).eq("id", id);
    if (error) throw new Error(`setProviderOnline: ${error.message}`);
  }

  async bumpComputeScore(id: string, delta: number): Promise<Provider> {
    const current = await this.getProvider(id);
    if (!current) throw new Error(`provider not found: ${id}`);
    const row = await this.one(
      this.db.from("providers").update({ compute_score: current.computeScore + delta }).eq("id", id).select().single(),
      "bumpComputeScore",
    );
    return toProvider(row as Row);
  }

  async createJob(j: NewJob): Promise<Job> {
    const row = await this.one(
      this.db.from("jobs").insert({
        name: j.name, user_id: j.userId,
        resource_type: j.spec.resourceType, region: j.spec.region,
        estimated_usage: j.estimatedUsage ?? null, autonomy_armed: j.autonomyArmed ?? false,
      }).select().single(),
      "createJob",
    );
    return toJob(row as Row);
  }

  async getJob(id: string): Promise<Job | null> {
    const { data, error } = await this.db.from("jobs").select().eq("id", id).maybeSingle();
    if (error) throw new Error(`getJob: ${error.message}`);
    return data ? toJob(data as Row) : null;
  }

  async updateJob(id: string, patch: JobPatch): Promise<Job> {
    const dbPatch: Row = {};
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.providerId !== undefined) dbPatch.provider_id = patch.providerId;
    if (patch.totalCost !== undefined) dbPatch.total_cost = patch.totalCost;
    if (patch.startedAt !== undefined) dbPatch.started_at = patch.startedAt;
    if (patch.endedAt !== undefined) dbPatch.ended_at = patch.endedAt;
    const row = await this.one(
      this.db.from("jobs").update(dbPatch).eq("id", id).select().single(),
      "updateJob",
    );
    return toJob(row as Row);
  }

  async recordDecision(d: Omit<JobDecision, "id" | "createdAt">): Promise<JobDecision> {
    const row = await this.one(
      this.db.from("job_decisions").insert({
        job_id: d.jobId, candidates: d.candidates,
        chosen_provider_id: d.chosenProviderId, rationale: d.rationale,
      }).select().single(),
      "recordDecision",
    );
    const r = row as Row;
    return {
      id: r.id as string, jobId: r.job_id as string,
      candidates: r.candidates as JobDecision["candidates"],
      chosenProviderId: (r.chosen_provider_id as string) ?? null,
      rationale: r.rationale as string, createdAt: r.created_at as string,
    };
  }

  async recordTick(t: Omit<Tick, "id" | "createdAt">): Promise<Tick> {
    const row = await this.one(
      this.db.from("ticks").insert({
        job_id: t.jobId, provider_id: t.providerId, seq: t.seq, amount: t.amount,
        authorization_ref: t.authorizationRef, settled: t.settled, settlement_ref: t.settlementRef,
      }).select().single(),
      "recordTick",
    );
    return toTick(row as Row);
  }

  async listTicks(jobId: string): Promise<Tick[]> {
    const { data, error } = await this.db.from("ticks").select().eq("job_id", jobId).order("seq");
    if (error) throw new Error(`listTicks: ${error.message}`);
    return (data ?? []).map((r) => toTick(r as Row));
  }

  async jobCost(jobId: string): Promise<number> {
    const { data, error } = await this.db.from("ticks").select("amount").eq("job_id", jobId);
    if (error) throw new Error(`jobCost: ${error.message}`);
    return (data ?? []).reduce((s, r) => s + Number((r as Row).amount), 0);
  }
}
```

- [ ] **Step 6: Type-check + config tests**

Run: `cd services && bunx tsc --noEmit && bun test src/config.test.ts`
Expected: tsc exit 0, config tests pass (4 tests).

- [ ] **Step 7: Commit**

```bash
git add services/src/registry/supabase.ts services/src/config.ts services/src/config.test.ts services/.env.example services/package.json services/bun.lock
git commit -m "feat(registry): SupabaseRegistry + optional supabase config"
```

---

## Task 6: SupabaseRegistry integration test (handoff: needs Supabase)

**Files:**
- Create: `services/src/registry/supabase.test.ts`

- [ ] **Step 1: Write the integration test**

Write `services/src/registry/supabase.test.ts`. It runs the same contract, but
skips entirely when Supabase env vars are absent, and resets the tables before
each test so the contract's empty-registry assumption holds.

```ts
import { registryContract } from "./contract";
import { SupabaseRegistry } from "./supabase";
import { loadConfig } from "../config";

const cfg = loadConfig();

if (!cfg.supabase) {
  // No Supabase configured — skip the integration contract (unit suite stays green).
  console.log("[supabase.test] SUPABASE_* not set; skipping integration contract.");
} else {
  const { url, serviceRoleKey } = cfg.supabase;
  registryContract("SupabaseRegistry", async () => {
    const reg = new SupabaseRegistry(url, serviceRoleKey);
    // Reset tables so each contract test starts from empty (child rows first).
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
    for (const t of ["ticks", "job_decisions", "settlements", "jobs", "providers"]) {
      const { error } = await db.from(t).delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw new Error(`reset ${t}: ${error.message}`);
    }
    return reg;
  });
}
```

- [ ] **Step 2: Run it (handoff)**

With `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set in `services/.env` and the
migration applied:
Run: `cd services && bun test src/registry/supabase.test.ts`
Expected: the same contract tests pass against the real database. Without the env
vars, it prints the skip line and passes trivially.

- [ ] **Step 3: Confirm the offline suite is unaffected**

Run (without Supabase env): `cd services && bun test`
Expected: all unit + contract (in-memory) tests pass; the supabase file logs skip.

- [ ] **Step 4: Commit**

```bash
git add services/src/registry/supabase.test.ts
git commit -m "test(registry): SupabaseRegistry integration contract (skips without env)"
```

---

## Task 7: Provider seed script

**Files:**
- Create: `services/scripts/seed-providers.ts`

- [ ] **Step 1: Write the seed script**

Write `services/scripts/seed-providers.ts`. It inserts a handful of realistic
providers through whichever registry is configured (Supabase if env is set, else
in-memory as a dry run that prints what it would insert).

```ts
import { loadConfig } from "../src/config";
import { InMemoryRegistry } from "../src/registry/in-memory";
import { SupabaseRegistry } from "../src/registry/supabase";
import type { Registry, NewProvider } from "../src/registry/registry";

const seeds: NewProvider[] = [
  { alias: "node-astral-1", ownerWallet: "0xA11ce", endpointUrl: "http://localhost:4001", resourceType: "GPU", region: "US-East", specs: { gpu: "NVIDIA H100", vramGb: 80 }, online: true, stakeAmount: 100, pricePerTick: 0.000006, computeScore: 98, avgLatencyMs: 4 },
  { alias: "node-orion-2", ownerWallet: "0xB0b", endpointUrl: "http://localhost:4002", resourceType: "GPU", region: "EU-West", specs: { gpu: "NVIDIA A100", vramGb: 40 }, online: true, stakeAmount: 100, pricePerTick: 0.0000045, computeScore: 94, avgLatencyMs: 6 },
  { alias: "node-nebula-3", ownerWallet: "0xC4r0l", endpointUrl: "http://localhost:4003", resourceType: "CPU", region: "US-West", specs: { cpuCores: 64, ramGb: 256 }, online: true, stakeAmount: 50, pricePerTick: 0.0000022, computeScore: 87, avgLatencyMs: 5 },
  { alias: "node-pulsar-4", ownerWallet: "0xD4ve", endpointUrl: "http://localhost:4004", resourceType: "GPU", region: "Asia-Pacific", specs: { gpu: "NVIDIA L40S", vramGb: 48 }, online: false, stakeAmount: 100, pricePerTick: 0.0000051, computeScore: 76, avgLatencyMs: 9 },
];

async function makeRegistry(): Promise<{ reg: Registry; live: boolean }> {
  const cfg = loadConfig();
  if (cfg.supabase) return { reg: new SupabaseRegistry(cfg.supabase.url, cfg.supabase.serviceRoleKey), live: true };
  return { reg: new InMemoryRegistry(), live: false };
}

const { reg, live } = await makeRegistry();
for (const s of seeds) {
  const p = await reg.registerProvider(s);
  console.log(`${live ? "inserted" : "(dry-run)"} ${p.alias} -> ${p.id}`);
}
console.log(live ? "\n✅ seeded providers into Supabase." : "\n(dry run — set SUPABASE_* to insert for real)");
```

- [ ] **Step 2: Add the script to package.json**

Add to `services/package.json` scripts: `"seed": "bun run scripts/seed-providers.ts"`.

- [ ] **Step 3: Dry-run it (offline)**

Run (no Supabase env): `cd services && bun run seed`
Expected: prints `(dry-run) node-astral-1 -> <uuid>` for each seed and the dry-run
note. (With Supabase env set, it inserts for real.)

- [ ] **Step 4: Commit**

```bash
git add services/scripts/seed-providers.ts services/package.json
git commit -m "feat(registry): provider seed script (dry-run offline, inserts with supabase)"
```

---

## Task 8: Wrap-up

- [ ] **Step 1: Full suite + type-check**

Run: `cd services && bun test && bunx tsc --noEmit`
Expected: all tests pass (config, scoring, in-memory contract; supabase contract
runs only if env is set), tsc exit 0.

- [ ] **Step 2: Lint the touched frontend? (none)** — this plan does not touch `src/`.

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch (verify tests, present options,
execute choice). Default to merging to `main` once green.

---

## Self-Review Notes

**Spec coverage:** Implements the spec's Data model (all five tables) and the State
+ registry component behind a `Registry` interface (spec's "behind a `Registry`
interface so an on-chain backing can replace it later"). Reputation's Compute Score
update path is `bumpComputeScore`. Settlements table is created here; the broker's
settlement reconciliation that writes it is Plan 4/5.

**Placeholder scan:** No TBDs. The one copy artifact in `in-memory.ts`
`registerProvider` is called out explicitly with the correct single-spread form to
use. Supabase apply (Task 4 step 2) is an environment action with a named tool
(`apply_migration`) — not a code placeholder.

**Type consistency:** `Provider`/`JobSpec`/`Job`/`JobDecision`/`Tick` defined once
in `domain.ts` (Task 1) and imported everywhere. `Registry`, `NewProvider`,
`NewJob`, `JobPatch`, `ProviderFilter` defined in Task 2 and used by both
implementations and the contract. The contract suite (Task 3) is the single source
of behavioral truth both implementations satisfy.

**Not in scope (later plans):** RLS / realtime read policies for the dashboard
(Plan 6), the provider service that serves x402 ticks (Plan 3), the settlement
adapter that writes `settlements` (Plan 4), the matching/stream engine that calls
`recordDecision`/`recordTick` (Plan 5).
