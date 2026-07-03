# Circle Custody + Platform Fee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all buyer-side money to Circle developer-controlled wallets (zero private keys in our database) and collect a provider-side 1% platform fee, both wired into the metering worker and the app.

**Architecture:** Two independently shippable phases. **Phase 1 (fee):** the renter pays the listed `pricePerCharge` (gross); the provider's x402 endpoint demands the *net* (gross minus fee), so the provider bears the fee (listing and deploying stay free). **Fees stream like everything else:** the worker hosts its own x402-paywalled fee endpoint (seller = the platform treasury) and each tick makes two nano-payments from the renter's Gateway balance — net to the provider, fee to the treasury — through the same settlement adapter. A terminal-rent sweep pays any fee ticks that failed transiently, also via the fee endpoint, so no separate on-chain transfer path exists. The user's passkey modular wallet is untouched: it stays identity + treasury, and funding flows to whatever spend address `walletFor` returns. **Phase 2 (Circle custody):** a `CircleGatewaySettlementAdapter` behind the existing `SettlementAdapter` interface reimplements GatewayClient's deposit/pay/reconcile flows using Circle's `signTypedData` + contract-execution APIs (proven by `probe:circle-signer`, PASS 2026-07-02), plus a `circle_wallets` mapping table so new users/agents get Circle-custodied wallets while existing raw-key wallets keep working (dual backend, env-switched).

**Tech Stack:** Bun + TypeScript, `@circle-fin/developer-controlled-wallets@10.8.0`, `@circle-fin/x402-batching@3.2.0` (`BatchEvmScheme` standalone), viem, Supabase.

