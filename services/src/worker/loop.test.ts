// services/src/worker/loop.test.ts
import { test, expect } from "bun:test";
import { InMemoryRegistry } from "../registry/in-memory";
import { FakeSettlementAdapter } from "../settlement/fake";
import { defaultTrust } from "../trust/trust";
import { workerPass } from "./loop";

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
