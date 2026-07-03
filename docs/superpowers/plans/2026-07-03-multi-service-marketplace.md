# Multi-service marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the compute-only marketplace into a multi-service one (GPU, CPU, Full Server, Storage, VPN, Worker) driven by a single service-type descriptor registry, with a generalized executor seam and per-type unit metering, VPN being the first non-compute service end to end.

**Architecture:** One `SERVICE_REGISTRY` of descriptors is the source of truth; the domain enum, API validation, provider server, metering worker, register form, marketplace filters, and MCP all read from it. The provider's x402 endpoint is paywalled at a fixed per-unit price and exposes an unpaywalled per-session usage read; the worker charges one fixed-price hit per accrued unit (one per tick for time types, per GB for VPN), keeping the existing count-based budget and restart safety.

**Tech Stack:** Bun + TypeScript (services + mcp), Zod, TanStack Start / React (web), Supabase (Postgres), `@circle-fin/x402-batching`, `bun test`.

**Spec:** `docs/superpowers/specs/2026-07-03-multi-service-marketplace-design.md`

Conventions for every task: run commands from the repo root unless noted. `bun test src` runs the web tests; `cd services && bun test` runs the backend tests. The repo uses `noUncheckedIndexedAccess`; guard index access. Follow the terminology-sweep rule: when a name changes, grep the whole tree.

---

### Task 1: The service-type descriptor registry

**Files:**
- Create: `services/src/services/registry.ts`
- Test: `services/src/services/registry.test.ts`

- [ ] **Step 1: Write the failing test (`services/src/services/registry.test.ts`)**

```ts
import { describe, test, expect } from "bun:test";
import { SERVICE_REGISTRY, serviceIds, descriptorFor, type MeteringKind } from "./registry";

describe("service registry", () => {
  test("covers the six launch service types", () => {
    expect(serviceIds().sort()).toEqual(
      ["CPU", "Full Server", "GPU", "Storage", "VPN", "Worker"].sort(),
    );
  });

  test("every descriptor is complete", () => {
    for (const id of serviceIds()) {
      const d = descriptorFor(id);
      expect(d.id).toBe(id);
      expect(d.label.length).toBeGreaterThan(0);
      expect(["compute", "storage", "network", "worker"]).toContain(d.category);
      expect((["time", "volume"] as MeteringKind[])).toContain(d.metering);
      expect(d.unit.length).toBeGreaterThan(0);
      expect(d.path.startsWith("/")).toBe(true);
      // schemas parse a minimal valid object without throwing on shape
      expect(typeof d.specSchema.safeParse).toBe("function");
      expect(typeof d.telemetry.safeParse).toBe("function");
      expect(typeof d.connect.safeParse).toBe("function");
    }
  });

  test("VPN is volume-metered on the network path with a profile connect", () => {
    const vpn = descriptorFor("VPN");
    expect(vpn.category).toBe("network");
    expect(vpn.metering).toBe("volume");
    expect(vpn.unit).toBe("GB");
    expect(vpn.path).toBe("/vpn");
    expect(vpn.connect.safeParse({ profile: "[Interface]\n..." }).success).toBe(true);
  });

  test("descriptorFor throws on an unknown id", () => {
    expect(() => descriptorFor("QUANTUM")).toThrow(/unknown service type/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services && bun test src/services/registry.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `services/src/services/registry.ts`**

```ts
// services/src/services/registry.ts
// The single source of truth for what service types the marketplace hosts. Every consumer
// (domain enum, API validation, provider server, metering worker, register form, marketplace
// filters, MCP) reads from here, so adding a service type is one descriptor, not scattered branches.
import { z } from "zod";

export type MeteringKind = "time" | "volume";
export type ServiceCategory = "compute" | "storage" | "network" | "worker";

export interface ServiceTypeDescriptor {
  id: string;
  label: string;
  category: ServiceCategory;
  metering: MeteringKind; // display/pricing label; the endpoint owns accrual (see the worker)
  unit: string;           // "second" | "GB-hour" | "GB"
  path: string;           // paywalled service path on the provider, e.g. "/compute" | "/vpn"
  specSchema: z.ZodType;  // provider listing fields for this type
  telemetry: z.ZodType;   // heartbeat shape the executor emits
  connect: z.ZodType;     // what a running rent hands the renter
  defaultExecutorKind: string;
}

const region = z.string().min(1);
const sshConnect = z.object({ host: z.string(), user: z.string(), token: z.string() });
const computeTelemetry = z.object({
  cpu: z.number(), ramGb: z.number(), gpuUtil: z.number(), seq: z.number(), ts: z.number(),
});

