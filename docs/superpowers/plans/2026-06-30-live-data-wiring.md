# Live-Data Read Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every mock-data read in the marketplace, marketplace detail, dashboard, and provider-dashboard pages with reads from the real `services/` broker registry, then delete `mock-data.ts`. No write path changes.

**Architecture:** Extend the `Registry` interface with `listRents` and an `ownerWallet` provider filter (additive, both implementations). Give `SupabaseRegistry` a constructor overload that accepts an existing `SupabaseClient` so the frontend reuses `supabaseAdmin()`. Wire `services/src` into the frontend build via a `@services` alias. Expose reads through new TanStack `createServerFn`s. Rewire five frontend files to consume them, dropping any UI that has no registry-backed data instead of faking it.

**Tech Stack:** TanStack Start / React / Vite, `@tanstack/react-query` (already installed, unused so far), Bun test (`services/`), Supabase.

**Spec:** `docs/superpowers/specs/2026-06-30-live-data-wiring-design.md`

---

### Task 1: `Registry` interface — `listRents` and `ownerWallet` filter

**Files:**
- Modify: `services/src/registry/registry.ts`
- Modify: `services/src/registry/contract.ts`
- Test: `services/src/registry/in-memory.test.ts` (existing, runs the contract unchanged)

- [ ] **Step 1: Add the failing contract tests**

In `services/src/registry/contract.ts`, add two tests at the end of the `describe` block, right before the closing `});` of the `describe(...)` callback (after the existing `recordDecision stores candidates + rationale` test):

```ts
    test("listRents filters by userId, providerId, and status", async () => {
      const provider = await reg.registerProvider({ ...sampleProvider, alias: "filter-target" });
      const a = await reg.createRent({ name: "a", userId: "user-a", spec: { resourceType: "GPU", region: null } });
      const b = await reg.createRent({ name: "b", userId: "user-b", spec: { resourceType: "GPU", region: null } });
      await reg.updateRent(a.id, { status: "running", providerId: provider.id });

      expect((await reg.listRents({ userId: "user-a" })).map((r) => r.id)).toEqual([a.id]);
      expect((await reg.listRents({ providerId: provider.id })).map((r) => r.id)).toEqual([a.id]);
      expect((await reg.listRents({ status: "running" })).map((r) => r.id)).toEqual([a.id]);
      expect((await reg.listRents()).map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    }, T);

    test("listProviders filters by ownerWallet", async () => {
      await reg.registerProvider({ ...sampleProvider, alias: "mine-1", ownerWallet: "0xowner" });
      await reg.registerProvider({ ...sampleProvider, alias: "theirs-1", ownerWallet: "0xother" });

      const mine = await reg.listProviders({ ownerWallet: "0xowner" });
      expect(mine.map((p) => p.alias)).toEqual(["mine-1"]);
    }, T);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services && bun test registry/in-memory.test.ts`
