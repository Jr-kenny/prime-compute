# Write Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three remaining simulated writes (provider registration, rent creation,
pause/resume/stop) with real registry-backed writes, gated by server-verified identity instead of
trusted client parameters.

**Architecture:** A `requireUser(accessToken)` helper verifies the caller against Supabase and
derives their real id/wallet server-side. A new `services/src/rent-transitions.ts` is the single
source of truth for which rent-status transitions are legal, used by both the server (to enforce)
and the UI (to mirror for button state). Five server functions in `src/lib/broker/server-fns.ts`
(three new, two retrofitted) do the actual writes.

**Tech Stack:** TanStack Start server functions, Bun test, Supabase Auth (service-role
`auth.getUser`), `@tanstack/react-query` for cache invalidation after a mutation.

**Spec:** `docs/superpowers/specs/2026-06-30-write-paths-design.md`

---

### Task 1: Centralized rent transition rules

**Files:**
- Create: `services/src/rent-transitions.ts`
- Test: `services/src/rent-transitions.test.ts`

- [ ] **Step 1: Write the failing test**

`services/src/rent-transitions.test.ts`:

```ts
import { test, expect } from "bun:test";
import { canPause, canResume, canCancel } from "./rent-transitions";
import type { Rent, RentStatus } from "./domain";

function rentWithStatus(status: RentStatus): Rent {
  return {
    id: "r1",
    name: "test-rent",
    userId: "u1",
    spec: { resourceType: "GPU", region: null },
    estimatedUsage: null,
    autonomyArmed: false,
    status,
    providerId: null,
    totalCost: 0,
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
  };
}

test("canPause is true only for running", () => {
  expect(canPause(rentWithStatus("running"))).toBe(true);
  for (const status of ["queued", "paused", "completed", "cancelled", "failed"] as RentStatus[]) {
    expect(canPause(rentWithStatus(status))).toBe(false);
  }
});

test("canResume is true only for paused", () => {
  expect(canResume(rentWithStatus("paused"))).toBe(true);
  for (const status of ["queued", "running", "completed", "cancelled", "failed"] as RentStatus[]) {
    expect(canResume(rentWithStatus(status))).toBe(false);
  }
});

test("canCancel is true for queued, running, and paused; false for terminal states", () => {
  for (const status of ["queued", "running", "paused"] as RentStatus[]) {
    expect(canCancel(rentWithStatus(status))).toBe(true);
  }
  for (const status of ["completed", "cancelled", "failed"] as RentStatus[]) {
    expect(canCancel(rentWithStatus(status))).toBe(false);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services && bun test rent-transitions.test.ts`
Expected: FAIL — module `./rent-transitions` not found.

- [ ] **Step 3: Implement**

`services/src/rent-transitions.ts`:

```ts
import type { Rent, RentStatus } from "./domain";

const NON_TERMINAL: RentStatus[] = ["queued", "running", "paused"];

export function canPause(rent: Rent): boolean {
  return rent.status === "running";
}

export function canResume(rent: Rent): boolean {
  return rent.status === "paused";
}

export function canCancel(rent: Rent): boolean {
  return NON_TERMINAL.includes(rent.status);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services && bun test rent-transitions.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add services/src/rent-transitions.ts services/src/rent-transitions.test.ts
git commit -m "feat(domain): centralize rent status transition rules"
```

---

### Task 2: Server-side identity verification

**Files:**
- Create: `src/lib/auth/require-user.ts`

- [ ] **Step 1: Implement**

