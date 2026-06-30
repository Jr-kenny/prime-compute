# Sub-project A: Live-data read path — Design

**Status:** approved (brainstormed 2026-06-30). Next: implementation plan via writing-plans.

**One-line contract:** Every read the frontend renders comes from the real `services/` registry;
if the registry doesn't expose a piece of data, the UI doesn't pretend it exists.

This is **sub-project A**, named in the Phase 0 design as the first of three downstream pieces
(A live-data read path, B control bridge, C Lumen conversational deploy). Phase 0 proved every
authenticated user has a session and a wallet. This phase proves the frontend can show that
user real broker data instead of `src/lib/mock-data.ts`.

---

## Scope

**In scope:** replace every mock-data read in the marketplace, marketplace detail, dashboard,
and provider-dashboard pages with reads from the real `services/` broker backend (the
`providers`, `rents`, `charges` tables via the existing `Registry` interface). Delete
`mock-data.ts` once nothing imports it.

**Out of scope, deliberately:** every write path. Creating a rent (the "Submit rent" button),
registering a new provider (`register.tsx`'s form), pausing/stopping a job, adding funds, none
of that changes in this PR. They stay exactly as they are today (UI-only simulations) and become
their own spec later. Keeping reads and writes in separate PRs keeps this one reviewable as a
single responsibility: swap data sources, change no behavior.

---

## Why this shape

`services/` already has a real, working broker backend (`Registry` interface, `SupabaseRegistry`,
proper tables for providers/rents/charges/decisions), built and proven across Plans 1-10. The
frontend has never imported from it; it's 100% disconnected, running entirely on
`mock-data.ts`'s twelve hardcoded providers and fabricated job history. This phase wires the two
together for reads, reusing the existing `Registry` interface as the single source of truth for
data shapes rather than duplicating query logic in the frontend.

---

## Architecture

### 1. Wire `services/` into the frontend build

Add a Vite alias `@services` → `services/src` (mirrors the existing `@` → `src` alias in
`vite.config.ts`) and add `services` to this app's `tsconfig.json` `include`. No new
dependencies: `@supabase/supabase-js` is already present, and everything under
`services/src/registry/`, `services/src/domain.ts`, and `services/src/trust/trust.ts` has zero
Bun-specific code, it imports cleanly into the Node/Vite server runtime.

### 2. `SupabaseRegistry` accepts an existing client

Today `SupabaseRegistry`'s constructor only takes `(url, serviceRoleKey)` and builds its own
client. Three existing scripts (`seed-providers.ts`, `broker-roundtrip.ts`,
`integration-roundtrip.ts`) call it that way and must keep working unchanged. Add an overload:

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
  // ...rest unchanged
}
```

When given a client, it's stored directly, never wrapped in a second `createClient` call. The
frontend's registry access becomes `new SupabaseRegistry(supabaseAdmin())`, reusing the existing
factory in `src/lib/supabase/server.ts` (the same one the auth bridge already uses). One source
of truth for the service-role client, zero new env vars.

### 3. Extend the `Registry` interface (additive only)

Two gaps, both filled the same way the interface already handles `listProviders`/`ProviderFilter`:

```ts
export type RentFilter = {
  userId?: string;
  providerId?: string;
  status?: RentStatus;
};

export type ProviderFilter = {
  resourceType?: ResourceType;
  onlineOnly?: boolean;
  ownerWallet?: string; // new
};

export interface Registry {
  // ...existing methods unchanged
  listRents(filter?: RentFilter): Promise<Rent[]>; // new
}
```

- `listRents({ userId })` powers the consumer dashboard (rents the signed-in user created).
- `listRents({ providerId })` powers a provider's "Jobs" tab (rents matched to one of their
  servers), `Rent.providerId` already exists on the domain type for exactly this.
- `ProviderFilter.ownerWallet` powers the provider dashboard's "My servers" (confirmed via
  `migrations/0001_init.sql`: `providers.owner_wallet` is the only user-link column on that
  table, there's no FK to `profiles`, so filtering by wallet address is correct, not assumed).

Implemented in both `SupabaseRegistry` (a `.eq(...)` clause per filter key, same pattern as the
existing ones) and `InMemoryRegistry` (an array filter), so the contract tests in
`registry/contract.ts` keep covering both implementations.

### 4. Server-only registry access: `src/lib/broker/registry.ts`

```ts
import { supabaseAdmin } from "../supabase/server";
import { SupabaseRegistry } from "@services/registry/supabase";

