import { test, expect } from "bun:test";
import { createFeeRemitter } from "./remitter";

function seams() {
  const withdrawn: bigint[] = [];
  const reported: { txHash: string; amountAtomic: bigint }[] = [];
  return {
    withdrawn, reported,
    withdraw: async (amountAtomic: bigint) => { withdrawn.push(amountAtomic); return { txHash: `0xtx${withdrawn.length}` }; },
    report: async (r: { txHash: string; amountAtomic: bigint }) => { reported.push(r); },
  };
}

test("accrues bps of each payment and flushes at the threshold", async () => {
  const s = seams();
  const r = createFeeRemitter({ feeBps: 100, thresholdAtomic: 3n, withdraw: s.withdraw, report: s.report });
  await r.onPayment(100n); // fee 1
  await r.onPayment(100n); // fee 2 — still below threshold
  expect(s.withdrawn).toEqual([]);
  await r.onPayment(100n); // fee 3 — threshold hit
  expect(s.withdrawn).toEqual([3n]);
  expect(s.reported).toEqual([{ txHash: "0xtx1", amountAtomic: 3n }]);
  expect(r.accrued()).toBe(0n);
});

test("flush() remits any positive accrual; a no-op when zero", async () => {
  const s = seams();
  const r = createFeeRemitter({ feeBps: 100, thresholdAtomic: 1_000_000n, withdraw: s.withdraw, report: s.report });
  await r.onPayment(100n); // fee 1, below threshold
  await r.flush();
  expect(s.withdrawn).toEqual([1n]);
  await r.flush(); // nothing accrued now
  expect(s.withdrawn).toEqual([1n]);
});

test("a failed withdraw restores the accrual for a later retry", async () => {
  const s = seams();
  const failing = { ...s, withdraw: async () => { throw new Error("gateway down"); } };
  const r = createFeeRemitter({ feeBps: 100, thresholdAtomic: 1n, withdraw: failing.withdraw, report: s.report });
  await r.onPayment(200n); // fee 2, threshold hit, withdraw fails
  expect(r.accrued()).toBe(2n); // restored, not lost
  expect(s.reported).toEqual([]);
});

test("a withdraw that succeeds but fails to report is re-reported on the next flush", async () => {
  const s = seams();
  let failReports = true;
  const report = async (x: { txHash: string; amountAtomic: bigint }) => {
    if (failReports) throw new Error("platform unreachable");
    return s.report(x);
  };
  const r = createFeeRemitter({ feeBps: 100, thresholdAtomic: 1n, withdraw: s.withdraw, report });
  await r.onPayment(200n); // withdraws 2n, report fails -> queued
  expect(s.withdrawn).toEqual([2n]);
  expect(s.reported).toEqual([]);
  failReports = false;
  await r.flush(); // no new accrual, but the pending report drains
  expect(s.reported).toEqual([{ txHash: "0xtx1", amountAtomic: 2n }]);
});

test("zero fee bps never accrues or withdraws", async () => {
  const s = seams();
  const r = createFeeRemitter({ feeBps: 0, thresholdAtomic: 1n, withdraw: s.withdraw, report: s.report });
  await r.onPayment(1_000_000n);
  await r.flush();
  expect(s.withdrawn).toEqual([]);
});