Expected: FAIL — `TypeError: reg.listRents is not a function` (the type doesn't exist on `Registry` yet, so this won't even compile cleanly under `bun test`'s type-stripping; the runtime error is the same either way: the method is missing).

- [ ] **Step 3: Add the types to the `Registry` interface**

In `services/src/registry/registry.ts`, change the top import and add `RentFilter`, extend `ProviderFilter`, and add `listRents` to the interface:

```ts
import type {
  Provider,
  Rent,
  RentDecision,
  Charge,
  RentSpec,
  ResourceType,
  RentStatus,
} from "../domain";
import type { DecisionLog } from "../runtime/types";

export type NewProvider = Omit<Provider, "id" | "computeScore"> & {
  computeScore?: number;
};

export type NewRent = {
  name: string;
  userId: string;
  spec: RentSpec;
  estimatedUsage?: number | null;
  autonomyArmed?: boolean;
};

export type RentPatch = Partial<
  Pick<Rent, "status" | "providerId" | "totalCost" | "startedAt" | "endedAt">
>;

export type ProviderFilter = {
  resourceType?: ResourceType;
  onlineOnly?: boolean;
  ownerWallet?: string;
};

export type RentFilter = {
  userId?: string;
  providerId?: string;
  status?: RentStatus;
};

export interface Registry {
  registerProvider(p: NewProvider): Promise<Provider>;
  listProviders(filter?: ProviderFilter): Promise<Provider[]>;
  getProvider(id: string): Promise<Provider | null>;
  setProviderOnline(id: string, online: boolean): Promise<void>;
  bumpComputeScore(id: string, delta: number): Promise<Provider>;

  createRent(r: NewRent): Promise<Rent>;
  getRent(id: string): Promise<Rent | null>;
  listRents(filter?: RentFilter): Promise<Rent[]>;
  updateRent(id: string, patch: RentPatch): Promise<Rent>;

  recordDecision(d: Omit<RentDecision, "id" | "createdAt">): Promise<RentDecision>;
  recordDecisionLog(rentId: string, log: DecisionLog): Promise<DecisionLog>;
  listDecisionLogs(rentId: string): Promise<DecisionLog[]>;
  recordCharge(t: Omit<Charge, "id" | "createdAt">): Promise<Charge>;
  markChargeSettled(chargeId: string): Promise<void>;
  listCharges(rentId: string): Promise<Charge[]>;
  rentCost(rentId: string): Promise<number>;
}
```

- [ ] **Step 4: Implement in `InMemoryRegistry`**

In `services/src/registry/in-memory.ts`, change the import line to add `RentFilter`:

```ts
import type { Registry, NewProvider, NewRent, RentPatch, ProviderFilter, RentFilter } from "./registry";
```

Update `listProviders` to honor `ownerWallet`, and add `listRents` right after `getRent`:

```ts
  async listProviders(filter?: ProviderFilter): Promise<Provider[]> {
    let out = [...this.providers.values()];
    if (filter?.resourceType) out = out.filter((p) => p.resourceType === filter.resourceType);
    if (filter?.onlineOnly) out = out.filter((p) => p.online);
    if (filter?.ownerWallet) out = out.filter((p) => p.ownerWallet === filter.ownerWallet);
    return out;
  }
```

```ts
  async listRents(filter?: RentFilter): Promise<Rent[]> {
    let out = [...this.rents.values()];
    if (filter?.userId) out = out.filter((r) => r.userId === filter.userId);
    if (filter?.providerId) out = out.filter((r) => r.providerId === filter.providerId);
    if (filter?.status) out = out.filter((r) => r.status === filter.status);
    return out;
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd services && bun test registry/in-memory.test.ts`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 6: Commit**

```bash
git add services/src/registry/registry.ts services/src/registry/in-memory.ts services/src/registry/contract.ts
git commit -m "feat(registry): add listRents and ownerWallet provider filter"
```

---

### Task 2: `SupabaseRegistry` — constructor overload and the same two methods

**Files:**
- Modify: `services/src/registry/supabase.ts`

- [ ] **Step 1: Add the constructor overload**

In `services/src/registry/supabase.ts`, replace the constructor:

```ts
export class SupabaseRegistry implements Registry {
  private db: SupabaseClient;

  constructor(client: SupabaseClient);
  constructor(url: string, serviceRoleKey: string);
  constructor(clientOrUrl: SupabaseClient | string, serviceRoleKey?: string) {
    this.db = typeof clientOrUrl === "string"
      ? createClient(clientOrUrl, serviceRoleKey!, { auth: { persistSession: false } })
      : clientOrUrl;
  }
```

This keeps `new SupabaseRegistry(url, key)` working for `seed-providers.ts`, `broker-roundtrip.ts`, and `integration-roundtrip.ts` unchanged, and adds `new SupabaseRegistry(existingClient)` for the frontend. When given a client, it's stored directly, never wrapped in a second `createClient` call.

- [ ] **Step 2: Add `ownerWallet` to `listProviders` and implement `listRents`**

```ts
  async listProviders(filter?: ProviderFilter): Promise<Provider[]> {
    let q = this.db.from("providers").select();
    if (filter?.resourceType) q = q.eq("resource_type", filter.resourceType);
    if (filter?.onlineOnly) q = q.eq("online", true);
    if (filter?.ownerWallet) q = q.eq("owner_wallet", filter.ownerWallet);
    const { data, error } = await q;
    if (error) throw new Error(`listProviders: ${error.message}`);
    return (data ?? []).map((r) => toProvider(r));
  }
```

Add right after `getRent`:

```ts
  async listRents(filter?: RentFilter): Promise<Rent[]> {
    let q = this.db.from("rents").select();
    if (filter?.userId) q = q.eq("user_id", filter.userId);
    if (filter?.providerId) q = q.eq("provider_id", filter.providerId);
    if (filter?.status) q = q.eq("status", filter.status);
    const { data, error } = await q;
    if (error) throw new Error(`listRents: ${error.message}`);
    return (data ?? []).map((r) => toRent(r));
  }
```

Update the type import at the top of the file to include `RentFilter`:

```ts
import type { Registry, NewProvider, NewRent, RentPatch, ProviderFilter, RentFilter } from "./registry";
```

- [ ] **Step 3: Type-check**

Run: `cd services && bunx tsc --noEmit`
Expected: no errors. (The live-DB contract test in `supabase.test.ts` only runs when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are set; without them it logs a skip message, which is expected in this environment. If those env vars are available, also run `cd services && bun test registry/supabase.test.ts` and expect PASS.)

- [ ] **Step 4: Commit**

```bash
git add services/src/registry/supabase.ts
git commit -m "feat(registry): SupabaseRegistry accepts an existing client; add listRents/ownerWallet"
```

---

### Task 3: Wire `services/src` into the frontend build

**Files:**
- Modify: `vite.config.ts`
- Modify: `tsconfig.json`

- [ ] **Step 1: Add the `@services` alias to Vite**

In `vite.config.ts`, change:

```ts
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
```

to:

```ts
    resolve: {
      alias: {
        "@": `${process.cwd()}/src`,
        "@services": `${process.cwd()}/services/src`,
      },
```

- [ ] **Step 2: Add the `@services` path to tsconfig**

In `tsconfig.json`, change:

```json
    "paths": {
      "@/*": ["./src/*"]
    }
```

to:

```json
    "paths": {
      "@/*": ["./src/*"],
      "@services/*": ["./services/src/*"]
    }
```

- [ ] **Step 3: Verify resolution**

Run: `npx tsc --noEmit`
Expected: no errors (nothing imports `@services` yet, this just confirms the config itself is valid).

- [ ] **Step 4: Commit**

```bash
git add vite.config.ts tsconfig.json
git commit -m "build: add @services alias to import services/src from the frontend"
```

---

### Task 4: Server-only registry access and server functions

**Files:**
- Create: `src/lib/broker/registry.ts`
- Create: `src/lib/broker/server-fns.ts`

- [ ] **Step 1: Create the registry accessor**

`src/lib/broker/registry.ts`:

```ts
import { supabaseAdmin } from "../supabase/server";
import { SupabaseRegistry } from "@services/registry/supabase";

// Server-only. Reuses the same service-role client the auth bridge already uses
// (src/lib/supabase/server.ts), one registry instance per server process.
let registry: SupabaseRegistry | null = null;

export function getRegistry(): SupabaseRegistry {
  registry ??= new SupabaseRegistry(supabaseAdmin());
  return registry;
}
```

- [ ] **Step 2: Create the server functions**

`src/lib/broker/server-fns.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import { getRegistry } from "./registry";

export const listProviders = createServerFn({ method: "GET" }).handler(async () => {
  return getRegistry().listProviders();
});

export const getProviderById = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => getRegistry().getProvider(data.id));

export const listMyRents = createServerFn({ method: "GET" })
  .validator((d: { userId: string }) => d)
  .handler(async ({ data }) => getRegistry().listRents({ userId: data.userId }));

export const listMyProviders = createServerFn({ method: "GET" })
  .validator((d: { ownerWallet: string }) => d)
  .handler(async ({ data }) => getRegistry().listProviders({ ownerWallet: data.ownerWallet }));

export const listProviderRents = createServerFn({ method: "GET" })
  .validator((d: { providerId: string }) => d)
  .handler(async ({ data }) => getRegistry().listRents({ providerId: data.providerId }));
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/broker/registry.ts src/lib/broker/server-fns.ts
git commit -m "feat(broker): server functions exposing registry reads to the frontend"
```

---

### Task 5: `ProviderCard.tsx` — real `Provider` type

**Files:**
- Modify: `src/components/site/ProviderCard.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { Link } from "@tanstack/react-router";
import { Cpu, MemoryStick, HardDrive, MapPin, Zap } from "lucide-react";
import { ComputeScoreRing } from "./ComputeScoreRing";
import { Button } from "@/components/ui/button";
import type { Provider } from "@services/domain";

export function ProviderCard({ p, onRent }: { p: Provider; onRent?: (p: Provider) => void }) {
  const gpu = p.specs.gpu as string | undefined;
  const vramGb = p.specs.vramGb as number | undefined;
  const cpuCores = p.specs.cpuCores as number | undefined;
  const ramGb = p.specs.ramGb as number | undefined;
  const storageGb = p.specs.storageGb as number | undefined;
  const uptimePct = Math.min(100, Math.max(0, p.trust.signals.uptime * 100));

  return (
    <div className="glass-card glow-hover p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${p.online ? "bg-success pulse-ring" : "bg-destructive"}`}
            />
            <span className="text-sm font-medium text-foreground">{p.alias}</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {p.region}
            <span className="mx-1">·</span>
            {p.resourceType}
          </div>
        </div>
        <ComputeScoreRing score={p.computeScore} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {gpu && (
          <div className="col-span-2 flex items-center gap-1.5 text-foreground">
            <Zap className="h-3.5 w-3.5 text-glow" />
            <span className="truncate">{gpu}</span>
            {vramGb !== undefined && <span className="text-muted-foreground">· {vramGb}GB VRAM</span>}
          </div>
        )}
        {cpuCores !== undefined && (
          <div className="flex items-center gap-1.5 text-muted-foreground"><Cpu className="h-3.5 w-3.5" />{cpuCores} cores</div>
        )}
        {ramGb !== undefined && (
          <div className="flex items-center gap-1.5 text-muted-foreground"><MemoryStick className="h-3.5 w-3.5" />{ramGb} GB</div>
        )}
        {storageGb !== undefined && (
          <div className="flex items-center gap-1.5 text-muted-foreground col-span-2"><HardDrive className="h-3.5 w-3.5" />{storageGb} GB SSD</div>
        )}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Rate</div>
          <div className="text-base font-semibold text-foreground">
            ${p.pricePerCharge.toFixed(7)}<span className="text-xs text-muted-foreground"> /sec</span>
          </div>
        </div>
        <div className="flex gap-1">
          <Pill>{uptimePct.toFixed(2)}%</Pill>
          <Pill>{p.trust.signals.successfulRentals.toLocaleString()} jobs</Pill>
          <Pill>{p.avgLatencyMs.toFixed(1)}ms</Pill>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button asChild variant="ghost" size="sm" className="flex-1 border border-border hover:bg-card">
          <Link to="/marketplace/$id" params={{ id: p.id }}>Details</Link>
        </Button>
        <Button
          size="sm"
          className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
          disabled={!p.online}
          onClick={() => onRent?.(p)}
        >
          Rent
        </Button>
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="hidden md:inline-flex items-center rounded-full border border-border bg-surface/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {children}
    </span>
  );
}
```

GPU/CPU/RAM/storage rows are now conditional: real seed data for CPU-type providers only sets `{ cpuCores, ramGb }` in `specs` (no `storageGb`), unlike the mock data which always populated every field.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors in `marketplace.index.tsx` and `marketplace.$id.tsx` only (they still import `Provider` from mock-data and pass it to `ProviderCard`, which now expects the real type) — that's expected, fixed in Tasks 6 and 7.

- [ ] **Step 3: Commit**

```bash
git add src/components/site/ProviderCard.tsx
git commit -m "refactor(marketplace): ProviderCard uses the real Provider type"
```

---

### Task 6: `marketplace.index.tsx` — real listing and rent sheet

**Files:**
- Modify: `src/routes/marketplace.index.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Filter as FilterIcon } from "lucide-react";
import confetti from "canvas-confetti";
import { ProviderCard } from "@/components/site/ProviderCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet";
import type { Provider, ResourceType } from "@services/domain";
import { listProviders } from "@/lib/broker/server-fns";
import { supabaseBrowser } from "@/lib/supabase/client";

