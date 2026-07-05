import { test, expect } from "bun:test";
import { reclaimFor } from "./reclaim";

test("reclaimFor withdraws (available - feeBuffer) via the circle path", async () => {
  const calls: { amount?: bigint; recipient?: string } = {};
  const res = await reclaimFor({
    address: "0xME",
    feeBufferAtomic: 5000n,
    readFloat: async () => 20_000n,
    circle: { withdraw: async (amount: bigint, recipient: string) => ((calls.amount = amount), (calls.recipient = recipient), "0xTX") },
  });
  expect(calls.amount).toBe(15_000n); // 20000 available - 5000 fee buffer
  expect(calls.recipient).toBe("0xME");
  expect(res).toEqual({ txHash: "0xTX", amountAtomic: "15000" });
});

test("reclaimFor uses the raw path when no circle executor is supplied", async () => {
  let used = "";
  const res = await reclaimFor({
    address: "0xME",
    feeBufferAtomic: 1000n,
    readFloat: async () => 5000n,
    raw: { withdraw: async () => ((used = "raw"), "0xRAW") },
  });
  expect(used).toBe("raw");
  expect(res).toEqual({ txHash: "0xRAW", amountAtomic: "4000" });
});

test("reclaimFor no-ops when the float is at or below the fee buffer", async () => {
  const res = await reclaimFor({
    address: "0xME",
    feeBufferAtomic: 5000n,
    readFloat: async () => 4000n,
    circle: { withdraw: async () => "should-not-run" },
  });
  expect(res).toEqual({ txHash: null, amountAtomic: "0" });
});

test("reclaimFor throws when no backend executor is available", async () => {
  await expect(reclaimFor({ address: "0xME", feeBufferAtomic: 1000n, readFloat: async () => 5000n })).rejects.toThrow(/no reclaim backend/);
});
