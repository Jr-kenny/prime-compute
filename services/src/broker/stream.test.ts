import { test, expect } from "bun:test";
import { streamRent } from "./stream";
import { InMemoryRegistry } from "../registry/in-memory";
import { FakeSettlementAdapter } from "../settlement/fake";
import type { SettlementAdapter, PaidCompute, SettlementStatus } from "../settlement/adapter";
import type { Provider, Rent } from "../domain";

const provider: Provider = {
  id: "p1", alias: "n", ownerWallet: "0x0", endpointUrl: "http://prov", resourceType: "GPU",
  region: "US-East", specs: {}, online: true, stakeAmount: 100, pricePerCharge: 0.0001,
  computeScore: 90, avgLatencyMs: 5,
};

async function makeRent(reg: InMemoryRegistry): Promise<Rent> {
  return reg.createRent({ name: "r", userId: "u1", spec: { resourceType: "GPU", region: null } });
}

test("streams maxUnits, records a charge each, cost is exact", async () => {
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  const result = await streamRent(rent, provider, { registry: reg, settlement }, { maxUnits: 3 });
  expect(result.units).toBe(3);
  expect(result.stoppedBy).toBe("maxUnits");
  expect(await reg.rentCost(rent.id)).toBe(300);
  expect((await reg.listCharges(rent.id)).length).toBe(3);
});

test("stops cleanly when the spend cap is hit, cost stays exact", async () => {
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 250n });
  const result = await streamRent(rent, provider, { registry: reg, settlement }, { maxUnits: 10 });
  expect(result.stoppedBy).toBe("cap");
  expect(result.units).toBe(2); // 100 + 100 = 200; third would breach 250
  expect(await reg.rentCost(rent.id)).toBe(200);
});

test("cancel stops within one unit", async () => {
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  let n = 0;
  const result = await streamRent(rent, provider, { registry: reg, settlement }, {
    maxUnits: 100,
    shouldStop: () => n++ >= 2, // allow 2 units, then cancel
  });
  expect(result.stoppedBy).toBe("cancel");
  expect(result.units).toBe(2);
});

test("a persistently failing provider trips unhealthy and stops", async () => {
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  // An adapter whose payForCompute always throws a non-cap error (x402 failure).
  const failing: SettlementAdapter = {
    buyerAddress: "0xB",
    async ensureFunded() { return { deposited: false }; },
    async payForCompute(): Promise<PaidCompute> { throw new Error("402 not honored"); },
    async reconcile(ref): Promise<SettlementStatus> { return { ref, status: "unknown", settled: false }; },
  };
  const result = await streamRent(rent, provider, { registry: reg, settlement: failing }, { maxUnits: 100 });
  expect(result.stoppedBy).toBe("unhealthy");
  expect(result.units).toBe(0); // never paid
  expect((await reg.listCharges(rent.id)).length).toBe(0);
});

test("startSeq continues charge numbering from a previous leg", async () => {
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  const result = await streamRent(rent, provider, { registry: reg, settlement }, { maxUnits: 2, startSeq: 5 });
  expect(result.units).toBe(2);
  const seqs = (await reg.listCharges(rent.id)).map((c) => c.seq);
  expect(seqs).toEqual([5, 6]);
});
