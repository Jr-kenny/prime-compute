# Settlement Adapter Implementation Plan (Plan 4 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the broker-as-buyer side: a `SettlementAdapter` that pays a provider's `/compute` endpoint one gasless x402 charge at a time from the funded Arc wallet, enforces a deterministic spend cap at the signing seam the AI can't cross, and reconciles the batched on-chain settlement.

**Architecture:** The only place real USDC moves, isolated behind one interface. `GatewaySettlementAdapter` wraps the proven `GatewayClient` (raw-key path): `ensureFunded` tops up the Gateway balance, `payForCompute` runs the 402 flow and signs the EIP-3009 authorization, and `reconcile` polls the batch transfer to confirmation. The deterministic guard is a pure `checkSpend` function wired into the client's `onBeforePaymentCreation` hook, so a charge that would breach the cap is aborted before anything is signed. A `FakeSettlementAdapter` implements the same interface with no network so the stream engine (Plan 5) can be built and tested offline. A spike investigates whether a Circle developer-controlled wallet can replace the raw key as the signer.

**Tech Stack:** Bun + TypeScript, `bun test`, `@circle-fin/x402-batching` (buyer API), viem. Builds on the `services/` workspace from Plans 1-3.

**Spec:** [`docs/superpowers/specs/2026-06-28-autonomous-compute-broker-design.md`](../specs/2026-06-28-autonomous-compute-broker-design.md) — Components and boundaries (unit 4, Settlement adapter), Data flow steps 3-6 (Guard, Fund, Stream, Settle), Wallet layer.

**Foundations:** [`docs/superpowers/foundations-report.md`](../foundations-report.md) — buyer API (`GatewayClient` deposit/pay), `onBeforePaymentCreation` guard seam, batched/async settlement (`pay().transaction` is a settlement UUID, reconcile when the batch lands).

**Naming:** the metered billing unit is a **Charge** (not "tick"); a provider's price is `pricePerCharge`; the provider's paid endpoint is `/compute`. See [`2026-06-28-state-and-registry.md`](2026-06-28-state-and-registry.md) and [`2026-06-28-provider-service.md`](2026-06-28-provider-service.md).

**Branch:** `git checkout -b feat/settlement-adapter` off `main`.

**Handoff note:** Tasks 1-2 and 5 run fully offline (pure guard math + the fake adapter). Task 3 (`GatewaySettlementAdapter`) type-checks offline but is exercised only by the gated script in Task 4, which needs `BROKER_WALLET_PRIVATE_KEY` (funded buyer) and `PROVIDER_WALLET_PRIVATE_KEY` in `services/.env` plus a reachable provider; it is a manual script, not part of `bun test`. Task 6 (Circle-wallet spike) is investigation + a written finding, not production code.

---

## File Structure

**Created:**
- `services/src/settlement/spend-policy.ts` — pure `checkSpend` deterministic guard + `SpendCapError`
- `services/src/settlement/spend-policy.test.ts` — unit tests for the guard
- `services/src/settlement/adapter.ts` — `SettlementAdapter` interface + shared result types
- `services/src/settlement/fake.ts` — `FakeSettlementAdapter` (no network, enforces the same guard)
- `services/src/settlement/fake.test.ts` — tests the fake against the adapter behavior
- `services/src/settlement/gateway.ts` — `GatewaySettlementAdapter` (real, raw-key, wraps `GatewayClient`)
- `services/scripts/settlement-roundtrip.ts` — manual real deposit + paid charge + reconcile (gated on wallet keys)

**Modified:**
- `services/package.json` — add `settlement:roundtrip` script
- `services/.env.example` — add `BROKER_SPEND_CAP_USD` (per-stream cap)
- `docs/superpowers/foundations-report.md` — append the Circle-wallet signer spike finding (Task 6)

---

## Task 1: The deterministic spend guard

**Files:**
- Create: `services/src/settlement/spend-policy.ts`
- Test: `services/src/settlement/spend-policy.test.ts`

All amounts are USDC atomic units (6 decimals) as `bigint`, matching `Charge.amount`.

- [ ] **Step 1: Write the failing test**

Write `services/src/settlement/spend-policy.test.ts`:

```ts
import { test, expect } from "bun:test";
import { checkSpend, SpendCapError } from "./spend-policy";

test("allows a charge that stays within the cap", () => {
  expect(checkSpend({ nextAtomic: 100n, spentAtomic: 0n, capAtomic: 1000n })).toEqual({ ok: true });
});

test("allows a charge that exactly reaches the cap", () => {
  expect(checkSpend({ nextAtomic: 100n, spentAtomic: 900n, capAtomic: 1000n })).toEqual({ ok: true });
});

test("rejects a charge that would exceed the cap", () => {
  const d = checkSpend({ nextAtomic: 101n, spentAtomic: 900n, capAtomic: 1000n });
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.reason).toMatch(/exceed/);
});

test("rejects a non-positive charge", () => {
  expect(checkSpend({ nextAtomic: 0n, spentAtomic: 0n, capAtomic: 1000n }).ok).toBe(false);
  expect(checkSpend({ nextAtomic: -5n, spentAtomic: 0n, capAtomic: 1000n }).ok).toBe(false);
});

test("SpendCapError carries the reason", () => {
  const err = new SpendCapError("over the cap");
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe("SpendCapError");
  expect(err.message).toBe("over the cap");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/settlement/spend-policy.test.ts`
Expected: FAIL — `Cannot find module "./spend-policy"`.

- [ ] **Step 3: Write the guard**

Write `services/src/settlement/spend-policy.ts`:

```ts
export type SpendDecision = { ok: true } | { ok: false; reason: string };

export type SpendArgs = {
  nextAtomic: bigint; // the charge about to be signed
  spentAtomic: bigint; // total already settled/committed this stream
  capAtomic: bigint; // the per-stream spend cap
};

// The line the AI cannot cross. Pure and deterministic: no network, no model.
export function checkSpend({ nextAtomic, spentAtomic, capAtomic }: SpendArgs): SpendDecision {
  if (nextAtomic <= 0n) return { ok: false, reason: `non-positive charge amount: ${nextAtomic}` };
  if (spentAtomic + nextAtomic > capAtomic) {
    return {
      ok: false,
      reason: `charge ${nextAtomic} would exceed cap ${capAtomic} (already spent ${spentAtomic})`,
    };
  }
  return { ok: true };
}

export class SpendCapError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SpendCapError";
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/settlement/spend-policy.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/settlement/spend-policy.ts services/src/settlement/spend-policy.test.ts
git commit -m "feat(settlement): deterministic spend-cap guard (pure)"
```

---

## Task 2: SettlementAdapter interface + FakeSettlementAdapter

**Files:**
- Create: `services/src/settlement/adapter.ts`
- Create: `services/src/settlement/fake.ts`
- Test: `services/src/settlement/fake.test.ts`

- [ ] **Step 1: Write the interface**

Write `services/src/settlement/adapter.ts`:

```ts
export type PaidCompute = {
  amountAtomic: bigint; // what was charged for this unit
  settlementRef: string; // batch transfer id (reconcile against this); never a tx hash yet
  data: unknown; // the provider's response body (telemetry etc.)
  status: number; // HTTP status from the provider
};

export type SettlementStatus = {
  ref: string;
  status: string; // raw provider/Gateway status (e.g. received|batched|confirmed|completed|failed)
  settled: boolean; // true once the batch has landed on-chain
};

// The only place real USDC moves, behind one interface so the stream engine never
// touches the wallet or the SDK directly.
export interface SettlementAdapter {
  readonly buyerAddress: string;
  /** Ensure the Gateway balance can cover at least `minAtomic`; deposits if short. */
  ensureFunded(minAtomic: bigint): Promise<{ deposited: boolean; depositTxHash?: string }>;
  /** Pay one charge for one unit of compute. Throws SpendCapError if the guard aborts. */
  payForCompute(url: string): Promise<PaidCompute>;
  /** Check whether a settlement ref has landed on-chain. */
  reconcile(settlementRef: string): Promise<SettlementStatus>;
}
```

- [ ] **Step 2: Write the failing test**

Write `services/src/settlement/fake.test.ts`:

```ts
import { test, expect } from "bun:test";
import { FakeSettlementAdapter } from "./fake";
import { SpendCapError } from "./spend-policy";

test("payForCompute returns an amount + settlement ref and increments spend", async () => {
  const a = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 250n });
  const first = await a.payForCompute("http://provider/compute");
  expect(first.amountAtomic).toBe(100n);
  expect(first.settlementRef).toBeTruthy();
  expect(first.status).toBe(200);
});

test("payForCompute throws SpendCapError once the cap would be exceeded", async () => {
  const a = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 250n });
  await a.payForCompute("u"); // 100
  await a.payForCompute("u"); // 200
  await expect(a.payForCompute("u")).rejects.toBeInstanceOf(SpendCapError); // 300 > 250
});

test("ensureFunded is a no-op for the fake", async () => {
  const a = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 250n });
  expect(await a.ensureFunded(100n)).toEqual({ deposited: false });
});

test("reconcile reports settled for a known ref", async () => {
  const a = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 250n });
  const { settlementRef } = await a.payForCompute("u");
  const s = await a.reconcile(settlementRef);
  expect(s.settled).toBe(true);
  expect(s.ref).toBe(settlementRef);
});

test("buyerAddress is exposed", () => {
  const a = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 250n });
  expect(a.buyerAddress).toBe("0xFAKEBUYER");
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd services && bun test src/settlement/fake.test.ts`
Expected: FAIL — `Cannot find module "./fake"`.

- [ ] **Step 4: Write the fake**

Write `services/src/settlement/fake.ts`:

```ts
import type { SettlementAdapter, PaidCompute, SettlementStatus } from "./adapter";
import { checkSpend, SpendCapError } from "./spend-policy";

export type FakeOptions = {
  pricePerChargeAtomic: bigint;
  capAtomic: bigint;
  buyerAddress?: string;
};

// Deterministic, no network. Enforces the same spend guard as the real adapter so
// the stream engine (Plan 5) can be developed and tested offline.
export class FakeSettlementAdapter implements SettlementAdapter {
  readonly buyerAddress: string;
  private spent = 0n;
  private seq = 0;
  private refs = new Set<string>();

  constructor(private opts: FakeOptions) {
    this.buyerAddress = opts.buyerAddress ?? "0xFAKEBUYER";
  }

  async ensureFunded(_minAtomic: bigint): Promise<{ deposited: boolean }> {
    return { deposited: false };
  }

  async payForCompute(_url: string): Promise<PaidCompute> {
    const nextAtomic = this.opts.pricePerChargeAtomic;
    const decision = checkSpend({ nextAtomic, spentAtomic: this.spent, capAtomic: this.opts.capAtomic });
    if (!decision.ok) throw new SpendCapError(decision.reason);
    this.spent += nextAtomic;
    const settlementRef = `fake-settlement-${this.seq++}`;
    this.refs.add(settlementRef);
    return {
      amountAtomic: nextAtomic,
      settlementRef,
      data: { ok: true, telemetry: { cpu: 42, gpuUtil: 70, seq: this.seq - 1, ts: Date.now() } },
      status: 200,
    };
  }

  async reconcile(settlementRef: string): Promise<SettlementStatus> {
    return { ref: settlementRef, status: this.refs.has(settlementRef) ? "completed" : "unknown", settled: this.refs.has(settlementRef) };
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd services && bun test src/settlement/fake.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add services/src/settlement/adapter.ts services/src/settlement/fake.ts services/src/settlement/fake.test.ts
git commit -m "feat(settlement): SettlementAdapter interface + FakeSettlementAdapter"
```

---

## Task 3: GatewaySettlementAdapter (real, raw-key)

**Files:**
- Create: `services/src/settlement/gateway.ts`
- Modify: `services/.env.example`

This wraps the proven `GatewayClient`. It is not unit-tested (it needs network +
a funded wallet); it type-checks here and is exercised by Task 4's gated script.

- [ ] **Step 1: Write the adapter**

Write `services/src/settlement/gateway.ts`. The hook signature and `pay`/`deposit`/
`getBalances`/`getTransferById` shapes are from `@circle-fin/x402-batching/client`
(see the foundations report).

