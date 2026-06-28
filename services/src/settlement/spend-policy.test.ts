import { test, expect } from "bun:test";
import { checkSpend, SpendCapError } from "./spend-policy";

test("allows a charge that stays within the cap", () => {
  expect(checkSpend({ nextAtomic: 100n, spentAtomic: 0n, capAtomic: 1000n })).toEqual({ ok: true });
});

test("allows a charge that exactly reaches the cap", () => {
  expect(checkSpend({ nextAtomic: 100n, spentAtomic: 900n, capAtomic: 1000n })).toEqual({ ok: true });
});

test("rejects a charge that would exceed the cap", () => {
  const d = checkSpend({ nextAtomic: 101n, spentAtomic: 900n, capAtomic: 1000n });
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.reason).toMatch(/exceed/);
});

test("rejects a non-positive charge", () => {
  expect(checkSpend({ nextAtomic: 0n, spentAtomic: 0n, capAtomic: 1000n }).ok).toBe(false);
  expect(checkSpend({ nextAtomic: -5n, spentAtomic: 0n, capAtomic: 1000n }).ok).toBe(false);
});

test("SpendCapError carries the reason", () => {
  const err = new SpendCapError("over the cap");
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe("SpendCapError");
  expect(err.message).toBe("over the cap");
});