```ts
import { supabaseAdmin } from "../supabase/server";

// Server-only. Every write (and any read of private data) takes a client-supplied accessToken
// and verifies it here rather than trusting a client-claimed userId/ownerWallet. Fails closed if
// the verified user has no wallet_address in their metadata, since wallet_address is the
// identity anchor everywhere else in this app (services/supabase/migrations/0005).
export async function requireUser(accessToken: string): Promise<{ id: string; walletAddress: string }> {
  const { data, error } = await supabaseAdmin().auth.getUser(accessToken);
  if (error || !data.user) throw new Error("invalid or expired session");

  const walletAddress = data.user.user_metadata?.wallet_address as string | undefined;
  if (!walletAddress) throw new Error("authenticated user has no wallet_address in metadata");

  return { id: data.user.id, walletAddress };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (nothing imports this yet).

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/require-user.ts
git commit -m "feat(auth): requireUser verifies a session token server-side"
```

---

### Task 3: Server functions — retrofit reads, add writes

**Files:**
- Modify: `src/lib/broker/server-fns.ts`

- [ ] **Step 1: Replace the file**

```ts
import { createServerFn } from "@tanstack/react-start";
import { getRegistry } from "./registry";
import { requireUser } from "../auth/require-user";
import { defaultTrust } from "@services/trust/trust";
import { canPause, canResume, canCancel } from "@services/rent-transitions";
import type { NewProvider, RentPatch } from "@services/registry/registry";
import type { Rent, RentSpec } from "@services/domain";

// `Provider.specs` is `Record<string, unknown>` (it's a jsonb column with no fixed shape), which
// is genuinely JSON-serializable at runtime but TanStack Start's static serializability check
// can't prove that for an `unknown`-valued index signature. `strict: { output: false }` skips
// that static check for these three; everything they return still goes over the wire as plain
// JSON the same as any other server function.
export const listProviders = createServerFn({ method: "GET", strict: { output: false } }).handler(async () => {
  return getRegistry().listProviders();
});

export const getProviderById = createServerFn({ method: "GET", strict: { output: false } })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => getRegistry().getProvider(data.id));

export const listMyRents = createServerFn({ method: "GET" })
  .validator((d: { accessToken: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    return getRegistry().listRents({ userId: user.id });
  });

export const listMyProviders = createServerFn({ method: "GET", strict: { output: false } })
  .validator((d: { accessToken: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    return getRegistry().listProviders({ ownerWallet: user.walletAddress });
  });

export const listProviderRents = createServerFn({ method: "GET" })
  .validator((d: { providerId: string }) => d)
  .handler(async ({ data }) => getRegistry().listRents({ providerId: data.providerId }));

// Everything registerProvider needs except what the server derives itself (ownerWallet) or
// defaults (trust, online, avgLatencyMs).
type NewProviderInput = Omit<NewProvider, "ownerWallet" | "trust" | "online" | "avgLatencyMs" | "computeScore">;

// `specs` (and therefore the whole `provider` input) carries the same unknown-valued index
// signature as the read side, so both input and output serializability checks need skipping here.
export const registerProvider = createServerFn({ method: "POST", strict: false })
  .validator((d: { accessToken: string; provider: NewProviderInput }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    return getRegistry().registerProvider({
      ...data.provider,
      ownerWallet: user.walletAddress,
      trust: defaultTrust(),
      online: true,
      avgLatencyMs: 0,
    });
  });

export const createRent = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; name: string; spec: RentSpec; estimatedUsage?: number | null }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    return getRegistry().createRent({
      name: data.name,
      userId: user.id,
      spec: data.spec,
      estimatedUsage: data.estimatedUsage ?? null,
    });
  });

async function transitionRent(
  accessToken: string,
  rentId: string,
  canTransition: (rent: Rent) => boolean,
  verb: string,
  patch: RentPatch,
) {
  const user = await requireUser(accessToken);
  const registry = getRegistry();
  const rent = await registry.getRent(rentId);
  if (!rent) throw new Error("rent not found");
  if (rent.userId !== user.id) throw new Error("not your rent");
  if (!canTransition(rent)) throw new Error(`cannot ${verb} a rent with status "${rent.status}"`);
  return registry.updateRent(rentId, patch);
}

export const pauseRent = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; rentId: string }) => d)
  .handler(async ({ data }) =>
    transitionRent(data.accessToken, data.rentId, canPause, "pause", { status: "paused" }),
  );

export const resumeRent = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; rentId: string }) => d)
  .handler(async ({ data }) =>
    transitionRent(data.accessToken, data.rentId, canResume, "resume", { status: "running" }),
  );

export const cancelRent = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; rentId: string }) => d)
  .handler(async ({ data }) =>
    transitionRent(data.accessToken, data.rentId, canCancel, "cancel", {
      status: "cancelled",
      endedAt: new Date().toISOString(),
    }),
  );
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors in `dashboard.tsx` and `provider.tsx` only — both still call `listMyRents`/
`listMyProviders` with the old `{ userId }`/`{ ownerWallet }` shape. Fixed in Tasks 4 and 5.

- [ ] **Step 3: Commit**

```bash
git add src/lib/broker/server-fns.ts
git commit -m "feat(broker): verified-identity writes (registerProvider, createRent, pause/resume/cancel); retrofit reads onto requireUser"
```

---

### Task 4: `dashboard.tsx` — accessToken-based fetch, real pause/resume/cancel

**Files:**
- Modify: `src/routes/dashboard.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { authGuard } from "../lib/auth/guard";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Square, Copy } from "lucide-react";
import { AppShell } from "@/components/site/AppShell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { StreamingTicker, ElapsedTimer } from "@/components/site/StreamingTicker";
import { useSession } from "@/lib/auth/session";
import { listMyRents, listProviders, pauseRent, resumeRent, cancelRent } from "@/lib/broker/server-fns";
import { canPause, canResume, canCancel } from "@services/rent-transitions";
import type { Provider, Rent, RentStatus } from "@services/domain";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: authGuard,
  head: () => ({
    meta: [
      { title: "Consumer Dashboard — Prime Compute" },
      { name: "description", content: "Monitor your active rents, history, and streaming spend." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { session } = useSession();
  const accessToken = session?.access_token;

  const { data: rents = [] } = useQuery({
    queryKey: ["rents", "mine", accessToken],
    queryFn: () => listMyRents({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken,
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
            {runningRents.length} rents running
          </span>
          <span>
            streaming <span className="text-glow font-mono">${streamingRate.toFixed(7)}/sec</span>
          </span>
        </div>

        <Tabs defaultValue="active" className="mt-8">
          <TabsList className="bg-surface border border-border">
            <TabsTrigger value="active">Active rents</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-6 grid gap-4 lg:grid-cols-2">
            {activeRents.map((r) => (
              <ActiveRentCard key={r.id} rent={r} provider={r.providerId ? providersById[r.providerId] : undefined} />
            ))}
            {activeRents.length === 0 && (
              <div className="col-span-full glass-card p-10 text-center text-muted-foreground">
                No active rents. Head to the marketplace to rent some compute.
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-6 glass-card p-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-muted-foreground text-left">
                  <th className="py-2">Rent</th>
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
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No completed rents yet.</td></tr>
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
              {["Rent completed", "Rent failed", "Low balance", "Migration events"].map((l) => (
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

function ActiveRentCard({ rent, provider }: { rent: Rent; provider: Provider | undefined }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [mutating, setMutating] = useState(false);
  const startedAtMs = rent.startedAt ? new Date(rent.startedAt).getTime() : Date.now();

  async function mutate(fn: typeof pauseRent) {
    if (!session) {
      router.navigate({ to: "/onboarding", search: { redirect: router.state.location.pathname } });
      return;
    }
    setMutating(true);
    try {
      await fn({ data: { accessToken: session.access_token, rentId: rent.id } });
      await queryClient.invalidateQueries({ queryKey: ["rents", "mine"] });
    } finally {
      setMutating(false);
    }
  }

  return (
    <div className="glass-card glow-hover p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-medium">{rent.name}</div>
          <div className="text-xs text-muted-foreground">on {provider?.alias ?? "unmatched"}</div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-success">
          <span className={`h-1.5 w-1.5 rounded-full bg-success ${rent.status === "running" ? "pulse-ring" : ""}`} />
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
            paused={rent.status !== "running"}
            className="text-2xl font-semibold text-gradient-blue"
          />
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Elapsed</div>
          <div className="text-sm text-foreground">
            <ElapsedTimer startedAt={startedAtMs} paused={rent.status !== "running"} />
          </div>
        </div>
      </div>
      <div className="mt-5 flex gap-2">
        {canPause(rent) && (
          <Button variant="ghost" className="flex-1 border border-border" disabled={mutating} onClick={() => mutate(pauseRent)}>
            <Pause className="h-4 w-4" /> Pause
          </Button>
        )}
        {canResume(rent) && (
          <Button variant="ghost" className="flex-1 border border-border" disabled={mutating} onClick={() => mutate(resumeRent)}>
            <Pause className="h-4 w-4" /> Resume
          </Button>
        )}
        {canCancel(rent) && (
          <Button
            variant="ghost"
            className="flex-1 border border-destructive/30 text-destructive hover:bg-destructive/10"
            disabled={mutating}
            onClick={() => mutate(cancelRent)}
          >
            <Square className="h-4 w-4" /> Stop
          </Button>
        )}
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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors only in `provider.tsx` (Task 5 fixes it).

- [ ] **Step 3: Manually verify**

Run: `npm run dev`, sign in, create a rent from the marketplace (after Task 6), visit `/dashboard`,
confirm Pause/Resume/Stop actually change the rent's status (refresh or watch the badge update
after the query invalidates) and that a `queued` rent only shows a Stop button, no Pause.

- [ ] **Step 4: Commit**

```bash
git add src/routes/dashboard.tsx
git commit -m "feat(dashboard): real pause/resume/cancel wired to the registry"
```

---

### Task 5: `provider.tsx` — accessToken-based fetch

**Files:**
- Modify: `src/routes/provider.tsx:30-34`

- [ ] **Step 1: Update the `listMyProviders` query**

Change:

```tsx
  const { walletAddress } = useSession();

  const { data: myServers = [] } = useQuery({
    queryKey: ["providers", "mine", walletAddress],
    queryFn: () => listMyProviders({ data: { ownerWallet: walletAddress! } }),
    enabled: !!walletAddress,
  });
```

to:

```tsx
  const { session, walletAddress } = useSession();
  const accessToken = session?.access_token;

  const { data: myServers = [] } = useQuery({
    queryKey: ["providers", "mine", accessToken],
    queryFn: () => listMyProviders({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken,
  });
```

(`walletAddress` stays, it's still used further down for the "Payout wallet" field.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors anywhere.

- [ ] **Step 3: Commit**

```bash
git add src/routes/provider.tsx
git commit -m "fix(provider): listMyProviders call uses accessToken after the requireUser retrofit"
```

---

### Task 6: `register.tsx` — real provider registration

**Files:**
- Modify: `src/routes/register.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Cpu, Zap, HardDrive, Server, ArrowRight, ArrowLeft, CheckCircle2 } from "lucide-react";
import { authGuard } from "../lib/auth/guard";
import confetti from "canvas-confetti";
import { PageShell } from "@/components/site/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import { registerProvider } from "@/lib/broker/server-fns";
import type { ResourceType } from "@services/domain";

export const Route = createFileRoute("/register")({
  beforeLoad: authGuard,
  head: () => ({
    meta: [
      { title: "List Your Server — Prime Compute" },
      { name: "description", content: "Register idle hardware on Prime Compute and earn streaming USDC per millisecond." },
    ],
  }),
  component: Register,
});

type ResType = ResourceType;
const resOptions: { id: ResType; icon: any; desc: string }[] = [
  { id: "GPU", icon: Zap, desc: "Single or multi-GPU rig" },
  { id: "CPU", icon: Cpu, desc: "High-core CPU server" },
  { id: "Storage", icon: HardDrive, desc: "Bulk SSD/NVMe" },
  { id: "Full Server", icon: Server, desc: "Everything in one box" },
];

function Register() {
  const router = useRouter();
  const { walletAddress } = useSession();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [providerId, setProviderId] = useState<string | null>(null);

  const [form, setForm] = useState({
    alias: "", type: "GPU" as ResType,
    cpu: 32, ram: 128, storage: 2000,
    gpu: "NVIDIA H100", vram: 80,
    endpointUrl: "",
    region: "US-East",
    pricePerCharge: 0.0000098,
    certified: false,
  });

  const steps = ["Hardware", "Pricing", "Verification", "Review"];

  function next() { setStep((s) => Math.min(steps.length - 1, s + 1)); }
  function prev() { setStep((s) => Math.max(0, s - 1)); }

  async function submit() {
    const { data } = await supabaseBrowser.auth.getSession();
    if (!data.session) {
      router.navigate({ to: "/onboarding", search: { redirect: router.state.location.pathname } });
      return;
    }

    setSubmitting(true);
    try {
      const specs: Record<string, unknown> =
        form.type === "GPU" || form.type === "Full Server"
          ? { gpu: form.gpu, vramGb: form.vram, cpuCores: form.cpu, ramGb: form.ram, storageGb: form.storage }
          : { cpuCores: form.cpu, ramGb: form.ram, storageGb: form.storage };

      const created = await registerProvider({
        data: {
          accessToken: data.session.access_token,
          provider: {
            alias: form.alias,
            endpointUrl: form.endpointUrl,
            resourceType: form.type,
            region: form.region,
            specs,
            pricePerCharge: form.pricePerCharge,
          },
        },
      });
      setProviderId(created.id);
      setDone(true);
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.5 } });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell>
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12">
        <div className="text-[11px] uppercase tracking-wider text-glow">Provider onboarding</div>
        <h1 className="mt-1 text-3xl md:text-4xl font-bold">List your server</h1>

        {/* progress */}
        <div className="mt-8 flex items-center gap-2">
          {steps.map((s, i) => (
            <div key={s} className="flex-1">
              <div className={cn("h-1 rounded-full transition", i <= step ? "bg-glow" : "bg-border")} />
              <div className={cn("mt-2 text-[10px] uppercase tracking-wider", i <= step ? "text-foreground" : "text-muted-foreground")}>{s}</div>
            </div>
          ))}
        </div>

        <div className="mt-8 glass-card p-6 md:p-8">
          {done ? (
            <div className="text-center py-10">
              <div className="mx-auto h-14 w-14 rounded-full bg-success/15 ring-1 ring-success/40 flex items-center justify-center text-success">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-2xl font-bold">Server registered</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {form.alias} is live in the registry{providerId ? ` (${providerId})` : ""}. The broker will start routing rents to it once it's been benchmarked.
              </p>
            </div>
          ) : step === 0 ? (
            <div className="space-y-5">
              <div>
                <Label>Server alias</Label>
                <Input className="mt-2 bg-card border-border" value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} placeholder="node-astral-7" />
              </div>
              <div>
                <Label>Endpoint URL</Label>
                <Input className="mt-2 bg-card border-border font-mono" value={form.endpointUrl} onChange={(e) => setForm({ ...form, endpointUrl: e.target.value })} placeholder="https://your-server:4001" />
                <p className="mt-2 text-xs text-muted-foreground">Where the broker reaches your provider executor to route work.</p>
              </div>
              <div>
                <Label>Resource type</Label>
                <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                  {resOptions.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setForm({ ...form, type: r.id })}
                      className={cn(
                        "rounded-lg border p-3 text-left transition",
                        form.type === r.id ? "border-glow bg-primary/10" : "border-border bg-card/60 hover:border-accent/50",
                      )}
                    >
                      <r.icon className="h-4 w-4 text-glow" />
                      <div className="mt-2 text-sm font-medium">{r.id}</div>
                      <div className="text-[10px] text-muted-foreground">{r.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="CPU cores" v={form.cpu} onChange={(v) => setForm({ ...form, cpu: +v })} />
                <Field label="RAM (GB)" v={form.ram} onChange={(v) => setForm({ ...form, ram: +v })} />
                <Field label="Storage (GB)" v={form.storage} onChange={(v) => setForm({ ...form, storage: +v })} />
              </div>
              {(form.type === "GPU" || form.type === "Full Server") && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>GPU model</Label>
                    <Input className="mt-2 bg-card border-border" value={form.gpu} onChange={(e) => setForm({ ...form, gpu: e.target.value })} />
                  </div>
                  <Field label="VRAM (GB)" v={form.vram} onChange={(v) => setForm({ ...form, vram: +v })} />
                </div>
              )}
            </div>
          ) : step === 1 ? (
            <div className="space-y-5">
              <div>
                <Label>Region</Label>
                <select
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                  className="mt-2 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
                >
                  {["US-East", "US-West", "EU-West", "EU-Central", "Asia-Pacific", "South-America"].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Price per second (USDC)</Label>
                <Input type="number" step="0.0000001" className="mt-2 bg-card border-border font-mono" value={form.pricePerCharge}
                  onChange={(e) => setForm({ ...form, pricePerCharge: +e.target.value })} />
                <p className="mt-2 text-xs text-muted-foreground">
                  At this rate, a 1-hour rent costs <span className="text-foreground">${(form.pricePerCharge * 3600).toFixed(4)}</span>.
                </p>
              </div>
            </div>
          ) : step === 2 ? (
            <div className="space-y-5">
              <div>
                <Label>Owner wallet</Label>
                <Input readOnly value={walletAddress ?? "—"} className="mt-2 bg-card border-border font-mono" />
                <p className="mt-2 text-xs text-muted-foreground">This server will be registered to the wallet you're signed in with.</p>
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox checked={form.certified} onCheckedChange={(v) => setForm({ ...form, certified: !!v })} className="mt-0.5" />
                <span className="text-sm text-muted-foreground">
                  I certify these specs are accurate. The broker will benchmark this server and flag mismatches publicly on my Compute Score.
                </span>
              </label>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <Review label="Alias" value={form.alias || "—"} />
              <Review label="Type" value={form.type} />
              <Review label="Endpoint" value={form.endpointUrl || "—"} />
              <Review label="Hardware" value={`${form.cpu} cores · ${form.ram} GB RAM · ${form.storage} GB SSD`} />
              {(form.type === "GPU" || form.type === "Full Server") && <Review label="GPU" value={`${form.gpu} · ${form.vram} GB VRAM`} />}
              <Review label="Region" value={form.region} />
              <Review label="Price" value={`$${form.pricePerCharge.toFixed(7)} / sec`} />
            </div>
          )}

          {!done && (
            <div className="mt-8 flex justify-between">
              <Button variant="ghost" onClick={prev} disabled={step === 0} className="border border-border"><ArrowLeft className="h-4 w-4" />Back</Button>
              {step < steps.length - 1 ? (
                <Button onClick={next} className="bg-primary text-primary-foreground">Continue<ArrowRight className="h-4 w-4" /></Button>
              ) : (
                <Button onClick={submit} disabled={!form.certified || submitting} className="bg-primary text-primary-foreground">
                  {submitting ? "Registering…" : "Submit server"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}

function Field({ label, v, onChange }: { label: string; v: number; onChange: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type="number" className="mt-2 bg-card border-border" value={v} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function Review({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
```

This drops the `Switch`, `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle` imports entirely
(no longer used: "Always-on" toggle and the wallet-connect dialog are both gone), and the
`walletOpen` state that controlled that dialog.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manually verify**

Run: `npm run dev`, sign in, go to `/register`, fill out the wizard including the new Endpoint URL
field, submit. Confirm the success screen shows a real provider id, and that the provider now
shows up in `/marketplace` with `owner_wallet` matching the signed-in wallet (check via
`mcp__supabase__execute_sql` against the `providers` table if you want to confirm at the DB
level, or just look for it in the marketplace listing).

- [ ] **Step 4: Commit**

```bash
git add src/routes/register.tsx
git commit -m "feat(register): real provider registration via the registry"
```

---

### Task 7: `marketplace.index.tsx` — real rent creation

**Files:**
- Modify: `src/routes/marketplace.index.tsx:217-243` (the `RentSheet` component's state/submit),
  and the success message text further down.

- [ ] **Step 1: Add the `createRent` import**

```tsx
import { listProviders, createRent } from "@/lib/broker/server-fns";
```

(replaces the current `import { listProviders } from "@/lib/broker/server-fns";`)

- [ ] **Step 2: Replace `submit()`**

Change:

```tsx
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
```

to:

```tsx
  async function submit() {
    const { data } = await supabaseBrowser.auth.getSession();
    if (!data.session || !provider) {
      router.navigate({ to: "/onboarding", search: { redirect: router.state.location.pathname } });
      return;
    }

    setSubmitting(true);
    try {
      await createRent({
        data: {
          accessToken: data.session.access_token,
          name,
          spec: { resourceType: provider.resourceType, region: provider.region },
          estimatedUsage: duration * 60,
        },
      });
      setDone(true);
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.4 } });
    } finally {
      setSubmitting(false);
    }
  }
```

- [ ] **Step 3: Update the success copy**

Change:

```tsx
            <h3 className="mt-4 text-lg font-semibold">Rent submitted</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              The broker is opening a payment stream now.
            </p>
```

to:

```tsx
            <h3 className="mt-4 text-lg font-semibold">Rent queued</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              It'll be matched to a provider when the broker processes the queue.
            </p>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in `src/`.

- [ ] **Step 5: Manually verify**

Run: `npm run dev`, sign in, go to `/marketplace`, click "Rent" on a provider card, fill in a rent
name, submit. Confirm the success screen says "Rent queued" (not the old "payment stream" claim),
and that the rent shows up on `/dashboard`'s Active rents tab with status `queued` and no
provider matched (the unmatched-by-design behavior from the spec).

- [ ] **Step 6: Commit**

```bash
git add src/routes/marketplace.index.tsx
git commit -m "feat(marketplace): RentSheet creates a real queued rent"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full services test suite**

Run: `cd services && bun test in-memory.test.ts rent-transitions.test.ts`
Expected: all pass. (Deliberately not running `supabase.test.ts` or the full `bun test` here,
both touch the live shared Supabase project, which this plan doesn't need to do again.)

- [ ] **Step 2: Frontend type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit (only if the above steps required any fixes; otherwise nothing to commit)**

---

## Self-Review Notes

- **Spec coverage:** `requireUser` (Task 2) including the fail-closed wallet check, the
  `rent-transitions.ts` centralization with unit tests (Task 1), `registerProvider` (Task 6),
  `createRent` without a `preferredProviderId` (Task 7), and `pauseRent`/`resumeRent`/`cancelRent`
  with server-enforced transitions plus UI-mirrored button state (Task 4) all map directly to the
  spec's five numbered sections. The "no always-on broker" acknowledgment from the spec isn't a
  code change, it's already true of the system and reflected in the honest copy changes in Tasks
  6 and 7.
- **Type consistency:** `accessToken` is the parameter name everywhere a server fn needs identity
  (Tasks 3, 4, 5, 6, 7), never `userId`/`ownerWallet` directly. `canPause`/`canResume`/`canCancel`
  signatures match between `services/src/rent-transitions.ts` (Task 1) and both call sites that
  import them (Task 3's server-side enforcement, Task 4's UI button mirroring).
- **No write path left simulated:** register.tsx, RentSheet, and ActiveRentCard's pause/resume/
  stop are the only three simulated writes identified in the spec; all three are covered.