export const Route = createFileRoute("/marketplace/")({
  loader: () => listProviders(),
  component: MarketplaceIndex,
});

const allTypes: ResourceType[] = ["GPU", "CPU", "Storage"];

function MarketplaceIndex() {
  const providers = Route.useLoaderData();
  const [q, setQ] = useState("");
  const [types, setTypes] = useState<ResourceType[]>(["GPU", "CPU", "Storage"]);
  const [minScore, setMinScore] = useState(0);
  const [maxPrice, setMaxPrice] = useState(0.00003);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [rentFor, setRentFor] = useState<Provider | null>(null);

  const filtered = useMemo(() => {
    return providers.filter((p) => {
      if (q && !p.alias.toLowerCase().includes(q.toLowerCase())) return false;
      if (!types.includes(p.resourceType as ResourceType) && p.resourceType !== "Full Server")
        return false;
      if (p.computeScore < minScore) return false;
      if (p.pricePerCharge > maxPrice) return false;
      if (availableOnly && !p.online) return false;
      return true;
    });
  }, [providers, q, types, minScore, maxPrice, availableOnly]);

  const toggleType = (t: ResourceType) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
        <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-glow">Marketplace</div>
            <h1 className="mt-1 text-3xl md:text-4xl font-bold">Compute Marketplace</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {filtered.length} providers match your filters
            </p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search providers..."
                className="pl-9 bg-surface/60 border-border"
              />
            </div>
          </div>
        </header>

        <div className="grid lg:grid-cols-[260px_1fr] gap-8">
          <aside className="hidden lg:block">
            <FiltersPanel
              types={types}
              toggleType={toggleType}
              minScore={minScore}
              setMinScore={setMinScore}
              maxPrice={maxPrice}
              setMaxPrice={setMaxPrice}
              availableOnly={availableOnly}
              setAvailableOnly={setAvailableOnly}
            />
          </aside>

          <div>
            <div className="lg:hidden mb-4">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" className="border border-border w-full">
                    <FilterIcon className="h-4 w-4" /> Filters
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="bg-surface border-border">
                  <SheetHeader>
                    <SheetTitle>Filters</SheetTitle>
                  </SheetHeader>
                  <div className="mt-6">
                    <FiltersPanel
                      types={types}
                      toggleType={toggleType}
                      minScore={minScore}
                      setMinScore={setMinScore}
                      maxPrice={maxPrice}
                      setMaxPrice={setMaxPrice}
                      availableOnly={availableOnly}
                      setAvailableOnly={setAvailableOnly}
                    />
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((p) => (
                <ProviderCard key={p.id} p={p} onRent={(prov) => setRentFor(prov)} />
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full glass-card p-10 text-center text-muted-foreground">
                  No providers match. Loosen your filters.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <RentSheet provider={rentFor} onClose={() => setRentFor(null)} />
    </>
  );
}

function FiltersPanel({
  types,
  toggleType,
  minScore,
  setMinScore,
  maxPrice,
  setMaxPrice,
  availableOnly,
  setAvailableOnly,
}: {
  types: ResourceType[];
  toggleType: (t: ResourceType) => void;
  minScore: number;
  setMinScore: (n: number) => void;
  maxPrice: number;
  setMaxPrice: (n: number) => void;
  availableOnly: boolean;
  setAvailableOnly: (v: boolean) => void;
}) {
  return (
    <div className="space-y-6 glass-card p-5">
      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Resource type
        </Label>
        <div className="mt-3 space-y-2">
          {allTypes.map((t) => (
            <label
              key={t}
              className="flex items-center gap-2 text-sm text-foreground cursor-pointer"
            >
              <Checkbox checked={types.includes(t)} onCheckedChange={() => toggleType(t)} />
              {t}
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Min compute score
          </Label>
          <span className="text-xs text-foreground">{minScore}</span>
        </div>
        <Slider
          className="mt-3"
          value={[minScore]}
          min={0}
          max={100}
          step={1}
          onValueChange={(v) => setMinScore(v[0])}
        />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Max $/sec
          </Label>
          <span className="text-xs text-foreground">${maxPrice.toFixed(7)}</span>
        </div>
        <Slider
          className="mt-3"
          value={[maxPrice]}
          min={0.000001}
          max={0.00003}
          step={0.0000005}
          onValueChange={(v) => setMaxPrice(v[0])}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label className="text-sm">Available now only</Label>
        <Switch checked={availableOnly} onCheckedChange={setAvailableOnly} />
      </div>
    </div>
  );
}

function RentSheet({ provider, onClose }: { provider: Provider | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(15);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const budget = provider ? (duration * 60 * provider.pricePerCharge).toFixed(4) : "0";
  const gpu = provider?.specs.gpu as string | undefined;
  const vramGb = provider?.specs.vramGb as number | undefined;
  const cpuCores = provider?.specs.cpuCores as number | undefined;
  const ramGb = provider?.specs.ramGb as number | undefined;

  async function submit() {
    const { data } = await supabaseBrowser.auth.getSession();
    if (!data.session) {
      router.navigate({ to: "/onboarding", search: { redirect: router.state.location.pathname } });
      return;
    }

    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setDone(true);
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.4 } });
    }, 1100);
  }

  return (
    <Sheet
      open={!!provider}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setDone(false);
          setName("");
        }
      }}
    >
      <SheetContent className="bg-surface border-border">
        <SheetHeader>
          <SheetTitle>Rent{provider ? ` from ${provider.alias}` : ""}</SheetTitle>
        </SheetHeader>
        {provider && !done && (
          <div className="mt-6 space-y-5">
            <div>
              <Label>Job name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. llama-fine-tune"
                className="mt-2 bg-card border-border"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Stat label="GPU" value={gpu ?? "—"} />
              <Stat label="VRAM" value={vramGb ? `${vramGb} GB` : "—"} />
              <Stat label="CPU" value={cpuCores ? `${cpuCores} cores` : "—"} />
              <Stat label="RAM" value={ramGb ? `${ramGb} GB` : "—"} />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label>Estimated duration</Label>
                <span className="text-sm text-foreground">{duration} min</span>
              </div>
              <Slider
                className="mt-3"
                value={[duration]}
                min={1}
                max={240}
                step={1}
                onValueChange={(v) => setDuration(v[0])}
              />
            </div>
            <div className="glass-card p-4">
              <div className="text-xs text-muted-foreground">Estimated max budget</div>
              <div className="mt-1 text-2xl font-semibold text-gradient-blue">${budget}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                at ${provider.pricePerCharge.toFixed(7)}/s · streaming, refundable on cancel
              </div>
            </div>
            <SheetFooter>
              <Button
                onClick={submit}
                disabled={submitting || !name}
                className="w-full bg-primary text-primary-foreground"
              >
                {submitting ? "Routing through broker…" : "Submit rent"}
              </Button>
            </SheetFooter>
          </div>
        )}
        {done && (
          <div className="mt-12 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-success/15 ring-1 ring-success/40 flex items-center justify-center text-success">
              ✓
            </div>
            <h3 className="mt-4 text-lg font-semibold">Job submitted</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              The broker is opening a payment stream now.
            </p>
            <Button
              onClick={() => {
                onClose();
                setDone(false);
                setName("");
              }}
              variant="ghost"
              className="mt-6 border border-border"
            >
              Close
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card/60 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground truncate">{value}</div>
    </div>
  );
}
```

Note the two stray mid-file imports (`supabaseBrowser`, `useRouter`) that existed in the old version are now at the top with everything else.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors only in `marketplace.$id.tsx`, `dashboard.tsx`, `provider.tsx` (still untouched) — fixed in the next tasks.

- [ ] **Step 3: Manually verify**

Run: `npm run dev`, sign in via `/onboarding`, visit `/marketplace`. Expected: the page loads with whatever providers exist in the real `providers` table (empty list + "No providers match" if the table hasn't been seeded — that's correct behavior, not a bug; seed via `cd services && bun run seed` with `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` set if you want data to look at).

- [ ] **Step 4: Commit**

```bash
git add src/routes/marketplace.index.tsx
git commit -m "feat(marketplace): load providers from the registry instead of mock data"
```

---

### Task 7: `marketplace.$id.tsx` — real detail page, drop fabricated tabs

**Files:**
- Modify: `src/routes/marketplace.$id.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, MapPin } from "lucide-react";
import { ComputeScoreRing } from "@/components/site/ComputeScoreRing";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { RentStatus } from "@services/domain";
import { getProviderById, listProviderRents } from "@/lib/broker/server-fns";

