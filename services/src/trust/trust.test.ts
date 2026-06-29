import { test, expect } from "bun:test";
import { TIERS, DEFAULT_TIER, meetsTier, defaultTrust } from "./trust";

test("TIERS go from open to strongest and DEFAULT_TIER is the open one", () => {
  expect(TIERS).toEqual(["Community", "Verified", "Bonded", "Enterprise"]);
  expect(DEFAULT_TIER).toBe("Community");
});

test("meetsTier: equal and higher pass, lower fails", () => {
  expect(meetsTier("Community", "Community")).toBe(true);
  expect(meetsTier("Bonded", "Verified")).toBe(true);
  expect(meetsTier("Enterprise", "Community")).toBe(true);
  expect(meetsTier("Community", "Verified")).toBe(false);
  expect(meetsTier("Verified", "Bonded")).toBe(false);
});

test("defaultTrust builds a Community profile with neutral signals", () => {
  const t = defaultTrust();
  expect(t.tier).toBe("Community");
  expect(t.signals).toEqual({ uptime: 1, successfulRentals: 0, health: "healthy", verification: false });
});

test("defaultTrust accepts a tier override and returns a fresh object each call", () => {
  expect(defaultTrust("Bonded").tier).toBe("Bonded");
  expect(defaultTrust()).not.toBe(defaultTrust());
});