export const SERVICE_REGISTRY: Record<string, ServiceTypeDescriptor> = {
  GPU: {
    id: "GPU", label: "GPU", category: "compute", metering: "time", unit: "second", path: "/compute",
    specSchema: z.object({ gpu: z.string(), vramGb: z.number(), cpuCores: z.number(), ramGb: z.number(), region }),
    telemetry: computeTelemetry, connect: sshConnect, defaultExecutorKind: "simulated-compute",
  },
  CPU: {
    id: "CPU", label: "CPU", category: "compute", metering: "time", unit: "second", path: "/compute",
    specSchema: z.object({ cpuCores: z.number(), ramGb: z.number(), region }),
    telemetry: computeTelemetry, connect: sshConnect, defaultExecutorKind: "simulated-compute",
  },
  "Full Server": {
    id: "Full Server", label: "Full Server", category: "compute", metering: "time", unit: "second", path: "/compute",
    specSchema: z.object({ gpu: z.string().optional(), cpuCores: z.number(), ramGb: z.number(), diskGb: z.number(), region }),
    telemetry: computeTelemetry, connect: sshConnect, defaultExecutorKind: "simulated-compute",
  },
  Storage: {
    id: "Storage", label: "Storage", category: "storage", metering: "volume", unit: "GB-hour", path: "/storage",
    specSchema: z.object({ capacityGb: z.number(), region, redundancy: z.string().optional() }),
    telemetry: z.object({ usedGb: z.number(), unitsAccrued: z.number(), seq: z.number(), ts: z.number() }),
    connect: z.object({ bucketUrl: z.string(), accessKey: z.string(), secretKey: z.string() }),
    defaultExecutorKind: "simulated-storage",
  },
  VPN: {
    id: "VPN", label: "VPN", category: "network", metering: "volume", unit: "GB", path: "/vpn",
    specSchema: z.object({
      exitLocation: z.string(), protocol: z.enum(["WireGuard", "OpenVPN"]),
      bandwidthMbps: z.number(), dataCapGb: z.number().optional(), region,
    }),
    telemetry: z.object({ bytesTransferred: z.number(), unitsAccrued: z.number(), seq: z.number(), ts: z.number() }),
    connect: z.object({ profile: z.string() }),
    defaultExecutorKind: "simulated-vpn",
  },
  Worker: {
    id: "Worker", label: "Worker", category: "worker", metering: "time", unit: "second", path: "/worker",
    specSchema: z.object({ cpuCores: z.number(), ramGb: z.number(), concurrency: z.number(), runtime: z.string(), region }),
    telemetry: z.object({ cpu: z.number(), ramGb: z.number(), jobsRun: z.number(), seq: z.number(), ts: z.number() }),
    connect: z.object({ submitUrl: z.string(), token: z.string() }),
    defaultExecutorKind: "simulated-worker",
  },
};

export function serviceIds(): string[] {
  return Object.keys(SERVICE_REGISTRY);
}

export function descriptorFor(id: string): ServiceTypeDescriptor {
  const d = SERVICE_REGISTRY[id];
  if (!d) throw new Error(`unknown service type: ${id}`);
  return d;
}
```

- [ ] **Step 4: Run tests**

Run: `cd services && bun test src/services/registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/services/registry.ts services/src/services/registry.test.ts
git commit -m "feat(services): service-type descriptor registry (compute, storage, vpn, worker)"
```

---

### Task 2: Derive the domain enum from the registry

**Files:**
- Modify: `services/src/domain.ts:11-12`
- Test: `services/src/domain.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test (`services/src/domain.test.ts`)**

```ts
import { describe, test, expect } from "bun:test";
import { RESOURCE_TYPES } from "./domain";

describe("domain resource types", () => {
  test("includes the new service types", () => {
    expect(RESOURCE_TYPES).toContain("VPN");
    expect(RESOURCE_TYPES).toContain("Worker");
    expect(RESOURCE_TYPES).toContain("GPU");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services && bun test src/domain.test.ts`
Expected: FAIL (VPN/Worker not present).

- [ ] **Step 3: Change `services/src/domain.ts`**

Replace lines 11-12:

```ts
export const RESOURCE_TYPES = ["GPU", "CPU", "Storage", "Full Server"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
```

with:

```ts
import { serviceIds } from "./services/registry";

// Runtime source of truth for the resource-type enum, derived from the service registry so a new
// service type flows here automatically. Mirrors the widened DB check constraint (0002 migration).
export const RESOURCE_TYPES = serviceIds() as readonly string[];
export type ResourceType = string;
```

Note: `ResourceType` widens from a literal union to `string`. This is deliberate; the registry is now the validator. Guard with `descriptorFor`/`serviceIds` at boundaries rather than the compiler.

- [ ] **Step 4: Run tests**

Run: `cd services && bun test src/domain.test.ts && bunx tsc --noEmit`
Expected: domain test PASS. If tsc surfaces places that relied on the literal union (exhaustive switches), fix them to use `descriptorFor`. Run the full `cd services && bun test` to catch fallout; fix any now-narrowed casts.

- [ ] **Step 5: Commit**

```bash
git add services/src/domain.ts services/src/domain.test.ts
git commit -m "feat(services): derive RESOURCE_TYPES from the service registry"
```

---

### Task 3: Generalize the executor and add per-type simulators

**Files:**
- Modify: `services/src/provider/executor.ts`
- Test: `services/src/provider/executor.test.ts`

The current `ComputeExecutor` has `compute(sessionId)` + `release`. Generalize to `ServiceExecutor` with `provision`, `heartbeat`, `release`, and a `usage(sessionId)` read that reports cumulative accrued units (the seam the worker meters on). Keep a compute simulator behaving as today, and add VPN/storage/worker simulators.

- [ ] **Step 1: Write the failing test (`services/src/provider/executor.test.ts`)**

Add these tests (keep any existing ones):

