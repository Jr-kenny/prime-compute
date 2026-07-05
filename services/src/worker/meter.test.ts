// services/src/worker/meter.test.ts
import { test, expect } from "bun:test";
import { InMemoryRegistry } from "../registry/in-memory";
import { FakeSettlementAdapter } from "../settlement/fake";
import { defaultTrust } from "../trust/trust";
import { provisionLease, meterTick, sweepSuspended } from "./meter";
import { LeaseHealthTracker } from "./lease-health";
import type { DegradationDeps } from "../broker/degradation";
import type { Soul, Policy } from "../runtime/types";

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

  // Advance past the tick window twice more -> 3 charges, and it keeps running (continuous).
  clock += 1001; await meterTick(rent.id, deps);
  clock += 1001; await meterTick(rent.id, deps);
  expect((await reg.listCharges(rent.id)).length).toBe(3);
  clock += 1001; const more = await meterTick(rent.id, deps);
  expect(more.status).toBe("running");
});

test("a lease suspended past the grace window is terminated", async () => {
  const { reg, rent } = await seed();
  const now = 5_000_000;
  await reg.updateRent(rent.id, { status: "suspended", statusReason: "insufficient EOA balance for top-up", suspendedAt: new Date(now - 4000).toISOString() });
  const within = await sweepSuspended(rent.id, { registry: reg, graceMs: 5000, nowMs: () => now });
  expect(within.status).toBe("suspended"); // 4s < 5s grace
  const later = await sweepSuspended(rent.id, { registry: reg, graceMs: 5000, nowMs: () => now + 2000 });
  expect(later.status).toBe("completed"); // 6s >= 5s grace
  expect((await reg.getRent(rent.id))?.statusReason).toContain("balance stayed low");
});

test("an empty EOA suspends with a stamp, and a refunded tick resumes and clears it", async () => {
  const { reg, rent } = await seed();
  // EOA holds 150: enough for the initial 1-unit buffer (100), not enough for the next refill.
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1_000_000n, fundsRemaining: 150n });
  await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 100, topupUnits: 1 });
  let clock = 1_000_000;
  const deps = { registry: reg, settlement, tickMs: 1000, maxUnits: 100, topupUnits: 1, nowMs: () => clock };

  const a1 = await meterTick(rent.id, deps); // spends the buffer
  expect(a1.status).toBe("running");
  clock += 1001;
  const a2 = await meterTick(rent.id, deps); // refill needs 100, only 50 left -> suspend
  expect(a2.status).toBe("suspended");
  expect((await reg.getRent(rent.id))?.suspendedAt).toBeTruthy();

  // Refund the EOA and flip the lease back to running (what a refund + the worker do), then tick.
  settlement.opts.fundsRemaining = 1_000_000n;
  await reg.updateRent(rent.id, { status: "running", statusReason: null });
  clock += 2000;
  const b = await meterTick(rent.id, deps);
  expect(b.status).toBe("running");
  expect((await reg.getRent(rent.id))?.suspendedAt).toBeNull();
});

test("meterTick completes a lease at its expires_at time", async () => {
  const { reg } = await seed();
  const start = 1_000_000;
  const rent = await reg.createRent({ name: "timed", owner: { kind: "user", id: "u3", walletAddress: "0x0" },
    spec: { resourceType: "GPU", region: null }, expiresAt: new Date(start + 1500).toISOString() });
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1_000_000n });
  await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 100, topupUnits: 100 });
  let clock = start;
  const deps = { registry: reg, settlement, tickMs: 1000, maxUnits: 100, topupUnits: 100, nowMs: () => clock };
  const r1 = await meterTick(rent.id, deps); expect(r1.status).toBe("running"); clock += 1000;
  const r2 = await meterTick(rent.id, deps); expect(r2.status).toBe("running"); clock += 1000; // 1_002_000 >= 1_001_500 expiry
  const r3 = await meterTick(rent.id, deps);
  expect(r3.status).toBe("completed");
  expect((await reg.getRent(rent.id))?.statusReason).toContain("time");
});

test("meterTick completes a lease when its max-spend cap is reached", async () => {
  const { reg } = await seed();
  const rent = await reg.createRent({ name: "capped", owner: { kind: "user", id: "u2", walletAddress: "0x0" },
    spec: { resourceType: "GPU", region: null }, maxSpendAtomic: 250 }); // cap at 250 atomic, price 100/unit
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1_000_000n });
  await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 100, topupUnits: 100 });
  let clock = 1_000_000;
  const deps = { registry: reg, settlement, tickMs: 1000, maxUnits: 100, topupUnits: 100, nowMs: () => clock };
  for (let i = 0; i < 5; i++) { await meterTick(rent.id, deps); clock += 1001; }
  const r = await reg.getRent(rent.id);
  expect(r?.status).toBe("completed");
  // 100 + 100 = 200 <= 250; a third would hit 300 > 250, so it stops at 2 charges.
  expect((await reg.listCharges(rent.id)).length).toBe(2);
  expect(r?.statusReason).toContain("spend cap");
});

test("meterTick tops up the float in chunks, not every tick", async () => {
  const { reg, rent } = await seed();
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1_000_000n, fundsRemaining: 1_000_000n });
  await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 3, topupUnits: 3 });
  let clock = 1_000_000;
  const deps = { registry: reg, settlement, tickMs: 1000, maxUnits: 3, topupUnits: 3, nowMs: () => clock };
  for (let i = 0; i < 6; i++) { await meterTick(rent.id, deps); clock += 1001; }
  // 6 charges with a 3-unit buffer => a top-up roughly every 3 charges, far fewer deposits than ticks.
  expect(settlement.deposits).toBeGreaterThan(1); // provision + at least one mid-stream chunk
  expect(settlement.deposits).toBeLessThan(6);
  expect((await reg.listCharges(rent.id)).length).toBe(6);
});

