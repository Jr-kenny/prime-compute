# Provider Service Implementation Plan (Plan 3 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deployable provider template: a real x402 seller that paywalls each compute tick behind Circle's `createGatewayMiddleware`, serving telemetry from a pluggable `ComputeExecutor` (slice 1 ships `SimulatedExecutor`).

**Architecture:** The provider is a plain Express app. `GET /tick` is paywalled by the proven x402 seller middleware; behind the paywall sits a `ComputeExecutor` interface so the simulated compute of slice 1 becomes a real Railway/Render executor in Phase 2 with no change to the money path. `GET /health` is unpaywalled so the broker/registry can read the provider's identity and specs. The app is built by a `createProviderApp(opts)` factory (testable without binding a port); a thin entry script runs it from env config. The thing we simulate is the thing that later becomes the real deployable provider.

**Tech Stack:** Bun + TypeScript, `bun test`, Express 5, `@circle-fin/x402-batching` (seller API), viem. Builds on the `services/` workspace from Plans 1-2.

**Spec:** [`docs/superpowers/specs/2026-06-28-autonomous-compute-broker-design.md`](../specs/2026-06-28-autonomous-compute-broker-design.md) — Components and boundaries (unit 3, Provider service), Data flow steps 5-6.

**Foundations:** [`docs/superpowers/foundations-report.md`](../foundations-report.md) — the x402 seller API, Arc network `eip155:5042002`, and testnet facilitator are locked there and proven by `services/probes/x402-roundtrip.ts`.

**Branch:** `git checkout -b feat/provider-service` off `main`.

**Handoff note:** Tasks 1-3 and 5 run fully offline (the `/health` and 402-challenge tests need no network or wallet). Task 4 is a real on-chain round-trip script, gated on `PROVIDER_WALLET_PRIVATE_KEY` + `BROKER_WALLET_PRIVATE_KEY` in `services/.env` and a funded buyer (faucet: https://faucet.circle.com); it is a manual script, not part of `bun test`, so the suite stays green offline.

---

## File Structure

**Created:**
- `services/src/provider/executor.ts` — `ComputeExecutor` interface + `Telemetry` type + `SimulatedExecutor`
- `services/src/provider/executor.test.ts` — unit tests for `SimulatedExecutor`
- `services/src/provider/server.ts` — `createProviderApp(opts)` factory (the `/health` + paywalled `/tick` app)
- `services/src/provider/server.test.ts` — offline tests: `/health` metadata, `/tick` returns 402 without payment
- `services/scripts/run-provider.ts` — entry script: build a `SimulatedExecutor` + app from env and listen (the deployable template)
- `services/scripts/provider-roundtrip.ts` — manual real paid-tick check through the provider app (gated on wallet keys)

**Modified:**
- `services/package.json` — add `provider` and `provider:roundtrip` scripts
- `services/.env.example` — add `PROVIDER_PORT`, `PROVIDER_PRICE`, `PROVIDER_ALIAS`, `PROVIDER_REGION`, `PROVIDER_RESOURCE_TYPE`

---

## Task 1: ComputeExecutor interface + SimulatedExecutor

**Files:**
- Create: `services/src/provider/executor.ts`
- Test: `services/src/provider/executor.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/provider/executor.test.ts`:

```ts
import { test, expect } from "bun:test";
import { SimulatedExecutor } from "./executor";

test("tick returns an incrementing seq per session", async () => {
  const ex = new SimulatedExecutor({ hasGpu: true });
  expect((await ex.tick("s1")).seq).toBe(0);
  expect((await ex.tick("s1")).seq).toBe(1);
  expect((await ex.tick("s1")).seq).toBe(2);
});

test("sessions are independent", async () => {
  const ex = new SimulatedExecutor({ hasGpu: true });
  await ex.tick("a");
  await ex.tick("a");
  expect((await ex.tick("b")).seq).toBe(0);
  expect((await ex.tick("a")).seq).toBe(2);
});

test("a GPU profile reports gpuUtil, a CPU profile reports zero", async () => {
  const gpu = await new SimulatedExecutor({ hasGpu: true }).tick("s");
  const cpu = await new SimulatedExecutor({ hasGpu: false }).tick("s");
  expect(gpu.gpuUtil).toBeGreaterThan(0);
  expect(cpu.gpuUtil).toBe(0);
});

test("telemetry has the expected shape", async () => {
  const t = await new SimulatedExecutor({ hasGpu: true }).tick("s");
  expect(typeof t.cpu).toBe("number");
  expect(typeof t.ramGb).toBe("number");
  expect(typeof t.gpuUtil).toBe("number");
  expect(typeof t.ts).toBe("number");
});

test("release resets a session's seq", async () => {
  const ex = new SimulatedExecutor({ hasGpu: true });
  await ex.tick("s");
  await ex.tick("s");
  await ex.release("s");
  expect((await ex.tick("s")).seq).toBe(0);
});

test("kind identifies the executor", () => {
  expect(new SimulatedExecutor().kind).toBe("simulated");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/provider/executor.test.ts`
Expected: FAIL — `Cannot find module "./executor"`.

- [ ] **Step 3: Write the executor**

Write `services/src/provider/executor.ts`:

```ts
export type Telemetry = {
  cpu: number; // % utilization
  ramGb: number; // GB in use
  gpuUtil: number; // % (0 for CPU-only providers)
  seq: number; // tick counter for this session
  ts: number; // epoch ms
};

// The seam that makes the provider real later: slice 1 ships SimulatedExecutor;
// Phase 2 adds RailwayExecutor / RenderExecutor with the same interface, so the
// paywalled money path never changes.
export interface ComputeExecutor {
  readonly kind: string;
  /** One unit of compute for a session; returns a telemetry heartbeat. */
  tick(sessionId: string): Promise<Telemetry>;
  /** Release any resources held for a session. */
  release(sessionId: string): Promise<void>;
}

export class SimulatedExecutor implements ComputeExecutor {
  readonly kind = "simulated";
  private sessions = new Map<string, number>(); // sessionId -> next seq

  constructor(private profile: { hasGpu: boolean } = { hasGpu: true }) {}

  async tick(sessionId: string): Promise<Telemetry> {
    const seq = this.sessions.get(sessionId) ?? 0;
    this.sessions.set(sessionId, seq + 1);
    // Synthetic load that wobbles per tick so the live meter looks alive.
    const wobble = (base: number, span: number) =>
      Math.round((base + span * (0.5 + 0.5 * Math.sin(seq / 3))) * 10) / 10;
    return {
      cpu: wobble(35, 30),
      ramGb: wobble(6, 4),
      gpuUtil: this.profile.hasGpu ? wobble(60, 35) : 0,
      seq,
      ts: Date.now(),
    };
  }

  async release(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/provider/executor.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/provider/executor.ts services/src/provider/executor.test.ts
git commit -m "feat(provider): ComputeExecutor interface + SimulatedExecutor"
```

---

## Task 2: The provider app (paywalled /tick + /health)

**Files:**
- Create: `services/src/provider/server.ts`
- Test: `services/src/provider/server.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/provider/server.test.ts`. It boots the app on an ephemeral
port and checks the two offline-observable behaviors: `/health` serves metadata
with no payment, and `/tick` returns HTTP 402 when hit with no payment.

```ts
import { test, expect, afterEach } from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createProviderApp } from "./server";
import { SimulatedExecutor } from "./executor";

const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com";

function boot() {
  const app = createProviderApp({
    executor: new SimulatedExecutor({ hasGpu: true }),
    sellerAddress: "0x000000000000000000000000000000000000dEaD",
    price: "$0.0001",
    facilitatorUrl,
    meta: { alias: "test-node", resourceType: "GPU", region: "US-East", specs: { gpu: "H100" } },
  });
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  return { server, base: `http://localhost:${port}` };
}