```ts
import { describe, test, expect } from "bun:test";
import { makeSimulatedExecutor } from "./executor";

describe("simulated executors", () => {
  test("compute accrues one unit per heartbeat", async () => {
    const ex = makeSimulatedExecutor("GPU");
    await ex.provision("s1", { region: "US-East" });
    await ex.heartbeat("s1");
    await ex.heartbeat("s1");
    expect(await ex.usage("s1")).toBe(2); // 2 seconds -> 2 units
  });

  test("vpn accrues GB units as bytes transferred grow", async () => {
    const ex = makeSimulatedExecutor("VPN");
    await ex.provision("s1", { exitLocation: "NL", protocol: "WireGuard", bandwidthMbps: 1000, region: "EU" });
    // each heartbeat simulates ~1 GB of transfer
    await ex.heartbeat("s1");
    await ex.heartbeat("s1");
    await ex.heartbeat("s1");
    expect(await ex.usage("s1")).toBe(3); // 3 GB -> 3 units
  });

  test("vpn provision returns a wireguard profile", async () => {
    const ex = makeSimulatedExecutor("VPN");
    const connect = await ex.provision("s1", { exitLocation: "NL", protocol: "WireGuard", bandwidthMbps: 1000, region: "EU" });
    expect((connect as { profile: string }).profile).toContain("[Interface]");
  });

  test("release forgets a session", async () => {
    const ex = makeSimulatedExecutor("GPU");
    await ex.provision("s1", { region: "US-East" });
    await ex.heartbeat("s1");
    await ex.release("s1");
    expect(await ex.usage("s1")).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services && bun test src/provider/executor.test.ts`
Expected: FAIL (`makeSimulatedExecutor` not exported).

- [ ] **Step 3: Rewrite `services/src/provider/executor.ts`**

```ts
// services/src/provider/executor.ts
// The provider-side seam. Slice 1 ships simulators; a RenderExecutor (Task 4) implements the same
// interface for real compute. The paywalled money path never changes; only what runs behind it does.
import { descriptorFor } from "../services/registry";

export type Connect = Record<string, unknown>;
export type Telemetry = Record<string, unknown> & { seq: number; ts: number };

export interface ServiceExecutor {
  readonly kind: string;
  readonly serviceType: string;
  provision(sessionId: string, spec: Record<string, unknown>): Promise<Connect>;
  heartbeat(sessionId: string): Promise<Telemetry>;
  usage(sessionId: string): Promise<number>; // cumulative accrued whole units for this session
  release(sessionId: string): Promise<void>;
}

type Session = { seq: number; units: number; bytes: number; spec: Record<string, unknown> };

const wobble = (base: number, span: number, seq: number) =>
  Math.round((base + span * (0.5 + 0.5 * Math.sin(seq / 3))) * 10) / 10;

function wireguardProfile(spec: Record<string, unknown>): string {
  return `[Interface]\n# Prime Compute VPN (${String(spec.exitLocation ?? "??")})\nPrivateKey = <redacted>\nAddress = 10.7.0.2/32\n\n[Peer]\nEndpoint = ${String(spec.exitLocation ?? "exit")}.vpn.prime:51820\nAllowedIPs = 0.0.0.0/0\n`;
}

// One simulator, parameterized by the descriptor's category, so the six types share one code path.
export function makeSimulatedExecutor(serviceType: string): ServiceExecutor {
  const d = descriptorFor(serviceType);
  const sessions = new Map<string, Session>();

  return {
    kind: d.defaultExecutorKind,
    serviceType,
    async provision(sessionId, spec) {
      sessions.set(sessionId, { seq: 0, units: 0, bytes: 0, spec });
      if (d.category === "network") return { profile: wireguardProfile(spec) };
      if (d.category === "storage") return { bucketUrl: `s3://prime/${sessionId}`, accessKey: "AK-sim", secretKey: "SK-sim" };
      if (d.category === "worker") return { submitUrl: `https://worker.prime/${sessionId}`, token: "wk-sim" };
      return { host: `${sessionId}.compute.prime`, user: "prime", token: "ssh-sim" };
    },
    async heartbeat(sessionId) {
      const s = sessions.get(sessionId) ?? { seq: 0, units: 0, bytes: 0, spec: {} };
      sessions.set(sessionId, s);
      const seq = s.seq++;
      if (d.category === "network") {
        s.bytes += 1_000_000_000; // ~1 GB per heartbeat in the simulation
        s.units = Math.floor(s.bytes / 1_000_000_000);
        return { bytesTransferred: s.bytes, unitsAccrued: s.units, seq, ts: Date.now() };
      }
      if (d.category === "storage") {
        const capacityGb = Number(s.spec.capacityGb ?? 100);
        s.units += 1; // one GB-hour tick in the simulation
        return { usedGb: capacityGb, unitsAccrued: s.units, seq, ts: Date.now() };
      }
      if (d.category === "worker") {
        s.units += 1;
        return { cpu: wobble(30, 25, seq), ramGb: wobble(4, 3, seq), jobsRun: s.units, seq, ts: Date.now() };
      }
      s.units += 1; // one second per heartbeat
      const hasGpu = serviceType === "GPU" || serviceType === "Full Server";
      return { cpu: wobble(35, 30, seq), ramGb: wobble(6, 4, seq), gpuUtil: hasGpu ? wobble(60, 35, seq) : 0, seq, ts: Date.now() };
    },
    async usage(sessionId) {
      return sessions.get(sessionId)?.units ?? 0;
    },
    async release(sessionId) {
      sessions.delete(sessionId);
    },
  };
}
```

If a `ComputeExecutor`/`SimulatedExecutor` export is still imported elsewhere, keep a thin back-compat alias at the bottom: `export const SimulatedExecutor = /* legacy */`. Grep first: `grep -rn "SimulatedExecutor\|ComputeExecutor" services/src src --include=*.ts | grep -v test`. Update each importer to `makeSimulatedExecutor(type)` / `ServiceExecutor`; the provider server is handled in Task 5.

- [ ] **Step 4: Run tests**

Run: `cd services && bun test src/provider/executor.test.ts`
Expected: PASS (4 new tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/provider/executor.ts services/src/provider/executor.test.ts
git commit -m "feat(provider): ServiceExecutor seam + per-type simulators with unit accrual"
```

