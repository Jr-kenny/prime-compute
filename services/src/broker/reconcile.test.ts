import { test, expect } from "bun:test";
import { reconcileRent } from "./reconcile";
import { InMemoryRegistry } from "../registry/in-memory";
import { FakeSettlementAdapter } from "../settlement/fake";

test("reconcileRent marks settled charges and counts them", async () => {
  const reg = new InMemoryRegistry();
  const rent = await reg.createRent({ name: "r", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
  // Two charges recorded optimistically (settled: false), with refs the fake knows.
  const a = await reg.recordCharge({ rentId: rent.id, providerId: "p", seq: 0, units: 1, amount: 100, feeAmount: 0, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: "fake-settlement-0" });
  const b = await reg.recordCharge({ rentId: rent.id, providerId: "p", seq: 1, units: 1, amount: 100, feeAmount: 0, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: "fake-settlement-1" });

  // A fake adapter that reports refs it has issued as settled.
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1000n });
  await settlement.payForCompute("u"); // issues fake-settlement-0
  await settlement.payForCompute("u"); // issues fake-settlement-1

  const settledCount = await reconcileRent(reg, settlement, rent.id);
  expect(settledCount).toBe(2);
  const charges = await reg.listCharges(rent.id);
  expect(charges.every((c) => c.settled)).toBe(true);
  expect([a.id, b.id].length).toBe(2);
});

test("reconcileRent leaves unsettled charges alone", async () => {
  const reg = new InMemoryRegistry();
  const rent = await reg.createRent({ name: "r", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
  await reg.recordCharge({ rentId: rent.id, providerId: "p", seq: 0, units: 1, amount: 100, feeAmount: 0, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: "never-issued" });
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 1000n });
  const settledCount = await reconcileRent(reg, settlement, rent.id);
  expect(settledCount).toBe(0);
  expect((await reg.listCharges(rent.id))[0]?.settled).toBe(false);
});