```ts
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { parseUnits } from "viem";
import type { SettlementAdapter, PaidCompute, SettlementStatus } from "./adapter";
import { checkSpend, SpendCapError } from "./spend-policy";

export type GatewayAdapterOptions = {
  privateKey: `0x${string}`;
  capAtomic: bigint; // per-stream spend cap
  chain?: "arcTestnet"; // slice 1 target
};

// USDC has 6 decimals; the SDK takes deposit amounts as decimal strings.
const USDC_DECIMALS = 6;

export class GatewaySettlementAdapter implements SettlementAdapter {
  private client: GatewayClient;
  readonly buyerAddress: string;
  private spent = 0n;
  private lastAbortReason: string | null = null;

  constructor(private opts: GatewayAdapterOptions) {
    this.client = new GatewayClient({ chain: opts.chain ?? "arcTestnet", privateKey: opts.privateKey });
    this.buyerAddress = this.client.address;

    // The deterministic guard, wired at the signing seam. Returning { abort } makes
    // pay() throw before any EIP-3009 authorization is signed.
    this.client.onBeforePaymentCreation(async (ctx) => {
      const nextAtomic = BigInt(ctx.selectedRequirements.amount);
      const decision = checkSpend({ nextAtomic, spentAtomic: this.spent, capAtomic: this.opts.capAtomic });
      if (!decision.ok) {
        this.lastAbortReason = decision.reason;
        return { abort: true, reason: decision.reason };
      }
      return undefined;
    });
  }

  async ensureFunded(minAtomic: bigint): Promise<{ deposited: boolean; depositTxHash?: string }> {
    const balances = await this.client.getBalances();
    if (balances.gateway.available >= minAtomic) return { deposited: false };
    const shortfall = minAtomic - balances.gateway.available;
    // Deposit the shortfall (decimal string), rounding up to the next whole atomic unit.
    const amount = formatAtomic(shortfall);
    const dep = await this.client.deposit(amount);
    return { deposited: true, depositTxHash: dep.depositTxHash };
  }

  async payForCompute(url: string): Promise<PaidCompute> {
    this.lastAbortReason = null;
    try {
      const res = await this.client.pay(url);
      this.spent += res.amount;
      return { amountAtomic: res.amount, settlementRef: res.transaction, data: res.data, status: res.status };
    } catch (err) {
      // The guard hook makes pay() throw "Payment creation aborted: <reason>".
      if (this.lastAbortReason) throw new SpendCapError(this.lastAbortReason);
      throw err;
    }
  }

  async reconcile(settlementRef: string): Promise<SettlementStatus> {
    const t = await this.client.getTransferById(settlementRef);
    const settled = t.status === "completed" || t.status === "confirmed";
    return { ref: settlementRef, status: t.status, settled };
  }
}

function formatAtomic(atomic: bigint): string {
  // bigint atomic -> decimal USDC string, e.g. 100n -> "0.0001"
  const negative = atomic < 0n;
  const v = (negative ? -atomic : atomic).toString().padStart(USDC_DECIMALS + 1, "0");
  const whole = v.slice(0, v.length - USDC_DECIMALS);
  const frac = v.slice(v.length - USDC_DECIMALS).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
```

> `parseUnits` is imported for symmetry with viem money handling; if your linter
> flags it as unused after writing `formatAtomic`, drop the import. `formatAtomic`
> is used because `deposit` wants a decimal string while caps are atomic bigints.

- [ ] **Step 2: Add the spend-cap env doc**

Append to `services/.env.example`:

```bash

# Settlement (broker-as-buyer)
BROKER_SPEND_CAP_USD=1.00
```

- [ ] **Step 3: Type-check**

Run: `cd services && bunx tsc --noEmit`
Expected: exit 0. (If `parseUnits` is reported unused, remove its import and re-run.)

- [ ] **Step 4: Commit**

```bash
git add services/src/settlement/gateway.ts services/.env.example
git commit -m "feat(settlement): GatewaySettlementAdapter (raw-key) with spend-cap guard"
```

---

## Task 4: Real settlement round-trip script (handoff: needs a funded wallet)

**Files:**
- Create: `services/scripts/settlement-roundtrip.ts`
- Modify: `services/package.json`

Proves the adapter end-to-end: fund, pay a real provider's `/compute`, reconcile.

