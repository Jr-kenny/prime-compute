# Provider-Remit Fee Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One x402 payment per tick from the renter at the listed gross price; the provider template accrues the platform fee from received payments and remits it to the treasury from its Gateway earnings, with the platform ledger tracking per-charge receivables.

**Architecture:** Per spec `docs/superpowers/specs/2026-07-02-provider-remit-fee-model-design.md`. The meter drops its fee leg and records `fee_amount` as a *receivable* (`floor(paid * feeBps / 10000)`). The provider template goes back to paywalling the listed price and gains a remitter that accrues fee on every confirmed payment and, at a threshold, calls `GatewayClient.withdraw(fee, { recipient: TREASURY })` (earnings live in the seller's **Gateway balance**, verified against circlefin/arc-nanopayments), then reports `{ providerId, txHash, amountAtomic }` to a worker-hosted remittance endpoint. The worker verifies the tx on-chain (USDC Transfer to the treasury) and stamps `fee_settlement_ref` on the provider's oldest fully-covered outstanding charges, FIFO. The old fee endpoint, renter-side sweep, and net pricing are retired.

**Tech Stack:** Bun + TypeScript, `@circle-fin/x402-batching@3.2.0` (`GatewayClient.withdraw`, `createGatewayMiddleware`), viem (receipt verification), Supabase.

**Locked mechanics (verified against installed SDK + arc-nanopayments source):**
- Seller x402 earnings land in the seller's **Gateway balance**, not the wallet.
- `GatewayClient.withdraw(amount: string /* decimal USDC */, { chain?, recipient?, maxFee? })` -> `{ mintTxHash, amount: bigint, ... }`; same-chain is instant; `maxFee` defaults to `"2.01"`.
- `createGatewayMiddleware(...).require(price)` attaches `req.payment = { verified, payer, amount /* atomic string */, network, transaction? }`.
- Render free tier exposes only `$PORT`: the remittance endpoint rides the worker's existing `Bun.serve` health server, NOT a second port. `WORKER_FEE_PORT` is retired.
- USDC on Arc testnet: `0x3600000000000000000000000000000000000000`; treasury: `PLATFORM_TREASURY_ADDRESS`.

---

## File structure

- `services/src/registry/{registry,in-memory,supabase}.ts` + `contract.ts` — `listOutstandingFeeCharges(providerId)`
- `services/src/worker/meter.ts` + `meter.test.ts` — gross once, receivable, no fee leg
- `services/src/worker/loop.ts` — drop sweep pass + `feeBaseUrl`, thread `feeBps`
- DELETE `services/src/worker/{sweep,sweep.test,fee-app,fee-app.test}.ts`
- `services/src/worker/remit.ts` + `remit.test.ts` (new) — pure FIFO application + fetch-style endpoint handler
- `services/src/worker/verify-remittance.ts` + test (new) — on-chain USDC-Transfer-to-treasury check via viem
- `services/src/worker/index.ts` — remit route on the health server; `feeBps` in deps
- `services/src/provider/server.ts` + `server.test.ts` — paywall listed price, drop netPrice, add `onPayment`
- `services/src/provider/remitter.ts` + `remitter.test.ts` (new) — accrue/threshold/flush/report
- `services/scripts/run-provider.ts` — wire the remitter (GatewayClient withdraw seam, shutdown flush)
- `services/scripts/circle-roundtrip.ts` — drop `platformFeeBps` (option no longer exists)
- `services/scripts/remit-roundtrip.ts` (new, gated) — live proof
- `services/.env.example`, `docs/WORKER_DEPLOY.md` — env churn

---

## Task 1: Registry — outstanding fee receivables per provider

**Files:**
- Modify: `services/src/registry/registry.ts`
- Modify: `services/src/registry/in-memory.ts`
- Modify: `services/src/registry/supabase.ts`
- Test: `services/src/registry/contract.ts`

- [ ] **Step 1: Write the failing contract case**

In `services/src/registry/contract.ts`, add inside the describe block (uses the same `defaultTrust` import the existing provider cases use):

```ts
    test("listOutstandingFeeCharges returns unstamped fee charges for one provider, oldest first", async () => {
      const provider = await reg.registerProvider({
        alias: "recv-p", ownerWallet: "0xs", endpointUrl: "http://x", resourceType: "GPU", region: "US-East",
        specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 1,
      });
      const other = await reg.registerProvider({
        alias: "recv-q", ownerWallet: "0xs", endpointUrl: "http://y", resourceType: "GPU", region: "US-East",
        specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 1,
      });
      const rent = await reg.createRent({ name: "recv-rent", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
      // seq 0: outstanding; seq 1: already stamped; seq 2: zero fee; seq 3: other provider.
      await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: 0, amount: 100, feeAmount: 1, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: null });
      await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: 1, amount: 100, feeAmount: 2, feeSettlementRef: "0xdone", authorizationRef: null, settled: false, settlementRef: null });
      await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: 2, amount: 100, feeAmount: 0, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: null });
      await reg.recordCharge({ rentId: rent.id, providerId: other.id, seq: 3, amount: 100, feeAmount: 5, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: null });
      await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: 4, amount: 100, feeAmount: 3, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: null });

      const outstanding = await reg.listOutstandingFeeCharges(provider.id);
      expect(outstanding.map((c) => c.feeAmount)).toEqual([1, 3]); // oldest first, only unstamped fee > 0, only this provider
    }, T);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/registry/in-memory.test.ts`
Expected: FAIL (type error: `listOutstandingFeeCharges` not on `Registry`).

- [ ] **Step 3: Implement**

In `services/src/registry/registry.ts`, add to the `Registry` interface next to `listCharges`:

```ts
  /** Fee receivables: this provider's charges with fee_amount > 0 and no remittance stamp, oldest first. */
  listOutstandingFeeCharges(providerId: string): Promise<Charge[]>;
```

In `services/src/registry/in-memory.ts` (charges array preserves insertion order = creation order):

```ts
  async listOutstandingFeeCharges(providerId: string): Promise<Charge[]> {
    return this.charges.filter((c) => c.providerId === providerId && c.feeAmount > 0 && !c.feeSettlementRef);
  }
```

In `services/src/registry/supabase.ts` (reuse the existing `toCharge` mapper):

```ts
  async listOutstandingFeeCharges(providerId: string): Promise<Charge[]> {
    const { data, error } = await this.db.from("charges").select("*")
      .eq("provider_id", providerId).gt("fee_amount", 0).is("fee_settlement_ref", null)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`listOutstandingFeeCharges: ${error.message}`);
    return (data ?? []).map((r) => this.toCharge(r as Row));
  }
```

(If `toCharge` is a standalone function rather than a method in that file, call it the way `listCharges` does — mirror `listCharges` exactly.)

- [ ] **Step 4: Run in-memory contract + type-check**

Run: `cd services && bun test src/registry/in-memory.test.ts && bunx tsc --noEmit`
Expected: PASS + clean. (The live `supabase.test.ts` run of the same contract is covered by the full-suite gate in Task 7; it has been network-flaky, so don't block on it here.)

- [ ] **Step 5: Commit**

```bash
git add services/src/registry
git commit -m "feat(fees): registry lists a provider's outstanding fee receivables"
```

---

## Task 2: Meter pays gross once; fee becomes a receivable; sweep retires

**Files:**
- Modify: `services/src/worker/meter.ts`
- Modify: `services/src/worker/loop.ts`
- Delete: `services/src/worker/sweep.ts`, `services/src/worker/sweep.test.ts`
- Test: `services/src/worker/meter.test.ts`

- [ ] **Step 1: Rewrite the three fee tests in `meter.test.ts`**

Replace the three existing tests named `"meterTick streams the fee as its own nano-payment and records both refs"`, `"a failed fee payment doesn't block the provider stream; ref stays null for the sweep"`, and `"zero fee (legacy gross endpoint) skips the fee payment entirely"` (they use the file's `fakeSettlementSeq` helper — keep the helper) with:

```ts
test("meterTick makes ONE gross payment and records the fee as a receivable", async () => {
  const { reg, rent } = await seed(); // provider gross = 100 atomic
  await reg.updateRent(rent.id, { status: "running", providerId: (await reg.listProviders())[0]!.id, startedAt: new Date().toISOString() });
  const paidUrls: string[] = [];
  const settlement = fakeSettlementSeq(paidUrls, [100n]); // one payment, at gross
  const r = await meterTick(rent.id, { registry: reg, settlement, tickMs: 1000, maxUnits: 10, nowMs: () => 5, feeBps: 100 });
  expect(r.charged).toBe(true);
  expect(paidUrls.length).toBe(1); // no second payment, ever
  const [charge] = await reg.listCharges(rent.id);
  expect(charge?.amount).toBe(100);
  expect(charge?.feeAmount).toBe(1); // floor(100 * 100 / 10000) — a receivable, not a payment
  expect(charge?.feeSettlementRef).toBeNull(); // stamped later by a remittance
  expect((await reg.getRent(rent.id))?.totalCost).toBe(100); // renter spend only; see the rentCost note below
});

test("fee receivable floors and zero-bps records zero", async () => {
  const { reg, rent } = await seed();
  await reg.updateRent(rent.id, { status: "running", providerId: (await reg.listProviders())[0]!.id, startedAt: new Date().toISOString() });
  const settlement = fakeSettlementSeq([], [99n]);
  await meterTick(rent.id, { registry: reg, settlement, tickMs: 1000, maxUnits: 10, nowMs: () => 5, feeBps: 100 });
  expect((await reg.listCharges(rent.id))[0]?.feeAmount).toBe(0); // floor(99/100) = 0

  const { reg: reg2, rent: rent2 } = await seed();
  await reg2.updateRent(rent2.id, { status: "running", providerId: (await reg2.listProviders())[0]!.id, startedAt: new Date().toISOString() });
  const settlement2 = fakeSettlementSeq([], [100n]);
  await meterTick(rent2.id, { registry: reg2, settlement: settlement2, tickMs: 1000, maxUnits: 10, nowMs: () => 5 }); // no feeBps
  expect((await reg2.listCharges(rent2.id))[0]?.feeAmount).toBe(0);
});
```

**Step 2 note on `totalCost`:** `rentCost` sums `amount + feeAmount` (Phase 1). In this model the fee is the provider's liability, not extra renter spend — the renter paid exactly `amount`. Change `rentCost` in BOTH registries to sum `amount` only:

In `services/src/registry/in-memory.ts`:

```ts
  async rentCost(rentId: string): Promise<number> {
    return this.charges.filter((t) => t.rentId === rentId).reduce((s, t) => s + t.amount, 0);
  }
```

In `services/src/registry/supabase.ts`:

```ts
  async rentCost(rentId: string): Promise<number> {
    const { data, error } = await this.db.from("charges").select("amount").eq("rent_id", rentId);
    if (error) throw new Error(`rentCost: ${error.message}`);
    return (data ?? []).reduce((s, r) => s + Number((r as Row).amount), 0);
  }
```

And fix the Task-1-of-Phase-1 contract case in `services/src/registry/contract.ts`: the test `"recordCharge persists feeAmount and rentCost sums amount + fee"` asserts `rentCost === 100` from `amount: 99, feeAmount: 1`. Rename it to `"recordCharge persists feeAmount; rentCost is what the renter paid"` and change the assertion to `expect(await reg.rentCost(rent.id)).toBe(99);`. Fix the first meter test above accordingly: `totalCost` expectation becomes `100` (amount only). Use this final assertion in the meter test: `expect((await reg.getRent(rent.id))?.totalCost).toBe(100);`

- [ ] **Step 2: Run to verify failures**

Run: `cd services && bun test src/worker/meter.test.ts src/registry/in-memory.test.ts`
Expected: FAIL (`feeBps` unknown on `TickDeps`; old fee-leg behavior still present; rentCost mismatch).

- [ ] **Step 3: Implement the meter change**

In `services/src/worker/meter.ts`, `TickDeps` replaces `feeBaseUrl?: string` with:

```ts
  feeBps?: number;         // platform fee in basis points; recorded as a receivable, never paid here
```

Replace the whole fee block inside `meterTick`'s try (from `const grossAtomic = ...` down to the `recordCharge` call) with:

```ts
    const paidAtomic = Number(paid.amountAtomic);
    // The platform fee is a RECEIVABLE the provider owes from this payment (they received
    // gross; they remit fee from their Gateway earnings). Nothing extra leaves the renter,
    // and no second payment happens here. fee_settlement_ref is stamped when a verified
    // remittance covers this charge.
    const feeAtomic = Math.floor((paidAtomic * (deps.feeBps ?? 0)) / 10_000);
    await registry.recordCharge({
      rentId, providerId: provider.id, seq: charges.length,
      amount: paidAtomic, feeAmount: feeAtomic, feeSettlementRef: null,
      authorizationRef: null, settled: false, settlementRef: paid.settlementRef,
    });
```

(The `grossAtomic` const and the try/catch around the fee payment are deleted.)

- [ ] **Step 4: Drop the sweep + thread `feeBps` in the loop**

In `services/src/worker/loop.ts`:
- Delete the `import { sweepFees } from "./sweep";` line and the entire terminal-catch-up block at the end of `workerPass` (the `if (deps.feeBaseUrl) { ... }` block).
- In `WorkerDeps`, replace `feeBaseUrl?: string` with `feeBps?: number; // platform fee (basis points) recorded as a receivable per charge`.
- In the running-lease loop, pass it through: `await meterTick(rent.id, { registry, settlement, tickMs: deps.tickMs, maxUnits, nowMs: deps.nowMs, feeBps: deps.feeBps });`

Delete the files:

```bash
git rm services/src/worker/sweep.ts services/src/worker/sweep.test.ts
```

- [ ] **Step 5: Run worker + registry tests, expect one remaining break**

Run: `cd services && bun test src/worker src/registry/in-memory.test.ts`
Expected: meter + registry PASS; `worker/index.ts` still references `feeBaseUrl`/`createFeeApp` — that compiles until Task 5 only if untouched, so run `bunx tsc --noEmit` and fix index.ts minimally NOW: in `services/src/worker/index.ts` delete the whole fee-endpoint block (the `import { createServer } ... createFeeApp ...` section, lines importing `node:http` and `./fee-app` included) and change the deps line to:

```ts
const deps: WorkerDeps = {
  registry, settlementFor, rank, tickMs: TICK_MS, defaultMaxUnits: DEFAULT_MAX_UNITS,
  feeBps: Number(process.env.PLATFORM_FEE_BPS ?? "0"),
};
```

Then delete the fee app:

```bash
git rm services/src/worker/fee-app.ts services/src/worker/fee-app.test.ts
```

Run: `cd services && bun test src/worker && bunx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add -A services/src/worker services/src/registry
git commit -m "feat(fees): meter records the fee as a provider receivable; renter pays gross once"
```

---

## Task 3: Provider template back to the listed price, with an `onPayment` tap

**Files:**
- Modify: `services/src/provider/server.ts`
- Modify: `services/scripts/run-provider.ts` (compile fix only here; remitter wiring in Task 5)
- Modify: `services/scripts/circle-roundtrip.ts` (compile fix)
- Test: `services/src/provider/server.test.ts`

- [ ] **Step 1: Rewrite the pricing test + add the tap test**

In `services/src/provider/server.test.ts`, delete the test `"net pricing: /compute demands gross minus the platform fee, /health shows both"` and add (using the file's existing request helpers/fixtures):

```ts
test("/health shows the listed price only; /compute is paywalled at that price", async () => {
  const app = createProviderApp({
    executor: fakeExecutor(), sellerAddress: "0xseller", price: "$0.0001",
    facilitatorUrl: "http://facilitator", meta,
  });
  const res = await request(app).get("/health");
  expect(res.body.price).toBe("$0.0001");
  expect(res.body.netPrice).toBeUndefined();
});

test("onPayment fires with the atomic amount of each confirmed payment", async () => {
  const seen: bigint[] = [];
  // The paywall middleware attaches req.payment; in tests the middleware is stubbed the
  // same way the existing paywall tests stub it, injecting a fake payment.
  const app = createProviderApp({
    executor: fakeExecutor(), sellerAddress: "0xseller", price: "$0.0001",
    facilitatorUrl: "http://facilitator", meta,
    onPayment: (atomic) => { seen.push(atomic); },
  });
  // Simulate the middleware having verified a payment of 100 atomic:
  // call the /compute handler with req.payment preset (mirror how the existing tests
  // exercise /compute without a real facilitator; if they hit the real middleware,
  // add a test seam identical in style to fee-app's old requireOverride).
  await computeWithFakePayment(app, { verified: true, payer: "0xbuyer", amount: "100", network: "eip155:5042002" });
  expect(seen).toEqual([100n]);
});
```

(`computeWithFakePayment` is whatever this file's existing pattern for exercising the paywalled route is — the assertion contract is: a request that reaches the handler with `req.payment.amount === "100"` results in `onPayment(100n)`. If the file has no such pattern, add a `requireOverride?: RequestHandler` test seam to `ProviderAppOptions` exactly like the old fee-app had, defaulting to the real `gateway.require(price)`.)

- [ ] **Step 2: Run to verify failures**

Run: `cd services && bun test src/provider/server.test.ts`
Expected: FAIL (`netPrice` still in /health; `onPayment` unknown).

- [ ] **Step 3: Implement**

In `services/src/provider/server.ts`:
- Delete the exported `netPrice` function, the `platformFeeBps` option, and the `feeBps`/`chargedPrice` lines.
- `ProviderAppOptions` gains: `onPayment?: (amountAtomic: bigint) => void; // tap for the fee remitter`
- `/health` responds `{ ok: true, kind: executor.kind, price, ...meta }` (no `netPrice`).
- The paywall goes back to `gateway.require(price)`.
- In the `/compute` handler, after reading `pay`, add:

```ts
    if (pay?.amount) {
      try { opts.onPayment?.(BigInt(pay.amount)); } catch { /* the tap must never break compute */ }
    }
```

Compile fixes (the option is gone):
- `services/scripts/run-provider.ts`: delete the `platformFeeBps: Number(process.env.PLATFORM_FEE_BPS ?? "100"),` line.
- `services/scripts/circle-roundtrip.ts`: delete `platformFeeBps: 100,` and update its final console line to `"✅ Circle-custodied wallet paid a real x402 charge (gross; fee is remitted provider-side)."`

- [ ] **Step 4: Run tests + type-check**

Run: `cd services && bun test src/provider && bunx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add services/src/provider services/scripts/run-provider.ts services/scripts/circle-roundtrip.ts
git commit -m "feat(fees): provider paywalls the listed price again and exposes an onPayment tap"
```

---

## Task 4: The fee remitter

**Files:**
- Create: `services/src/provider/remitter.ts`
- Test: `services/src/provider/remitter.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// services/src/provider/remitter.test.ts
import { test, expect } from "bun:test";
import { createFeeRemitter } from "./remitter";

function seams() {
  const withdrawn: bigint[] = [];
  const reported: { txHash: string; amountAtomic: bigint }[] = [];
  return {
    withdrawn, reported,
    withdraw: async (amountAtomic: bigint) => { withdrawn.push(amountAtomic); return { txHash: `0xtx${withdrawn.length}` }; },
    report: async (r: { txHash: string; amountAtomic: bigint }) => { reported.push(r); },
  };
}

test("accrues bps of each payment and flushes at the threshold", async () => {
  const s = seams();
  const r = createFeeRemitter({ feeBps: 100, thresholdAtomic: 3n, withdraw: s.withdraw, report: s.report });
  await r.onPayment(100n); // fee 1
  await r.onPayment(100n); // fee 2 — still below threshold
  expect(s.withdrawn).toEqual([]);
  await r.onPayment(100n); // fee 3 — threshold hit
  expect(s.withdrawn).toEqual([3n]);
  expect(s.reported).toEqual([{ txHash: "0xtx1", amountAtomic: 3n }]);
  expect(r.accrued()).toBe(0n);
});

test("flush() remits any positive accrual; a no-op when zero", async () => {
  const s = seams();
  const r = createFeeRemitter({ feeBps: 100, thresholdAtomic: 1_000_000n, withdraw: s.withdraw, report: s.report });
  await r.onPayment(100n); // fee 1, below threshold
  await r.flush();
  expect(s.withdrawn).toEqual([1n]);
  await r.flush(); // nothing accrued now
  expect(s.withdrawn).toEqual([1n]);
});

test("a failed withdraw restores the accrual for a later retry", async () => {
  const s = seams();
  const failing = { ...s, withdraw: async () => { throw new Error("gateway down"); } };
  const r = createFeeRemitter({ feeBps: 100, thresholdAtomic: 1n, withdraw: failing.withdraw, report: s.report });
  await r.onPayment(200n); // fee 2, threshold hit, withdraw fails
  expect(r.accrued()).toBe(2n); // restored, not lost
  expect(s.reported).toEqual([]);
});

test("a withdraw that succeeds but fails to report is re-reported on the next flush", async () => {
  const s = seams();
  let failReports = true;
  const report = async (x: { txHash: string; amountAtomic: bigint }) => {
    if (failReports) throw new Error("platform unreachable");
    return s.report(x);
  };
  const r = createFeeRemitter({ feeBps: 100, thresholdAtomic: 1n, withdraw: s.withdraw, report });
  await r.onPayment(200n); // withdraws 2n, report fails -> queued
  expect(s.withdrawn).toEqual([2n]);
  expect(s.reported).toEqual([]);
  failReports = false;
  await r.flush(); // no new accrual, but the pending report drains
  expect(s.reported).toEqual([{ txHash: "0xtx1", amountAtomic: 2n }]);
});

test("zero fee bps never accrues or withdraws", async () => {
  const s = seams();
  const r = createFeeRemitter({ feeBps: 0, thresholdAtomic: 1n, withdraw: s.withdraw, report: s.report });
  await r.onPayment(1_000_000n);
  await r.flush();
  expect(s.withdrawn).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services && bun test src/provider/remitter.test.ts`
Expected: FAIL, "Cannot find module './remitter'".

- [ ] **Step 3: Implement**

```ts
// services/src/provider/remitter.ts
// Accrues the platform's cut of every payment this provider receives and remits it to
// the treasury from the provider's own Gateway earnings. Accrual is in-memory only: an
// unremitted balance lost to a crash is not lost money — it stays an outstanding
// receivable in the platform ledger and ages there until a later remittance covers it.

export type FeeRemitterOptions = {
  feeBps: number;            // platform fee in basis points (100 = 1%)
  thresholdAtomic: bigint;   // remit when accrued fees reach this (withdraws cost gas)
  withdraw: (amountAtomic: bigint) => Promise<{ txHash: string }>; // Gateway withdraw to the treasury
  report: (r: { txHash: string; amountAtomic: bigint }) => Promise<void>; // tell the platform
};

export type FeeRemitter = {
  onPayment(paymentAtomic: bigint): Promise<void>;
  flush(): Promise<void>;
  accrued(): bigint;
};

export function createFeeRemitter(opts: FeeRemitterOptions): FeeRemitter {
  let accrued = 0n;
  // Withdrawn but not yet acknowledged by the platform: money already moved, so these are
  // only retried as reports, never re-withdrawn.
  const pendingReports: { txHash: string; amountAtomic: bigint }[] = [];
  let flushing = false;

  async function drainReports(): Promise<void> {
    while (pendingReports.length > 0) {
      const next = pendingReports[0]!;
      await opts.report(next); // throws -> stays queued for the next flush
      pendingReports.shift();
    }
  }

  async function flush(): Promise<void> {
    if (flushing) return; // never overlap withdrawals
    flushing = true;
    try {
      try {
        await drainReports();
      } catch (e) {
        console.warn("[remitter] report retry failed:", e instanceof Error ? e.message : e);
      }
      if (accrued <= 0n) return;
      const amountAtomic = accrued;
      accrued = 0n;
      let txHash: string;
      try {
        ({ txHash } = await opts.withdraw(amountAtomic));
      } catch (e) {
        accrued += amountAtomic; // nothing moved; retry later
        console.warn("[remitter] withdraw failed:", e instanceof Error ? e.message : e);
        return;
      }
      try {
        await opts.report({ txHash, amountAtomic });
      } catch (e) {
        pendingReports.push({ txHash, amountAtomic }); // money moved; only the report retries
        console.warn("[remitter] report failed (queued for retry):", e instanceof Error ? e.message : e);
      }
    } finally {
      flushing = false;
    }
  }

  return {
    accrued: () => accrued,
    flush,
    async onPayment(paymentAtomic: bigint): Promise<void> {
      if (opts.feeBps <= 0) return;
      accrued += (paymentAtomic * BigInt(opts.feeBps)) / 10_000n;
      if (accrued >= opts.thresholdAtomic) await flush();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services && bun test src/provider/remitter.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/provider/remitter.ts services/src/provider/remitter.test.ts
git commit -m "feat(fees): fee remitter accrues per payment and remits from Gateway earnings"
```

---

## Task 5: Wire the remitter into the provider entry script

**Files:**
- Modify: `services/scripts/run-provider.ts`

- [ ] **Step 1: Wire it**

Rework `services/scripts/run-provider.ts` to (keep everything currently there that isn't shown):

```ts
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createFeeRemitter } from "../src/provider/remitter";

// ... existing key/port/price/etc reads stay ...

// Fee remittance: the platform's cut comes out of THIS provider's Gateway earnings.
// Without treasury+remit config the provider simply accrues visible receivables.
const treasury = process.env.PLATFORM_TREASURY_ADDRESS as `0x${string}` | undefined;
const remitUrl = process.env.PLATFORM_REMIT_URL; // e.g. https://<worker-host>
const providerId = process.env.PROVIDER_ID;      // printed by seed/registration
const feeBps = Number(process.env.PLATFORM_FEE_BPS ?? "100");

let onPayment: ((amountAtomic: bigint) => void) | undefined;
let remitterFlush: (() => Promise<void>) | undefined;
if (treasury && remitUrl && providerId && feeBps > 0) {
  const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: key });
  const remitter = createFeeRemitter({
    feeBps,
    thresholdAtomic: BigInt(process.env.FEE_REMIT_THRESHOLD_ATOMIC ?? "10000"), // $0.01
    withdraw: async (atomic) => {
      const res = await gateway.withdraw((Number(atomic) / 1_000_000).toString(), {
        recipient: treasury,
        ...(process.env.FEE_REMIT_MAX_FEE_USDC ? { maxFee: process.env.FEE_REMIT_MAX_FEE_USDC } : {}),
      });
      return { txHash: res.mintTxHash };
    },
    report: async (r) => {
      const res = await fetch(`${remitUrl}/remittances`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId, txHash: r.txHash, amountAtomic: r.amountAtomic.toString() }),
      });
      if (!res.ok) throw new Error(`remit report failed (${res.status})`);
    },
  });
  onPayment = (atomic) => { void remitter.onPayment(atomic); };
  remitterFlush = remitter.flush;
  console.log(`[provider] remitting ${feeBps}bps of earnings to ${treasury} via ${remitUrl}`);
} else {
  console.warn("[provider] fee remitter disabled (needs PLATFORM_TREASURY_ADDRESS, PLATFORM_REMIT_URL, PROVIDER_ID, PLATFORM_FEE_BPS>0)");
}

const app = createProviderApp({
  // ... existing options stay ...
  onPayment,
});

// Flush accrued fees on graceful shutdown so small remainders don't strand until restart.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    try { await remitterFlush?.(); } finally { process.exit(0); }
  });
}
```

- [ ] **Step 2: Type-check + full provider suite**

Run: `cd services && bunx tsc --noEmit && bun test src/provider`
Expected: clean + PASS.

- [ ] **Step 3: Commit**

```bash
git add services/scripts/run-provider.ts
git commit -m "feat(fees): provider entry remits fees to the treasury (threshold + shutdown flush)"
```

---

## Task 6: Remittance verification + endpoint on the worker's health server

**Files:**
- Create: `services/src/worker/verify-remittance.ts`
- Create: `services/src/worker/remit.ts`
- Modify: `services/src/worker/index.ts`
- Test: `services/src/worker/verify-remittance.test.ts`, `services/src/worker/remit.test.ts`

- [ ] **Step 1: Write the failing verification test**

```ts
// services/src/worker/verify-remittance.test.ts
import { test, expect } from "bun:test";
import { pad } from "viem";
import { transferredToTreasury, type ReceiptReader } from "./verify-remittance";

const USDC = "0x3600000000000000000000000000000000000000";
const TREASURY = "0x00000000000000000000000000000000000e1e45".toLowerCase() as `0x${string}`;
// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function reader(logs: { address: string; topics: string[]; data: string }[]): ReceiptReader {
  return { getTransactionReceipt: async () => ({ status: "success", logs }) as any };
}

const treasury32 = pad(TREASURY, { size: 32 }); // address left-padded to a bytes32 topic

test("sums USDC Transfer value to the treasury in the tx", async () => {
  const r = reader([
    { address: USDC, topics: [TRANSFER_TOPIC, pad("0x1111111111111111111111111111111111111111", { size: 32 }), treasury32], data: "0x" + (150n).toString(16).padStart(64, "0") },
  ]);
  expect(await transferredToTreasury(r, "0xabc", USDC, TREASURY)).toBe(150n);
});

test("ignores transfers of other tokens or to other recipients", async () => {
  const other32 = pad("0x2222222222222222222222222222222222222222", { size: 32 });
  const r = reader([
    { address: "0x9999999999999999999999999999999999999999", topics: [TRANSFER_TOPIC, other32, treasury32], data: "0x" + (150n).toString(16).padStart(64, "0") }, // wrong token
    { address: USDC, topics: [TRANSFER_TOPIC, treasury32, other32], data: "0x" + (150n).toString(16).padStart(64, "0") }, // wrong direction
  ]);
  expect(await transferredToTreasury(r, "0xabc", USDC, TREASURY)).toBe(0n);
});

test("a reverted tx counts as zero", async () => {
  const r: ReceiptReader = { getTransactionReceipt: async () => ({ status: "reverted", logs: [] }) as any };
  expect(await transferredToTreasury(r, "0xabc", USDC, TREASURY)).toBe(0n);
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `cd services && bun test src/worker/verify-remittance.test.ts` — FAIL, module missing. Then:

```ts
// services/src/worker/verify-remittance.ts
// On-chain proof that a reported remittance actually paid the treasury: read the tx
// receipt and sum USDC Transfer events whose recipient is the treasury. We credit what
// the chain says moved, not what the report claims.
import { createPublicClient, http } from "viem";

export type ReceiptReader = {
  getTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ status: string; logs: { address: string; topics: string[]; data: string }[] }>;
};

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const topicIsAddress = (topic: string | undefined, address: string) =>
  !!topic && topic.length === 66 && `0x${topic.slice(26).toLowerCase()}` === address.toLowerCase();

export async function transferredToTreasury(
  reader: ReceiptReader,
  txHash: string,
  usdcAddress: string,
  treasury: string,
): Promise<bigint> {
  let receipt;
  try {
    receipt = await reader.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch {
    return 0n; // unknown tx = nothing verifiable
  }
  if (receipt.status !== "success") return 0n;
  let total = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdcAddress.toLowerCase()) continue;
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (!topicIsAddress(log.topics[2], treasury)) continue;
    total += BigInt(log.data);
  }
  return total;
}

export function makeReceiptReader(rpcUrl: string): ReceiptReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return { getTransactionReceipt: (args) => client.getTransactionReceipt(args) as any };
}
```

Note: `getTransactionReceipt` may not find the tx immediately after `withdraw` returns — the endpoint treats "not found" as unverified and the provider's pending-report retry (Task 4) re-reports on its next flush. Re-run the test file: PASS (3 tests).

- [ ] **Step 3: Write the failing endpoint test**

```ts
// services/src/worker/remit.test.ts
import { test, expect } from "bun:test";
import { InMemoryRegistry } from "../registry/in-memory";
import { defaultTrust } from "../trust/trust";
import { applyRemittance, handleRemittance } from "./remit";
import type { Charge } from "../domain";

const c = (id: string, feeAmount: number) => ({ id, feeAmount } as Charge);

test("applyRemittance stamps oldest fully covered charges and reports the leftover", () => {
  const out = applyRemittance([c("a", 1), c("b", 2), c("c", 3)], 4n);
  expect(out.chargeIds).toEqual(["a", "b"]); // 1 + 2 covered; 3 not fully covered by the remaining 1
  expect(out.remainingAtomic).toBe(1n);
});

test("applyRemittance with nothing outstanding stamps nothing", () => {
  const out = applyRemittance([], 5n);
  expect(out.chargeIds).toEqual([]);
  expect(out.remainingAtomic).toBe(5n);
});

async function seeded() {
  const reg = new InMemoryRegistry();
  const provider = await reg.registerProvider({
    alias: "p", ownerWallet: "0xs", endpointUrl: "http://x", resourceType: "GPU", region: "US-East",
    specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 1,
  });
  const rent = await reg.createRent({ name: "r", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
  for (const [seq, fee] of [1, 2, 3].entries()) {
    await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq, amount: 100, feeAmount: fee, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: null });
  }
  return { reg, provider };
}

const post = (body: unknown) =>
  new Request("http://worker/remittances", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("a verified remittance stamps FIFO up to the on-chain amount", async () => {
  const { reg, provider } = await seeded();
  const res = await handleRemittance(post({ providerId: provider.id, txHash: "0xabc", amountAtomic: "3" }), {
    registry: reg, verify: async () => 3n, // chain says 3 moved
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, verifiedAtomic: "3", stamped: 2 }); // fees 1 + 2; the 3-fee charge is not fully covered
  const outstanding = await reg.listOutstandingFeeCharges(provider.id);
  expect(outstanding.map((x) => x.feeAmount)).toEqual([3]);
});

test("credits what the chain verified, not what the report claims", async () => {
  const { reg, provider } = await seeded();
  const res = await handleRemittance(post({ providerId: provider.id, txHash: "0xabc", amountAtomic: "999" }), {
    registry: reg, verify: async () => 1n,
  });
  expect((await res.json() as any).stamped).toBe(1); // only the 1-fee charge
});

test("an unverifiable tx stamps nothing and returns 422", async () => {
  const { reg, provider } = await seeded();
  const res = await handleRemittance(post({ providerId: provider.id, txHash: "0xnope", amountAtomic: "3" }), {
    registry: reg, verify: async () => 0n,
  });
  expect(res.status).toBe(422);
  expect((await reg.listOutstandingFeeCharges(provider.id)).length).toBe(3);
});

test("bad bodies get a 400", async () => {
  const { reg } = await seeded();
  for (const body of [{}, { providerId: "p" }, { providerId: "p", txHash: "0x", amountAtomic: "-1" }]) {
    const res = await handleRemittance(post(body), { registry: reg, verify: async () => 0n });
    expect(res.status).toBe(400);
  }
});
```

- [ ] **Step 4: Run to verify it fails, then implement**

Run: `cd services && bun test src/worker/remit.test.ts` — FAIL, module missing. Then:

```ts
// services/src/worker/remit.ts
// The platform's fee-collection surface: providers report a remittance tx, the worker
// verifies on-chain what actually reached the treasury, and stamps that amount across
// the provider's oldest outstanding receivables (only fully covered charges stamp; a
// partial remainder stays outstanding for the next remittance).
import type { Registry } from "../registry/registry";
import type { Charge } from "../domain";

export function applyRemittance(outstanding: Charge[], amountAtomic: bigint): { chargeIds: string[]; remainingAtomic: bigint } {
  const chargeIds: string[] = [];
  let remaining = amountAtomic;
  for (const charge of outstanding) {
    const fee = BigInt(charge.feeAmount);
    if (fee > remaining) break;
    remaining -= fee;
    chargeIds.push(charge.id);
  }
  return { chargeIds, remainingAtomic: remaining };
}

export type RemitDeps = {
  registry: Registry;
  verify: (txHash: string) => Promise<bigint>; // on-chain USDC actually received by the treasury
};

export async function handleRemittance(req: Request, deps: RemitDeps): Promise<Response> {
  let body: { providerId?: unknown; txHash?: unknown; amountAtomic?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const providerId = typeof body.providerId === "string" ? body.providerId : "";
  const txHash = typeof body.txHash === "string" && body.txHash.startsWith("0x") ? body.txHash : "";
  const claimed = typeof body.amountAtomic === "string" && /^\d+$/.test(body.amountAtomic) ? BigInt(body.amountAtomic) : -1n;
  if (!providerId || !txHash || claimed < 0n) {
    return Response.json({ error: "providerId, txHash (0x...), and amountAtomic (decimal string) required" }, { status: 400 });
  }

  const verifiedAtomic = await deps.verify(txHash);
  if (verifiedAtomic <= 0n) {
    return Response.json({ error: "no verifiable USDC transfer to the treasury in that tx" }, { status: 422 });
  }

  const outstanding = await deps.registry.listOutstandingFeeCharges(providerId);
  const { chargeIds } = applyRemittance(outstanding, verifiedAtomic);
  for (const id of chargeIds) await deps.registry.markChargeFeeSettled(id, txHash);
  return Response.json({ ok: true, verifiedAtomic: verifiedAtomic.toString(), stamped: chargeIds.length });
}
```

Run: `cd services && bun test src/worker/remit.test.ts` — PASS (6 tests).

- [ ] **Step 5: Mount it on the worker's health server**

In `services/src/worker/index.ts`, replace the `Bun.serve` block with:

```ts
import { handleRemittance } from "./remit";
import { transferredToTreasury, makeReceiptReader } from "./verify-remittance";

const port = Number(process.env.PORT ?? "8787");
const treasury = process.env.PLATFORM_TREASURY_ADDRESS;
const usdc = process.env.USDC_ADDRESS;
const rpcUrl = process.env.ARC_RPC_URL;
const remitReady = Boolean(treasury && usdc && rpcUrl);
const reader = remitReady ? makeReceiptReader(rpcUrl!) : null;
if (!remitReady) console.warn("[worker] remittance endpoint disabled (needs PLATFORM_TREASURY_ADDRESS, USDC_ADDRESS, ARC_RPC_URL)");

Bun.serve({
  port,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/health") return new Response("ok", { status: 200 });
    // Providers report fee remittances here; this must be publicly reachable (Render
    // exposes only $PORT, which is why it rides the health server, not its own port).
    if (pathname === "/remittances" && req.method === "POST" && remitReady) {
      return handleRemittance(req, {
        registry,
        verify: (txHash) => transferredToTreasury(reader!, txHash, usdc!, treasury!),
      });
    }
    return new Response("metering worker", { status: 200 });
  },
});
console.log(`[worker] health + remittance server on :${port}`);
```

(The `treasury` const from the old fee-endpoint block was deleted in Task 2; this reintroduces it here. Imports go to the top of the file with the others.)

- [ ] **Step 6: Full worker suite + type-check**

Run: `cd services && bun test src/worker && bunx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 7: Commit**

```bash
git add services/src/worker
git commit -m "feat(fees): worker verifies remittances on-chain and stamps receivables FIFO"
```

---

## Task 7: Env, docs, full gates

**Files:**
- Modify: `services/.env.example`, `services/.env`, `docs/WORKER_DEPLOY.md`

- [ ] **Step 1: Env docs**

In `services/.env.example`, replace the platform-fee block (the `PLATFORM_FEE_BPS` / `PLATFORM_TREASURY_ADDRESS` / `WORKER_FEE_PORT` comments and lines) with:

```
# Platform fee (basis points; 100 = 1%). The renter pays the LISTED price; the provider
# remits this cut from its Gateway earnings. The worker records it per charge as a
# receivable and stamps it when a verified remittance arrives.
PLATFORM_FEE_BPS=100
# Where remittances land (a Circle developer-controlled wallet address).
PLATFORM_TREASURY_ADDRESS=0x5ad0ccd42fe945aff0c7e64e268f3e82788c2c16

# Provider-side remittance (run-provider.ts). Without all three the provider just
# accrues visible receivables and remits nothing.
PLATFORM_REMIT_URL=            # the worker's public base url (its $PORT server)
PROVIDER_ID=                   # this provider's registry id (printed at registration)
FEE_REMIT_THRESHOLD_ATOMIC=10000   # remit when accrued fees reach this ($0.01)
# FEE_REMIT_MAX_FEE_USDC=0.05      # optional cap on the Gateway withdraw fee
```

Remove `WORKER_FEE_PORT` from `services/.env` too, and add the three new provider-side vars (values: remit url `http://localhost:8787`, the seed provider's id, threshold default).

In `docs/WORKER_DEPLOY.md`, in the Circle custody section, append:

```
Platform fees are provider-remitted: the renter pays the listed price, and each provider
remits its accrued fee from Gateway earnings to `PLATFORM_TREASURY_ADDRESS`, reporting
the tx to `POST /remittances` on the worker's public port. The worker verifies the
transfer on-chain (needs `ARC_RPC_URL` + `USDC_ADDRESS`) before stamping receivables, so
the endpoint needs no auth. `WORKER_FEE_PORT` is gone; nothing listens there anymore.
```

- [ ] **Step 2: Full gates**

Run: `cd services && bun test src && bunx tsc --noEmit && cd .. && bun test src/lib mcp/src && bunx tsc --noEmit && bun run build`
Expected: all green (the live Supabase contract suites have been network-flaky lately; identical failures on a clean checkout mean environment, not regression — verify that way before digging).

- [ ] **Step 3: Commit**

```bash
git add services/.env.example docs/WORKER_DEPLOY.md
git commit -m "feat(fees): provider-remit fee model env + deploy docs"
```

---

## Task 8: Live proof (gated)

**Files:**
- Create: `services/scripts/remit-roundtrip.ts`
- Modify: `services/package.json`

- [ ] **Step 1: The gated script**

```ts
// services/scripts/remit-roundtrip.ts
// Live proof (spends real testnet USDC): a raw-key buyer pays N gross x402 charges to a
// local provider; the provider's remitter withdraws the accrued fee from its Gateway
// earnings to the treasury; the local remittance handler verifies the tx on-chain and
// stamps the receivables. Needs: BROKER_WALLET_PRIVATE_KEY (funded buyer),
// PROVIDER_WALLET_PRIVATE_KEY (seller, needs gas for the withdraw), USDC_ADDRESS,
// ARC_RPC_URL, PLATFORM_TREASURY_ADDRESS.
import { createServer } from "node:http";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createProviderApp } from "../src/provider/server";
import { SimulatedExecutor } from "../src/provider/executor";
import { createFeeRemitter } from "../src/provider/remitter";
import { GatewaySettlementAdapter } from "../src/settlement/gateway";
import { InMemoryRegistry } from "../src/registry/in-memory";
import { defaultTrust } from "../src/trust/trust";
import { handleRemittance } from "../src/worker/remit";
import { transferredToTreasury, makeReceiptReader } from "../src/worker/verify-remittance";

const buyerKey = process.env.BROKER_WALLET_PRIVATE_KEY as `0x${string}`;
const sellerKey = process.env.PROVIDER_WALLET_PRIVATE_KEY as `0x${string}`;
const usdc = process.env.USDC_ADDRESS!;
const rpcUrl = process.env.ARC_RPC_URL!;
const treasury = process.env.PLATFORM_TREASURY_ADDRESS as `0x${string}`;
if (!buyerKey || !sellerKey || !usdc || !rpcUrl || !treasury) throw new Error("missing env (see header)");

const reg = new InMemoryRegistry();
const provider = await reg.registerProvider({
  alias: "remit-rt", ownerWallet: "0xseller", endpointUrl: "http://localhost:4112", resourceType: "GPU",
  region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 1,
});
const rent = await reg.createRent({ name: "remit-rt", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });

const sellerGateway = new GatewayClient({ chain: "arcTestnet", privateKey: sellerKey });
const reports: { txHash: string; amountAtomic: bigint }[] = [];
const remitter = createFeeRemitter({
  feeBps: 100, thresholdAtomic: 1n, // remit on the first accrual for the proof
  withdraw: async (atomic) => {
    const res = await sellerGateway.withdraw((Number(atomic) / 1_000_000).toString(), { recipient: treasury });
    return { txHash: res.mintTxHash };
  },
  report: async (r) => { reports.push(r); },
});

const app = createProviderApp({
  executor: new SimulatedExecutor(), sellerAddress: sellerGateway.address, price: "$0.0001",
  facilitatorUrl: "https://gateway-api-testnet.circle.com",
  meta: { alias: "remit-rt", resourceType: "GPU", region: "US-East", specs: {} },
  onPayment: (atomic) => { void remitter.onPayment(atomic); },
});
const server = createServer(app);
await new Promise<void>((r) => server.listen(4112, r));

const buyer = new GatewaySettlementAdapter({ privateKey: buyerKey, capAtomic: 10_000n, chain: "arcTestnet", rpcUrl });
console.log("[1] funding + paying 3 gross charges…");
await buyer.ensureFunded(1_000n);
for (let seq = 0; seq < 3; seq++) {
  const paid = await buyer.payForCompute("http://localhost:4112/compute?session=remit-rt");
  await reg.recordCharge({
    rentId: rent.id, providerId: provider.id, seq, amount: Number(paid.amountAtomic),
    feeAmount: Math.floor(Number(paid.amountAtomic) / 100), feeSettlementRef: null,
    authorizationRef: null, settled: false, settlementRef: paid.settlementRef,
  });
  console.log(`  charge ${seq}: paid ${paid.amountAtomic} (gross)`);
}
console.log("[2] flushing the remitter (withdraw earnings -> treasury)…");
await remitter.flush();
const report = reports[0];
if (!report) throw new Error("remitter produced no report — withdraw failed? (check seller gas + Gateway balance timing: batch settlement must land before earnings are withdrawable)");
console.log("  remitted", report.amountAtomic, "tx", report.txHash);

console.log("[3] verifying + stamping via the worker handler…");
const reader = makeReceiptReader(rpcUrl);
const res = await handleRemittance(
  new Request("http://local/remittances", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId: provider.id, txHash: report.txHash, amountAtomic: report.amountAtomic.toString() }) }),
  { registry: reg, verify: (tx) => transferredToTreasury(reader, tx, usdc, treasury) },
);
console.log("  handler:", res.status, await res.json());
console.log("  outstanding after:", (await reg.listOutstandingFeeCharges(provider.id)).length);
server.close();
console.log("✅ gross stream -> provider Gateway earnings -> fee remitted on-chain -> receivables stamped");
```

Add `"remit:roundtrip": "bun run scripts/remit-roundtrip.ts"` to `services/package.json` scripts.

- [ ] **Step 2: Run it live (needs funded wallets — HANDOFF if not)**

Run: `cd services && bun run remit:roundtrip`
Expected: 3 gross charges paid; a real withdraw tx to the treasury; handler returns 200 with stamped > 0.
Two live realities to calibrate here: (a) x402 earnings are only withdrawable after Circle settles the batch — if the withdraw fails on balance, wait for batch settlement (same polling reality the existing reconcile machinery handles) and rerun the flush; (b) observe the actual same-chain withdraw fee and, if it is non-trivial relative to $0.01, raise the documented `FEE_REMIT_THRESHOLD_ATOMIC` default accordingly (the SDK's `maxFee` default is 2.01 USDC).

- [ ] **Step 3: Commit**

```bash
git add services/scripts/remit-roundtrip.ts services/package.json
git commit -m "feat(fees): live remit roundtrip proof"
```

---

## Self-review notes

- **Spec coverage:** one gross payment per tick (Task 2), receivable ledger semantics + FIFO fully-covered stamping (Tasks 1, 6), remitter with threshold + shutdown flush + report retry (Tasks 4, 5), on-chain verification crediting what the chain says (Task 6), retirement of net pricing / fee endpoint / sweep (Tasks 2, 3), receivable aging is served by `listOutstandingFeeCharges` (a UI/report view is not in the spec's scope), splitter contract deferred (spec-only), env + docs (Task 7), live proof (Task 8).
- **Beyond-spec correction locked in:** `rentCost` drops `feeAmount` (Task 2) — the fee is no longer renter spend, and leaving it would overstate `totalCost` in the dashboard. The Phase 1 contract test is updated to match.
- **Type consistency:** `listOutstandingFeeCharges(providerId): Promise<Charge[]>` (Tasks 1, 6, 8); `createFeeRemitter` returns `{ onPayment(bigint): Promise<void>, flush(): Promise<void>, accrued(): bigint }` (Tasks 4, 5, 8); `handleRemittance(req: Request, { registry, verify }): Promise<Response>` (Tasks 6, 8); `onPayment?: (amountAtomic: bigint) => void` on `ProviderAppOptions` (Tasks 3, 5, 8); `transferredToTreasury(reader, txHash, usdcAddress, treasury): Promise<bigint>` (Tasks 6, 8).
- **Known judgment calls:** the remittance endpoint is unauthenticated by design (on-chain verification is the auth: stamping requires real USDC having reached the treasury, and attribution comes from the reported providerId — misattribution only lets a provider donate its remittance to another's receivables); accrual is in-memory per the spec; `Number(atomic)/1e6` for the withdraw amount is exact for any realistic fee magnitude (< 2^53 atomic).

## Execution handoff

Ordering: Tasks 1-2 (ledger + meter) are the platform core; 3-5 (provider side) and 6 (collection) build on them; 7-8 close out. Each task ends green and committable. Task 8 needs funded testnet wallets (handoff if not available).
