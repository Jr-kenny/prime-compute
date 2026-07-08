// services/src/worker/meter.test.ts
import { test, expect } from "bun:test";
import { InMemoryRegistry } from "../registry/in-memory";
import { FakeSettlementAdapter } from "../settlement/fake";
import { FakeNetworkAdapter } from "../network/fake";
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

test("provisionLease mints network access and stores hostname", async () => {
  const { reg, rent } = await seed();
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 10_000n });
  const net = new FakeNetworkAdapter();
  const res = await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 3, network: net });
  expect(res.status).toBe("running");
  const r = await reg.getRent(rent.id);
  expect(r?.leaseAccessToken).toBe(`tskey-${rent.id}`);
  expect(r?.networkHostname).toBe(`box-${r?.providerId}`);
  expect(r?.networkStatus).toBe("provisioned");
});

test("provisionLease fails soft when the network service is down", async () => {
  const { reg, rent } = await seed();
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 10_000n });
  const net = new FakeNetworkAdapter({ failMint: true });
  const res = await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 3, network: net });
  expect(res.status).toBe("running"); // lease still opens and will charge
  const r = await reg.getRent(rent.id);
  expect(r?.networkStatus).toBe("unprovisioned");
  expect(r?.leaseAccessToken).toBeTruthy(); // fell back to a plain token
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

test("a time lease bills for elapsed wall-clock, firing the nanopayments the time owes (not one per worker pass)", async () => {
  const { reg, rent } = await seed(); // provider price 0.0001 -> 100 atomic/unit
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1_000_000n, fundsRemaining: 1_000_000n });
  await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 100, topupUnits: 100 });

  let clock = 1_000_000;
  const deps = { registry: reg, settlement, tickMs: 1000, maxUnits: 100, topupUnits: 100, nowMs: () => clock, perTickCap: 100 };

  // First tick bootstraps one unit and stamps the billing watermark at "now".
  await meterTick(rent.id, deps);
  expect((await reg.listCharges(rent.id)).length).toBe(1);

  // Under load the worker's next pass only reaches this lease 5s later. Five seconds of a
  // per-second lease owes five units on this pass, not one — carried by ONE batched payment.
  clock += 5000;
  await meterTick(rent.id, deps);

  // 1 (bootstrap) + 5 (the elapsed catch-up) = 6 units * 100 atomic, across 2 payments.
  expect(await reg.billedUnits(rent.id)).toBe(6);
  expect(await reg.rentCost(rent.id)).toBe(600);
  const charges = await reg.listCharges(rent.id);
  expect(charges.length).toBe(2); // bootstrap + one batch, not five separate nanopayments
  expect(charges[1]?.units).toBe(5);
  expect(charges[1]?.seq).toBe(1); // contiguous: batch starts at the unit after bootstrap
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

test("a transient funding error (rate limit) does NOT suspend a running lease", async () => {
  const { reg, rent } = await seed();
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1_000_000n });
  await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 100, topupUnits: 1 });
  let clock = 1_000_000;
  const deps = { registry: reg, settlement, tickMs: 1000, maxUnits: 100, topupUnits: 1, nowMs: () => clock };
  await meterTick(rent.id, deps); // bootstrap charge, healthy

  // The next refill boundary hits a Circle rate limit / on-chain blip instead of a dry wallet.
  // The lease must stay running and retry, not park in suspended where nothing resumes it.
  const flaky = {
    ...settlement,
    buyerAddress: settlement.buyerAddress,
    ensureFunded: async () => { throw new Error("API rate limit error"); },
    payForCompute: settlement.payForCompute.bind(settlement),
    reconcile: settlement.reconcile.bind(settlement),
  };
  clock += 1001;
  const res = await meterTick(rent.id, { ...deps, settlement: flaky });
  expect(res.status).toBe("running");
  expect((await reg.getRent(rent.id))?.status).toBe("running");

  // Once the blip clears, the next tick charges normally again.
  clock += 1001;
  const recovered = await meterTick(rent.id, deps);
  expect(recovered.status).toBe("running");
  expect(recovered.charged).toBe(true);
});

test("a transient funding error during provisioning leaves the rent queued for retry", async () => {
  const { reg, rent } = await seed();
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1_000_000n });
  const flaky = {
    ...settlement,
    buyerAddress: settlement.buyerAddress,
    ensureFunded: async () => { throw new Error("contract execution approve(address,uint256) FAILED: FAILED_ON_ONCHAIN"); },
    payForCompute: settlement.payForCompute.bind(settlement),
    reconcile: settlement.reconcile.bind(settlement),
  };
  const res = await provisionLease(rent.id, { registry: reg, settlement: flaky, maxUnits: 3 });
  expect(res.status).toBe("queued");
  expect((await reg.getRent(rent.id))?.status).toBe("queued");
  // And with the blip gone, the same rent provisions fine.
  const ok = await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 3 });
  expect(ok.status).toBe("running");
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

