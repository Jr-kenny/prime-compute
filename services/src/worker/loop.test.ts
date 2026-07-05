// services/src/worker/loop.test.ts
import { test, expect } from "bun:test";
import { InMemoryRegistry } from "../registry/in-memory";
import { FakeSettlementAdapter } from "../settlement/fake";
import { defaultTrust } from "../trust/trust";
import { workerPass } from "./loop";

test("a pass meters running leases concurrently, so one slow lease doesn't serialize the fleet", async () => {
  const reg = new InMemoryRegistry();
  await reg.registerProvider({
    alias: "p1", ownerWallet: "0xseller", endpointUrl: "http://localhost:1", resourceType: "GPU",
    region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001,
    computeScore: 90, avgLatencyMs: 5,
  });
  const providerId = (await reg.listProviders())[0]!.id;

  // Five leases already running, each paying through a settlement whose pay() takes a beat.
  for (let i = 0; i < 5; i++) {
    const r = await reg.createRent({ name: `lease-${i}`, owner: { kind: "user", id: `u${i}`, walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
    await reg.updateRent(r.id, { status: "running", providerId, startedAt: new Date().toISOString() });
  }

  // Instrumented settlement: track how many pay() calls overlap. Sequential => always 1.
  let inFlight = 0;
  let maxInFlight = 0;
  const settlement = {
    buyerAddress: "0xbuyer",
    async ensureFunded() { return { deposited: false }; },
    async payForCompute() {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((res) => setTimeout(res, 5));
      inFlight--;
      return { amountAtomic: 100n, settlementRef: "ref", data: {}, status: 200 };
    },
    async reconcile(ref: string) { return { ref, status: "completed" as const, settled: true }; },
  };

  await workerPass({ registry: reg, settlementFor: async () => settlement, tickMs: 1000, defaultMaxUnits: 100, nowMs: () => 5 });

  expect(maxInFlight).toBeGreaterThan(1); // leases metered in parallel, not one-at-a-time
});

test("a queued lease provisions then charges continuously across passes, past its estimatedUsage", async () => {
  const reg = new InMemoryRegistry();
  await reg.registerProvider({
    alias: "p1", ownerWallet: "0xseller", endpointUrl: "http://localhost:1", resourceType: "GPU",
    region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001,
    computeScore: 90, avgLatencyMs: 5,
  });
  await reg.createRent({ name: "demo", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null }, estimatedUsage: 2 });

  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 10_000n });
  let clock = 1_000_000;
  const deps = {
    registry: reg,
    settlementFor: async () => settlement,
    tickMs: 1000,
    defaultMaxUnits: 100,
    nowMs: () => clock,
  };

  await workerPass(deps); // provisions, then charges its first unit
  clock += 1001;
  await workerPass(deps); // second unit
  clock += 1001;
  await workerPass(deps); // third unit -> keeps running (continuous, no hard stop at the estimate)

  const rents = await reg.listRents({ userId: "u1" });
  expect(rents[0]?.status).toBe("running");
  expect((await reg.listCharges(rents[0]!.id)).length).toBe(3);
});
