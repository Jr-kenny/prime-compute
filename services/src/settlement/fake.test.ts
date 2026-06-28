import { test, expect } from "bun:test";
import { FakeSettlementAdapter } from "./fake";
import { SpendCapError } from "./spend-policy";

test("payForCompute returns an amount + settlement ref and increments spend", async () => {
  const a = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 250n });
  const first = await a.payForCompute("http://provider/compute");
  expect(first.amountAtomic).toBe(100n);
  expect(first.settlementRef).toBeTruthy();
  expect(first.status).toBe(200);
});

test("payForCompute throws SpendCapError once the cap would be exceeded", async () => {
  const a = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 250n });
  await a.payForCompute("u"); // 100
  await a.payForCompute("u"); // 200
  await expect(a.payForCompute("u")).rejects.toBeInstanceOf(SpendCapError); // 300 > 250
});

test("ensureFunded is a no-op for the fake", async () => {
  const a = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 250n });
  expect(await a.ensureFunded(100n)).toEqual({ deposited: false });
});

test("reconcile reports settled for a known ref", async () => {
  const a = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 250n });
  const { settlementRef } = await a.payForCompute("u");
  const s = await a.reconcile(settlementRef);
  expect(s.settled).toBe(true);
  expect(s.ref).toBe(settlementRef);
});

test("buyerAddress is exposed", () => {
  const a = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 250n });
  expect(a.buyerAddress).toBe("0xFAKEBUYER");
});
