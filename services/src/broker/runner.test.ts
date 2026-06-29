import { test, expect } from "bun:test";
import { runRent } from "./runner";
import { InMemoryRegistry } from "../registry/in-memory";
import { FakeSettlementAdapter } from "../settlement/fake";
import type { NewProvider } from "../registry/registry";
import type { SettlementAdapter, PaidCompute, SettlementStatus } from "../settlement/adapter";

const base: Pick<NewProvider, "ownerWallet" | "endpointUrl" | "specs" | "avgLatencyMs"> = {
  ownerWallet: "0x0", endpointUrl: "http://prov", specs: {}, avgLatencyMs: 5,
};

async function seeded() {
  const reg = new InMemoryRegistry();
  await reg.registerProvider({ ...base, alias: "A", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 95 });
  const rent = await reg.createRent({ name: "train", userId: "u1", spec: { resourceType: "GPU", region: null }, autonomyArmed: true });
  return { reg, rent };
}

test("happy path: records a decision, streams, finalizes completed with exact cost", async () => {
  const { reg, rent } = await seeded();
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  const result = await runRent(rent.id, { registry: reg, settlement }, { maxUnits: 3 });
  expect(result.stoppedBy).toBe("maxUnits");
  const finalized = await reg.getRent(rent.id);
  expect(finalized?.status).toBe("completed");
  expect(finalized?.providerId).toBeTruthy();
  expect(finalized?.totalCost).toBe(300);
});

test("cancel finalizes the rent as cancelled", async () => {
  const { reg, rent } = await seeded();
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  let n = 0;
  const result = await runRent(rent.id, { registry: reg, settlement }, { maxUnits: 100, shouldStop: () => n++ >= 1 });
  expect(result.stoppedBy).toBe("cancel");
  expect((await reg.getRent(rent.id))?.status).toBe("cancelled");
});

test("no matching provider fails the rent without spending", async () => {
  const reg = new InMemoryRegistry();
  const rent = await reg.createRent({ name: "x", userId: "u1", spec: { resourceType: "Storage", region: null } });
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  const result = await runRent(rent.id, { registry: reg, settlement }, { maxUnits: 3 });
  expect(result.stoppedBy).toBe("no-provider");
  expect((await reg.getRent(rent.id))?.status).toBe("failed");
  expect(await reg.rentCost(rent.id)).toBe(0);
});

test("autonomy: finalizes failed when the only provider degrades with no alternative", async () => {
  const reg = new InMemoryRegistry();
  await reg.registerProvider({ ...base, alias: "A", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 95 });
  const rent = await reg.createRent({ name: "x", userId: "u1", spec: { resourceType: "GPU", region: null }, autonomyArmed: true });

  // An adapter that always throws a non-cap error: the provider never serves.
  const failing: SettlementAdapter = {
    buyerAddress: "0xB",
    async ensureFunded() { return { deposited: false }; },
    async payForCompute(): Promise<PaidCompute> { throw new Error("402 not honored"); },
    async reconcile(ref): Promise<SettlementStatus> { return { ref, status: "unknown", settled: false }; },
  };

  const result = await runRent(rent.id, { registry: reg, settlement: failing }, { maxUnits: 5, maxMigrations: 1 });
  expect(result.stoppedBy).toBe("no-alternative");
  expect((await reg.getRent(rent.id))?.status).toBe("failed");
  expect(await reg.rentCost(rent.id)).toBe(0);
});
