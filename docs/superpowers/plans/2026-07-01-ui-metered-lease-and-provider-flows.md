# UI metered-lease + provider flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app real in-app entry points to list a server and to rent one, and make the rent flow honestly track the metered lease lifecycle (queued -> running with connect creds + real cost -> terminal) by polling the backend instead of faking progress.

**Architecture:** A pure `rentPhase(rent, provider)` helper maps backend status to display copy so the sheet renders declaratively. A shared `RentSheet` component (extracted from the marketplace index) creates the lease via the existing `createRent`, seeds the React Query cache with the returned rent, then polls a new owner-scoped `getMyRent` server-fn with a self-stopping interval. The marketplace grid and the provider detail page both use that one sheet. Adding a service is surfaced through the sidebar and the provider dashboard; `register.tsx` itself is unchanged.

**Tech Stack:** TanStack Start (React, SSR, deploys as a Cloudflare Worker), TanStack Query v5, Bun test, the existing `@services/domain` types and `src/lib/broker` server-fns.

This is the UI layer of `docs/superpowers/specs/2026-07-01-ui-metered-lease-and-provider-flows-design.md`, sitting on top of the merged metering worker. The frontend never predicts transitions: `createRent` makes the lease, the worker advances it, React Query reflects that truth, the sheet renders it.

---

## File structure

- `src/lib/broker/rent-phase.ts` - pure `rentPhase(rent, provider)` -> `{ phase, title, description, canConnect, terminal }`. The declarative core, no React.
- `src/lib/broker/rent-phase.test.ts` - unit tests for every status + the provider-gone case.
- `src/lib/broker/server-fns.ts` - add `getMyRent(accessToken, rentId)` (owner-scoped single-rent read).
- `src/components/site/RentSheet.tsx` - the shared rent flow (form -> live tracking). Moved out of the marketplace index and extended with polling.
- `src/routes/marketplace.index.tsx` - drop the local `RentSheet`/`Stat`, import the shared one.
- `src/routes/marketplace.$id.tsx` - wire the dead "Rent" button to open the shared `RentSheet`.
- `src/components/site/Sidebar.tsx` - add a "List a server" nav link.
- `src/routes/provider.tsx` - add a "List a server" button (header + empty state).

---

## Task 1: `rentPhase` pure helper

**Files:**
- Create: `src/lib/broker/rent-phase.ts`
- Test: `src/lib/broker/rent-phase.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/broker/rent-phase.test.ts
import { test, expect } from "bun:test";
import { rentPhase } from "./rent-phase";
import type { Rent, Provider } from "@services/domain";
import { defaultTrust } from "@services/trust/trust";

function rent(partial: Partial<Rent>): Rent {
  return {
    id: "r1", name: "n", userId: "u1", spec: { resourceType: "GPU", region: null },
    estimatedUsage: null, autonomyArmed: false, status: "queued", providerId: null,
    totalCost: 0, createdAt: "", startedAt: null, endedAt: null,
    lastChargedAt: null, leaseAccessToken: null, ...partial,
  };
}

const provider: Provider = {
  id: "p1", alias: "p", ownerWallet: "0x", endpointUrl: "http://localhost:1", resourceType: "GPU",
  region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001,
  computeScore: 90, avgLatencyMs: 5,
};

test("queued is non-terminal and cannot connect", () => {
  const p = rentPhase(rent({ status: "queued" }), provider);
  expect(p.phase).toBe("queued");
  expect(p.terminal).toBe(false);
  expect(p.canConnect).toBe(false);
});

test("running with a token and a provider can connect", () => {
  const p = rentPhase(rent({ status: "running", leaseAccessToken: "tok" }), provider);
  expect(p.phase).toBe("running");
  expect(p.canConnect).toBe(true);
  expect(p.terminal).toBe(false);
});

test("running cannot connect when the provider is gone", () => {
  const p = rentPhase(rent({ status: "running", leaseAccessToken: "tok" }), undefined);
  expect(p.canConnect).toBe(false); // rent still shown, just not connectable
});

test("running cannot connect without a token yet", () => {
  const p = rentPhase(rent({ status: "running", leaseAccessToken: null }), provider);
  expect(p.canConnect).toBe(false);
});

test("suspended is non-terminal and points at the wallet", () => {
  const p = rentPhase(rent({ status: "suspended" }), provider);
  expect(p.phase).toBe("suspended");
  expect(p.terminal).toBe(false);
  expect(p.description.toLowerCase()).toContain("top up");
});

test("paused is handled (non-terminal, no connect)", () => {
  const p = rentPhase(rent({ status: "paused" }), provider);
  expect(p.phase).toBe("paused");
  expect(p.terminal).toBe(false);
  expect(p.canConnect).toBe(false);
});

test("terminal statuses are terminal and cannot connect", () => {
  for (const status of ["completed", "cancelled", "failed"] as const) {
    const p = rentPhase(rent({ status }), provider);
    expect(p.phase).toBe(status);
    expect(p.terminal).toBe(true);
    expect(p.canConnect).toBe(false);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/broker/rent-phase.test.ts`
