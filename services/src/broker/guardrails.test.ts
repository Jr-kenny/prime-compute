import { test, expect } from "bun:test";
import { revalidateProvider } from "./guardrails";
import type { Provider } from "../domain";

const ok: Provider = {
  id: "p", alias: "n", ownerWallet: "0x0", endpointUrl: "http://x", resourceType: "GPU",
  region: "US-East", specs: {}, online: true, stakeAmount: 100, pricePerCharge: 0.000006,
  computeScore: 90, avgLatencyMs: 5,
};

test("passes a healthy, staked, matching provider", () => {
  expect(revalidateProvider(ok, { resourceType: "GPU", region: null })).toEqual({ ok: true });
});

test("rejects an offline provider", () => {
  expect(revalidateProvider({ ...ok, online: false }, { resourceType: "GPU", region: null }).ok).toBe(false);
});

test("rejects a provider with no active stake", () => {
  const d = revalidateProvider({ ...ok, stakeAmount: 0 }, { resourceType: "GPU", region: null });
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.reason).toMatch(/stake/);
});

test("rejects a resource-type or region mismatch", () => {
  expect(revalidateProvider(ok, { resourceType: "CPU", region: null }).ok).toBe(false);
  expect(revalidateProvider(ok, { resourceType: "GPU", region: "EU-West" }).ok).toBe(false);
});