---

### Task 4: RenderExecutor (compute, seam-ready, off by default)

**Files:**
- Create: `services/src/provider/render.ts`
- Test: `services/src/provider/render.test.ts`

- [ ] **Step 1: Write the failing test (`services/src/provider/render.test.ts`)**

```ts
import { describe, test, expect } from "bun:test";
import { RenderExecutor, type RenderApi } from "./render";

const fakeApi = (): RenderApi => ({
  createService: async () => ({ id: "srv-1", host: "srv-1.onrender.com" }),
  deleteService: async () => {},
});

describe("RenderExecutor", () => {
  test("conforms to ServiceExecutor and provisions a real host", async () => {
    const ex = new RenderExecutor("GPU", fakeApi());
    const connect = await ex.provision("s1", { region: "US-East" });
    expect((connect as { host: string }).host).toBe("srv-1.onrender.com");
    expect(await ex.usage("s1")).toBe(0);
    await ex.heartbeat("s1");
    expect(await ex.usage("s1")).toBe(1);
    await ex.release("s1"); // tears down via api.deleteService
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services && bun test src/provider/render.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `services/src/provider/render.ts`**

```ts
// services/src/provider/render.ts
// Seam-ready real compute executor. It implements ServiceExecutor against Render's API so the
// platform can provision real containers later. It is never the default: platform listings run the
// simulator until RENDER_API_KEY is set and the provider factory opts in (Task 5 note). Compute only.
import type { ServiceExecutor, Connect, Telemetry } from "./executor";

export interface RenderApi {
  createService(input: { region: string }): Promise<{ id: string; host: string }>;
  deleteService(id: string): Promise<void>;
}

// Thin real client. Left minimal on purpose; wiring real HTTP calls is a later flip behind the seam.
export function makeRenderApi(apiKey: string): RenderApi {
  const base = "https://api.render.com/v1";
  return {
    async createService({ region }) {
      const res = await fetch(`${base}/services`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ type: "web_service", region }),
      });
      if (!res.ok) throw new Error(`render createService failed: ${res.status}`);
      const j = (await res.json()) as { service?: { id: string } };
      const id = j.service?.id ?? "";
      return { id, host: `${id}.onrender.com` };
    },
    async deleteService(id) {
      await fetch(`${base}/services/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${apiKey}` } });
    },
  };
}

export class RenderExecutor implements ServiceExecutor {
  readonly kind = "render";
  private ids = new Map<string, string>();
  private units = new Map<string, number>();
  constructor(readonly serviceType: string, private api: RenderApi) {}