let registry: SupabaseRegistry | null = null;
export function getRegistry(): SupabaseRegistry {
  registry ??= new SupabaseRegistry(supabaseAdmin());
  return registry;
}
```

### 5. New server functions: `src/lib/broker/server-fns.ts`

Same shape as the existing `src/lib/auth/server-fns.ts` (`createServerFn`, server-only secrets
never reach the browser):

- `listProviders()` → marketplace listing
- `getProviderById({ id })` → marketplace detail page loader, replaces `findProvider`
- `listMyRents({ userId })` → dashboard, `rent.totalCost` is read directly off each row, **not**
  recomputed via `rentCost()` per rent. Traced `services/src/broker/runner.ts:81`: the broker
  already computes `rentCost()` once per cycle and persists it back via
  `updateRent({ totalCost })`, so the stored column is kept current. Calling `rentCost()` again
  per rent here would be an avoidable N+1 query.
- `listMyProviders({ ownerWallet })` → provider dashboard's "My servers"
- `listProviderRents({ providerId })` → provider dashboard's "Jobs" tab, one call per server
  shown (servers per owner is small, no pagination needed here)

### 6. Type ownership

Every UI component that currently does `import type { Provider } from "@/lib/mock-data"` (or
`ResourceType`, `JobStatus`) switches to importing from `services/src/domain.ts` instead:
`Provider`, `ResourceType`, `Rent`, `RentStatus`. `mock-data.ts` stops being a type source the
moment it stops being a data source.

`RentStatus` includes `"queued"`, which mock `JobStatus` never modeled. Every place that renders
a status badge (`dashboard.tsx`'s `StatusBadge`, `marketplace.$id.tsx`'s `StatusBadge`) gets a
`queued` entry added to its style map so a real queued rent can't silently fall through a
`Record<RentStatus, string>` lookup.

---

## Page-by-page changes

### `ProviderCard.tsx`
`Provider` type from `services`. `pricePerSecond` → `pricePerCharge`. Uptime display clamps:
`Math.min(100, Math.max(0, p.trust.signals.uptime * 100))`.

### `marketplace.index.tsx`
`Provider`/`ResourceType` types from `services`. Providers loaded via `listProviders()` in the
route loader. Filter logic and `RentSheet`'s budget math move from `pricePerSecond` to
`pricePerCharge`, renamed in the same pass as the data-source swap (no intermediate state mixing
the two units). `RentSheet`'s submit button keeps simulating, no `createRent` call.

### `marketplace.$id.tsx`
Loader uses `getProviderById({ id })` instead of `findProvider`. `pricePerSecond` →
`pricePerCharge`, uptime clamp as above. Three sections removed entirely, each fully fabricated
with no backing table or registry method: the **Benchmarks** tab, the **Reviews** tab, and the
**30-day uptime** chart. The **Job history** tab stays and becomes real: `listProviderRents({
providerId })`.

### `dashboard.tsx`
Rents loaded via `listMyRents({ userId: profile.id })` (from `useSession()`), partitioned
client-side into active (`running`/`queued`/`paused`) vs. history (`completed`/`cancelled`/
`failed`) rather than two separate calls. `JobStatus` → `RentStatus`, `queued` added to
`StatusBadge`'s map.

Fabricated content removed (none of it has a registry-backed source, and none of it came from
`mock-data.ts`, it was hardcoded directly in this file): the `wallet $1,284.93` stat-strip
figure, the `8ms broker match` stat, the Billing tab's `Balance $1,284.93` card and "Add funds"
button, the "Spend · 30 days" chart, and the "Recent transactions" mini-table (avoiding the same
per-rent `listCharges` N+1 shape already ruled out for `rentCost`). The Billing tab keeps one
real, zero-new-query figure: **Total spent**, computed client-side as `sum(rent.totalCost)` over
the rents already fetched for the History tab.

### `provider.tsx`
Servers loaded via `listMyProviders({ ownerWallet: walletAddress })`. Each server's Jobs come
from `listProviderRents({ providerId: server.id })`.

Fabricated content removed: `Lifetime $24,182.40` / `This month $1,847.20`, the "Daily earnings ·
30d" chart, the "Payouts" table (`Math.random()` tx hashes; `settlements` isn't even exposed by
`Registry`), and the per-card `Earnings today · $64.12`. `ServerCard`'s "currently earning" block
(today hardcoded as `hasJob={i === 0}` with a fake start time) is **replaced, not removed**: it
becomes a real check against that server's rents for one with `status: "running"`, showing the
server's real `pricePerCharge` if found.

---

## Cleanup

After all five files (`ProviderCard.tsx`, `dashboard.tsx`, `marketplace.$id.tsx`, `provider.tsx`,
`marketplace.index.tsx`, confirmed via `grep -rln "mock-data" src` as the exact current importer
set) are migrated, re-run that grep. Zero remaining matches before deleting `mock-data.ts`.

---

## Testing

- `services/` already has `registry/contract.ts`, a shared contract test run against both
  `InMemoryRegistry` and `SupabaseRegistry`. The new `listRents` method and `ProviderFilter`
  additions get contract test cases there, covering both implementations the same way every
  other Registry method already is.
- Frontend side: manual verification per page (marketplace shows seeded providers, dashboard
  shows a signed-in user's own rents and nobody else's, provider dashboard shows only servers
  owned by the signed-in wallet), since there's no existing frontend test harness for these
  routes to extend.

---

## Resulting PR shape

1. Add `listRents`/`RentFilter` and the `ownerWallet` filter to the `Registry` interface, both
   implementations, contract tests.
2. `SupabaseRegistry` constructor overload; frontend reuses `supabaseAdmin()`.
3. `src/lib/broker/registry.ts` + `src/lib/broker/server-fns.ts`.
4. Five page rewires: real types, real reads, fabricated sections removed or replaced per the
   table above.
5. Delete `mock-data.ts`.
6. No write path touched.