test("reaching the spend cap revokes network access", async () => {
  const { reg } = await seed();
  const rent = await reg.createRent({ name: "capped", owner: { kind: "user", id: "u2", walletAddress: "0x0" },
    spec: { resourceType: "GPU", region: null }, maxSpendAtomic: 250 });
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1_000_000n });
  const net = new FakeNetworkAdapter();
  await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 100, topupUnits: 100, network: net });
  expect(net.granted.has(rent.id)).toBe(true); // granted at open
  let clock = 1_000_000;
  const deps = { registry: reg, settlement, tickMs: 1000, maxUnits: 100, topupUnits: 100, nowMs: () => clock, network: net };
  for (let i = 0; i < 5; i++) { await meterTick(rent.id, deps); clock += 1001; }
  const r = await reg.getRent(rent.id);
  expect(r?.status).toBe("completed");
  expect(net.revoked).toContain(rent.id); // revoked at close
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

test("one batched nanopayment carries exactly the seconds owed, at exactly the listed price", async () => {
  const { reg, rent } = await seed(); // price 0.0001 -> 100 atomic per second
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1_000_000n, fundsRemaining: 1_000_000n });
  await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 100, topupUnits: 100 });
  let clock = 1_000_000;
  const deps = { registry: reg, settlement, tickMs: 1000, maxUnits: 100, topupUnits: 100, nowMs: () => clock, perTickCap: 60 };

  await meterTick(rent.id, deps); // bootstrap second
  clock += 30_000;                // the worker is away for 30s of real usage
  await meterTick(rent.id, deps);

  // The renter owes exactly 31 seconds and pays exactly 31 * 100 atomic — via 2 payments,
  // not 31. Same total, same provider earnings, meter keeps up at any fleet size.
  expect(await reg.billedUnits(rent.id)).toBe(31);
  expect(await reg.rentCost(rent.id)).toBe(3100);
  expect((await reg.listCharges(rent.id)).length).toBe(2);
});

test("a provider demanding more than the batch is worth is refused at the signing seam", async () => {
  const { reg, rent } = await seed(); // listed price 100 atomic/unit
  // Endpoint answers the 402 dance asking DOUBLE the batch's worth. The per-call ceiling
  // (units * listed price) must abort before anything is signed.
  const greedy = new FakeSettlementAdapter({ pricePerChargeAtomic: 200n, capAtomic: 1_000_000n });
  await reg.updateRent(rent.id, { status: "running", providerId: (await reg.listProviders())[0]!.id, startedAt: new Date().toISOString() });
  const res = await meterTick(rent.id, { registry: reg, settlement: greedy, tickMs: 1000, maxUnits: 10, nowMs: () => 5 });
  expect(res.charged).toBe(false);
  expect(res.status).toBe("suspended"); // SpendCapError path: refused, nothing paid
  expect(await reg.billedUnits(rent.id)).toBe(0);
});

test("a catch-up tick that jumps past the top-up boundary still refills the float", async () => {
  const { reg, rent } = await seed(); // price 100 atomic/unit
  // EOA rich, float buffer of 3 units. Old modulo trigger only refilled when the charge count sat
  // EXACTLY on a multiple of 3; a multi-unit catch-up tick skips those and the float starved.
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1_000_000n, fundsRemaining: 1_000_000n });
  await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 3, topupUnits: 3 });
  let clock = 1_000_000;
  const deps = { registry: reg, settlement, tickMs: 1000, maxUnits: 3, topupUnits: 3, nowMs: () => clock, perTickCap: 10 };

  await meterTick(rent.id, deps); // bootstrap: 1 charge, float has 2 units left
  const depositsAfterBootstrap = settlement.deposits;

  // The next pass reaches this lease 8s late: 8 units owed, jumping the count from 1 straight
  // past the 3-unit boundary. Crossing detection must refill; the skipped-multiple bug starved
  // the float here and the payments failed while the lease still said "running".
  clock += 8000;
  const r = await meterTick(rent.id, deps);
  expect(r.status).toBe("running");
  expect(r.charged).toBe(true);
  expect(settlement.deposits).toBeGreaterThan(depositsAfterBootstrap); // the boundary crossing refilled
  expect(await reg.billedUnits(rent.id)).toBe(9); // 1 bootstrap + 8 catch-up, none dropped
  expect(await reg.rentCost(rent.id)).toBe(900);
});

