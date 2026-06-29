import { test, expect } from "bun:test";
import { hardFilter, scoreProviders } from "./scoring";
import type { Provider, RentSpec } from "./domain";
import { defaultTrust } from "./trust/trust";

const base = { alias: "n", ownerWallet: "0x0", endpointUrl: "http://x", specs: {} };
const providers: Provider[] = [
  { id: "A", ...base, resourceType: "GPU", region: "US-East", online: true, trust: defaultTrust(), pricePerCharge: 0.000006, computeScore: 70, avgLatencyMs: 5 },
  { id: "B", ...base, resourceType: "GPU", region: "EU-West", online: true, trust: defaultTrust(), pricePerCharge: 0.000004, computeScore: 92, avgLatencyMs: 8 },
  { id: "C", ...base, resourceType: "GPU", region: "US-East", online: false, trust: defaultTrust(), pricePerCharge: 0.000003, computeScore: 99, avgLatencyMs: 4 },
  { id: "D", ...base, resourceType: "CPU", region: "US-East", online: true, trust: defaultTrust(), pricePerCharge: 0.000002, computeScore: 80, avgLatencyMs: 4 },
];

const spec: RentSpec = { resourceType: "GPU", region: null };

test("hardFilter drops offline and wrong-type providers", () => {
  const kept = hardFilter(providers, spec).map((p) => p.id);
  expect(kept).toEqual(["A", "B"]); // C offline, D wrong type
});

test("hardFilter drops providers below the required trust tier", () => {
  const mixed: Provider[] = [
    { id: "lo", ...base, resourceType: "GPU", region: "US-East", online: true, trust: defaultTrust("Community"), pricePerCharge: 0.000004, computeScore: 90, avgLatencyMs: 5 },
    { id: "hi", ...base, resourceType: "GPU", region: "US-East", online: true, trust: defaultTrust("Bonded"), pricePerCharge: 0.000006, computeScore: 80, avgLatencyMs: 5 },
  ];
  const kept = hardFilter(mixed, { resourceType: "GPU", region: null, requiredTrustTier: "Bonded" }).map((p) => p.id);
  expect(kept).toEqual(["hi"]); // Community is below Bonded
});

test("scoreProviders ranks by a weighted blend (cheaper + higher score first)", () => {
  const ranked = scoreProviders(hardFilter(providers, spec), spec).map((p) => p.id);
  expect(ranked[0]).toBe("B"); // cheaper and higher score than A
});
