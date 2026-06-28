import { test, expect } from "bun:test";
import { matchProviders, deterministicRank } from "./matching";
import { InMemoryRegistry } from "../registry/in-memory";
import type { NewProvider } from "../registry/registry";

const base: Omit<NewProvider, "alias" | "resourceType" | "region" | "online" | "stakeAmount" | "pricePerCharge" | "computeScore"> = {
  ownerWallet: "0x0",
  endpointUrl: "http://x",
  specs: {},
  avgLatencyMs: 5,
};

async function seed() {
  const reg = new InMemoryRegistry();
  await reg.registerProvider({ ...base, alias: "A", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.000006, computeScore: 70 });
  await reg.registerProvider({ ...base, alias: "B", resourceType: "GPU", region: "EU-West", online: true, stakeAmount: 100, pricePerCharge: 0.000004, computeScore: 92 });
  await reg.registerProvider({ ...base, alias: "C", resourceType: "GPU", region: "US-East", online: false, stakeAmount: 100, pricePerCharge: 0.000003, computeScore: 99 });
  await reg.registerProvider({ ...base, alias: "D", resourceType: "CPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.000002, computeScore: 80 });
  return reg;
}

test("matchProviders filters then ranks; picks the best GPU and excludes offline/wrong-type", async () => {
  const reg = await seed();
  const result = await matchProviders(reg, { resourceType: "GPU", region: null }, deterministicRank);
  expect(result.chosen?.alias).toBe("B"); // cheaper + higher score than A; C offline; D is CPU
  const aliases = result.candidates.length;
  expect(aliases).toBe(2); // A and B only
  expect(result.rationale).toBeTruthy();
});

test("matchProviders returns chosen null when nothing matches", async () => {
  const reg = await seed();
  const result = await matchProviders(reg, { resourceType: "Storage", region: null }, deterministicRank);
  expect(result.chosen).toBeNull();
  expect(result.candidates).toEqual([]);
});

test("a throwing rank strategy falls back to the deterministic scorer", async () => {
  const reg = await seed();
  const boom = async () => { throw new Error("model down"); };
  const result = await matchProviders(reg, { resourceType: "GPU", region: null }, boom);
  expect(result.chosen?.alias).toBe("B"); // still ranked by the fallback
  expect(result.rationale).toMatch(/fell back/);
});