**Locked constants (verified against installed SDK source + foundations-report):**
- Gateway API testnet: `https://gateway-api-testnet.circle.com/v1`
- GatewayWallet (testnet): `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`, Gateway domain `26`
- Pay-path EIP-712: domain `{name:"GatewayWalletBatched", version:"1", chainId:5042002, verifyingContract:<from 402 extra>}`, primaryType `TransferWithAuthorization`
- 402 dance headers: request `PAYMENT-REQUIRED` (base64 JSON), pay retry `Payment-Signature` (base64 JSON), settle `PAYMENT-RESPONSE` (base64 JSON)
- Deposit = ERC-20 `approve(gatewayWallet, value)` on USDC, then `deposit(token, value)` on GatewayWallet
- Circle signTypedData REQUIRES `EIP712Domain` declared in `types` (probe gotcha #1); entity secret is account-global, already in `services/.env` (gotcha #2)
- Probe wallet (reusable treasury for testnet): `21c9abd2-24f0-5a29-b9f7-3981571add87` / `0x5ad0ccd42fe945aff0c7e64e268f3e82788c2c16`

---

## File structure

**Phase 1 (fee):**
- `services/supabase/migrations/0009_platform_fee.sql` — `charges.fee_amount`, `rents.fees_swept_at`
- `services/src/domain.ts` — `Charge.feeAmount`, `Rent.feesSweptAt`
- `services/src/registry/{registry,in-memory,supabase}.ts` + `contract.ts` — persist/map both fields; `rentCost` = amount + fee
- `services/src/settlement/spend-policy.ts` — optional `maxPerChargeAtomic` guard
- `services/src/settlement/gateway.ts` — thread `maxPerChargeAtomic` into the hook
- `services/src/worker/meter.ts` — per-tick fee nano-payment + accrual
- `services/src/worker/fee-app.ts` (new) — the worker's x402-paywalled fee endpoint
- `services/src/worker/sweep.ts` (new) — terminal catch-up for missed fee ticks
- `services/src/worker/loop.ts` + `index.ts` — fee endpoint + sweep pass + env wiring
- `services/src/provider/server.ts` + `scripts/run-provider.ts` — net pricing in the template

**Phase 2 (Circle custody):**
- `services/supabase/migrations/0010_circle_wallets.sql` — wallet-id mapping table
- `services/src/wallet/circle.ts` (new) — client factory + `CircleWalletStore`
- `services/src/settlement/circle-signer.ts` (new) — Circle-backed `BatchEvmSigner`
- `services/src/settlement/gateway-pay.ts` (new) — standalone 402 dance
- `services/src/settlement/circle-gateway.ts` (new) — the adapter
- `services/src/worker/settlement-factory.ts` + `index.ts` — dual-backend payer resolution
- `src/lib/marketplace/wallet.ts` + `src/lib/wallet/server-fns.ts` — app-side provisioning/withdraw dual backend
- `services/scripts/circle-roundtrip.ts` (new, gated) — live on-chain proof

---

# Phase 1: Platform fee (1%, provider bears it)

## Task 1: Fee fields in the ledger

**Files:**
- Create: `services/supabase/migrations/0009_platform_fee.sql`
- Modify: `services/src/domain.ts` (Charge, Rent)
- Modify: `services/src/registry/registry.ts` (RentPatch)
- Modify: `services/src/registry/in-memory.ts`
- Modify: `services/src/registry/supabase.ts`
- Test: `services/src/registry/contract.ts`

- [ ] **Step 1: Write the migration**

```sql
-- services/supabase/migrations/0009_platform_fee.sql
-- Provider-side platform fee: the renter pays the listed (gross) price; the provider's
-- endpoint charges net; the difference streams to the treasury per tick as its own
-- nano-payment. fee_amount is atomic USDC like amount; fee_settlement_ref is the fee
-- payment's batch ref (null = the fee tick didn't land yet; the terminal sweep catches it).
alter table charges add column if not exists fee_amount numeric not null default 0;
alter table charges add column if not exists fee_settlement_ref text;
alter table rents add column if not exists fees_swept_at timestamptz;
```

- [ ] **Step 2: Apply to the live Supabase project**

Apply via the Supabase MCP `apply_migration` (project `xwxuqcougmanzonypoym`, name `0009_platform_fee`).
Verify: `select fee_amount from charges limit 1;` and `select fees_swept_at from rents limit 1;` both run.

- [ ] **Step 3: Write the failing contract cases**

In `services/src/registry/contract.ts`, add inside the describe block:

```ts
    test("recordCharge persists feeAmount and rentCost sums amount + fee", async () => {
      const rent = await reg.createRent({ name: "fee-rent", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
      const provider = await reg.registerProvider({
        alias: "fee-p", ownerWallet: "0xs", endpointUrl: "http://x", resourceType: "GPU", region: "US-East",
        specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 1,
      });
      await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: 0, amount: 99, feeAmount: 1, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: null });
      const [c] = await reg.listCharges(rent.id);
      expect(c?.feeAmount).toBe(1);
      expect(c?.feeSettlementRef).toBeNull();
      expect(await reg.rentCost(rent.id)).toBe(100); // gross: what the renter spent
      await reg.markChargeFeeSettled(c!.id, "fee-batch-1");
      expect((await reg.listCharges(rent.id))[0]?.feeSettlementRef).toBe("fee-batch-1");
    }, T);

    test("updateRent persists feesSweptAt", async () => {
      const rent = await reg.createRent({ name: "sweep-rent", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
      const t = new Date().toISOString();
      const updated = await reg.updateRent(rent.id, { feesSweptAt: t });
      expect(new Date(updated.feesSweptAt!).getTime()).toBe(new Date(t).getTime());
    }, T);
```

(If `contract.ts` doesn't already import `defaultTrust`, it does — check the top of the file; it's used by existing provider cases.)

- [ ] **Step 4: Run it (in-memory) to verify it fails**

Run: `cd services && bun test src/registry/in-memory.test.ts`
Expected: FAIL (type error: `feeAmount` not on Charge; `feesSweptAt` not on RentPatch).

- [ ] **Step 5: Domain + registry types**

In `services/src/domain.ts`, add to `Charge` (after `amount`):

```ts
  feeAmount: number; // atomic USDC for the platform on this charge (renter paid amount + feeAmount)
  feeSettlementRef: string | null; // the fee nano-payment's batch ref; null until it lands
```

In `services/src/registry/registry.ts`, add to the `Registry` interface (next to `markChargeSettled`):

```ts
  /** Stamp the fee nano-payment's settlement ref on a charge (fee streamed or swept). */
  markChargeFeeSettled(chargeId: string, ref: string): Promise<void>;
```

In `services/src/registry/in-memory.ts`:

```ts
  async markChargeFeeSettled(chargeId: string, ref: string): Promise<void> {
    const c = this.charges.find((x) => x.id === chargeId);
    if (c) c.feeSettlementRef = ref;
  }
```

In `services/src/registry/supabase.ts`:

```ts
  async markChargeFeeSettled(chargeId: string, ref: string): Promise<void> {
    const { error } = await this.db.from("charges").update({ fee_settlement_ref: ref }).eq("id", chargeId);
    if (error) throw new Error(`markChargeFeeSettled: ${error.message}`);
  }
```

(`toCharge` gains `feeSettlementRef: (r.fee_settlement_ref as string) ?? null,` and `recordCharge`'s insert gains `fee_settlement_ref: t.feeSettlementRef,`.)

Add to `Rent` (after `leaseAccessToken`):

```ts
  feesSweptAt: string | null; // when the accrued platform fee was transferred to the treasury
```

In `services/src/registry/registry.ts`, add to `RentPatch`:

```ts
  feesSweptAt?: string | null;
```

- [ ] **Step 6: In-memory registry**

In `services/src/registry/in-memory.ts`: `createRent`'s literal gains `feesSweptAt: null,` (next to `leaseAccessToken: null`). `rentCost` becomes:

```ts
  async rentCost(rentId: string): Promise<number> {
    return this.charges.filter((t) => t.rentId === rentId).reduce((s, t) => s + t.amount + t.feeAmount, 0);
  }
```

(`recordCharge` spreads the input so `feeAmount` flows through unchanged; `updateRent` patches by spread so `feesSweptAt` flows too — verify both are spread-based, they are.)

- [ ] **Step 7: Supabase registry**

In `services/src/registry/supabase.ts`:
- `toRent` gains `feesSweptAt: (r.fees_swept_at as string) ?? null,`
- `toCharge` gains `feeAmount: Number(r.fee_amount ?? 0),`
- `recordCharge` insert gains `fee_amount: t.feeAmount,`
- `updateRent`'s patch mapping gains (mirroring how `lastChargedAt` is mapped): `if (patch.feesSweptAt !== undefined) row.fees_swept_at = patch.feesSweptAt;`
- `rentCost` becomes:

```ts
  async rentCost(rentId: string): Promise<number> {
    const { data, error } = await this.db.from("charges").select("amount, fee_amount").eq("rent_id", rentId);
    if (error) throw new Error(`rentCost: ${error.message}`);
    return (data ?? []).reduce((s, r) => s + Number((r as Row).amount) + Number((r as Row).fee_amount ?? 0), 0);
  }
```

- [ ] **Step 8: Fix existing recordCharge call sites**

Grep: `grep -rn "recordCharge" services/src src --include="*.ts" | grep -v test | grep -v registry`
Each caller (`services/src/worker/meter.ts`, `services/src/broker/stream.ts`) gains `feeAmount: 0, feeSettlementRef: null` for now (meter gets the real values in Task 3).

- [ ] **Step 9: Run in-memory contract + type-check**

Run: `cd services && bun test src/registry/in-memory.test.ts && bunx tsc --noEmit`
Expected: PASS + clean. Then `cd .. && bunx tsc --noEmit` (app) — clean.

- [ ] **Step 10: Commit**

```bash
git add services/supabase/migrations/0009_platform_fee.sql services/src/domain.ts services/src/registry services/src/worker/meter.ts services/src/broker/stream.ts
git commit -m "feat(fees): fee_amount on charges + fees_swept_at on rents, rentCost = gross"
```

---

## Task 2: Per-charge price guard in the spend policy

The renter must never pay more per tick than the listed gross price, even if a self-hosted
provider endpoint demands more than its listing. This rides the existing deterministic guard.

**Files:**
- Modify: `services/src/settlement/spend-policy.ts`
- Modify: `services/src/settlement/gateway.ts`
- Test: `services/src/settlement/spend-policy.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `services/src/settlement/spend-policy.test.ts`:

```ts
test("checkSpend rejects a single charge above maxPerChargeAtomic", () => {
  const d = checkSpend({ nextAtomic: 101n, spentAtomic: 0n, capAtomic: 10_000n, maxPerChargeAtomic: 100n });
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.reason).toContain("per-charge");
});

test("checkSpend allows a charge at exactly maxPerChargeAtomic", () => {
  const d = checkSpend({ nextAtomic: 100n, spentAtomic: 0n, capAtomic: 10_000n, maxPerChargeAtomic: 100n });
  expect(d.ok).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/settlement/spend-policy.test.ts`
Expected: FAIL (unknown property `maxPerChargeAtomic`).

- [ ] **Step 3: Implement**

In `services/src/settlement/spend-policy.ts`, add `maxPerChargeAtomic?: bigint` to the input type of `checkSpend`, and before the cap check:

```ts
  if (input.maxPerChargeAtomic !== undefined && input.nextAtomic > input.maxPerChargeAtomic) {
    return { ok: false, reason: `per-charge amount ${input.nextAtomic} exceeds the listed price ${input.maxPerChargeAtomic}` };
  }
```

In `services/src/settlement/gateway.ts`: `GatewayAdapterOptions` gains `maxPerChargeAtomic?: bigint;` and the `onBeforePaymentCreation` hook passes it through to `checkSpend`.

- [ ] **Step 4: Run tests + type-check**

Run: `cd services && bun test src/settlement && bunx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add services/src/settlement
git commit -m "feat(fees): per-charge price ceiling in the spend guard"
```

---

## Task 3: Fee accrual in the meter

**Files:**
- Modify: `services/src/worker/meter.ts`
- Test: `services/src/worker/meter.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `services/src/worker/meter.test.ts` (mirror the file's existing fixture style — it builds an `InMemoryRegistry`, a provider with `pricePerCharge`, and a fake settlement whose `payForCompute` returns a fixed `amountAtomic`):

```ts
test("meterTick streams the fee as its own nano-payment and records both refs", async () => {
  const { registry, rent } = await runningLease({ pricePerCharge: 0.0001 }); // gross = 100 atomic
  const paidUrls: string[] = [];
  // First call = the provider (net 99); second = the fee endpoint (1).
  const settlement = fakeSettlementSeq(paidUrls, [99n, 1n]);
  const r = await meterTick(rent.id, { registry, settlement, tickMs: 0, maxUnits: 10, feeBaseUrl: "http://worker:9999" });
  expect(r.charged).toBe(true);
  const [charge] = await registry.listCharges(rent.id);
  expect(charge?.amount).toBe(99);
  expect(charge?.feeAmount).toBe(1);
  expect(charge?.feeSettlementRef).toBeTruthy();
  expect(paidUrls[1]).toBe("http://worker:9999/fee/1");
  expect((await registry.getRent(rent.id))?.totalCost).toBe(100); // renter sees gross
});

test("a failed fee payment doesn't block the provider stream; ref stays null for the sweep", async () => {
  const { registry, rent } = await runningLease({ pricePerCharge: 0.0001 });
  const settlement = fakeSettlementSeq([], [99n, new Error("fee endpoint down")]);
  const r = await meterTick(rent.id, { registry, settlement, tickMs: 0, maxUnits: 10, feeBaseUrl: "http://worker:9999" });
  expect(r.charged).toBe(true);
  const [charge] = await registry.listCharges(rent.id);
  expect(charge?.feeAmount).toBe(1);
  expect(charge?.feeSettlementRef).toBeNull();
});

test("zero fee (legacy gross endpoint) and no feeBaseUrl both skip the fee payment", async () => {
  const { registry, rent } = await runningLease({ pricePerCharge: 0.0001 });
  const paidUrls: string[] = [];
  const settlement = fakeSettlementSeq(paidUrls, [100n]);
  await meterTick(rent.id, { registry, settlement, tickMs: 0, maxUnits: 10, feeBaseUrl: "http://worker:9999" });
  expect((await registry.listCharges(rent.id))[0]?.feeAmount).toBe(0);
  expect(paidUrls.length).toBe(1); // no second payment for a zero fee
});
```

(`fakeSettlementSeq(urls, results)` is a small local helper: `payForCompute(url)` pushes the url, pops the next result, throws it if it's an Error, else returns `{ amountAtomic: result, settlementRef: "ref-" + urls.length, data: {}, status: 200 }`. Adapt to the file's existing fixture style — the assertions are the contract.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/worker/meter.test.ts`
Expected: FAIL (`feeAmount` recorded as 0 from Task 1's placeholder).

- [ ] **Step 3: Implement fee accrual**

In `services/src/worker/meter.ts`: `TickDeps` gains `feeBaseUrl?: string`. Where the charge is recorded after `payForCompute`:

```ts
  const grossAtomic = Math.round(provider.pricePerCharge * 1_000_000);
  const paidAtomic = Number(paid.amountAtomic);
  // Provider-side fee: the renter pays at most the listed gross; the provider's endpoint
  // demands net, and the difference is the platform's — streamed as its own nano-payment
  // to the worker's fee endpoint, from the same Gateway balance, same adapter. A legacy
  // endpoint that still charges gross yields zero fee; the renter never overpays.
  const feeAtomic = Math.max(0, grossAtomic - paidAtomic);
  let feeSettlementRef: string | null = null;
  if (feeAtomic > 0 && deps.feeBaseUrl) {
    try {
      const feePaid = await settlement.payForCompute(`${deps.feeBaseUrl}/fee/${feeAtomic}`);
      feeSettlementRef = feePaid.settlementRef || null;
    } catch (e) {
      // Never block the provider stream on the fee leg; the terminal sweep collects it.
      console.warn(`[meter] fee payment failed for ${rentId}:`, e instanceof Error ? e.message : e);
    }
  }
  await registry.recordCharge({
    rentId, providerId: provider.id, seq: charges.length,
    amount: paidAtomic, feeAmount: feeAtomic, feeSettlementRef,
    authorizationRef: null, settled: false, settlementRef: paid.settlementRef,
  });
```

(This replaces the existing `recordCharge` call which had `amount: Number(paid.amountAtomic)` and Task 1's placeholders. Note: fee payments ride `settlement.payForCompute`, so they count against the lease's spend cap — correct, since the cap bounds the renter's total outflow, and funding already uses the gross bound.)

- [ ] **Step 4: Run tests + type-check**

Run: `cd services && bun test src/worker && bunx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add services/src/worker/meter.ts services/src/worker/meter.test.ts
git commit -m "feat(fees): meter accrues fee = gross - paid per charge"
```

---

## Task 4: The fee endpoint + terminal catch-up sweep

The platform collects its fee the same way providers collect revenue: an x402-paywalled
endpoint, hosted by the worker itself, whose seller is the treasury. Per tick the meter
pays it (Task 3); this task builds the endpoint and the terminal sweep that pays any fee
ticks that failed transiently — through the same endpoint, so there is no separate
on-chain transfer path and no wallet-backend branching.

**Files:**
- Create: `services/src/worker/fee-app.ts`
- Create: `services/src/worker/sweep.ts`
- Modify: `services/src/worker/loop.ts`
- Modify: `services/src/worker/index.ts`
- Test: `services/src/worker/fee-app.test.ts`, `services/src/worker/sweep.test.ts`

- [ ] **Step 1: Write the failing fee-app test**

```ts
// services/src/worker/fee-app.test.ts
import { test, expect } from "bun:test";
import { createFeeApp } from "./fee-app";

// The paywall itself is createGatewayMiddleware (already proven by the provider server
// suite); what's ours to test is the route shape and the dynamic per-request price.
test("GET /fee/:atomic is paywalled at exactly that atomic amount", async () => {
  const prices: string[] = [];
  const app = createFeeApp({
    treasury: "0xTREASURY",
    facilitatorUrl: "http://facilitator",
    // Test seam: capture what the paywall was asked to charge, then let the request through.
    requireOverride: (price) => { prices.push(price); return (_req, _res, next) => next(); },
  });
  const { createServer } = await import("node:http");
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const res = await fetch(`http://localhost:${port}/fee/123`);
  server.close();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, feeAtomic: 123 });
  expect(prices).toEqual(["$0.000123"]);
});

test("rejects a non-numeric or non-positive fee", async () => {
  const app = createFeeApp({ treasury: "0xT", facilitatorUrl: "http://f", requireOverride: () => (_q, _s, n) => n() });
  const { createServer } = await import("node:http");
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  expect((await fetch(`http://localhost:${port}/fee/abc`)).status).toBe(400);
  expect((await fetch(`http://localhost:${port}/fee/0`)).status).toBe(400);
  server.close();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/worker/fee-app.test.ts`
Expected: FAIL, "Cannot find module './fee-app'".

- [ ] **Step 3: Implement the fee app**

```ts
// services/src/worker/fee-app.ts
import express, { type Express, type RequestHandler } from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";

export type FeeAppOptions = {
  treasury: string;       // sellerAddress: where the fee nano-payments settle
  facilitatorUrl: string;
  networks?: string[];    // CAIP-2; default Arc testnet
  // Test seam: swap the real paywall for a stub that records the demanded price.
  requireOverride?: (price: string) => RequestHandler;
};

// The platform's revenue endpoint: paying `/fee/:atomic` IS the fee. The amount rides in
// the path so one route serves every provider price; the x402 payment goes to the treasury
// through the exact same Gateway batching rail the providers use.
export function createFeeApp(opts: FeeAppOptions): Express {
  const networks = opts.networks ?? ["eip155:5042002"];
  const gateway = createGatewayMiddleware({ sellerAddress: opts.treasury, networks, facilitatorUrl: opts.facilitatorUrl });
  const require = opts.requireOverride ?? ((price: string) => gateway.require(price));

  const app = express();
  app.get("/fee/:atomic", (req, res, next) => {
    const atomic = Number(req.params.atomic);
    if (!Number.isInteger(atomic) || atomic <= 0) {
      res.status(400).json({ error: "fee must be a positive integer of atomic USDC units" });
      return;
    }
    require(`$${atomic / 1_000_000}`)(req, res, () => {
      res.json({ ok: true, feeAtomic: atomic });
    });
  });
  return app;
}
```

- [ ] **Step 4: Run fee-app tests to verify they pass**

Run: `cd services && bun test src/worker/fee-app.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing sweep test**

```ts
// services/src/worker/sweep.test.ts
import { test, expect } from "bun:test";
import { InMemoryRegistry } from "../registry/in-memory";
import { defaultTrust } from "../trust/trust";
import { sweepFees, type PayFee } from "./sweep";

async function terminalRent(reg: InMemoryRegistry, fees: { amount: number; ref: string | null }[]) {
  const provider = await reg.registerProvider({
    alias: "p", ownerWallet: "0xs", endpointUrl: "http://x", resourceType: "GPU", region: "US-East",
    specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 1,
  });
  const rent = await reg.createRent({ name: "r", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
  let seq = 0;
  for (const f of fees) {
    await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: seq++, amount: 99, feeAmount: f.amount, feeSettlementRef: f.ref, authorizationRef: null, settled: false, settlementRef: null });
  }
  await reg.updateRent(rent.id, { status: "completed", endedAt: new Date().toISOString() });
  return rent;
}

test("sweepFees pays only the outstanding fee ticks and stamps everything", async () => {
  const reg = new InMemoryRegistry();
  // One fee tick streamed live (ref set), two missed (ref null).
  const rent = await terminalRent(reg, [{ amount: 1, ref: "live-1" }, { amount: 1, ref: null }, { amount: 2, ref: null }]);
  const paid: bigint[] = [];
  const payFee: PayFee = async (_rent, atomic) => { paid.push(atomic); return "sweep-ref"; };

  const first = await sweepFees(rent.id, { registry: reg, payFee });
  expect(first.swept).toBe(true);
  expect(paid).toEqual([3n]); // only the missed ticks, as one payment
  const charges = await reg.listCharges(rent.id);
  expect(charges.map((c) => c.feeSettlementRef)).toEqual(["live-1", "sweep-ref", "sweep-ref"]);
  expect((await reg.getRent(rent.id))?.feesSweptAt).toBeTruthy();

  const second = await sweepFees(rent.id, { registry: reg, payFee });
  expect(second.swept).toBe(false); // idempotent
  expect(paid.length).toBe(1);
});

test("all fees already streamed -> just stamps, no payment; non-terminal -> skipped", async () => {
  const reg = new InMemoryRegistry();
  const done = await terminalRent(reg, [{ amount: 1, ref: "live-1" }]);
  const payFee: PayFee = async () => { throw new Error("must not pay"); };
  const r = await sweepFees(done.id, { registry: reg, payFee });
  expect(r.swept).toBe(false);
  expect((await reg.getRent(done.id))?.feesSweptAt).toBeTruthy();

  const running = await reg.createRent({ name: "r2", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
  await reg.updateRent(running.id, { status: "running" });
  expect((await sweepFees(running.id, { registry: reg, payFee })).swept).toBe(false);
});

test("a failed sweep payment leaves refs + stamp unset (retry next pass)", async () => {
  const reg = new InMemoryRegistry();
  const rent = await terminalRent(reg, [{ amount: 5, ref: null }]);
  const payFee: PayFee = async () => { throw new Error("gateway down"); };
  const r = await sweepFees(rent.id, { registry: reg, payFee });
  expect(r.swept).toBe(false);
  expect((await reg.listCharges(rent.id))[0]?.feeSettlementRef).toBeNull();
  expect((await reg.getRent(rent.id))?.feesSweptAt).toBeNull();
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd services && bun test src/worker/sweep.test.ts`
Expected: FAIL, "Cannot find module './sweep'".

- [ ] **Step 7: Implement the sweep**

```ts
// services/src/worker/sweep.ts
import type { Registry } from "../registry/registry";
import type { Rent, RentStatus } from "../domain";

// Pays an outstanding fee amount for a rent — in practice the rent's settlement adapter
// hitting the worker's own /fee endpoint, so sweep money rides the same nano-payment rail
// as live fee ticks. Returns the settlement ref.
export type PayFee = (rent: Rent, amountAtomic: bigint) => Promise<string>;

export type SweepDeps = { registry: Registry; payFee: PayFee };
export type SweepResult = { swept: boolean; reason: string; ref?: string };

const TERMINAL: RentStatus[] = ["completed", "cancelled", "failed"];

// Terminal catch-up: fee ticks normally stream live from the meter; this collects the ones
// whose fee payment failed. One payment for the whole remainder, refs stamped per charge,
// fees_swept_at stamped once nothing is outstanding. Any failure leaves state unstamped so
// the next worker pass retries.
export async function sweepFees(rentId: string, deps: SweepDeps): Promise<SweepResult> {
  const { registry, payFee } = deps;
  const rent = await registry.getRent(rentId);
  if (!rent) return { swept: false, reason: "rent not found" };
  if (!TERMINAL.includes(rent.status)) return { swept: false, reason: "not terminal" };
  if (rent.feesSweptAt) return { swept: false, reason: "already swept" };

  const charges = await registry.listCharges(rentId);
  const outstanding = charges.filter((c) => c.feeAmount > 0 && !c.feeSettlementRef);
  const dueAtomic = outstanding.reduce((s, c) => s + BigInt(c.feeAmount), 0n);
  if (dueAtomic <= 0n) {
    await registry.updateRent(rentId, { feesSweptAt: new Date().toISOString() }); // nothing owed; stop rechecking
    return { swept: false, reason: "no outstanding fees" };
  }

  try {
    const ref = await payFee(rent, dueAtomic);
    for (const c of outstanding) await registry.markChargeFeeSettled(c.id, ref);
    await registry.updateRent(rentId, { feesSweptAt: new Date().toISOString() });
    return { swept: true, reason: "swept", ref };
  } catch (e) {
    return { swept: false, reason: e instanceof Error ? e.message : "fee payment failed" };
  }
}
```

- [ ] **Step 8: Run sweep tests to verify they pass**

Run: `cd services && bun test src/worker/sweep.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Wire the loop + the worker entry**

In `services/src/worker/loop.ts`: `WorkerDeps` gains `feeBaseUrl?: string` (threaded into `meterTick`'s deps) and, at the end of `workerPass`, when `feeBaseUrl` is set:

```ts
  if (deps.feeBaseUrl) {
    const feeBaseUrl = deps.feeBaseUrl;
    for (const status of ["completed", "cancelled", "failed"] as const) {
      for (const rent of await registry.listRents({ status })) {
        if (rent.feesSweptAt) continue;
        try {
          const settlement = await deps.settlementFor(rent, deps.defaultMaxUnits);
          await sweepFees(rent.id, {
            registry,
            payFee: async (r, atomic) => (await settlement.payForCompute(`${feeBaseUrl}/fee/${atomic}`)).settlementRef,
          });
        } catch (e) {
          console.error(`[worker] fee sweep failed for ${rent.id}:`, e instanceof Error ? e.message : e);
        }
      }
    }
  }
```

In `services/src/worker/index.ts`, start the fee endpoint and thread the base url:

```ts
import { createServer } from "node:http";
import { createFeeApp } from "./fee-app";

const treasury = process.env.PLATFORM_TREASURY_ADDRESS;
const feePort = Number(process.env.WORKER_FEE_PORT ?? "8788");
let feeBaseUrl: string | undefined;
if (treasury) {
  const feeApp = createFeeApp({ treasury, facilitatorUrl: "https://gateway-api-testnet.circle.com" });
  createServer(feeApp).listen(feePort);
  feeBaseUrl = `http://127.0.0.1:${feePort}`;
  console.log(`[worker] fee endpoint on :${feePort} -> treasury ${treasury}`);
} else {
  console.warn("[worker] PLATFORM_TREASURY_ADDRESS unset; platform fees disabled");
}
```

and add `feeBaseUrl` to the `deps` object.

- [ ] **Step 10: Full worker tests + type-check**

Run: `cd services && bun test src/worker && bunx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 11: Commit**

```bash
git add services/src/worker
git commit -m "feat(fees): platform fee streams per tick via the worker's own x402 endpoint"
```

---

## Task 5: Net pricing in the provider template

**Files:**
- Modify: `services/src/provider/server.ts`
- Modify: `services/scripts/run-provider.ts`
- Test: `services/src/provider/server.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `services/src/provider/server.test.ts` (it already builds an app via `createProviderApp` and reads `/health`):

```ts
test("net pricing: /compute demands gross minus the platform fee, /health shows both", async () => {
  const app = createProviderApp({
    executor: fakeExecutor(), sellerAddress: "0xseller", price: "$0.0001",
    platformFeeBps: 100, facilitatorUrl: "http://facilitator", meta,
  });
  const res = await request(app).get("/health");
  expect(res.body.price).toBe("$0.0001");        // listed gross, what renters see
  expect(res.body.netPrice).toBe("$0.000099");   // what /compute actually demands
});
```

(Use the file's existing request helper/fixtures; the assertions are the contract.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/provider/server.test.ts`
Expected: FAIL (`platformFeeBps` unknown; no `netPrice`).

- [ ] **Step 3: Implement**

In `services/src/provider/server.ts`:

```ts
// The marketplace's cut comes out of the provider's price, not on top of it: the listing
// shows gross, the paywall demands net, and the platform sweeps the difference from the
// renter (whose total spend still equals the listed gross).
export function netPrice(gross: string, feeBps: number): string {
  const grossAtomic = Math.round(parseFloat(gross.replace("$", "")) * 1_000_000);
  const netAtomic = Math.floor((grossAtomic * (10_000 - feeBps)) / 10_000);
  return `$${netAtomic / 1_000_000}`;
}
```

`ProviderAppOptions` gains `platformFeeBps?: number` (default 0 so existing tests/deploys are untouched). In `createProviderApp`:

```ts
  const feeBps = opts.platformFeeBps ?? 0;
  const chargedPrice = feeBps > 0 ? netPrice(price, feeBps) : price;
```

`/health` responds with `{ ok: true, kind: executor.kind, price, netPrice: chargedPrice, ...meta }`, and the paywall becomes `gateway.require(chargedPrice)`.

In `services/scripts/run-provider.ts`, pass `platformFeeBps: Number(process.env.PLATFORM_FEE_BPS ?? "100")` into `createProviderApp`.

- [ ] **Step 4: Run tests + type-check + full suite**

Run: `cd services && bun test src/provider && bunx tsc --noEmit && bun test src`
Expected: all PASS, clean.

- [ ] **Step 5: Update env docs**

Add to `.env.example` (root) and `services/.env`:

```
# Platform fee (basis points; 100 = 1%) and where swept fees land
PLATFORM_FEE_BPS=100
PLATFORM_TREASURY_ADDRESS=0x5ad0ccd42fe945aff0c7e64e268f3e82788c2c16
```

(The treasury above is the probe's Circle wallet — already Circle-custodied, fine for testnet; Phase 2's setup script can mint a dedicated one.)

- [ ] **Step 6: Commit**

```bash
git add services/src/provider services/scripts/run-provider.ts .env.example
git commit -m "feat(fees): provider template charges net of the 1% platform fee"
```

---

# Phase 2: Circle-custodied wallets

## Task 6: `circle_wallets` mapping + `CircleWalletStore`

**Files:**
- Create: `services/supabase/migrations/0010_circle_wallets.sql`
- Create: `services/src/wallet/circle.ts`
- Test: `services/src/wallet/circle.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- services/supabase/migrations/0010_circle_wallets.sql
-- Circle developer-controlled wallets: custody lives at Circle (MPC); we store only the
-- wallet id + address per principal. No key material, encrypted or otherwise.
create table if not exists circle_wallets (
  owner_kind text not null check (owner_kind in ('user','agent','platform')),
  owner_id text not null,
  wallet_id text not null unique,
  address text not null unique,
  created_at timestamptz not null default now(),
  primary key (owner_kind, owner_id)
);
alter table circle_wallets enable row level security;
```

- [ ] **Step 2: Apply to the live Supabase project**

Apply via `apply_migration` (project `xwxuqcougmanzonypoym`, name `0010_circle_wallets`).
Verify: `select count(*) from circle_wallets;` runs.

- [ ] **Step 3: Write the failing test**

```ts
// services/src/wallet/circle.test.ts
import { test, expect } from "bun:test";
import { CircleWalletStore, type CircleWalletsApi } from "./circle";

// Minimal fakes: the Circle API slice the store touches, and a supabase table.
function fakeCircle(): CircleWalletsApi & { created: number } {
  const api = {
    created: 0,
    async createWallets() {
      api.created += 1;
      return { data: { wallets: [{ id: `w-${api.created}`, address: `0xaddr${api.created}` }] } } as any;
    },
  };
  return api;
}
function fakeDb() {
  const rows: any[] = [];
  return {
    _rows: rows,
    from() {
      let filters: [string, unknown][] = [];
      const api: any = {
        select() { return api; },
        eq(c: string, v: unknown) { filters.push([c, v]); return api; },
        async maybeSingle() {
          const r = rows.find((x) => filters.every(([c, v]) => x[c] === v)) ?? null;
          return { data: r, error: null };
        },
        async insert(row: any) { rows.push(row); return { error: null }; },
      };
      return api;
    },
  } as any;
}

test("getOrCreate creates once and returns the same wallet after", async () => {
  const circle = fakeCircle();
  const store = new CircleWalletStore(fakeDb(), circle, "wallet-set-1");
  const a = await store.getOrCreate("user", "u1");
  const b = await store.getOrCreate("user", "u1");
  expect(a.address).toBe("0xaddr1");
  expect(a.walletId).toBe("w-1");
  expect(b.address).toBe("0xaddr1");
  expect(circle.created).toBe(1);
});

test("get returns null for an unknown principal", async () => {
  const store = new CircleWalletStore(fakeDb(), fakeCircle(), "ws");
  expect(await store.get("agent", "nope")).toBeNull();
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd services && bun test src/wallet/circle.test.ts`
Expected: FAIL, "Cannot find module './circle'".

- [ ] **Step 5: Implement**

```ts
// services/src/wallet/circle.ts
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CircleClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

export function makeCircleClient(env: Record<string, string | undefined> = process.env): CircleClient {
  const apiKey = env.CIRCLE_API_KEY;
  const entitySecret = env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) throw new Error("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET required");
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

export type OwnerKind = "user" | "agent" | "platform";
export type CircleWallet = { walletId: string; address: string };

// The API slice the store needs; the real client satisfies it, tests stub it.
export type CircleWalletsApi = {
  createWallets(input: { walletSetId: string; blockchains: any[]; accountType: "EOA"; count: number }): Promise<any>;
};

// One Circle wallet per principal, mapped in circle_wallets. accountType EOA is
// load-bearing: EIP-3009 needs an ECDSA signature recovering to the funds-holding address.
export class CircleWalletStore {
  constructor(private db: SupabaseClient, private circle: CircleWalletsApi, private walletSetId: string) {}

  async get(kind: OwnerKind, id: string): Promise<CircleWallet | null> {
    const { data, error } = await this.db.from("circle_wallets").select("wallet_id, address")
      .eq("owner_kind", kind).eq("owner_id", id).maybeSingle();
    if (error) throw error;
    return data ? { walletId: data.wallet_id as string, address: data.address as string } : null;
  }

  async getOrCreate(kind: OwnerKind, id: string): Promise<CircleWallet> {
    const found = await this.get(kind, id);
    if (found) return found;
    const res: any = await this.circle.createWallets({
      walletSetId: this.walletSetId, blockchains: ["ARC-TESTNET"], accountType: "EOA", count: 1,
    });
    const w = res.data?.wallets?.[0];
    if (!w) throw new Error(`createWallets returned no wallet: ${JSON.stringify(res.data)}`);
    const { error } = await this.db.from("circle_wallets").insert({
      owner_kind: kind, owner_id: id, wallet_id: w.id, address: w.address,
    });
    if (error) {
      const again = await this.get(kind, id); // lost a race; the existing row wins
      if (again) return again;
      throw error;
    }
    return { walletId: w.id as string, address: w.address as string };
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd services && bun test src/wallet/circle.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Setup script for the wallet set + dedicated treasury**

```ts
// services/scripts/circle-setup.ts
// One-time: create the production wallet set + the platform treasury wallet, print ids.
import { makeCircleClient } from "../src/wallet/circle";

const client = makeCircleClient();
const set: any = await client.createWalletSet({ name: "prime-compute" });
const walletSetId = set.data?.walletSet?.id;
console.log("CIRCLE_WALLET_SET_ID=" + walletSetId);
const created: any = await client.createWallets({ walletSetId, blockchains: ["ARC-TESTNET"] as any, accountType: "EOA", count: 1 });
const treasury = created.data?.wallets?.[0];
console.log("PLATFORM_TREASURY_ADDRESS=" + treasury.address, "(wallet id " + treasury.id + ")");
console.log("Put both in services/.env (and root .env for the app).");
```

Add script `"circle:setup": "bun run scripts/circle-setup.ts"` to `services/package.json`. Run it once, put `CIRCLE_WALLET_SET_ID` + the new `PLATFORM_TREASURY_ADDRESS` in env.

- [ ] **Step 8: Commit**

```bash
git add services/supabase/migrations/0010_circle_wallets.sql services/src/wallet/circle.ts services/src/wallet/circle.test.ts services/scripts/circle-setup.ts services/package.json
git commit -m "feat(circle): circle_wallets mapping, CircleWalletStore, setup script"
```

---

## Task 7: Circle-backed `BatchEvmSigner`

**Files:**
- Create: `services/src/settlement/circle-signer.ts`
- Test: `services/src/settlement/circle-signer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/src/settlement/circle-signer.test.ts
import { test, expect } from "bun:test";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { circleBatchSigner } from "./circle-signer";

// Stub Circle client that signs with a local key — validates the exact JSON we send
// (EIP712Domain present, bigints stringified) by round-tripping it through a real signer.
function stubCircle(account: ReturnType<typeof privateKeyToAccount>) {
  return {
    lastData: "" as string,
    async signTypedData({ data }: { walletId: string; data: string }) {
      (this as any).lastData = data;
      const parsed = JSON.parse(data);
      expect(parsed.types.EIP712Domain).toBeDefined(); // Circle rejects payloads without it
      const { EIP712Domain: _drop, ...types } = parsed.types;
      const signature = await account.signTypedData({
        domain: parsed.domain, types, primaryType: parsed.primaryType,
        message: { ...parsed.message, value: BigInt(parsed.message.value), validAfter: BigInt(parsed.message.validAfter), validBefore: BigInt(parsed.message.validBefore) },
      });
      return { data: { signature } };
    },
  };
}

const payParams = (from: string) => ({
  domain: { name: "GatewayWalletBatched", version: "1", chainId: 5042002, verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as `0x${string}` },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: { from, to: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", value: 100n, validAfter: 0n, validBefore: 9999999999n, nonce: ("0x" + "11".repeat(32)) as `0x${string}` },
});

test("signature from the Circle path recovers to the wallet address", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const circle = stubCircle(account);
  const signer = circleBatchSigner(circle as any, "wallet-1", account.address);
  const params = payParams(account.address);
  const signature = await signer.signTypedData(params as any);
  const recovered = await recoverTypedDataAddress({ ...(params as any), signature });
  expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
});

test("bigints in the message are JSON-safe strings on the wire", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const circle = stubCircle(account);
  const signer = circleBatchSigner(circle as any, "wallet-1", account.address);
  await signer.signTypedData(payParams(account.address) as any);
  const parsed = JSON.parse(circle.lastData);
  expect(parsed.message.value).toBe("100");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/settlement/circle-signer.test.ts`
Expected: FAIL, "Cannot find module './circle-signer'".

- [ ] **Step 3: Implement**

```ts
// services/src/settlement/circle-signer.ts
import type { BatchEvmSigner } from "@circle-fin/x402-batching";

// The API slice the signer needs from the Circle developer-controlled wallets client.
export type CircleSignerApi = {
  signTypedData(input: { walletId: string; data: string; memo?: string }): Promise<{ data?: { signature?: string } } | any>;
};

// Canonical EIP712Domain field order; only fields actually present in the domain are declared.
const DOMAIN_FIELDS: { name: string; type: string }[] = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
  { name: "salt", type: "bytes32" },
];

const jsonSafe = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

// A BatchEvmSigner whose key lives at Circle. Two dialect fixes vs the viem-style params
// BatchEvmScheme passes in (both probe-proven 2026-07-02): Circle's validator requires
// EIP712Domain declared in `types`, and the JSON body can't carry bigints.
export function circleBatchSigner(client: CircleSignerApi, walletId: string, address: string): BatchEvmSigner {
  return {
    address: address as `0x${string}`,
    async signTypedData(params) {
      const domainType = DOMAIN_FIELDS.filter((f) => (params.domain as Record<string, unknown>)[f.name] !== undefined);
      const data = JSON.stringify(
        { domain: params.domain, types: { EIP712Domain: domainType, ...params.types }, primaryType: params.primaryType, message: params.message },
        jsonSafe,
      );
      const res: any = await client.signTypedData({ walletId, data, memo: "prime-compute x402 charge" });
      const signature = res.data?.signature;
      if (!signature) throw new Error(`Circle signTypedData returned no signature: ${JSON.stringify(res.data)}`);
      return signature as `0x${string}`;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services && bun test src/settlement/circle-signer.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/settlement/circle-signer.ts services/src/settlement/circle-signer.test.ts
git commit -m "feat(circle): Circle-backed BatchEvmSigner with the EIP712Domain dialect fix"
```

---

## Task 8: Standalone Gateway pay dance

**Files:**
- Create: `services/src/settlement/gateway-pay.ts`
- Test: `services/src/settlement/gateway-pay.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/src/settlement/gateway-pay.test.ts
import { test, expect } from "bun:test";
import { gatewayPay } from "./gateway-pay";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

const requirement = {
  scheme: "exact", network: "eip155:5042002", asset: "0xusdc", amount: "99",
  payTo: "0xseller", maxTimeoutSeconds: 60,
  extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
};

function fakeScheme() {
  return {
    calls: [] as any[],
    async createPaymentPayload(x402Version: number, req: any) {
      (this as any).calls.push({ x402Version, req });
      return { x402Version, payload: { signature: "0xsig", authorization: { from: "0xbuyer", to: "0xseller", value: "99", validAfter: "0", validBefore: "9", nonce: "0x11" } } };
    },
  };
}

function fetchScript(...responses: Response[]) {
  let i = 0;
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = async (url: string, init?: any) => {
    calls.push({ url, headers: init?.headers ?? {} });
    return responses[i++] ?? new Response("exhausted", { status: 500 });
  };
  return { impl, calls };
}

test("pays through the 402 dance and returns amount + settlement ref", async () => {
  const paymentRequired = { x402Version: 2, resource: "http://p/compute", accepts: [requirement] };
  const { impl, calls } = fetchScript(
    new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": b64(paymentRequired) } }),
    new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", "PAYMENT-RESPONSE": b64({ transaction: "settle-uuid" }) } }),
  );
  const scheme = fakeScheme();
  const paid = await gatewayPay("http://p/compute", scheme as any, { chainId: 5042002, fetchImpl: impl as any });
  expect(paid.amountAtomic).toBe(99n);
  expect(paid.settlementRef).toBe("settle-uuid");
  expect(paid.status).toBe(200);
  expect(scheme.calls[0].req).toEqual(requirement);
  const sigHeader = calls[1].headers["Payment-Signature"];
  const decoded = JSON.parse(Buffer.from(sigHeader, "base64").toString("utf8"));
  expect(decoded.accepted).toEqual(requirement);
  expect(decoded.resource).toBe("http://p/compute");
});

test("a 200 without a paywall is free (amount 0, no signing)", async () => {
  const { impl } = fetchScript(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
  const scheme = fakeScheme();
  const paid = await gatewayPay("http://p/free", scheme as any, { chainId: 5042002, fetchImpl: impl as any });
  expect(paid.amountAtomic).toBe(0n);
  expect(scheme.calls.length).toBe(0);
});

test("throws when no Gateway batching option matches the chain", async () => {
  const paymentRequired = { x402Version: 2, resource: "r", accepts: [{ ...requirement, network: "eip155:1" }] };
  const { impl } = fetchScript(new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": b64(paymentRequired) } }));
  await expect(gatewayPay("http://p/compute", fakeScheme() as any, { chainId: 5042002, fetchImpl: impl as any })).rejects.toThrow(/batching option/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/settlement/gateway-pay.test.ts`
Expected: FAIL, "Cannot find module './gateway-pay'".

- [ ] **Step 3: Implement**

```ts
// services/src/settlement/gateway-pay.ts
// The x402/Gateway 402 dance, extracted from GatewayClient.pay so any BatchEvmScheme —
// including one whose signer lives at Circle — can drive it. Wire format mirrors
// @circle-fin/x402-batching's client exactly (PAYMENT-REQUIRED / Payment-Signature /
// PAYMENT-RESPONSE, all base64 JSON).

type SchemeLike = { createPaymentPayload(x402Version: number, requirements: any): Promise<any> };
export type GatewayPayOptions = { chainId: number; fetchImpl?: typeof fetch };
export type GatewayPaid = { amountAtomic: bigint; settlementRef: string; data: unknown; status: number };

export async function gatewayPay(url: string, scheme: SchemeLike, opts: GatewayPayOptions): Promise<GatewayPaid> {
  const fetchImpl = opts.fetchImpl ?? fetch;

  const initial = await fetchImpl(url);
  if (initial.status !== 402) {
    if (initial.ok) return { amountAtomic: 0n, settlementRef: "", data: await initial.json(), status: initial.status };
    throw new Error(`request failed with status ${initial.status}`);
  }

  const requiredHeader = initial.headers.get("PAYMENT-REQUIRED");
  if (!requiredHeader) throw new Error("missing PAYMENT-REQUIRED header in 402 response");
  const paymentRequired = JSON.parse(Buffer.from(requiredHeader, "base64").toString("utf-8"));

  const network = `eip155:${opts.chainId}`;
  const option = (paymentRequired.accepts ?? []).find(
    (o: any) => o.network === network && o.extra?.name === "GatewayWalletBatched" && o.extra?.version === "1" && typeof o.extra?.verifyingContract === "string",
  );
  if (!option) throw new Error(`no Gateway batching option for ${network} in the 402 response`);

  const x402Version = paymentRequired.x402Version ?? 2;
  const paymentPayload = await scheme.createPaymentPayload(x402Version, option);
  const header = Buffer.from(JSON.stringify({ ...paymentPayload, resource: paymentRequired.resource, accepted: option })).toString("base64");

  const paid = await fetchImpl(url, { headers: { "Payment-Signature": header } });
  if (!paid.ok) {
    const err = await paid.json().catch(() => ({}));
    throw new Error(`payment failed: ${(err as any).error ?? paid.statusText}`);
  }
  const settleHeader = paid.headers.get("PAYMENT-RESPONSE");
  const settle = settleHeader ? JSON.parse(Buffer.from(settleHeader, "base64").toString("utf-8")) : undefined;

  return { amountAtomic: BigInt(option.amount), settlementRef: settle?.transaction ?? "", data: await paid.json(), status: paid.status };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services && bun test src/settlement/gateway-pay.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/settlement/gateway-pay.ts services/src/settlement/gateway-pay.test.ts
git commit -m "feat(circle): standalone Gateway 402 dance for external signers"
```

---

## Task 9: `CircleGatewaySettlementAdapter`

**Files:**
- Create: `services/src/settlement/circle-gateway.ts`
- Test: `services/src/settlement/circle-gateway.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/src/settlement/circle-gateway.test.ts
import { test, expect } from "bun:test";
import { CircleGatewaySettlementAdapter } from "./circle-gateway";
import { SpendCapError } from "./spend-policy";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const requirement = {
  scheme: "exact", network: "eip155:5042002", asset: "0xusdc", amount: "99", payTo: "0xseller",
  maxTimeoutSeconds: 60, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
};

// A Circle client stub: signs anything, executes contracts, reports transactions complete.
function stubCircle() {
  return {
    executions: [] as any[],
    async signTypedData() { return { data: { signature: "0x" + "ab".repeat(65) } }; },
    async createContractExecutionTransaction(input: any) {
      (this as any).executions.push(input);
      return { data: { id: `tx-${(this as any).executions.length}` } };
    },
    async getTransaction() { return { data: { transaction: { state: "COMPLETE", txHash: "0xhash" } } }; },
  };
}

function paywalledFetch() {
  let first = true;
  return async (url: string, init?: any) => {
    if (String(url).includes("gateway-api")) {
      return new Response(JSON.stringify({ balances: [{ balance: "0" }] }), { status: 200 }); // gateway empty
    }
    if (first && !init?.headers?.["Payment-Signature"]) {
      first = false;
      return new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": b64({ x402Version: 2, resource: url, accepts: [requirement] }) } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "PAYMENT-RESPONSE": b64({ transaction: "settle-1" }) } });
  };
}

const opts = (over: Partial<ConstructorParameters<typeof CircleGatewaySettlementAdapter>[0]> = {}) => ({
  client: stubCircle() as any, walletId: "w1", address: "0xbuyer",
  capAtomic: 10_000n, usdcAddress: "0xusdc", fetchImpl: paywalledFetch() as any, ...over,
});

test("payForCompute pays the 402 and tracks spend against the cap", async () => {
  const adapter = new CircleGatewaySettlementAdapter(opts());
  const paid = await adapter.payForCompute("http://p/compute");
  expect(paid.amountAtomic).toBe(99n);
  expect(paid.settlementRef).toBe("settle-1");
});

test("payForCompute throws SpendCapError beyond the cap", async () => {
  const adapter = new CircleGatewaySettlementAdapter(opts({ capAtomic: 50n }));
  await expect(adapter.payForCompute("http://p/compute")).rejects.toThrow(SpendCapError);
});

test("ensureFunded approves + deposits the shortfall via Circle contract execution", async () => {
  const client = stubCircle();
  const adapter = new CircleGatewaySettlementAdapter(opts({ client: client as any }));
  const r = await adapter.ensureFunded(500n);
  expect(r.deposited).toBe(true);
  expect(client.executions.length).toBe(2);
  expect(client.executions[0].abiFunctionSignature).toBe("approve(address,uint256)");
  expect(client.executions[0].abiParameters).toEqual(["0x0077777d7EBA4688BDeF3E311b846F25870A19B9", "500"]);
  expect(client.executions[1].abiFunctionSignature).toBe("deposit(address,uint256)");
  expect(client.executions[1].abiParameters).toEqual(["0xusdc", "500"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/settlement/circle-gateway.test.ts`
Expected: FAIL, "Cannot find module './circle-gateway'".

- [ ] **Step 3: Implement**

```ts
// services/src/settlement/circle-gateway.ts
import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import type { SettlementAdapter, PaidCompute, SettlementStatus } from "./adapter";
import { checkSpend, SpendCapError } from "./spend-policy";
import { circleBatchSigner, type CircleSignerApi } from "./circle-signer";
import { gatewayPay } from "./gateway-pay";

const GATEWAY_API = "https://gateway-api-testnet.circle.com/v1";
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const ARC_TESTNET_CHAIN_ID = 5042002;
const ARC_GATEWAY_DOMAIN = 26;

export type CircleExecApi = CircleSignerApi & {
  createContractExecutionTransaction(input: any): Promise<any>;
  getTransaction(input: { id: string }): Promise<any>;
};

export type CircleGatewayOptions = {
  client: CircleExecApi;
  walletId: string;
  address: string;      // the Circle wallet's on-chain address (the payer)
  capAtomic: bigint;    // per-stream spend cap (same semantics as the raw-key adapter)
  usdcAddress: string;  // Arc USDC
  maxPerChargeAtomic?: bigint;
  gatewayApi?: string;  // override for tests
  fetchImpl?: typeof fetch;
};

// SettlementAdapter whose signer lives at Circle: pay = standalone 402 dance with a
// Circle-backed BatchEvmScheme; funding = approve+deposit through Circle's contract
// execution API. No private key exists on our side of any call.
export class CircleGatewaySettlementAdapter implements SettlementAdapter {
  readonly buyerAddress: string;
  private scheme: BatchEvmScheme;
  private spent = 0n;
  private lastAbortReason: string | null = null;
  private fetchImpl: typeof fetch;
  private api: string;

  constructor(private opts: CircleGatewayOptions) {
    this.buyerAddress = opts.address;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.api = opts.gatewayApi ?? GATEWAY_API;
    this.scheme = new BatchEvmScheme(circleBatchSigner(opts.client, opts.walletId, opts.address));
    this.scheme.onBeforePaymentCreation(async (ctx) => {
      const nextAtomic = BigInt(ctx.selectedRequirements.amount);
      const decision = checkSpend({ nextAtomic, spentAtomic: this.spent, capAtomic: this.opts.capAtomic, maxPerChargeAtomic: this.opts.maxPerChargeAtomic });
      if (!decision.ok) {
        this.lastAbortReason = decision.reason;
        return { abort: true, reason: decision.reason };
      }
      return undefined;
    });
  }

  async ensureFunded(minAtomic: bigint): Promise<{ deposited: boolean; depositTxHash?: string }> {
    const available = await this.gatewayBalance();
    if (available >= minAtomic) return { deposited: false };
    const shortfall = (minAtomic - available).toString();
    await this.exec("approve(address,uint256)", [GATEWAY_WALLET, shortfall], this.opts.usdcAddress);
    const txHash = await this.exec("deposit(address,uint256)", [this.opts.usdcAddress, shortfall], GATEWAY_WALLET);
    return { deposited: true, depositTxHash: txHash };
  }

  async payForCompute(url: string): Promise<PaidCompute> {
    this.lastAbortReason = null;
    try {
      const paid = await gatewayPay(url, this.scheme, { chainId: ARC_TESTNET_CHAIN_ID, fetchImpl: this.fetchImpl });
      this.spent += paid.amountAtomic;
      return { amountAtomic: paid.amountAtomic, settlementRef: paid.settlementRef, data: paid.data, status: paid.status };
    } catch (err) {
      if (this.lastAbortReason) throw new SpendCapError(this.lastAbortReason);
      throw err;
    }
  }

  async reconcile(settlementRef: string): Promise<SettlementStatus> {
    const res = await this.fetchImpl(`${this.api}/x402/transfers/${encodeURIComponent(settlementRef)}`);
    if (!res.ok) throw new Error(`reconcile failed (${res.status})`);
    const t: any = await res.json();
    const settled = t.status === "completed" || t.status === "confirmed";
    return { ref: settlementRef, status: t.status, settled };
  }

  private async gatewayBalance(): Promise<bigint> {
    const res = await this.fetchImpl(`${this.api}/balances`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "USDC", sources: [{ depositor: this.buyerAddress, domain: ARC_GATEWAY_DOMAIN }] }),
    });
    if (!res.ok) throw new Error(`gateway balances failed (${res.status})`);
    const data: any = await res.json();
    const balance = data.balances?.[0]?.balance;
    if (balance === undefined) throw new Error("gateway returned no balance for the depositor");
    return BigInt(Math.round(Number(balance) * 1_000_000));
  }

  // One contract call through Circle, polled to completion. Circle pays gas in USDC on Arc.
  private async exec(signature: string, params: string[], contractAddress: string): Promise<string> {
    const created: any = await this.opts.client.createContractExecutionTransaction({
      walletId: this.opts.walletId, contractAddress,
      abiFunctionSignature: signature, abiParameters: params,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    const id = created.data?.id;
    if (!id) throw new Error(`contract execution gave no id: ${JSON.stringify(created.data)}`);
    for (let i = 0; i < 60; i++) {
      const res: any = await this.opts.client.getTransaction({ id });
      const tx = res.data?.transaction;
      if (tx?.state === "COMPLETE" || tx?.state === "CONFIRMED") return tx.txHash ?? id;
      if (tx?.state === "FAILED" || tx?.state === "CANCELLED" || tx?.state === "DENIED") {
        throw new Error(`contract execution ${signature} ${tx.state}: ${tx?.errorReason ?? ""}`);
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`contract execution ${signature} timed out`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services && bun test src/settlement/circle-gateway.test.ts`
Expected: PASS (3 tests). (The stub's `getTransaction` returns COMPLETE immediately, so no test waits on the 2s poll.)

- [ ] **Step 5: Type-check + full settlement suite**

Run: `cd services && bunx tsc --noEmit && bun test src/settlement`
Expected: clean + PASS.

- [ ] **Step 6: Commit**

```bash
git add services/src/settlement/circle-gateway.ts services/src/settlement/circle-gateway.test.ts
git commit -m "feat(circle): CircleGatewaySettlementAdapter (pay/fund/reconcile, zero keys)"
```

---

## Task 10: Dual-backend payer resolution in the worker

**Files:**
- Modify: `services/src/worker/settlement-factory.ts`
- Modify: `services/src/worker/index.ts`
- Test: `services/src/worker/settlement-factory.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `services/src/worker/settlement-factory.test.ts`:

```ts
test("a circle payer builds via the circle builder", async () => {
  const built: string[] = [];
  const factory = makeSettlementFactory(
    async () => ({ kind: "circle" as const, walletId: "w1", address: "0xc" }),
    {
      capAtomic: 10n,
      build: () => { built.push("raw"); return {} as any; },
      buildCircle: (payer) => { built.push(`circle:${payer.walletId}`); return {} as any; },
    },
  );
  await factory({ id: "r1", agentId: null, userId: "u1" } as any, 1);
  expect(built).toEqual(["circle:w1"]);
});

test("a raw payer still builds via the raw builder", async () => {
  const built: string[] = [];
  const factory = makeSettlementFactory(
    async () => ({ kind: "raw" as const, signer: { address: "0xa", privateKey: "0xkey" as any } }),
    { capAtomic: 10n, build: () => { built.push("raw"); return {} as any; }, buildCircle: () => { built.push("circle"); return {} as any; } },
  );
  await factory({ id: "r2", agentId: null, userId: "u1" } as any, 1);
  expect(built).toEqual(["raw"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/worker/settlement-factory.test.ts`
Expected: FAIL (LoadSigner returns a signer, not a payer union; no `buildCircle`).

- [ ] **Step 3: Implement the payer union**

Rewrite `services/src/worker/settlement-factory.ts`:

```ts
// services/src/worker/settlement-factory.ts
import type { Rent } from "../domain";
import type { SettlementAdapter } from "../settlement/adapter";
import { GatewaySettlementAdapter } from "../settlement/gateway";
import { CircleGatewaySettlementAdapter } from "../settlement/circle-gateway";
import { makeCircleClient } from "../wallet/circle";
import type { SpendSigner } from "../wallet/store";

export type SettlementFactory = (rent: Rent, maxUnits: number) => Promise<SettlementAdapter>;

// A lease's payer: legacy raw-key wallets keep working while new wallets live at Circle.
export type Payer =
  | { kind: "raw"; signer: SpendSigner }
  | { kind: "circle"; walletId: string; address: string };
export type LoadPayer = (rent: Rent) => Promise<Payer | null>;

type Options = {
  capAtomic: bigint;
  rpcUrl?: string;
  usdcAddress?: string; // required for the circle path
  // Seams so unit tests construct neither a GatewayClient nor a Circle client.
  build?: (signer: SpendSigner, capAtomic: bigint, rpcUrl?: string) => SettlementAdapter;
  buildCircle?: (payer: { walletId: string; address: string }, capAtomic: bigint) => SettlementAdapter;
};

export function makeSettlementFactory(loadPayer: LoadPayer, opts: Options): SettlementFactory {
  const cache = new Map<string, SettlementAdapter>();
  const build =
    opts.build ??
    ((signer, capAtomic, rpcUrl) =>
      new GatewaySettlementAdapter({ privateKey: signer.privateKey, capAtomic, chain: "arcTestnet", rpcUrl }));
  const buildCircle =
    opts.buildCircle ??
    ((payer, capAtomic) => {
      if (!opts.usdcAddress) throw new Error("usdcAddress required for circle-custodied payers");
      return new CircleGatewaySettlementAdapter({
        client: makeCircleClient() as any, walletId: payer.walletId, address: payer.address,
        capAtomic, usdcAddress: opts.usdcAddress,
      });
    });

  return async (rent, _maxUnits) => {
    const existing = cache.get(rent.id);
    if (existing) return existing;
    const payer = await loadPayer(rent);
    if (!payer) throw new Error(`no spend wallet for lease ${rent.id}`);
    const adapter =
      payer.kind === "circle" ? buildCircle(payer, opts.capAtomic) : build(payer.signer, opts.capAtomic, opts.rpcUrl);
    cache.set(rent.id, adapter);
    return adapter;
  };
}
```

- [ ] **Step 4: Fix the existing factory tests' load functions**

The pre-existing cases in `settlement-factory.test.ts` return bare signers; wrap them as `{ kind: "raw", signer }` to satisfy `LoadPayer`.

- [ ] **Step 5: Wire the worker's payer resolution (circle first, raw fallback)**

In `services/src/worker/index.ts`, replace the `settlementFor` construction:

```ts
import { CircleWalletStore, makeCircleClient } from "../wallet/circle";
import type { Payer } from "./settlement-factory";

const circleSetId = process.env.CIRCLE_WALLET_SET_ID;
const circleStore = circleSetId ? new CircleWalletStore(admin, makeCircleClient() as any, circleSetId) : null;

// Circle-custodied wallets win when the principal has one; legacy enc-key wallets keep
// paying for everyone provisioned before the switch. Zero keys for anything new.
const loadPayer = async (rent: Rent): Promise<Payer | null> => {
  const kind = rent.agentId ? ("agent" as const) : ("user" as const);
  const ownerId = rent.agentId ?? rent.userId!;
  if (circleStore) {
    const cw = await circleStore.get(kind, ownerId);
    if (cw) return { kind: "circle", walletId: cw.walletId, address: cw.address };
  }
  const signer = rent.agentId ? await agentStore.loadSigner(rent.agentId) : await userStore.loadSigner(rent.userId!);
  return signer ? { kind: "raw", signer } : null;
};

const settlementFor = makeSettlementFactory(loadPayer, {
  capAtomic: LEASE_CAP_ATOMIC, rpcUrl: process.env.ARC_RPC_URL, usdcAddress: process.env.USDC_ADDRESS,
});
```

(Import `Rent` from `../domain`. No sweep changes needed: fee streaming and the terminal sweep both ride `settlement.payForCompute`, which this factory already resolves per backend.)

- [ ] **Step 6: Run worker tests + type-check both packages**

Run: `cd services && bun test src/worker && bunx tsc --noEmit && cd .. && bunx tsc --noEmit`
Expected: PASS + both clean.

- [ ] **Step 7: Commit**

```bash
git add services/src/worker
git commit -m "feat(circle): worker pays from Circle wallets when the owner has one"
```

---

## Task 11: App-side provisioning + withdraw on the Circle backend

**Files:**
- Modify: `src/lib/marketplace/wallet.ts`
- Modify: `src/lib/agents/store.ts`
- Modify: `src/lib/wallet/server-fns.ts`
- Test: `src/lib/marketplace/wallet.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/marketplace/wallet.test.ts
import { test, expect } from "bun:test";
import { walletProviderFor } from "./wallet";

test("circle backend provisions through the circle store", async () => {
  const calls: string[] = [];
  const provider = walletProviderFor(
    { kind: "agent", id: "a1", walletAddress: "" },
    {
      backend: "circle",
      circle: { getOrCreate: async (kind, id) => { calls.push(`${kind}:${id}`); return { walletId: "w1", address: "0xc" }; } } as any,
      legacy: { getOrCreate: async () => { throw new Error("legacy must not be called"); } } as any,
    },
  );
  const w = await provider.getOrCreate();
  expect(w.address).toBe("0xc");
  expect(calls).toEqual(["agent:a1"]);
});

test("raw backend still provisions through the legacy store", async () => {
  const provider = walletProviderFor(
    { kind: "user", id: "u1", walletAddress: "" },
    {
      backend: "raw",
      circle: { getOrCreate: async () => { throw new Error("circle must not be called"); } } as any,
      legacy: { getOrCreate: async (id: string) => ({ address: `0xlegacy-${id}` }) } as any,
    },
  );
  expect((await provider.getOrCreate()).address).toBe("0xlegacy-u1");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/marketplace/wallet.test.ts`
Expected: FAIL (`walletProviderFor` doesn't exist).

- [ ] **Step 3: Implement the backend switch**

In `src/lib/marketplace/wallet.ts`, keep `walletStoreFor` (legacy callers) and add:

```ts
import { CircleWalletStore, makeCircleClient, type OwnerKind } from "@services/wallet/circle";

export type WalletBackendDeps = {
  backend: "circle" | "raw";
  circle: Pick<CircleWalletStore, "getOrCreate">;
  legacy: { getOrCreate(id: string): Promise<{ address: string }> };
};

// One seam for "give this principal a wallet": Circle-custodied when the backend says so,
// the legacy enc-key store otherwise. Existing wallets are never migrated out from under
// their owner — the worker resolves circle-first per lease, so both coexist.
export function walletProviderFor(principal: Principal, deps: WalletBackendDeps) {
  const kind: OwnerKind = principal.kind;
  return {
    getOrCreate: async (): Promise<{ address: string }> =>
      deps.backend === "circle" ? deps.circle.getOrCreate(kind, principal.id) : deps.legacy.getOrCreate(principal.id),
  };
}

export function liveWalletDeps(principal: Principal): WalletBackendDeps {
  const backend = (process.env.WALLET_BACKEND === "circle" ? "circle" : "raw") as "circle" | "raw";
  const setId = process.env.CIRCLE_WALLET_SET_ID;
  if (backend === "circle" && !setId) throw new Error("WALLET_BACKEND=circle needs CIRCLE_WALLET_SET_ID");
  return {
    backend,
    circle: backend === "circle" ? new CircleWalletStore(supabaseAdmin(), makeCircleClient() as any, setId!) : (null as any),
    legacy: walletStoreFor(principal),
  };
}
```

Change `walletFor` in `src/lib/marketplace/service.ts` to `walletProviderFor(principal, liveWalletDeps(principal)).getOrCreate()`, and `src/lib/agents/store.ts` `createAgent`'s wallet provisioning the same way (its `AgentWallets` seam already takes any `getOrCreate`, so pass the provider's).

- [ ] **Step 4: Withdraw for Circle wallets**

In `src/lib/wallet/server-fns.ts` `withdrawFromSpendWallet`: resolve the principal's wallet backend first — if a `circle_wallets` row exists for the user, withdraw via

```ts
const client = makeCircleClient();
const res: any = await client.createTransaction({
  walletId: cw.walletId,
  tokenAddress: process.env.USDC_ADDRESS!, blockchain: "ARC-TESTNET" as any,
  destinationAddress: data.to, amount: [data.amountUsdc],
  fee: { type: "level", config: { feeLevel: "MEDIUM" } },
});
return { txRef: res.data?.id as string };
```

else fall through to the existing raw-key ERC-20 transfer. (Balance display needs no change: `usdcBalance(address)` is address-based.)

- [ ] **Step 5: Run tests + type-check + build**

Run: `bun test src/lib && bunx tsc --noEmit && bun run build`
Expected: PASS, clean, build green (the Circle SDK must not leak into the client bundle — it's touched only inside server fns; if the build complains, move the circle imports behind dynamic `await import` inside the handlers).

- [ ] **Step 6: Commit**

```bash
git add src/lib/marketplace src/lib/agents/store.ts src/lib/wallet/server-fns.ts
git commit -m "feat(circle): app provisions and withdraws Circle-custodied wallets behind WALLET_BACKEND"
```

---

## Task 12: Live on-chain proof + flip

**Files:**
- Create: `services/scripts/circle-roundtrip.ts`
- Modify: `services/package.json`, `.env.example`, `docs/WORKER_DEPLOY.md`

- [ ] **Step 1: The gated roundtrip script**

```ts
// services/scripts/circle-roundtrip.ts
// Live proof (spends real testnet USDC): a Circle-custodied wallet funds Gateway and pays
// one x402 charge against a local provider. Needs: CIRCLE_* env, CIRCLE_WALLET_ID (funded
// with Arc testnet USDC — faucet to its address first), USDC_ADDRESS.
import { createServer } from "node:http";
import { createProviderApp } from "../src/provider/server";
import { SimulatedExecutor } from "../src/provider/executor";
import { CircleGatewaySettlementAdapter } from "../src/settlement/circle-gateway";
import { makeCircleClient } from "../src/wallet/circle";

const walletId = process.env.CIRCLE_WALLET_ID;
const usdc = process.env.USDC_ADDRESS;
if (!walletId || !usdc) throw new Error("CIRCLE_WALLET_ID and USDC_ADDRESS required");

const client = makeCircleClient();
const wallet: any = await client.getWallet({ id: walletId });
const address = wallet.data?.wallet?.address as string;
console.log("[1] paying from Circle wallet", address);

const app = createProviderApp({
  executor: new SimulatedExecutor(), sellerAddress: process.env.PROVIDER_OWNER_WALLET ?? address,
  price: "$0.0001", platformFeeBps: 100,
  facilitatorUrl: "https://gateway-api-testnet.circle.com", meta: { alias: "circle-rt", resourceType: "GPU", region: "US-East", specs: {} },
});
const server = createServer(app);
await new Promise<void>((r) => server.listen(4111, r));

const adapter = new CircleGatewaySettlementAdapter({
  client: client as any, walletId, address, capAtomic: 10_000n, usdcAddress: usdc,
});
console.log("[2] ensureFunded(1000)…");
console.log(await adapter.ensureFunded(1000n));
console.log("[3] paying one charge…");
const paid = await adapter.payForCompute("http://localhost:4111/compute?session=circle-rt");
console.log("paid:", paid.amountAtomic, "ref:", paid.settlementRef);
console.log("[4] reconcile:", await adapter.reconcile(paid.settlementRef));
server.close();
console.log("✅ Circle-custodied wallet paid a real x402 charge (net of the 1% fee).");
```

Add `"circle:roundtrip": "bun run scripts/circle-roundtrip.ts"` to `services/package.json`.
(Check `SimulatedExecutor`'s constructor/import name against `services/src/provider/executor.ts` and match it.)

- [ ] **Step 2: Run it live (needs a funded wallet — HANDOFF if the faucet is manual)**

Fund the probe wallet (`0x5ad0ccd42fe945aff0c7e64e268f3e82788c2c16`) with Arc testnet USDC, then:
Run: `cd services && bun run circle:roundtrip`
Expected: deposit tx, paid 99 atomic (net of 1%), reconcile returns a status.

- [ ] **Step 3: Flip the backends + document**

Set in root `.env` + `services/.env`: `WALLET_BACKEND=circle`, `CIRCLE_WALLET_SET_ID=<from circle:setup>`, `PLATFORM_TREASURY_ADDRESS=<from circle:setup>`. Mirror all new vars in `.env.example` with comments, and add a "Circle custody" section to `docs/WORKER_DEPLOY.md` (worker env now needs CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_SET_ID, PLATFORM_TREASURY_ADDRESS, USDC_ADDRESS; SPEND_WALLET_ENC_KEY stays until every legacy wallet is drained).

- [ ] **Step 4: Full gates**

Run: `cd services && bun test src && bunx tsc --noEmit && cd .. && bun test src/lib mcp/src && bunx tsc --noEmit && bun run build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add services/scripts/circle-roundtrip.ts services/package.json .env.example docs/WORKER_DEPLOY.md
git commit -m "feat(circle): live roundtrip proof + backend flip to Circle custody"
```

---

## Self-review notes

- **Coverage:** fee ledger + guard + accrual + sweep + net template (Tasks 1-5) implement the agreed fee model (renter pays listed gross, provider bears 1%, treasury swept per terminal rent); signer/dance/adapter/factory/app/proof (Tasks 6-12) implement zero-custody Circle wallets end to end. Dual backend keeps every existing wallet working; nothing migrates keys.
- **Deliberate scope-outs:** draining/retiring legacy raw-key wallets (needs per-user consent + funds movement); provider-side *verification* that a self-hosted endpoint prices at net (spec 2's handshake — until then the per-charge ceiling in Task 2 protects the renter, and a gross-charging endpoint just yields zero fee); mainnet constants (testnet-only everywhere, single flip point in `circle-gateway.ts`).
- **Known judgment calls:** gateway funding uses the gross bound, which is now exactly right — net + fee both flow from the Gateway balance; fee sweep retries each pass until the fee endpoint accepts (terminal rents are few); `gatewayBalance` converts Circle's decimal string via `Number` (6-decimal USDC amounts are well within float precision at testnet scale); the fee endpoint binds on 127.0.0.1 semantics via its own port — on Render it's reachable only by the worker itself, which is the point.
- **Type consistency check:** `Payer`/`LoadPayer` (Task 10) match the worker wiring; `FeeTransfer` (Task 4) matches the `index.ts` builder and the Task 10 circle extension; `CircleSignerApi`/`CircleExecApi` (Tasks 7/9) are subsets the real `CircleClient` satisfies; `feeAmount`/`feesSweptAt` names are identical across domain, registries, meter, and sweep.

## Execution handoff

Ordering note: Tasks 1-5 (fees) and 6-9 (Circle core) are independent; Task 10 depends on both 4 and 9; Tasks 11-12 close it out. Each task ends green and committable.