- [ ] **Step 1: Write the script**

Write `services/scripts/settlement-roundtrip.ts`. It boots a provider in-process
(reusing Plan 3's app) and pays it through the adapter.

```ts
import { privateKeyToAccount } from "viem/accounts";
import type { AddressInfo } from "node:net";
import { createProviderApp } from "../src/provider/server";
import { SimulatedExecutor } from "../src/provider/executor";
import { GatewaySettlementAdapter } from "../src/settlement/gateway";

const brokerKey = process.env.BROKER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
const providerKey = process.env.PROVIDER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com";

if (!brokerKey || !providerKey) {
  throw new Error("Set BROKER_WALLET_PRIVATE_KEY and PROVIDER_WALLET_PRIVATE_KEY in services/.env");
}

const sellerAddress = privateKeyToAccount(providerKey).address;
const app = createProviderApp({
  executor: new SimulatedExecutor({ hasGpu: true }),
  sellerAddress,
  price: "$0.0001",
  facilitatorUrl,
  meta: { alias: "node-settlement", resourceType: "GPU", region: "US-East", specs: { gpu: "H100" } },
});
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
const url = `http://localhost:${port}/compute?session=settlement`;

try {
  // Cap of 0.001 USDC (1000 atomic) is plenty for a few 100-atomic charges.
  const adapter = new GatewaySettlementAdapter({ privateKey: brokerKey, capAtomic: 1000n });
  console.log("buyer:", adapter.buyerAddress);

  console.log("ensuring the Gateway balance covers at least 0.0005 USDC...");
  const fund = await adapter.ensureFunded(500n);
  console.log("  funded:", fund.deposited, fund.depositTxHash ?? "(already funded)");

  console.log("paying for one unit of compute...");
  const paid = await adapter.payForCompute(url);
  console.log("  amount (atomic):", paid.amountAtomic.toString());
  console.log("  settlement ref:", paid.settlementRef);
  console.log("  telemetry:", JSON.stringify((paid.data as { telemetry?: unknown }).telemetry));

  console.log("reconciling the batch...");
  const status = await adapter.reconcile(paid.settlementRef);
  console.log("  status:", status.status, "settled:", status.settled);

  console.log("\n✅ settlement adapter paid + reconciled a real charge on Arc testnet.");
} catch (err) {
  console.error("\n❌ settlement round-trip failed:", err instanceof Error ? err.message : err);
  console.error("If the buyer has no testnet USDC, fund it at https://faucet.circle.com and retry.");
  process.exitCode = 1;
} finally {
  server.close();
}
```

- [ ] **Step 2: Add the script to package.json**

Add to `services/package.json` scripts: `"settlement:roundtrip": "bun run scripts/settlement-roundtrip.ts"`.

- [ ] **Step 3: Run it (handoff)**

With both keys set and the buyer funded:
Run: `cd services && bun run settlement:roundtrip`
Expected: prints the buyer address, a funding line, `amount (atomic): 100`, a
settlement ref (a UUID), telemetry, and a reconcile status (likely `received`/
`batched` immediately after paying, `settled: false` until the batch lands; re-run
or wait and reconcile again to see it flip). Without the keys it throws the clear
"Set ..." error and does nothing on-chain.

- [ ] **Step 4: Commit**

```bash
git add services/scripts/settlement-roundtrip.ts services/package.json
git commit -m "test(settlement): real deposit + paid charge + reconcile round-trip"
```

---

## Task 5: Wrap-up of the buildable adapter

- [ ] **Step 1: Full suite + type-check**

Run: `cd services && bun test && bunx tsc --noEmit`
Expected: all tests pass (existing suites + spend-policy + fake). The Gateway
adapter and both round-trip scripts are not part of `bun test`. tsc exit 0.

- [ ] **Step 2: Lint the touched frontend? (none)** — this plan does not touch `src/`.

---

## Task 6: Circle-wallet signer spike (investigation + finding)

The spec's Wallet layer wants the real broker on a Circle developer-controlled
wallet, not a raw key. This task decides whether that's reachable on the buyer side
and writes the finding down. It produces no production code unless the path is
clearly viable and cheap.

**Files:**
- Modify: `docs/superpowers/foundations-report.md`

- [ ] **Step 1: Establish the question**

`GatewayClient` only accepts `privateKey: Hex` (raw key). But the lower-level
`BatchEvmScheme` takes a `BatchEvmSigner` = `{ address, signTypedData }`, and
`registerBatchScheme(x402Client, { signer })` registers it. A Circle
developer-controlled wallet can sign EIP-712 typed data via Circle's API. So the
question is: can a Circle-wallet-backed `BatchEvmSigner` drive the buyer flow
without `GatewayClient`?

- [ ] **Step 2: Read the surfaces**

Read the buyer types in
`services/node_modules/@circle-fin/x402-batching/dist/client/index.d.ts` and the
`BatchEvmSigner` / hook types in the referenced `hooks-*.d.ts`. Confirm:
- `BatchEvmSigner.signTypedData` param/return shape (the EIP-712 payload it must sign).
- Whether the 402 HTTP flow and `deposit` exist anywhere except on `GatewayClient`
  (deposit is an on-chain ERC-20 approve+deposit — it needs a sender, not just a
  typed-data signer).

- [ ] **Step 3: Write the finding**

Append a section to `docs/superpowers/foundations-report.md` titled
"## Circle-wallet signer spike (Plan 4)" stating, in plain prose with the exact
type names: whether a Circle-wallet `BatchEvmSigner` can produce the EIP-3009
signature for `payForCompute` (signing path), and what's missing for `deposit` and
the 402 HTTP retry if `GatewayClient` is bypassed (funding path). Conclude with a
recommendation: either (a) slice 1 stays on the raw-key `GatewaySettlementAdapter`
and the Circle wallet is a Phase 2 swap behind the same `SettlementAdapter`
interface, or (b) a concrete adapter variant is worth building now. Do not change
`GatewaySettlementAdapter` unless (b) is justified and cheap.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/foundations-report.md
git commit -m "docs(settlement): Circle-wallet signer spike finding"
```

---

## Task 7: Finish the branch

- [ ] **Step 1: Finish**

Use superpowers:finishing-a-development-branch (verify tests, present options,
execute choice). Default to merging to `main` once green.

---

## Self-Review Notes

**Spec coverage:** Implements spec component 4 (Settlement adapter): the broker-as-buyer
that signs EIP-3009 authorizations per charge from the funded Arc wallet, the only
place real USDC moves, behind one interface (data-flow step 5 Stream, step 4 Fund via
`ensureFunded`). The deterministic guard (data-flow step 3 Guard: "chosen rate within
spend policy, the AI never crosses this line") is `checkSpend` wired into
`onBeforePaymentCreation`, enforced before signing. Reconciliation (data-flow step 6
Settle: batched/async, reconcile when the batch lands) is `reconcile` over
`getTransferById`. The Wallet layer's Circle-wallet intent is addressed by the Task 6
spike behind the same interface.

**Placeholder scan:** No TBDs. The real adapter is written against the exact buyer
API from the foundations report; the round-trip script reuses Plan 3's provider app.
Tasks 4 step 3 and Task 6 are environment/investigation actions with explicit
commands and a defined written deliverable, not code placeholders. The one judgment
call (`parseUnits` import) is called out with how to resolve it.

**Type consistency:** `SettlementAdapter`, `PaidCompute`, `SettlementStatus` defined
in Task 2 and implemented by both `FakeSettlementAdapter` (Task 2) and
`GatewaySettlementAdapter` (Task 3). `checkSpend` / `SpendCapError` defined in Task 1
and used by both adapters. Amounts are `bigint` atomic units throughout, matching
`Charge.amount` (Plan 2) and `pricePerCharge`. `payForCompute` hits the provider's
`/compute` endpoint (Plan 3), and the round-trip script imports `createProviderApp` /
`SimulatedExecutor` with their real signatures.

**Not in scope (later plans):** the stream engine that calls `payForCompute` in a
loop per running rent, records each `Charge` to the registry, and triggers
`reconcile` (Plan 5); persisting the `settlements` table and marking charges settled
(Plan 5, using the registry); the broker's model-driven decisions and the rest of the
guardrails beyond spend cap (Plan 5); Lumen + dashboard wiring (Plan 6).
