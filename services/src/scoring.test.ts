import { test, expect } from "bun:test";
import { hardFilter, scoreProviders } from "./scoring";
import type { Provider, RentSpec } from "./domain";

const base = { alias: "n", ownerWallet: "0x0", endpointUrl: "http://x", specs: {} };
const providers: Provider[] = [
  { id: "A", ...base, resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.000006, computeScore: 70, avgLatencyMs: 5 },
  { id: "B", ...base, resourceType: "GPU", region: "EU-West", online: true, stakeAmount: 100, pricePerCharge: 0.000004, computeScore: 92, avgLatencyMs: 8 },
  { id: "C", ...base, resourceType: "GPU", region: "US-East", online: false, stakeAmount: 100, pricePerCharge: 0.000003, computeScore: 99, avgLatencyMs: 4 },
  { id: "D", ...base, resourceType: "CPU", region: "US-East", online: true, stakeAmount: 0, pricePerCharge: 0.000002, computeScore: 80, avgLatencyMs: 4 },
];

const job: RentSpec = { resourceType: "GPU", region: null };

test("hardFilter drops offline, wrong-type, and unstaked providers", () => {
  const kept = hardFilter(providers, job).map((p) => p.id);
  expect(kept).toEqual(["A", "B"]); // C offline, D wrong type + no stake
});

test("scoreProviders ranks by a weighted blend (cheaper + higher score first)", () => {
  const ranked = scoreProviders(hardFilter(providers, job), job).map((p) => p.id);
  expect(ranked[0]).toBe("B"); // cheaper and higher score than A
});