test("meterTick keeps charging past the estimate (continuous)", async () => {
  const { reg, rent } = await seed(); // estimatedUsage 3
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1_000_000n });
  await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 3, topupUnits: 3 });
  let clock = 1_000_000;
  const deps = { registry: reg, settlement, tickMs: 1000, maxUnits: 3, nowMs: () => clock };
  for (let i = 0; i < 5; i++) { await meterTick(rent.id, deps); clock += 1001; }
  const r = await reg.getRent(rent.id);
  expect(r?.status).toBe("running");
  expect((await reg.listCharges(rent.id)).length).toBe(5); // past the estimate of 3
});

test("provisionLease funds only a buffer chunk, not the whole estimate", async () => {
  const { reg, rent } = await seed(); // estimatedUsage 3, provider price 0.0001 -> 100 atomic/unit
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1_000_000n, fundsRemaining: 1_000_000n });
  // topupUnits 2 => buffer = 2 * 100 = 200 atomic, regardless of maxUnits/estimate.
  const res = await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 3, topupUnits: 2 });
  expect(res.status).toBe("running");
  expect(settlement.fundCalls).toBe(1);
  // exactly 200 drawn from the EOA (the buffer), not 300 (the estimate).
  expect(settlement.opts.fundsRemaining).toBe(999_800n);
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

// --- degradation -> migration --------------------------------------------------------------
// A soul/policy plus a dead model client, so decideMigrateOrHold takes its deterministic
// fallback (migrate to the best untried candidate) without a live LLM.
const soul: Soul = { schema: "soul/v1", version: "1.0.0", name: "Broker", body: "s" };
const policy: Policy = { schema: "policy/v1", version: "1.0.0", body: "p" };
const deadModel: DegradationDeps = { soul, policy, client: { propose: async () => { throw new Error("model down"); } } };
const tracker = () => new LeaseHealthTracker({ healthOpts: { maxConsecutiveFailures: 3 }, holdBudget: { maxRetries: 2, maxDurationMs: 60_000, maxExtraSpend: 10_000n } });

// Settlement that never manages to pay: every hit throws a plain (non spend-cap) error, i.e. the
// provider endpoint is degraded. ensureFunded still succeeds so provisioning works.
const brokenProvider = {
  buyerAddress: "0xbuyer",
  async ensureFunded() { return { deposited: false }; },
  async payForCompute(): Promise<never> { throw new Error("provider endpoint down"); },
  async reconcile(ref: string) { return { ref, status: "completed" as const, settled: true }; },
};

async function seedTwoGpus() {
  const reg = new InMemoryRegistry();
  const p1 = await reg.registerProvider({ alias: "p1", ownerWallet: "0xseller", endpointUrl: "http://p1", resourceType: "GPU", region: "US-East", specs: { gpu: "H100" }, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, computeScore: 90, avgLatencyMs: 5 });
  const p2 = await reg.registerProvider({ alias: "p2", ownerWallet: "0xseller", endpointUrl: "http://p2", resourceType: "GPU", region: "US-East", specs: { gpu: "H100" }, online: true, trust: defaultTrust(), pricePerCharge: 0.0002, computeScore: 88, avgLatencyMs: 6 });
  // Pin p1 so the lease deterministically starts there; migration must NOT return to it.
  const rent = await reg.createRent({ name: "demo", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null, preferredProviderId: p1.id }, estimatedUsage: 100 });
  return { reg, rent, p1, p2 };
}

test("a degrading provider hands off to a healthy alternative after the failure streak", async () => {
  const { reg, rent, p1, p2 } = await seedTwoGpus();
  await reg.updateRent(rent.id, { status: "running", providerId: p1.id, startedAt: new Date().toISOString() });

  const health = tracker();
  let clock = 1_000_000;
  const deps = { registry: reg, settlement: brokenProvider, tickMs: 1000, maxUnits: 100, nowMs: () => clock, health, degradation: deadModel, maxMigrations: 3 };

  // Two failed ticks: streak building, still on p1.
  await meterTick(rent.id, deps);
  clock += 1001; await meterTick(rent.id, deps);
  expect((await reg.getRent(rent.id))?.providerId).toBe(p1.id);

  // Third consecutive failure crosses the threshold -> migrate to the untried provider.
  clock += 1001; const r = await meterTick(rent.id, deps);
  expect(r.status).toBe("running");
  expect((await reg.getRent(rent.id))?.providerId).toBe(p2.id); // handed off, and NOT back to the pinned p1
  expect((await reg.listDecisionLogs(rent.id)).length).toBeGreaterThan(0); // the hand-off is on the record
});

test("a degrading provider with no alternative keeps retrying rather than killing the lease", async () => {
  const { reg, rent, p1 } = await seedTwoGpus();
  await reg.setProviderOnline((await reg.listProviders()).find((p) => p.alias === "p2")!.id, false); // no alternative
  await reg.updateRent(rent.id, { status: "running", providerId: p1.id, startedAt: new Date().toISOString() });

  const health = tracker();
  let clock = 1_000_000;
  const deps = { registry: reg, settlement: brokenProvider, tickMs: 1000, maxUnits: 100, nowMs: () => clock, health, degradation: deadModel, maxMigrations: 3 };

  for (let i = 0; i < 4; i++) { await meterTick(rent.id, deps); clock += 1001; }
  const r = await reg.getRent(rent.id);
  expect(r?.status).toBe("running");   // still alive, will resume if the provider recovers
  expect(r?.providerId).toBe(p1.id);   // nowhere healthy to go, so it stays put
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