  async provision(sessionId: string, spec: Record<string, unknown>): Promise<Connect> {
    const svc = await this.api.createService({ region: String(spec.region ?? "oregon") });
    this.ids.set(sessionId, svc.id);
    this.units.set(sessionId, 0);
    return { host: svc.host, user: "prime", token: "ssh-render" };
  }
  async heartbeat(sessionId: string): Promise<Telemetry> {
    const u = (this.units.get(sessionId) ?? 0) + 1;
    this.units.set(sessionId, u);
    return { cpu: 0, ramGb: 0, gpuUtil: 0, seq: u - 1, ts: Date.now() };
  }
  async usage(sessionId: string): Promise<number> {
    return this.units.get(sessionId) ?? 0;
  }
  async release(sessionId: string): Promise<void> {
    const id = this.ids.get(sessionId);
    if (id) await this.api.deleteService(id);
    this.ids.delete(sessionId);
    this.units.delete(sessionId);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd services && bun test src/provider/render.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add services/src/provider/render.ts services/src/provider/render.test.ts
git commit -m "feat(provider): seam-ready RenderExecutor (compute, off by default)"
```

---

### Task 5: Provider server serves the per-type path + an unpaywalled usage read

**Files:**
- Modify: `services/src/provider/server.ts`
- Test: `services/src/provider/server.test.ts`

- [ ] **Step 1: Add failing tests (`services/src/provider/server.test.ts`)**

```ts
import { describe, test, expect } from "bun:test";
import request from "supertest"; // if unavailable, use fetch against app.listen(0); keep the existing test's style
import { createProviderApp } from "./server";
import { makeSimulatedExecutor } from "./executor";

function vpnApp() {
  return createProviderApp({
    executor: makeSimulatedExecutor("VPN"),
    sellerAddress: "0xseller", price: "$0.01", facilitatorUrl: "http://facilitator",
    meta: { alias: "vpn-1", resourceType: "VPN", region: "EU", specs: {} },
    requireOverride: (_req, _res, next) => next(), // bypass the paywall in the test
  });
}

describe("provider server, generalized", () => {
  test("serves the descriptor path (/vpn) and reports usage unpaywalled", async () => {
    const app = vpnApp();
    await request(app).get("/vpn?session=s1").expect(200);
    const usage = await request(app).get("/usage?session=s1").expect(200);
    expect(usage.body.units).toBeGreaterThanOrEqual(1);
  });

  test("health reports the service type", async () => {
    const res = await request(vpnApp()).get("/health").expect(200);
    expect(res.body.resourceType).toBe("VPN");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services && bun test src/provider/server.test.ts`
Expected: FAIL (no `/vpn` or `/usage` route).

- [ ] **Step 3: Rewrite `services/src/provider/server.ts`**

```ts
import express, { type Express, type RequestHandler } from "express";
import { createGatewayMiddleware, type PaymentRequest } from "@circle-fin/x402-batching/server";
import type { ServiceExecutor } from "./executor";
import { descriptorFor, type ServiceCategory } from "../services/registry";

export type { PaymentRequest };

export type ProviderMeta = {
  alias: string;
  resourceType: string;
  region: string;
  specs: Record<string, unknown>;
};

export type ProviderAppOptions = {
  executor: ServiceExecutor;
  sellerAddress: string;
  price: string;
  facilitatorUrl: string;
  networks?: string[];
  meta: ProviderMeta;
  onPayment?: (amountAtomic: bigint) => void;
  requireOverride?: RequestHandler;
};

export function createProviderApp(opts: ProviderAppOptions): Express {
  const { executor, sellerAddress, price, facilitatorUrl, meta } = opts;
  const networks = opts.networks ?? ["eip155:5042002"];
  const d = descriptorFor(meta.resourceType);

  const app = express();
  const gateway = createGatewayMiddleware({ sellerAddress, networks, facilitatorUrl });
  const require_ = opts.requireOverride ?? gateway.require(price);

  // Unpaywalled identity + price.
  app.get("/health", (_req, res) => {
    res.json({ ok: true, kind: executor.kind, price, ...meta });
  });

  // Unpaywalled per-session usage read: the worker consults this to know how many whole units are
  // pending before it makes any paid hit, so an idle session is never charged.
  app.get("/usage", async (req, res) => {
    const sessionId = (typeof req.query.session === "string" && req.query.session) || "default";
    res.json({ units: await executor.usage(sessionId) });
  });

  // Paywalled: one x402 micro-payment buys one unit at the listed per-unit price. The path is the
  // descriptor's, so a compute provider serves /compute, a VPN provider /vpn, etc.
  app.get(d.path, require_, async (req, res) => {
    const pay = (req as PaymentRequest).payment;
    if (pay?.amount) {
      try { opts.onPayment?.(BigInt(pay.amount)); } catch { /* the tap must never break service */ }
    }
    const sessionId = (typeof req.query.session === "string" && req.query.session) || "default";
    const telemetry = await executor.heartbeat(sessionId);
    res.json({
      ok: true,
      payment: pay ? { payer: pay.payer, amount: pay.amount, transaction: pay.transaction } : null,
      telemetry,
    });
  });

  return app;
}

export type { ServiceCategory };
```

- [ ] **Step 4: Run tests**

Run: `cd services && bun test src/provider/server.test.ts`
Expected: PASS. If `supertest` is not a dep, mirror the existing server test's request style (the file already tested `/compute`; reuse its harness). Update the existing `/compute` test to use a `makeSimulatedExecutor("GPU")` app so it still passes.

- [ ] **Step 5: Commit**

```bash
git add services/src/provider/server.ts services/src/provider/server.test.ts
git commit -m "feat(provider): descriptor-path service endpoint + unpaywalled usage read"
```

---

### Task 6: Worker charges pending whole units per tick

**Files:**
- Modify: `services/src/worker/meter.ts:99-117`
- Test: `services/src/worker/meter.test.ts`

The URL is hardcoded `/compute`. Change it to the descriptor's path, and before charging, read pending units (`accrued − alreadyCharged`) and charge that many (capped) so a busy VPN tick bills several GB and an idle one bills none. Budget stays count-based.

- [ ] **Step 1: Add a failing test (`services/src/worker/meter.test.ts`)**

Use the existing test harness/fakes in that file. Add:

```ts
test("charges pending whole units per tick for a volume service", async () => {
  // Arrange a running VPN rent whose provider /usage reports 3 pending units this tick.
  // Use the file's existing fake registry + fake settlement; set the provider resourceType to "VPN"
  // and stub the usage read to return 3, then 3 (no new units), across two ticks.
  const deps = makeTickDeps({ resourceType: "VPN", pendingUnits: [3, 0], perTickCap: 5 });
  const first = await meterTick("rent-vpn", deps);
  expect(first.charged).toBe(true);
  expect(deps.settlement.calls).toBe(3);   // 3 paid hits for 3 GB
  const second = await meterTick("rent-vpn", { ...deps, nowMs: () => deps.now + deps.tickMs + 1 });
  expect(second.charged).toBe(false);       // no new units -> no charge
  expect(deps.settlement.calls).toBe(3);
});
```

Wire `makeTickDeps` to the file's existing fakes (extend them with a `usage` stub on the provider and a `resourceType`). Keep the existing compute test passing by defaulting `pendingUnits` to `[1, 1, ...]`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd services && bun test src/worker/meter.test.ts`
Expected: FAIL (worker still hits `/compute` once and ignores pending units).

- [ ] **Step 3: Change `meterTick` in `services/src/worker/meter.ts`**

Replace the single-charge block (lines ~99-117) with a pending-units loop. Read the descriptor for the path, fetch pending units from the provider's `/usage`, and charge `min(pending, perTickCap)` times:

```ts
import { descriptorFor } from "../services/registry";

// ... inside meterTick, after resolving `provider`:
const d = descriptorFor(provider.resourceType);
const perTickCap = deps.perTickCap ?? 10;

// How many whole units are owed but not yet charged this session.
let pending = 1; // time types: one unit per tick
if (d.metering === "volume") {
  const accrued = await deps.readUsage(`${provider.endpointUrl}/usage?session=${rent.id}`);
  const charged = (await registry.listCharges(rentId)).length;
  pending = Math.max(0, accrued - charged);
}
if (pending === 0) {
  await registry.updateRent(rentId, { lastChargedAt: new Date(clock()).toISOString() });
  return { charged: false, status: "running", reason: "no units pending" };
}

const url = `${provider.endpointUrl}${d.path}?session=${rent.id}`;
let chargedAny = false;
const toCharge = Math.min(pending, perTickCap);
for (let i = 0; i < toCharge; i++) {
  const charges = await registry.listCharges(rentId);
  if (charges.length >= maxUnits) {
    await registry.updateRent(rentId, { status: "completed", totalCost: await registry.rentCost(rentId), endedAt: isoNow() });
    return { charged: chargedAny, status: "completed", reason: "budget reached" };
  }
  try {
    const paid = await settlement.payForCompute(url);
    const paidAtomic = Number(paid.amountAtomic);
    const feeAtomic = Math.floor((paidAtomic * (deps.feeBps ?? 0)) / 10_000);
    await registry.recordCharge({
      rentId, providerId: provider.id, seq: charges.length,
      amount: paidAtomic, feeAmount: feeAtomic, feeSettlementRef: null,
      authorizationRef: null, settled: false, settlementRef: paid.settlementRef,
    });
    chargedAny = true;
  } catch (e) {
    if (e instanceof SpendCapError) {
      await registry.updateRent(rentId, { status: "suspended" });
      return { charged: chargedAny, status: "suspended", reason: e.message };
    }
    break; // transient: stop this tick, retry next
  }
}
await registry.updateRent(rentId, {
  totalCost: await registry.rentCost(rentId),
  lastChargedAt: new Date(clock()).toISOString(),
});
return { charged: chargedAny, status: "running", reason: chargedAny ? "charged" : "transient" };
```

Add to `TickDeps`: `perTickCap?: number;` and `readUsage: (url: string) => Promise<number>;` (production wires `readUsage` to `fetch(url).then(r => r.json()).then(j => j.units)`; tests inject a stub).

- [ ] **Step 4: Run tests**

Run: `cd services && bun test src/worker/meter.test.ts`
Expected: PASS (new + existing). Wire `readUsage` where `meterTick` is called in the worker loop (`services/src/worker/loop.ts`); grep `meterTick(` to find call sites and pass `readUsage` + `perTickCap`.

- [ ] **Step 5: Commit**

```bash
git add services/src/worker/meter.ts services/src/worker/meter.test.ts services/src/worker/loop.ts
git commit -m "feat(worker): charge pending whole units per tick on the descriptor path"
```

---

### Task 7: Widen the resourceType DB check constraint

**Files:**
- Create: `services/supabase/migrations/0002_service_types.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0002_service_types.sql
-- Widen the resource_type check on providers and rents to allow VPN and Worker.
-- Postgres names inline column checks <table>_<column>_check.
alter table providers drop constraint if exists providers_resource_type_check;
alter table providers add constraint providers_resource_type_check
  check (resource_type in ('GPU','CPU','Storage','Full Server','VPN','Worker'));

alter table rents drop constraint if exists rents_resource_type_check;
alter table rents add constraint rents_resource_type_check
  check (resource_type in ('GPU','CPU','Storage','Full Server','VPN','Worker'));
```

- [ ] **Step 2: Verify the constraint names**

Run against the DB (or a local Supabase): `\d providers` and `\d rents`, confirm the check constraint names match `providers_resource_type_check` / `rents_resource_type_check`. If they differ (e.g. the rents table is named differently), fix the `drop constraint if exists` names to match. The `if exists` makes a name miss non-fatal, but the intended drop must hit.

- [ ] **Step 3: Apply and sanity-check**

Apply via your Supabase migration flow. Then confirm an insert with `resource_type = 'VPN'` succeeds (a quick `execute_sql` or a seeded VPN provider in Task 12).

- [ ] **Step 4: Commit**

```bash
git add services/supabase/migrations/0002_service_types.sql
git commit -m "feat(db): allow VPN and Worker resource types"
```

---

### Task 8: API validates listings against the descriptor spec schema

**Files:**
- Modify: `src/lib/agents/validate.ts`
- Test: `src/lib/agents/validate.test.ts`

- [ ] **Step 1: Add failing tests (`src/lib/agents/validate.test.ts`)**

```ts
import { describe, test, expect } from "bun:test";
import { parseProviderBody } from "./validate";

const base = { alias: "n", endpointUrl: "https://p.example.com", region: "EU", pricePerCharge: 0.01 };

describe("provider spec validation", () => {
  test("accepts a valid VPN listing", () => {
    const r = parseProviderBody({ ...base, resourceType: "VPN",
      specs: { exitLocation: "NL", protocol: "WireGuard", bandwidthMbps: 1000, region: "EU" } }, { allowPrivate: true });
    expect(r.ok).toBe(true);
  });

  test("rejects a VPN listing missing exitLocation", () => {
    const r = parseProviderBody({ ...base, resourceType: "VPN",
      specs: { protocol: "WireGuard", bandwidthMbps: 1000, region: "EU" } }, { allowPrivate: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/exitLocation|specs/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/lib/agents/validate.test.ts`
Expected: FAIL (specs currently passes through unvalidated).

- [ ] **Step 3: Add spec validation in `parseProviderBody`**

After the `isResourceType(o.resourceType)` check passes and before building the return value, validate `specs` against the descriptor:

```ts
import { descriptorFor } from "@services/services/registry";

// ... inside parseProviderBody, after the resourceType check:
const specsObj = (o.specs && typeof o.specs === "object" ? o.specs : {}) as Record<string, unknown>;
const specResult = descriptorFor(o.resourceType).specSchema.safeParse(specsObj);
if (!specResult.success) {
  return fail(`specs invalid for ${o.resourceType}: ${specResult.error.issues[0]?.message ?? "bad specs"}`);
}
```

and use `specResult.data` for `specs` in the returned value.

- [ ] **Step 4: Run tests**

Run: `bun test src/lib/agents/validate.test.ts && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/validate.ts src/lib/agents/validate.test.ts
git commit -m "feat(api): validate provider specs against the service descriptor"
```

---

### Task 9: MCP enum and connect payload from the registry

**Files:**
- Modify: `mcp/src/index.ts:16` (the `resourceType` enum) and the `register_server` input
- Test: `mcp/src/registry.test.ts` (new, a small guard)

- [ ] **Step 1: Add a failing test (`mcp/src/registry.test.ts`)**

```ts
import { describe, test, expect } from "bun:test";
import { serviceIds } from "../../services/src/services/registry";

describe("mcp service enum", () => {
  test("registry exposes VPN and Worker for the MCP tools", () => {
    expect(serviceIds()).toContain("VPN");
    expect(serviceIds()).toContain("Worker");
  });
});
```

(This pins the source the MCP enum derives from; the MCP server itself is stdio-wired and not unit-tested here.)

- [ ] **Step 2: Run to verify it passes the guard and then wire the enum**

Run: `cd mcp && bun test src/registry.test.ts`
Expected: PASS (it guards the registry). Now change `mcp/src/index.ts`:

Replace line 16:

```ts
const resourceType = z.enum(["GPU", "CPU", "Storage", "Full Server"]);
```

with a registry-derived enum:

```ts
import { serviceIds } from "../../services/src/services/registry";
const ids = serviceIds();
const resourceType = z.enum([ids[0]!, ...ids.slice(1)]);
```

(`z.enum` needs a non-empty tuple, hence the `[first, ...rest]` shape.)

- [ ] **Step 3: Typecheck the MCP package**

Run: `cd mcp && bunx tsc --noEmit`
Expected: clean. If the cross-package import path doesn't resolve, add a path alias or a relative import that matches the repo's tsconfig; confirm `discover_providers`/`rent_compute`/`register_server` still type-check.

- [ ] **Step 4: Commit**

```bash
git add mcp/src/index.ts mcp/src/registry.test.ts
git commit -m "feat(mcp): derive the service-type enum from the registry"
```

---

### Task 10: Register form renders fields from the descriptor

**Files:**
- Modify: `src/routes/register.tsx`

- [ ] **Step 1: Replace the hardcoded options and spec-building**

Replace `resOptions` (lines 29-34) so every registry type is selectable, driven by category for the icon:

```ts
import { serviceIds, descriptorFor } from "@services/services/registry";

const iconFor: Record<string, any> = { compute: Zap, storage: HardDrive, network: Shield, worker: Cpu };
const resOptions = serviceIds().map((id) => {
  const d = descriptorFor(id);
  return { id, icon: iconFor[d.category] ?? Server, desc: d.label };
});
```

(Import a `Shield` icon from lucide-react for the network category alongside the existing icon imports.)

Replace the `specs` builder (lines 68-71) so it collects the fields the chosen type's schema expects, from the form state. Keep the existing numeric inputs for compute; add conditional inputs for the network type:

```tsx
function buildSpecs(form: typeof initialForm): Record<string, unknown> {
  const d = descriptorFor(form.type);
  if (d.category === "network") {
    return { exitLocation: form.exitLocation, protocol: form.protocol, bandwidthMbps: form.bandwidthMbps, region: form.region };
  }
  if (d.category === "storage") return { capacityGb: form.storage, region: form.region };
  if (d.category === "worker") return { cpuCores: form.cpu, ramGb: form.ram, concurrency: form.concurrency, runtime: form.runtime, region: form.region };
  // compute
  return form.type === "GPU" || form.type === "Full Server"
    ? { gpu: form.gpu, vramGb: form.vram, cpuCores: form.cpu, ramGb: form.ram }
    : { cpuCores: form.cpu, ramGb: form.ram };
}
```

Add the new form fields to the `useState` default (`exitLocation: "NL"`, `protocol: "WireGuard"`, `bandwidthMbps: 1000`, `concurrency: 4`, `runtime: "node20"`), and render network/worker inputs in the Hardware step when `descriptorFor(form.type).category` is `network`/`worker` (mirror the existing GPU/Full-Server conditional blocks at lines 156/209). Use `buildSpecs(form)` in `submit()`.

- [ ] **Step 2: Verify in the browser preview**

Start the dev server, open `/register`, confirm all six types appear, selecting VPN shows exit-location/protocol/bandwidth inputs, and the console is clean. Submit a VPN listing against a public dummy endpoint (or with `ALLOW_PRIVATE_PROVIDER_ENDPOINTS=true`) and confirm it succeeds.

- [ ] **Step 3: tsc + commit**

```bash
bunx tsc --noEmit
git add src/routes/register.tsx
git commit -m "feat(web): register form renders fields per service descriptor"
```

---

### Task 11: Marketplace filters from the registry

**Files:**
- Modify: `src/routes/marketplace.index.tsx`

- [ ] **Step 1: Drive the type filters from the registry**

Replace `allTypes` (line 30) and the default `types` state (line 35) with registry ids:

```ts
import { serviceIds } from "@services/services/registry";
const allTypes = serviceIds();
// ...
const [types, setTypes] = useState<string[]>(serviceIds());
```

The filter predicate at line 44 currently special-cases `"Full Server"`. Replace with a plain membership test now that all types are in the list:

```ts
if (!types.includes(p.resourceType)) return false;
```

- [ ] **Step 2: Verify in the browser preview**

Open `/marketplace`, confirm VPN and Worker chips appear and filtering by them works. Console clean.

- [ ] **Step 3: tsc + commit**

```bash
bunx tsc --noEmit
git add src/routes/marketplace.index.tsx
git commit -m "feat(web): marketplace type filters from the service registry"
```

---

### Task 12: VPN end to end (integration test + seed)

**Files:**
- Test: `services/src/services/vpn-e2e.test.ts`
- Modify: `services/scripts/seed-providers.ts` (add a VPN + a Worker provider)

- [ ] **Step 1: Write the end-to-end test**

```ts
import { describe, test, expect } from "bun:test";
import { InMemoryRegistry } from "../registry/memory"; // use the file the contract tests use
import { makeSimulatedExecutor } from "../provider/executor";
import { meterTick } from "../worker/meter";
import { FakeSettlement } from "../settlement/fake";

describe("VPN provide -> rent -> meter -> connect", () => {
  test("bills per GB and hands back a profile", async () => {
    const reg = new InMemoryRegistry();
    const ex = makeSimulatedExecutor("VPN");
    const connect = await ex.provision("sess", { exitLocation: "NL", protocol: "WireGuard", bandwidthMbps: 1000, region: "EU" });
    expect((connect as { profile: string }).profile).toContain("[Interface]");

    // register a VPN provider + a running rent (mirror the registry contract test setup),
    // then meter one tick where /usage reports 2 pending GB units.
    const settlement = new FakeSettlement();
    // ... set up provider (resourceType "VPN"), rent (running), then:
    const res = await meterTick(rentId, {
      registry: reg, settlement, tickMs: 0, maxUnits: 100,
      readUsage: async () => 2, perTickCap: 10, nowMs: () => 1,
    });
    expect(res.charged).toBe(true);
    expect((await reg.listCharges(rentId)).length).toBe(2); // 2 GB -> 2 charges
  });
});
```

Fill the `...` using the exact registry fakes and provider/rent creation the existing `services/src/registry/contract.ts` tests use (same `registerProvider` / `createRent` / `updateRent` calls), so this test matches house style.

- [ ] **Step 2: Run to verify it passes**

Run: `cd services && bun test src/services/vpn-e2e.test.ts`
Expected: PASS.

- [ ] **Step 3: Seed a VPN and a Worker provider**

In `services/scripts/seed-providers.ts`, add two entries alongside the compute ones:

```ts
{ alias: "vpn-nl-1", resourceType: "VPN", region: "EU-West", pricePerCharge: 0.02,
  specs: { exitLocation: "NL", protocol: "WireGuard", bandwidthMbps: 1000, region: "EU-West" } },
{ alias: "worker-1", resourceType: "Worker", region: "US-East", pricePerCharge: 0.0001,
  specs: { cpuCores: 8, ramGb: 16, concurrency: 4, runtime: "node20", region: "US-East" } },
```

Match the exact field names the seed script already passes for compute providers.

- [ ] **Step 4: Run the seed against a scratch registry (or dry-run) + commit**

```bash
cd services && bun test src/services/vpn-e2e.test.ts && cd ..
git add services/src/services/vpn-e2e.test.ts services/scripts/seed-providers.ts
git commit -m "test(services): vpn provide->rent->meter e2e + seed vpn/worker providers"
```

---

### Task 13: Full gates and verification

**Files:** none (verification only)

- [ ] **Step 1: Run every gate**

```bash
bun test src
cd services && bun test && cd ..
bunx tsc --noEmit
cd mcp && bunx tsc --noEmit && cd ..
bun run build
```

Expected: all green. Fix any importer the enum-widening (Task 2) or executor rename (Task 3) missed, using the grep from those tasks.

- [ ] **Step 2: Browser preview pass**

Dev server up; `/register` shows six types with per-type fields, `/marketplace` filters on VPN/Worker, `/dashboard` renders. A running VPN rent shows the downloadable profile (the connect payload) rather than SSH creds. Screenshot for the user.

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "chore: multi-service marketplace gate fixes"
```

---

## Self-review notes

- Spec coverage: registry (T1), domain wiring (T2), executor generalization + simulators (T3), Render seam (T4), provider per-type path + usage read (T5), per-unit metering (T6), migration (T7), API spec validation (T8), MCP (T9), register form (T10), marketplace filters (T11), VPN e2e + seed (T12), gates (T13). Every spec section maps to a task.
- Type consistency: `ServiceExecutor` (`provision`/`heartbeat`/`usage`/`release`) is defined in T3 and consumed identically in T4/T5/T6/T12; `descriptorFor`/`serviceIds` from T1 are used in T2/T5/T6/T8/T9/T10/T11; `TickDeps` gains `readUsage` + `perTickCap` in T6 and both are passed in T12.
- Metering: one fixed-price hit per accrued unit, count-based budget, no new DB column, matches the reconciled spec.
- Watch items called out inline: constraint names to verify (T7 Step 2), `supertest` availability (T5 Step 4), cross-package registry import path from web and mcp (T8/T9), and executor/enum importer fallout (T2/T3 greps).
```