test("a catch-up tick cannot bill past the spend cap", async () => {
  const { reg } = await seed();
  // Cap allows 2 units at 100 atomic each (250 total). A 10s catch-up owes 10 units; only the
  // capped remainder may be billed, never the whole backlog.
  const rent = await reg.createRent({ name: "capped-catchup", owner: { kind: "user", id: "u9", walletAddress: "0x0" },
    spec: { resourceType: "GPU", region: null }, maxSpendAtomic: 250 });
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1_000_000n });
  await provisionLease(rent.id, { registry: reg, settlement, maxUnits: 100, topupUnits: 100 });
  let clock = 1_000_000;
  const deps = { registry: reg, settlement, tickMs: 1000, maxUnits: 100, topupUnits: 100, nowMs: () => clock, perTickCap: 10 };

  await meterTick(rent.id, deps); // bootstrap: 100 spent, cap has room for exactly 1 more
  clock += 10_000;
  await meterTick(rent.id, deps); // owes 10, may bill only 1
  expect(await reg.rentCost(rent.id)).toBe(200); // never past 250
  expect((await reg.listCharges(rent.id)).length).toBe(2);
  clock += 1001;
  const r = await meterTick(rent.id, deps); // next unit would cross the cap -> completed
  expect(r.status).toBe("completed");
});

test("a pay failure caused by a dry float is not blamed on the provider", async () => {
  const { reg, rent, p1 } = await seedTwoGpus();
  await reg.updateRent(rent.id, { status: "running", providerId: p1.id, startedAt: new Date().toISOString() });

  // pay() always fails, but every failure probe finds the float needed (and got) a refill:
  // that's a funding-shaped failure. The provider's health streak must NOT build, so no
  // migration fires no matter how many ticks pass.
  const fundingStarved = {
    buyerAddress: "0xbuyer",
    async ensureFunded() { return { deposited: true, depositTxHash: "0xdep" }; },
    async payForCompute(): Promise<never> { throw new Error("insufficient gateway balance"); },
    async reconcile(ref: string) { return { ref, status: "completed" as const, settled: true }; },
  };
  const health = tracker();
  let clock = 1_000_000;
  const deps = { registry: reg, settlement: fundingStarved, tickMs: 1000, maxUnits: 100, nowMs: () => clock, health, degradation: deadModel, maxMigrations: 3 };

  for (let i = 0; i < 5; i++) { await meterTick(rent.id, deps); clock += 1001; }
  const r = await reg.getRent(rent.id);
  expect(r?.status).toBe("running");
  expect(r?.providerId).toBe(p1.id); // still on the original provider: our wallet was the problem
  expect((await reg.listDecisionLogs(rent.id)).length).toBe(0); // no migrate/hold ever considered
});

test("a pay failure with a dry EOA behind it suspends with the grace stamp", async () => {
  const { reg, rent, p1 } = await seedTwoGpus();
  await reg.updateRent(rent.id, { status: "running", providerId: p1.id, startedAt: new Date().toISOString() });

  // pay() fails AND the refill probe throws: the wallet is empty end-to-end. That's the same
  // balance-suspend as the pre-loop top-up path, not a provider health sample.
  const dryWallet = {
    buyerAddress: "0xbuyer",
    async ensureFunded(): Promise<{ deposited: boolean }> { throw new Error("insufficient EOA balance for top-up"); },
    async payForCompute(): Promise<never> { throw new Error("insufficient gateway balance"); },
    async reconcile(ref: string) { return { ref, status: "completed" as const, settled: true }; },
  };
  // topupUnits unset here, so the pre-loop refill is keyed off maxUnits; use a count that's past
  // the first boundary so the failure surfaces inside the pay loop, exercising the catch path.
  await reg.updateRent(rent.id, { lastChargedAt: new Date(1_000_000 - 1001).toISOString() });
  const r = await meterTick(rent.id, { registry: reg, settlement: dryWallet, tickMs: 1000, maxUnits: 100, topupUnits: 0, nowMs: () => 1_000_000 });
  expect(r.status).toBe("suspended");
  const after = await reg.getRent(rent.id);
  expect(after?.status).toBe("suspended");
  expect(after?.suspendedAt).toBeTruthy(); // grace timer armed, sweepSuspended can act on it
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
    async payForCompute(url: string) {
      calls.n++;
      const units = BigInt(url.match(/[?&]units=(\d+)/)?.[1] ?? "1"); // one payment worth N units
      return { amountAtomic: 20n * units, settlementRef: `ref-${calls.n}`, data: {}, status: 200 };
    },
    async reconcile(ref: string) { return { ref, status: "completed", settled: true }; },
  };

  const accrued = 3; // provider /usage reports 3 GB transferred this session
  let clock = 1_000_000;
  const deps = { registry: reg, settlement, tickMs: 1000, maxUnits: 100, nowMs: () => clock, perTickCap: 10, readUsage: async () => accrued };

  const first = await meterTick(rent.id, deps);
  expect(first.charged).toBe(true);
  expect(calls.n).toBe(1); // 3 GB -> ONE batched payment worth 3 units
  expect(await reg.billedUnits(rent.id)).toBe(3);
  expect(await reg.rentCost(rent.id)).toBe(60); // 3 units * 20 atomic

  // Next tick, no new transfer accrued -> nothing pending, no charge.
  clock += 1001;
  const second = await meterTick(rent.id, deps);
  expect(second.charged).toBe(false);
  expect(calls.n).toBe(1); // still just the one payment; nothing new accrued
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
