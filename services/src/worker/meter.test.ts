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

test("charges pending whole units per tick for a volume service", async () => {
  const reg = new InMemoryRegistry();
  await reg.registerProvider({
    alias: "vpn1", ownerWallet: "0xseller", endpointUrl: "http://localhost:9", resourceType: "VPN",
    region: "EU", specs: { exitLocation: "NL", protocol: "WireGuard", bandwidthMbps: 1000, region: "EU" },
    online: true, trust: defaultTrust(), pricePerCharge: 0.02, computeScore: 90, avgLatencyMs: 5,
  });
  const rent = await reg.createRent({
    name: "vpn", owner: { kind: "user", id: "u1", walletAddress: "0x0" },
    spec: { resourceType: "VPN", region: null }, estimatedUsage: 100,
  });
  await reg.updateRent(rent.id, { status: "running", providerId: (await reg.listProviders())[0]!.id, startedAt: new Date().toISOString() });

  const calls = { n: 0 };
  const settlement = {
    buyerAddress: "0xbuyer",
    async ensureFunded() { return { deposited: false }; },
    async payForCompute(_url: string) { calls.n++; return { amountAtomic: 20n, settlementRef: `ref-${calls.n}`, data: {}, status: 200 }; },
    async reconcile(ref: string) { return { ref, status: "completed", settled: true }; },
  };

  const accrued = 3; // provider /usage reports 3 GB transferred this session
  let clock = 1_000_000;
  const deps = { registry: reg, settlement, tickMs: 1000, maxUnits: 100, nowMs: () => clock, perTickCap: 10, readUsage: async () => accrued };

  const first = await meterTick(rent.id, deps);
  expect(first.charged).toBe(true);
  expect(calls.n).toBe(3); // 3 GB -> 3 paid hits
  expect((await reg.listCharges(rent.id)).length).toBe(3);

  // Next tick, no new transfer accrued -> nothing pending, no charge.
  clock += 1001;
  const second = await meterTick(rent.id, deps);
  expect(second.charged).toBe(false);
  expect(calls.n).toBe(3);
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