export const Route = createFileRoute("/marketplace/$id")({
  loader: async ({ params }) => {
    const p = await getProviderById({ data: { id: params.id } });
    if (!p) throw notFound();
    const rents = await listProviderRents({ data: { providerId: p.id } });
    return { p, rents };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.p.alias} — Prime Compute` },
      { name: "description", content: `${loaderData?.p.alias} provider details: hardware, job history, and pricing.` },
    ],
  }),
  component: ProviderDetail,
  notFoundComponent: () => (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="text-3xl font-bold">Provider not found</h1>
      <Button asChild className="mt-6"><Link to="/marketplace">Back to marketplace</Link></Button>
    </div>
  ),
  errorComponent: () => (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">Couldn't load this provider</h1>
    </div>
  ),
});

function ProviderDetail() {
  const { p, rents } = Route.useLoaderData();
  const [tab, setTab] = useState("overview");
  const gpu = p.specs.gpu as string | undefined;
  const vramGb = p.specs.vramGb as number | undefined;
  const cpuCores = p.specs.cpuCores as number | undefined;
  const ramGb = p.specs.ramGb as number | undefined;
  const storageGb = p.specs.storageGb as number | undefined;
  const uptimePct = Math.min(100, Math.max(0, p.trust.signals.uptime * 100));

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 pb-32 md:pb-12">
      <Link to="/marketplace" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to marketplace
      </Link>

      <div className="mt-6 glass-card p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            <ComputeScoreRing score={p.computeScore} size={72} />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl md:text-3xl font-bold">{p.alias}</h1>
                <Badge className={p.online ? "bg-success/15 text-success border border-success/30" : "bg-destructive/15 text-destructive"}>
                  {p.online ? "online" : "offline"}
                </Badge>
              </div>
              <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> {p.region} · {p.resourceType}
              </div>
            </div>
          </div>
          <Button size="lg" className="bg-primary text-primary-foreground" disabled={!p.online}>Rent</Button>
        </div>

        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Rate" value={`$${p.pricePerCharge.toFixed(7)}/s`} />
          <Stat label="Uptime" value={`${uptimePct.toFixed(2)}%`} />
          <Stat label="Jobs completed" value={p.trust.signals.successfulRentals.toLocaleString()} />
          <Stat label="Avg latency" value={`${p.avgLatencyMs.toFixed(1)}ms`} />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-8">
        <TabsList className="bg-surface border border-border">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="history">Job history</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 glass-card p-6">
          <h3 className="font-semibold mb-4">Hardware</h3>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {[
                ["GPU", gpu ?? "—"],
                ["VRAM", vramGb ? `${vramGb} GB` : "—"],
                ["CPU cores", cpuCores ? `${cpuCores}` : "—"],
                ["RAM", ramGb ? `${ramGb} GB` : "—"],
                ["Storage", storageGb ? `${storageGb} GB SSD` : "—"],
                ["Region", p.region],
              ].map(([k, v]) => (
                <tr key={k}><td className="py-2 text-muted-foreground">{k}</td><td className="py-2 text-right text-foreground">{v}</td></tr>
              ))}
            </tbody>
          </table>
        </TabsContent>

        <TabsContent value="history" className="mt-6 glass-card p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-muted-foreground text-left">
                <th className="py-2">Rent</th><th>Duration</th><th>Cost</th><th>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rents.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 font-mono text-xs">{r.name}</td>
                  <td>{r.startedAt && r.endedAt ? `${Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000)}m` : "—"}</td>
                  <td>${r.totalCost.toFixed(4)}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
              {rents.length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No rents yet.</td></tr>
              )}
            </tbody>
          </table>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface/60 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-foreground">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: RentStatus }) {
  const map: Record<RentStatus, string> = {
    completed: "bg-success/15 text-success border-success/30",
    cancelled: "bg-warning/15 text-warning border-warning/30",
    failed: "bg-destructive/15 text-destructive border-destructive/30",
    running: "bg-primary/15 text-glow border-primary/30",
    paused: "bg-muted/40 text-muted-foreground border-border",
    queued: "bg-muted/40 text-muted-foreground border-border",
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${map[status]}`}>{status}</span>;
}
```

The Benchmarks tab, Reviews tab, and 30-day uptime chart are gone entirely (no `recharts` import left in this file), along with their imports (`uptime30d`, `benchmarkData`, `reviews`, `Star`, chart components).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors only in `dashboard.tsx` and `provider.tsx`.

- [ ] **Step 3: Manually verify**

Run: `npm run dev`, open a provider's detail page from `/marketplace`. Expected: Overview and Job history tabs only, no Benchmarks/Reviews, no uptime chart.

- [ ] **Step 4: Commit**

```bash
git add src/routes/marketplace.\$id.tsx
git commit -m "feat(marketplace): provider detail page reads the registry; drop fabricated tabs"
```

---

### Task 8: `dashboard.tsx` — real rents, drop fabricated balance/charts

**Files:**
- Modify: `src/routes/dashboard.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { authGuard } from "../lib/auth/guard";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pause, Square, Copy, Plus } from "lucide-react";
import { AppShell } from "@/components/site/AppShell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { StreamingTicker, ElapsedTimer } from "@/components/site/StreamingTicker";
import { useSession } from "@/lib/auth/session";
import { listMyRents, listProviders } from "@/lib/broker/server-fns";
import type { Provider, Rent, RentStatus } from "@services/domain";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: authGuard,
  head: () => ({
    meta: [
      { title: "Consumer Dashboard — Prime Compute" },
      { name: "description", content: "Monitor your active jobs, history, and streaming spend." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = useSession();
  const userId = user?.id;

  const { data: rents = [] } = useQuery({
    queryKey: ["rents", "mine", userId],
    queryFn: () => listMyRents({ data: { userId: userId! } }),
    enabled: !!userId,
  });
  const { data: providers = [] } = useQuery({
    queryKey: ["providers"],
    queryFn: () => listProviders(),
  });
  const providersById = Object.fromEntries(providers.map((p) => [p.id, p]));

  const activeRents = rents.filter((r) => r.status === "running" || r.status === "queued" || r.status === "paused");
  const historyRents = rents.filter((r) => r.status === "completed" || r.status === "cancelled" || r.status === "failed");
  const runningRents = rents.filter((r) => r.status === "running");
  const streamingRate = runningRents.reduce(
    (acc, r) => acc + (r.providerId ? (providersById[r.providerId]?.pricePerCharge ?? 0) : 0),
    0,
  );
  const totalSpent = rents.reduce((s, r) => s + r.totalCost, 0);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="text-[11px] uppercase tracking-wider text-glow">Consumer</div>
        <h1 className="mt-1 text-3xl md:text-4xl font-bold">Dashboard</h1>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success pulse-ring" />
            {runningRents.length} jobs running
          </span>
          <span>
            streaming <span className="text-glow font-mono">${streamingRate.toFixed(7)}/sec</span>
          </span>
        </div>

        <Tabs defaultValue="active" className="mt-8">
          <TabsList className="bg-surface border border-border">
            <TabsTrigger value="active">Active jobs</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-6 grid gap-4 lg:grid-cols-2">
            {activeRents.map((r) => (
              <ActiveJobCard key={r.id} rent={r} provider={r.providerId ? providersById[r.providerId] : undefined} />
            ))}
            {activeRents.length === 0 && (
              <div className="col-span-full glass-card p-10 text-center text-muted-foreground">
                No active jobs. Head to the marketplace to rent some compute.
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-6 glass-card p-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-muted-foreground text-left">
                  <th className="py-2">Job</th>
                  <th>Provider</th>
                  <th>Duration</th>
                  <th>Cost</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {historyRents.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2">{r.name}</td>
                    <td className="text-muted-foreground">{r.providerId ? providersById[r.providerId]?.alias ?? "—" : "—"}</td>
                    <td>{r.startedAt && r.endedAt ? `${Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000)}m` : "—"}</td>
                    <td>${r.totalCost.toFixed(4)}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="text-muted-foreground text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
                {historyRents.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No completed jobs yet.</td></tr>
                )}
              </tbody>
            </table>
          </TabsContent>

          <TabsContent value="billing" className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="glass-card p-6 lg:col-span-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Total spent</div>
              <div className="mt-2 text-3xl font-bold text-gradient-blue">${totalSpent.toFixed(4)}</div>
              <div className="mt-1 text-xs text-muted-foreground">across {rents.length} rent{rents.length === 1 ? "" : "s"}</div>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="glass-card p-6 space-y-4">
              <h3 className="font-semibold">Notifications</h3>
              {["Job completed", "Job failed", "Low balance", "Migration events"].map((l) => (
                <div key={l} className="flex items-center justify-between">
                  <Label>{l}</Label>
                  <Switch defaultChecked />
                </div>
              ))}
            </div>
            <div className="glass-card p-6 space-y-4">
              <h3 className="font-semibold">API key</h3>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value="pc_live_••••••••••••••sk29x"
                  className="font-mono bg-card border-border"
                />
                <Button variant="ghost" size="icon" className="border border-border">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <Label>Default payment</Label>
              <Input readOnly value="USDC · 0x4F…91Ae" className="font-mono bg-card border-border" />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function ActiveJobCard({ rent, provider }: { rent: Rent; provider: Provider | undefined }) {
  const [paused, setPaused] = useState(false);
  const startedAtMs = rent.startedAt ? new Date(rent.startedAt).getTime() : Date.now();
  return (
    <div className="glass-card glow-hover p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-medium">{rent.name}</div>
          <div className="text-xs text-muted-foreground">on {provider?.alias ?? "unmatched"}</div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-success">
          <span className={`h-1.5 w-1.5 rounded-full bg-success ${paused ? "" : "pulse-ring"}`} />
          {rent.status}
        </span>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Streaming spend
          </div>
          <StreamingTicker
            ratePerSecond={provider?.pricePerCharge ?? 0}
            startedAt={startedAtMs}
            paused={paused || rent.status !== "running"}
            className="text-2xl font-semibold text-gradient-blue"
          />
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Elapsed</div>
          <div className="text-sm text-foreground">
            <ElapsedTimer startedAt={startedAtMs} paused={paused} />
          </div>
        </div>
      </div>
      <div className="mt-5 flex gap-2">
        <Button
          variant="ghost"
          className="flex-1 border border-border"
          onClick={() => setPaused((v) => !v)}
        >
          <Pause className="h-4 w-4" /> {paused ? "Resume" : "Pause"}
        </Button>
        <Button
          variant="ghost"
          className="flex-1 border border-destructive/30 text-destructive hover:bg-destructive/10"
        >
          <Square className="h-4 w-4" /> Stop
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: RentStatus }) {
  const map: Record<RentStatus, string> = {
    completed: "bg-success/15 text-success border-success/30",
    cancelled: "bg-warning/15 text-warning border-warning/30",
    failed: "bg-destructive/15 text-destructive border-destructive/30",
    running: "bg-primary/15 text-glow border-primary/30",
    paused: "bg-muted/40 text-muted-foreground border-border",
    queued: "bg-muted/40 text-muted-foreground border-border",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${map[status]}`}
    >
      {status}
    </span>
  );
}
```

Removed: the `wallet $1,284.93` stat, `8ms broker match` stat, the Billing tab's fake `Balance` card and "Add funds" button, the "Spend · 30 days" chart, and the "Recent transactions" table (all `recharts` imports gone from this file too). `UsageBar`/CPU/RAM telemetry dropped from `ActiveJobCard` since there's no real per-job telemetry source. Pause/Stop buttons keep their existing local-only UI behavior (no backend call existed before either; wiring them to a real pause/stop action is a write, out of scope here).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors only in `provider.tsx`.

- [ ] **Step 3: Manually verify**

Run: `npm run dev`, sign in, visit `/dashboard`. Expected: Active jobs / History / Billing tabs show real (likely empty) rent data for the signed-in user, no fake balance or charts.

- [ ] **Step 4: Commit**

```bash
git add src/routes/dashboard.tsx
git commit -m "feat(dashboard): read rents from the registry; drop fabricated balance and charts"
```

---

### Task 9: `provider.tsx` — real servers and jobs, drop fabricated earnings

**Files:**
- Modify: `src/routes/provider.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { authGuard } from "../lib/auth/guard";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/site/AppShell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ComputeScoreRing } from "@/components/site/ComputeScoreRing";
import { StreamingTicker } from "@/components/site/StreamingTicker";
import { useSession } from "@/lib/auth/session";
import { listMyProviders, listProviderRents } from "@/lib/broker/server-fns";
import type { Provider, Rent } from "@services/domain";

export const Route = createFileRoute("/provider")({
  beforeLoad: authGuard,
  head: () => ({
    meta: [
      { title: "Provider Dashboard — Prime Compute" },
      { name: "description", content: "Manage your servers, jobs, and earnings as a Prime Compute provider." },
    ],
  }),
  component: ProviderDash,
});

function ProviderDash() {
  const { walletAddress } = useSession();

  const { data: myServers = [] } = useQuery({
    queryKey: ["providers", "mine", walletAddress],
    queryFn: () => listMyProviders({ data: { ownerWallet: walletAddress! } }),
    enabled: !!walletAddress,
  });

  const serverIds = myServers.map((s) => s.id);
  const { data: rentsByProvider = {} } = useQuery({
    queryKey: ["rents", "forProviders", serverIds],
    queryFn: async () => {
      const lists = await Promise.all(
        serverIds.map((id) => listProviderRents({ data: { providerId: id } })),
      );
      return Object.fromEntries(serverIds.map((id, i) => [id, lists[i]]));
    },
    enabled: serverIds.length > 0,
  });

  const allRents = Object.values(rentsByProvider).flat();
  const totalEarned = allRents.reduce((s, r) => s + r.totalCost, 0);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
        <div className="text-[11px] uppercase tracking-wider text-glow">Provider</div>
        <h1 className="mt-1 text-3xl md:text-4xl font-bold">Server operations</h1>

        <Tabs defaultValue="servers" className="mt-8">
          <TabsList className="bg-surface border border-border">
            <TabsTrigger value="servers">My servers</TabsTrigger>
            <TabsTrigger value="earnings">Earnings</TabsTrigger>
            <TabsTrigger value="jobs">Jobs</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="servers" className="mt-6 grid gap-4 lg:grid-cols-2">
            {myServers.map((s) => (
              <ServerCard key={s.id} server={s} rents={rentsByProvider[s.id] ?? []} />
            ))}
            {myServers.length === 0 && (
              <div className="col-span-full glass-card p-10 text-center text-muted-foreground">
                No servers registered to this wallet yet.
              </div>
            )}
          </TabsContent>

          <TabsContent value="earnings" className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="glass-card p-6 lg:col-span-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Total earned</div>
              <div className="mt-2 text-3xl font-bold text-gradient-blue">${totalEarned.toFixed(4)}</div>
              <div className="mt-1 text-xs text-muted-foreground">across {allRents.length} job{allRents.length === 1 ? "" : "s"}</div>
            </div>
          </TabsContent>

          <TabsContent value="jobs" className="mt-6 glass-card p-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs uppercase tracking-wider text-muted-foreground text-left"><th className="py-2">Job</th><th>Duration</th><th>Earned</th><th>Status</th></tr></thead>
              <tbody className="divide-y divide-border">
                {allRents.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2">{r.name}</td>
                    <td>{r.startedAt && r.endedAt ? `${Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000)}m` : "—"}</td>
                    <td>${r.totalCost.toFixed(4)}</td>
                    <td className="text-muted-foreground">{r.status}</td>
                  </tr>
                ))}
                {allRents.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No jobs yet.</td></tr>
                )}
              </tbody>
            </table>
          </TabsContent>

          <TabsContent value="settings" className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="glass-card p-6 space-y-4">
              <h3 className="font-semibold">Auto-accept</h3>
              <div className="flex items-center justify-between"><Label>Accept matched jobs automatically</Label><Switch defaultChecked /></div>
              <div className="flex items-center justify-between"><Label>Allow job migration in</Label><Switch defaultChecked /></div>
            </div>
            <div className="glass-card p-6 space-y-4">
              <h3 className="font-semibold">Payout wallet</h3>
              <Input readOnly value={walletAddress ?? "—"} className="font-mono bg-card border-border" />
              <Label>Minimum payout</Label>
              <Input defaultValue="50" className="bg-card border-border" />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function ServerCard({ server, rents }: { server: Provider; rents: Rent[] }) {
  const [online, setOnline] = useState(server.online);
  const runningRent = rents.find((r) => r.status === "running");
  const cpuCores = server.specs.cpuCores as number | undefined;
  const ramGb = server.specs.ramGb as number | undefined;
  const storageGb = server.specs.storageGb as number | undefined;
  const gpu = server.specs.gpu as string | undefined;

  return (
    <div className="glass-card glow-hover p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-medium">{server.alias}</div>
          <div className="text-xs text-muted-foreground">{server.region} · {gpu ?? (cpuCores ? `${cpuCores} cores` : "—")}</div>
        </div>
        <div className="flex items-center gap-3">
          <ComputeScoreRing score={server.computeScore} size={40} />
          <Switch checked={online} onCheckedChange={setOnline} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        <div><div className="text-foreground">{cpuCores ?? "—"}</div>cores</div>
        <div><div className="text-foreground">{ramGb ? `${ramGb}GB` : "—"}</div>ram</div>
        <div><div className="text-foreground">{storageGb ? `${storageGb}GB` : "—"}</div>ssd</div>
      </div>
      {runningRent && online ? (
        <div className="mt-4 rounded-lg border border-border bg-surface/60 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{runningRent.name}</span>
            <span className="inline-flex items-center gap-1 text-success"><span className="h-1.5 w-1.5 rounded-full bg-success pulse-ring" />running</span>
          </div>
          <div className="mt-2 flex items-end justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Earning</div>
              <StreamingTicker
                ratePerSecond={server.pricePerCharge}
                startedAt={runningRent.startedAt ? new Date(runningRent.startedAt).getTime() : Date.now()}
                className="text-lg font-semibold text-gradient-blue"
              />
            </div>
            <div className="text-xs text-muted-foreground">${server.pricePerCharge.toFixed(7)}/s</div>
          </div>
        </div>
      ) : (
        <div className="mt-4 text-xs text-muted-foreground">{online ? "Waiting for matched jobs…" : "Server offline. Toggle to start accepting jobs."}</div>
      )}
    </div>
  );
}
```

Removed: `Lifetime`/`This month` hardcoded earnings, the "Daily earnings · 30d" chart, the "Payouts" table (`Math.random()` tx hashes), and the per-card `Earnings today` line, along with the `recharts` and `historicalJobs`/`earnings30d`/`providers` mock imports. The "currently earning" block in `ServerCard` now checks for a real `running` rent on that server instead of the old hardcoded `hasJob={i === 0}`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in `src/` except `mock-data.ts` itself still existing unused (fine, removed in Task 10).

- [ ] **Step 3: Manually verify**

Run: `npm run dev`, sign in with a wallet that owns seeded providers (or any wallet, expect "No servers registered"), visit `/provider`. Expected: real server list, no fabricated earnings numbers.

- [ ] **Step 4: Commit**

```bash
git add src/routes/provider.tsx
git commit -m "feat(provider): read servers and jobs from the registry; drop fabricated earnings"
```

---

### Task 10: Delete `mock-data.ts`

**Files:**
- Delete: `src/lib/mock-data.ts`

- [ ] **Step 1: Verify no remaining importers**

Run: `grep -rln "mock-data" src`
Expected: no output (empty).

- [ ] **Step 2: Delete the file**

```bash
git rm src/lib/mock-data.ts
```

- [ ] **Step 3: Full verification**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete mock-data.ts, nothing reads it anymore"
```

---

## Self-Review Notes

- **Spec coverage:** every numbered item in the spec's Architecture and Page-by-page sections maps to a task above (registry extension → Tasks 1-2, build wiring → Task 3, server access → Task 4, the five page rewires → Tasks 5-9, cleanup → Task 10).
- **Type consistency:** `Provider`, `Rent`, `RentStatus`, `RentFilter`, `ProviderFilter` are used identically across every task that touches them; `pricePerCharge` (never `pricePerSecond`) and `specs.*` (never flat `gpu`/`vramGb`/etc.) are consistent everywhere after Task 5 onward.
- **No write paths touched:** `register.tsx`'s local `pricePerSecond` form state, `RentSheet`'s simulated submit, and the pause/stop buttons are explicitly left alone in every task that's adjacent to them.