Expected: FAIL, "Cannot find module './rent-phase'".

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/broker/rent-phase.ts
import type { Rent, Provider, RentStatus } from "@services/domain";

// Display shape derived purely from backend truth. phase mirrors the real RentStatus (including
// paused) so the mapping stays exhaustive; the sheet renders from this, no branching in JSX.
export type RentPhase = {
  phase: RentStatus;
  title: string;
  description: string;
  canConnect: boolean; // running AND we have a token AND the provider resolves
  terminal: boolean;
};

const TERMINAL: RentStatus[] = ["completed", "cancelled", "failed"];

export function rentPhase(rent: Rent, provider: Provider | undefined): RentPhase {
  const terminal = TERMINAL.includes(rent.status);
  switch (rent.status) {
    case "queued":
      return {
        phase: "queued",
        title: "Waiting for a provider",
        description: "The broker is matching your rent to a provider. Billing starts once it's running.",
        canConnect: false,
        terminal: false,
      };
    case "running":
      return {
        phase: "running",
        title: "Running",
        description: provider
          ? "Your lease is live and metering real USDC as it runs."
          : "Your lease is live, but its provider is unavailable right now.",
        canConnect: !!rent.leaseAccessToken && !!provider,
        terminal: false,
      };
    case "paused":
      return {
        phase: "paused",
        title: "Paused",
        description: "You paused this rent. Resume it from the dashboard to continue.",
        canConnect: false,
        terminal: false,
      };
    case "suspended":
      return {
        phase: "suspended",
        title: "Paused on balance",
        description: "Your spend wallet ran low, so billing stalled. Top up your wallet to resume.",
        canConnect: false,
        terminal: false,
      };
    case "completed":
      return { phase: "completed", title: "Completed", description: "This rent finished and billing stopped.", canConnect: false, terminal };
    case "cancelled":
      return { phase: "cancelled", title: "Cancelled", description: "You stopped this rent.", canConnect: false, terminal };
    case "failed":
      return { phase: "failed", title: "Couldn't start", description: "No provider matched this rent's requirements.", canConnect: false, terminal };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/broker/rent-phase.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/broker/rent-phase.ts src/lib/broker/rent-phase.test.ts
git commit -m "feat(ui): rentPhase, the pure status-to-display mapping"
```

---

## Task 2: `getMyRent` owner-scoped server-fn

**Files:**
- Modify: `src/lib/broker/server-fns.ts` (add after the `listMyRents` export near line 31)

- [ ] **Step 1: Add the server-fn**

`requireUser` and `getRegistry` are already imported and used by `listMyRents` in this file. Add:

```ts
// One lease by id, but only if the caller owns it. Returns null (not a throw) for a missing or
// foreign rent so the poller can render a neutral "couldn't load" instead of erroring.
export const getMyRent = createServerFn({ method: "GET", strict: { output: false } })
  .validator((d: { accessToken: string; rentId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    const rent = await getRegistry().getRent(data.rentId);
    if (!rent || rent.userId !== user.id) return null;
    return rent;
  });
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/broker/server-fns.ts
git commit -m "feat(ui): getMyRent owner-scoped single-lease read for polling"
```

---

## Task 3: Shared `RentSheet` with live tracking

**Files:**
- Create: `src/components/site/RentSheet.tsx`
- Modify: `src/routes/marketplace.index.tsx` (remove the local `RentSheet` + `Stat`, import the shared one)

- [ ] **Step 1: Create the shared component**

This moves the existing form verbatim and adds the tracking view. `noUnusedLocals` is off, so leftover imports in the index won't break the build.

```tsx
// src/components/site/RentSheet.tsx
import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import confetti from "canvas-confetti";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { supabaseBrowser } from "@/lib/supabase/client";
import { createRent, getMyRent } from "@/lib/broker/server-fns";
import { rentPhase } from "@/lib/broker/rent-phase";
import type { Provider, Rent } from "@services/domain";

export function RentSheet({ provider, onClose }: { provider: Provider | null; onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(15);
  const [submitting, setSubmitting] = useState(false);
  const [rentId, setRentId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const budget = provider ? (duration * 60 * provider.pricePerCharge).toFixed(4) : "0";
  const gpu = provider?.specs.gpu as string | undefined;
  const vramGb = provider?.specs.vramGb as number | undefined;
  const cpuCores = provider?.specs.cpuCores as number | undefined;
  const ramGb = provider?.specs.ramGb as number | undefined;

  const { data: liveRent } = useQuery({
    queryKey: ["rent", rentId],
    queryFn: () => getMyRent({ data: { accessToken: accessToken!, rentId: rentId! } }),
    enabled: !!rentId && !!accessToken,
    // Self-stopping: poll while active, stop on terminal, back off before the first payload.
    refetchInterval: (query) => {
      const rent = query.state.data as Rent | null | undefined;
      if (!rent) return 5000;
      switch (rent.status) {
        case "queued":
        case "running":
        case "suspended":
          return 3000;
        default:
          return false;
      }
    },
  });

  function reset() {
    onClose();
    setRentId(null);
    setName("");
    setAccessToken(null);
  }

  async function submit() {
    const { data } = await supabaseBrowser.auth.getSession();
    if (!data.session || !provider) {
      router.navigate({ to: "/onboarding", search: { redirect: router.state.location.pathname } });
      return;
    }
    setSubmitting(true);
    try {
      const created = await createRent({
        data: {
          accessToken: data.session.access_token,
          name,
          spec: { resourceType: provider.resourceType, region: provider.region },
          estimatedUsage: duration * 60,
        },
      });
      queryClient.setQueryData(["rent", created.id], created); // render instantly, don't wait a poll
      setAccessToken(data.session.access_token);
      setRentId(created.id);
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.4 } });
    } finally {
      setSubmitting(false);
    }
  }

  const phase = liveRent ? rentPhase(liveRent, provider ?? undefined) : null;

  return (
    <Sheet open={!!provider} onOpenChange={(o) => { if (!o) reset(); }}>
      <SheetContent className="bg-surface border-border">
        <SheetHeader>
          <SheetTitle>Rent{provider ? ` from ${provider.alias}` : ""}</SheetTitle>
        </SheetHeader>

        {provider && !rentId && (
          <div className="mt-6 space-y-5">
            <div>
              <Label>Rent name</Label>
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
              <div className="mt-1 text-2xl font-semibold text-foreground">${budget}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                at ${provider.pricePerCharge.toFixed(7)}/s · metered per second, only pay for what runs
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

        {rentId && (
          <div className="mt-6 space-y-5">
            <div className="glass-card p-4 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</div>
              <div className="text-lg font-semibold text-foreground">{phase?.title ?? "Loading…"}</div>
              <p className="text-sm text-muted-foreground">{phase?.description ?? "Fetching your lease…"}</p>
            </div>

            {phase?.canConnect && liveRent && (
              <div className="glass-card p-4 space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Connect</div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Endpoint</span>
                    <span className="font-mono truncate">{provider?.endpointUrl ?? "—"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Access token</span>
                    <span className="font-mono truncate">{liveRent.leaseAccessToken}</span>
                  </div>
                </div>
              </div>
            )}

            {phase?.phase === "running" && !phase.canConnect && (
              <div className="glass-card p-4 text-xs text-muted-foreground">
                Cannot connect · provider unavailable
              </div>
            )}

            {liveRent && (
              <div className="text-xs text-muted-foreground">
                Charged so far{" "}
                <span className="font-mono text-foreground">${(liveRent.totalCost / 1_000_000).toFixed(6)}</span>
              </div>
            )}

            <Button onClick={reset} variant="ghost" className="w-full border border-border">
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

- [ ] **Step 2: Swap the marketplace index to the shared component**

In `src/routes/marketplace.index.tsx`:

1. Delete the local `function RentSheet(...) { ... }` (currently ~lines 217-343) and the local `function Stat(...) { ... }` (currently ~lines 345-352).
2. Add the import near the other `@/components/site` imports (next to `ProviderCard`):

```ts
import { RentSheet } from "@/components/site/RentSheet";
```

The existing `<RentSheet provider={rentFor} onClose={() => setRentFor(null)} />` usage and the `rentFor` state stay exactly as they are.

- [ ] **Step 3: Type-check and build**

Run: `bunx tsc --noEmit`
Expected: clean.

Run: `bun run build`
Expected: Vite/Cloudflare-worker build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/site/RentSheet.tsx src/routes/marketplace.index.tsx
git commit -m "feat(ui): shared RentSheet that live-tracks the metered lease"
```

---

## Task 4: Wire the dead "Rent" button on the detail page

**Files:**
- Modify: `src/routes/marketplace.$id.tsx`

- [ ] **Step 1: Import `useState` and the shared sheet**

At the top of `src/routes/marketplace.$id.tsx`, add `useState` from React and the sheet:

```ts
import { useState } from "react";
import { RentSheet } from "@/components/site/RentSheet";
```

- [ ] **Step 2: Add sheet state and wire the button**

In the detail component (the one that renders `p`), add near the top of the function body:

```ts
const [renting, setRenting] = useState(false);
```

Change the dead button (currently `marketplace.$id.tsx:70`, `<Button size="lg" ... disabled={!p.online}>Rent</Button>`) to open the sheet:

```tsx
<Button
  size="lg"
  className="bg-primary text-primary-foreground"
  disabled={!p.online}
  onClick={() => setRenting(true)}
>
  Rent
</Button>
```

Then render the sheet once, just before the component's closing tag (alongside the existing markup):

```tsx
<RentSheet provider={renting ? p : null} onClose={() => setRenting(false)} />
```

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/routes/marketplace.\$id.tsx
git commit -m "feat(ui): wire the provider-detail Rent button to the live rent sheet"
```

---

## Task 5: In-app entry points to list a server

**Files:**
- Modify: `src/components/site/Sidebar.tsx`
- Modify: `src/routes/provider.tsx`

- [ ] **Step 1: Add the sidebar link**

In `src/components/site/Sidebar.tsx`, add `PlusCircle` to the existing `lucide-react` import, and add one entry to the `navLinks` array (after the Provider entry):

```ts
export const navLinks = [
  { to: "/marketplace", label: "Marketplace", icon: Store },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/provider", label: "Provider", icon: Server },
  { to: "/register", label: "List a server", icon: PlusCircle },
  { to: "/docs", label: "Docs", icon: BookOpen },
] as const;
```

- [ ] **Step 2: Add the provider-dashboard button (header + empty state)**

In `src/routes/provider.tsx`, add imports: `Link` from `@tanstack/react-router` (the file already imports `createFileRoute` from there, add `Link` to that import), `Button` from `@/components/ui/button`, and `PlusCircle` alongside the existing `Server` from `lucide-react`.

Replace the header block:

```tsx
          <div className="text-[11px] uppercase tracking-wider text-glow">Provider</div>
          <h1 className="mt-1 text-3xl md:text-4xl font-bold">Server operations</h1>
```

with a header that carries the action:

```tsx
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-glow">Provider</div>
              <h1 className="mt-1 text-3xl md:text-4xl font-bold">Server operations</h1>
            </div>
            <Button asChild className="bg-primary text-primary-foreground">
              <Link to="/register">
                <PlusCircle className="h-4 w-4" /> List a server
              </Link>
            </Button>
          </div>
```

And give the empty state an action. Replace:

```tsx
                <div className="col-span-full glass-card p-10 text-center text-muted-foreground">
                  No servers registered to this wallet yet.
                </div>
```

with:

```tsx
                <div className="col-span-full glass-card p-10 text-center text-muted-foreground">
                  <p>No servers registered to this wallet yet.</p>
                  <Button asChild className="mt-4 bg-primary text-primary-foreground">
                    <Link to="/register">
                      <PlusCircle className="h-4 w-4" /> List your first server
                    </Link>
                  </Button>
                </div>
```

- [ ] **Step 3: Type-check and build**

Run: `bunx tsc --noEmit`
Expected: clean.

Run: `bun run build`
Expected: build succeeds.

- [ ] **Step 4: Verify the routes still SSR**

Run: `bun run dev` in one shell, then:
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/marketplace` (expect 200)
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/provider` (expect 307 to onboarding when signed out, proving the guard runs and it compiles).

(The full click-through needs a passkey login and is a browser handoff, same as the wallet sheet.)

- [ ] **Step 5: Commit**

```bash
git add src/components/site/Sidebar.tsx src/routes/provider.tsx
git commit -m "feat(ui): surface list-a-server in the sidebar and provider dashboard"
```

---

## Self-review notes

- **Spec coverage:** add-a-service unreachable -> Task 5 (sidebar + provider header + empty state) ✓; dead detail Rent button -> Task 4 ✓; extract shared RentSheet -> Task 3 ✓; live tracking with dynamic self-stopping `refetchInterval` -> Task 3 ✓; `getMyRent` owner-scoped read -> Task 2 ✓; cache seed on create (`setQueryData`) -> Task 3 ✓; rich `rentPhase` object + declarative render -> Tasks 1,3 ✓; provider-gone edge (`canConnect` false, rent stays visible, "Cannot connect") -> Tasks 1,3 ✓; suspended -> wallet copy -> Task 1 ✓; signed-out -> /onboarding -> Task 3 (unchanged) ✓; worker-is-source-of-truth (no simulated progress) -> Task 3 (polls real state) ✓.
- **Placeholder scan:** none; every step has complete code.
- **Type consistency:** `rentPhase(rent, provider | undefined): RentPhase` is defined in Task 1 and called identically in Task 3. `getMyRent({ data: { accessToken, rentId } })` shape matches its validator (Task 2) and its call site (Task 3). `RentSheet({ provider, onClose })` prop shape is identical across Tasks 3 and 4 and the existing index usage. `phase` mirrors `RentStatus` so the switch is exhaustive (paused included), which also matches the two existing `StatusBadge` maps that now carry `suspended`.
- **Deliberate non-goals (from the spec):** no Supabase realtime (polling is enough), no change to the metering worker/registry/`register.tsx`, no wallet top-up flow (suspended copy only points at the existing wallet sheet).

---

## Execution handoff

After this lands, a signed-in user can reach "list a server" from the sidebar or the provider page, and renting from either the marketplace grid or a provider's detail page opens one sheet that shows the lease going queued -> running with its real connect credentials and metered cost, straight from the backend. The next natural step is Supabase realtime for the dashboard/rent views so the numbers move without polling.
