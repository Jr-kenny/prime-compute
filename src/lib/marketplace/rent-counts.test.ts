// src/lib/marketplace/rent-counts.test.ts
import { test, expect } from "bun:test";
import { tallyRentsByProvider } from "./rent-counts";

test("tallyRentsByProvider counts rents per provider and ignores unmatched ones", () => {
  const counts = tallyRentsByProvider([
    { providerId: "p1" },
    { providerId: "p1" },
    { providerId: "p2" },
    { providerId: null },
    { providerId: undefined },
  ]);
  expect(counts).toEqual({ p1: 2, p2: 1 });
});

test("tallyRentsByProvider is empty for no rents", () => {
  expect(tallyRentsByProvider([])).toEqual({});
});
