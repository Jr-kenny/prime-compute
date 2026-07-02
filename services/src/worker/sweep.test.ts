// services/src/worker/sweep.test.ts
import { test, expect } from "bun:test";
import { InMemoryRegistry } from "../registry/in-memory";
import { defaultTrust } from "../trust/trust";
import { sweepFees, type PayFee } from "./sweep";

async function terminalRent(reg: InMemoryRegistry, fees: { amount: number; ref: string | null }[]) {
  const provider = await reg.registerProvider({
    alias: "p", ownerWallet: "0xs", endpointUrl: "http://x", resourceType: "GPU", region: "US-East",
    specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 1,
  });
  const rent = await reg.createRent({ name: "r", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
  let seq = 0;
  for (const f of fees) {
    await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: seq++, amount: 99, feeAmount: f.amount, feeSettlementRef: f.ref, authorizationRef: null, settled: false, settlementRef: null });
  }
  await reg.updateRent(rent.id, { status: "completed", endedAt: new Date().toISOString() });
  return rent;
}

test("sweepFees pays only the outstanding fee ticks and stamps everything", async () => {
  const reg = new InMemoryRegistry();
  // One fee tick streamed live (ref set), two missed (ref null).
  const rent = await terminalRent(reg, [{ amount: 1, ref: "live-1" }, { amount: 1, ref: null }, { amount: 2, ref: null }]);
  const paid: bigint[] = [];
  const payFee: PayFee = async (_rent, atomic) => { paid.push(atomic); return "sweep-ref"; };

  const first = await sweepFees(rent.id, { registry: reg, payFee });
  expect(first.swept).toBe(true);
  expect(paid).toEqual([3n]); // only the missed ticks, as one payment
  const charges = await reg.listCharges(rent.id);
  expect(charges.map((c) => c.feeSettlementRef)).toEqual(["live-1", "sweep-ref", "sweep-ref"]);
  expect((await reg.getRent(rent.id))?.feesSweptAt).toBeTruthy();

  const second = await sweepFees(rent.id, { registry: reg, payFee });
  expect(second.swept).toBe(false); // idempotent
  expect(paid.length).toBe(1);
});

test("all fees already streamed -> just stamps, no payment; non-terminal -> skipped", async () => {
  const reg = new InMemoryRegistry();
  const done = await terminalRent(reg, [{ amount: 1, ref: "live-1" }]);
  const payFee: PayFee = async () => { throw new Error("must not pay"); };
  const r = await sweepFees(done.id, { registry: reg, payFee });
  expect(r.swept).toBe(false);
  expect((await reg.getRent(done.id))?.feesSweptAt).toBeTruthy();

  const running = await reg.createRent({ name: "r2", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
  await reg.updateRent(running.id, { status: "running" });
  expect((await sweepFees(running.id, { registry: reg, payFee })).swept).toBe(false);
});

test("a failed sweep payment leaves refs + stamp unset (retry next pass)", async () => {
  const reg = new InMemoryRegistry();
  const rent = await terminalRent(reg, [{ amount: 5, ref: null }]);
  const payFee: PayFee = async () => { throw new Error("gateway down"); };
  const r = await sweepFees(rent.id, { registry: reg, payFee });
  expect(r.swept).toBe(false);
  expect((await reg.listCharges(rent.id))[0]?.feeSettlementRef).toBeNull();
  expect((await reg.getRent(rent.id))?.feesSweptAt).toBeNull();
});
