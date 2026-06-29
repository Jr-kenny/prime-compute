import { test, expect } from "bun:test";
import { RetryLeash, type RetryBudget } from "./budget";

const budget: RetryBudget = { maxRetries: 3, maxDurationMs: 1000, maxExtraSpend: 500n };

test("approves while all three budgets remain", () => {
  let t = 0;
  const leash = new RetryLeash(budget, () => t);
  expect(leash.tryConsume(100n).ok).toBe(true); // 1 retry, 100 spent, t=0
  t = 100;
  expect(leash.tryConsume(100n).ok).toBe(true); // 2 retries, 200 spent
});

test("denies when retries run out", () => {
  let t = 0;
  const leash = new RetryLeash({ ...budget, maxRetries: 1 }, () => t);
  expect(leash.tryConsume(1n).ok).toBe(true);
  const d = leash.tryConsume(1n);
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.reason).toMatch(/retries/);
});

test("denies when extra-spend would be exceeded", () => {
  const leash = new RetryLeash({ ...budget, maxExtraSpend: 150n }, () => 0);
  expect(leash.tryConsume(100n).ok).toBe(true); // 100 <= 150
  const d = leash.tryConsume(100n); // would be 200 > 150
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.reason).toMatch(/spend/);
});

test("denies when the duration window has passed", () => {
  let t = 0;
  const leash = new RetryLeash({ ...budget, maxDurationMs: 500 }, () => t);
  expect(leash.tryConsume(1n).ok).toBe(true);
  t = 600; // past the window
  const d = leash.tryConsume(1n);
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.reason).toMatch(/duration/);
});
