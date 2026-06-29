import { test, expect } from "bun:test";
import { revalidateProvider } from "./guardrails";
import type { Provider } from "../domain";
import { defaultTrust } from "../trust/trust";

const ok: Provider = {
  id: "p", alias: "n", ownerWallet: "0x0", endpointUrl: "http://x", resourceType: "GPU",
  region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.000006,
  computeScore: 90, avgLatencyMs: 5,
};

test("passes a healthy, in-tier, matching provider", () => {
  expect(revalidateProvider(ok, { resourceType: "GPU", region: null })).toEqual({ ok: true });
});

test("rejects an offline provider", () => {
  expect(revalidateProvider({ ...ok, online: false }, { resourceType: "GPU", region: null }).ok).toBe(false);
});

test("rejects a provider below the required trust tier", () => {
  const d = revalidateProvider(ok, { resourceType: "GPU", region: null, requiredTrustTier: "Bonded" });
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.reason).toMatch(/tier/);
});

test("rejects a resource-type or region mismatch", () => {
  expect(revalidateProvider(ok, { resourceType: "CPU", region: null }).ok).toBe(false);
  expect(revalidateProvider(ok, { resourceType: "GPU", region: "EU-West" }).ok).toBe(false);
});
