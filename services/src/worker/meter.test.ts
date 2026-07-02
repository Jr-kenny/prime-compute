// services/src/worker/meter.test.ts
import { test, expect } from "bun:test";
import { InMemoryRegistry } from "../registry/in-memory";
import { FakeSettlementAdapter } from "../settlement/fake";
import { defaultTrust } from "../trust/trust";
import { provisionLease, meterTick } from "./meter";

async function seed() {
  const reg = new InMemoryRegistry();
  await reg.registerProvider({
    alias: "p1", ownerWallet: "0xseller", endpointUrl: "http://localhost:1", resourceType: "GPU",
    region: "US-East", specs: { gpu: "H100" }, online: true, trust: defaultTrust(),
    pricePerCharge: 0.0001, computeScore: 90, avgLatencyMs: 5,
  });
  const rent = await reg.createRent({ name: "demo", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null }, estimatedUsage: 3 });
  return { reg, rent };
}

test("provisionLease matches a provider and flips the lease to running", async () => {
  const { reg, rent } = await seed();
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 10_000n });
  const res = await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 3 });
  expect(res.status).toBe("running");
  const r = await reg.getRent(rent.id);
  expect(r?.status).toBe("running");
  expect(r?.providerId).toBeTruthy();
  expect(r?.leaseAccessToken).toBeTruthy();
});

test("meterTick charges one unit and stamps lastChargedAt, completing at the budget", async () => {
  const { reg, rent } = await seed();
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 10_000n });
  await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 3 });

  let clock = 1_000_000;
  const deps = { registry: reg, settlement, tickMs: 1000, maxUnits: 3, nowMs: () => clock };

  const a = await meterTick(rent.id, deps);
  expect(a.charged).toBe(true);
  expect((await reg.listCharges(rent.id)).length).toBe(1);

  // Same instant: rate-limited, no second charge.
  const b = await meterTick(rent.id, deps);
  expect(b.charged).toBe(false);
  expect((await reg.listCharges(rent.id)).length).toBe(1);

  // Advance past the tick window twice more -> 3 charges, then completes at the budget.
  clock += 1001; await meterTick(rent.id, deps);
  clock += 1001; await meterTick(rent.id, deps);
  expect((await reg.listCharges(rent.id)).length).toBe(3);
  clock += 1001; const done = await meterTick(rent.id, deps);
  expect(done.status).toBe("completed");
  expect((await reg.getRent(rent.id))?.status).toBe("completed");
});

test("meterTick suspends on a spend-cap stop", async () => {
  const { reg, rent } = await seed();
  // cap below one charge -> FakeSettlementAdapter throws SpendCapError on payForCompute.
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 0n });
  await reg.updateRent(rent.id, { status: "running", providerId: (await reg.listProviders())[0]!.id, startedAt: new Date().toISOString() });
  const res = await meterTick(rent.id, { registry: reg, settlement, tickMs: 1000, maxUnits: 3, nowMs: () => 5 });
  expect(res.status).toBe("suspended");
  expect((await reg.getRent(rent.id))?.status).toBe("suspended");
});

// A settlement fake that returns scripted amounts per payForCompute call (or throws when
// the scripted entry is an Error), recording the urls it was asked to pay.
function fakeSettlementSeq(urls: string[], results: (bigint | Error)[]) {
  let i = 0;
  return {
    buyerAddress: "0xbuyer",
    async ensureFunded() { return { deposited: false }; },
    async payForCompute(url: string) {
      urls.push(url);
      const r = results[i++];
      if (r === undefined) throw new Error("fakeSettlementSeq exhausted");
      if (r instanceof Error) throw r;
      return { amountAtomic: r, settlementRef: `ref-${i}`, data: {}, status: 200 };
    },
    async reconcile(ref: string) { return { ref, status: "completed", settled: true }; },
  };
}

test("meterTick streams the fee as its own nano-payment and records both refs", async () => {
  const { reg, rent } = await seed(); // gross = 100 atomic
  await reg.updateRent(rent.id, { status: "running", providerId: (await reg.listProviders())[0]!.id, startedAt: new Date().toISOString() });
  const paidUrls: string[] = [];
  const settlement = fakeSettlementSeq(paidUrls, [99n, 1n]); // provider net, then the fee
  const r = await meterTick(rent.id, { registry: reg, settlement, tickMs: 1000, maxUnits: 10, nowMs: () => 5, feeBaseUrl: "http://worker:9999" });
  expect(r.charged).toBe(true);
  const [charge] = await reg.listCharges(rent.id);
  expect(charge?.amount).toBe(99);
  expect(charge?.feeAmount).toBe(1);
  expect(charge?.feeSettlementRef).toBeTruthy();
  expect(paidUrls[1]).toBe("http://worker:9999/fee/1");
  expect((await reg.getRent(rent.id))?.totalCost).toBe(100); // renter sees gross
});

test("a failed fee payment doesn't block the provider stream; ref stays null for the sweep", async () => {
  const { reg, rent } = await seed();
  await reg.updateRent(rent.id, { status: "running", providerId: (await reg.listProviders())[0]!.id, startedAt: new Date().toISOString() });
  const settlement = fakeSettlementSeq([], [99n, new Error("fee endpoint down")]);
  const r = await meterTick(rent.id, { registry: reg, settlement, tickMs: 1000, maxUnits: 10, nowMs: () => 5, feeBaseUrl: "http://worker:9999" });
  expect(r.charged).toBe(true);
  const [charge] = await reg.listCharges(rent.id);
  expect(charge?.feeAmount).toBe(1);
  expect(charge?.feeSettlementRef).toBeNull();
});

test("zero fee (legacy gross endpoint) skips the fee payment entirely", async () => {
  const { reg, rent } = await seed();
  await reg.updateRent(rent.id, { status: "running", providerId: (await reg.listProviders())[0]!.id, startedAt: new Date().toISOString() });
  const paidUrls: string[] = [];
  const settlement = fakeSettlementSeq(paidUrls, [100n]);
  await meterTick(rent.id, { registry: reg, settlement, tickMs: 1000, maxUnits: 10, nowMs: () => 5, feeBaseUrl: "http://worker:9999" });
  expect((await reg.listCharges(rent.id))[0]?.feeAmount).toBe(0);
  expect(paidUrls.length).toBe(1); // no second payment for a zero fee
});