let open: Server | undefined;
afterEach(() => open?.close());

test("/health returns provider metadata without payment", async () => {
  const { server, base } = boot();
  open = server;
  const res = await fetch(`${base}/health`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({
    ok: true,
    kind: "simulated",
    price: "$0.0001",
    alias: "test-node",
    resourceType: "GPU",
    region: "US-East",
  });
});

test("/tick without payment is rejected with 402", async () => {
  const { server, base } = boot();
  open = server;
  const res = await fetch(`${base}/tick`);
  expect(res.status).toBe(402);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/provider/server.test.ts`
Expected: FAIL — `Cannot find module "./server"`.

- [ ] **Step 3: Write the provider app**

Write `services/src/provider/server.ts`. The seller middleware usage is copied
verbatim from the proven `services/probes/x402-roundtrip.ts`.

```ts
import express, { type Express } from "express";
import { createGatewayMiddleware, type PaymentRequest } from "@circle-fin/x402-batching/server";
import type { ComputeExecutor } from "./executor";
import type { ResourceType } from "../domain";

export type ProviderMeta = {
  alias: string;
  resourceType: ResourceType;
  region: string;
  specs: Record<string, unknown>;
};

export type ProviderAppOptions = {
  executor: ComputeExecutor;
  sellerAddress: string;
  price: string; // x402 price string, e.g. "$0.0001"
  facilitatorUrl: string;
  networks?: string[]; // CAIP-2; default Arc testnet
  meta: ProviderMeta;
};

export function createProviderApp(opts: ProviderAppOptions): Express {
  const { executor, sellerAddress, price, facilitatorUrl, meta } = opts;
  const networks = opts.networks ?? ["eip155:5042002"]; // Arc testnet

  const app = express();
  const gateway = createGatewayMiddleware({ sellerAddress, networks, facilitatorUrl });

  // Unpaywalled: the broker/registry reads identity, specs, and price from here.
  app.get("/health", (_req, res) => {
    res.json({ ok: true, kind: executor.kind, price, ...meta });
  });

  // Paywalled: one x402 micro-payment buys one compute tick.
  app.get("/tick", gateway.require(price), async (req, res) => {
    const pay = (req as PaymentRequest).payment;
    const sessionId = (typeof req.query.session === "string" && req.query.session) || "default";
    const telemetry = await executor.tick(sessionId);
    res.json({
      ok: true,
      payment: pay
        ? { payer: pay.payer, amount: pay.amount, transaction: pay.transaction }
        : null,
      telemetry,
    });
  });

  return app;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/provider/server.test.ts`
Expected: PASS (2 tests). The 402 challenge is built from local seller config
(address, price, network), so no network or wallet is needed for this test.

- [ ] **Step 5: Commit**

```bash
git add services/src/provider/server.ts services/src/provider/server.test.ts
git commit -m "feat(provider): paywalled /tick + /health app factory"
```

---

## Task 3: Entry script + env docs

**Files:**
- Create: `services/scripts/run-provider.ts`
- Modify: `services/package.json`, `services/.env.example`

- [ ] **Step 1: Write the entry script**

Write `services/scripts/run-provider.ts`. It derives the seller address from the
provider key and reads the rest from env, then serves.

```ts
import { privateKeyToAccount } from "viem/accounts";
import { createProviderApp } from "../src/provider/server";
import { SimulatedExecutor } from "../src/provider/executor";
import type { ResourceType } from "../src/domain";

const key = process.env.PROVIDER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) throw new Error("Set PROVIDER_WALLET_PRIVATE_KEY in services/.env");

const sellerAddress = privateKeyToAccount(key).address;
const port = Number(process.env.PROVIDER_PORT ?? 4001);
const price = process.env.PROVIDER_PRICE ?? "$0.0001";
const resourceType = (process.env.PROVIDER_RESOURCE_TYPE ?? "GPU") as ResourceType;
const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com";
const hasGpu = resourceType === "GPU" || resourceType === "Full Server";

const app = createProviderApp({
  executor: new SimulatedExecutor({ hasGpu }),
  sellerAddress,
  price,
  facilitatorUrl,
  meta: {
    alias: process.env.PROVIDER_ALIAS ?? "node-local-1",
    resourceType,
    region: process.env.PROVIDER_REGION ?? "US-East",
    specs: hasGpu ? { gpu: "NVIDIA H100", vramGb: 80 } : { cpuCores: 64, ramGb: 256 },
  },
});

app.listen(port, () => {
  console.log(`provider ${sellerAddress} serving x402 ticks on :${port} at ${price}/tick`);
});
```

- [ ] **Step 2: Add the script to package.json**

Add to `services/package.json` scripts (after the existing `seed` entry):
`"provider": "bun run scripts/run-provider.ts"`.

- [ ] **Step 3: Add env docs**

Append to `services/.env.example`:

```bash

# Provider service (x402 seller — the deployable template)
PROVIDER_PORT=4001
PROVIDER_PRICE=$0.0001
PROVIDER_ALIAS=node-local-1
PROVIDER_REGION=US-East
PROVIDER_RESOURCE_TYPE=GPU
```

- [ ] **Step 4: Smoke-test the script boots and serves**

With `PROVIDER_WALLET_PRIVATE_KEY` set in `services/.env`, run in one shell:
`cd services && bun run provider`
In another shell: `curl -s localhost:4001/health` → expect JSON with
`"ok":true,"resourceType":"GPU"`; `curl -s -o /dev/null -w "%{http_code}" localhost:4001/tick`
→ expect `402`. Stop the server (Ctrl-C).

- [ ] **Step 5: Commit**

```bash
git add services/scripts/run-provider.ts services/package.json services/.env.example
git commit -m "feat(provider): run-provider entry script + env docs"
```

---

## Task 4: Real paid-tick round-trip script (handoff: needs a funded wallet)

**Files:**
- Create: `services/scripts/provider-roundtrip.ts`
- Modify: `services/package.json`

This proves the provider template end-to-end: a real buyer deposits once, then
pays for a real tick through the provider app and gets telemetry back. It is a
manual script (not in `bun test`) because it does an on-chain deposit.

- [ ] **Step 1: Write the round-trip script**

Write `services/scripts/provider-roundtrip.ts`:

```ts
import { privateKeyToAccount } from "viem/accounts";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createProviderApp } from "../src/provider/server";
import { SimulatedExecutor } from "../src/provider/executor";
import type { AddressInfo } from "node:net";

const providerKey = process.env.PROVIDER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
const brokerKey = process.env.BROKER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com";
const explorer = process.env.ARC_EXPLORER_URL ?? "https://testnet.arcscan.app";

if (!providerKey || !brokerKey) {
  throw new Error("Set PROVIDER_WALLET_PRIVATE_KEY and BROKER_WALLET_PRIVATE_KEY in services/.env");
}

const sellerAddress = privateKeyToAccount(providerKey).address;
const app = createProviderApp({
  executor: new SimulatedExecutor({ hasGpu: true }),
  sellerAddress,
  price: "$0.0001",
  facilitatorUrl,
  meta: { alias: "node-roundtrip", resourceType: "GPU", region: "US-East", specs: { gpu: "H100" } },
});
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
console.log(`provider ${sellerAddress} up on :${port}`);

try {
  const client = new GatewayClient({ chain: "arcTestnet", privateKey: brokerKey });
  console.log("buyer: depositing 0.10 USDC (one-time)...");
  const dep = await client.deposit("0.10");
  console.log("  deposit tx:", `${explorer}/tx/${dep.depositTxHash}`);

  console.log("buyer: paying for one /tick (gas-free)...");
  const result = await client.pay(`http://localhost:${port}/tick?session=roundtrip`);
  console.log("  telemetry:", JSON.stringify((result.data as { telemetry?: unknown }).telemetry));
  console.log("  amount (atomic):", result.amount.toString());

  console.log("\n✅ provider template served a real paid tick on Arc testnet.");
} catch (err) {
  console.error("\n❌ round-trip failed:", err instanceof Error ? err.message : err);
  console.error("If the buyer has no testnet USDC, fund it at https://faucet.circle.com and retry.");
  process.exitCode = 1;
} finally {
  server.close();
}
```

- [ ] **Step 2: Add the script to package.json**

Add to `services/package.json` scripts: `"provider:roundtrip": "bun run scripts/provider-roundtrip.ts"`.

- [ ] **Step 3: Run it (handoff)**

With both keys set and the buyer funded:
Run: `cd services && bun run provider:roundtrip`
Expected: prints a deposit tx URL, then telemetry (e.g. `{"cpu":...,"gpuUtil":...,"seq":0,...}`)
and the atomic amount `100`, then the success line. Without the keys it throws the
clear "Set ..." error and does nothing on-chain.

- [ ] **Step 4: Commit**

```bash
git add services/scripts/provider-roundtrip.ts services/package.json
git commit -m "test(provider): real paid-tick round-trip script through the provider template"
```

---

## Task 5: Wrap-up

- [ ] **Step 1: Full suite + type-check**

Run: `cd services && bun test && bunx tsc --noEmit`
Expected: all tests pass (config, scoring, registry contracts, executor, provider
server). The supabase contract runs only if `SUPABASE_*` is set; the provider
round-trip is a manual script and not part of `bun test`. tsc exit 0.

- [ ] **Step 2: Lint the touched frontend? (none)** — this plan does not touch `src/`.

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch (verify tests, present options,
execute choice). Default to merging to `main` once green.

---

## Self-Review Notes

**Spec coverage:** Implements spec component 3 (Provider service): the deployable
x402 seller template running `createGatewayMiddleware`, each tick a paywalled
request, with a `ComputeExecutor` interface and a `SimulatedExecutor` for slice 1
(Phase 2 `RailwayExecutor`/`RenderExecutor` drop in behind the same interface).
Covers data-flow step 5 (provider verifies the x402 payment and serves the tick =
simulated compute heartbeat + telemetry). The unpaywalled `/health` endpoint gives
the broker the provider's online status and specs (used by the matching engine in
Plan 5). Settlement reconciliation (data-flow step 6) stays in Plan 4/5; the
provider only reports what the facilitator told it (`req.payment`).

**Placeholder scan:** No TBDs. The seller middleware is copied from the proven
probe, not sketched. Task 3 step 4 and Task 4 step 3 are environment actions
(running a server, an on-chain script) with exact commands and expected output, not
code placeholders.

**Type consistency:** `Telemetry` and `ComputeExecutor` defined in Task 1 and used
by `createProviderApp` (Task 2) and both scripts (Tasks 3-4). `ProviderMeta` /
`ProviderAppOptions` defined in Task 2 and consumed by Tasks 3-4. `ResourceType`
is imported from the shared `../domain` (Plan 2), keeping the provider's resource
type identical to the registry's. The seller API (`createGatewayMiddleware`,
`gateway.require`, `PaymentRequest`, `GatewayClient`) matches the foundations
report and the existing probe exactly.

**Not in scope (later plans):** the broker that calls these endpoints and signs the
buyer side per tick (Plan 4 settlement adapter + Plan 5 stream engine), provider
self-registration into the registry (slice 1 seeds providers via Plan 2's seed
script; the registry row's `endpointUrl` points at a running provider), and real
compute execution behind the executor (Phase 2).
