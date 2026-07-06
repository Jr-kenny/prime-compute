// src/lib/marketplace/service.test.ts
import { test, expect } from "bun:test";
import { InMemoryRegistry } from "@services/registry/in-memory";
import { defaultTrust } from "@services/trust/trust";
import type { Principal } from "@services/domain";
import { createRentFor, listRentsFor, getRentFor, cancelRentFor, registerProviderFor, listMyProvidersFor, setProviderOnlineFor, delistProviderFor } from "./service";

const agent: Principal = { kind: "agent", id: "agent-1", walletAddress: "0xAGENT" };
const other: Principal = { kind: "agent", id: "agent-2", walletAddress: "0xOTHER" };

test("createRentFor + listRentsFor scope to the principal", async () => {
  const reg = new InMemoryRegistry();
  const rent = await createRentFor(reg, agent, { name: "j", spec: { resourceType: "GPU", region: null } });
  expect(rent.agentId).toBe("agent-1");
  expect((await listRentsFor(reg, agent)).map((r) => r.id)).toEqual([rent.id]);
  expect(await listRentsFor(reg, other)).toEqual([]);
});

test("createRentFor forwards optional spend/time caps to the registry", async () => {
  const reg = new InMemoryRegistry();
  const rent = await createRentFor(reg, agent, {
    name: "capped", spec: { resourceType: "GPU", region: null }, maxSpendAtomic: 5000, expiresAt: "2030-01-01T00:00:00.000Z",
  });
  expect(rent.maxSpendAtomic).toBe(5000);
  expect(rent.expiresAt).toBe("2030-01-01T00:00:00.000Z");
});

test("getRentFor / cancelRentFor enforce ownership", async () => {
  const reg = new InMemoryRegistry();
  const rent = await createRentFor(reg, agent, { name: "j", spec: { resourceType: "GPU", region: null } });
  expect((await getRentFor(reg, agent, rent.id))?.id).toBe(rent.id);
  expect(await getRentFor(reg, other, rent.id)).toBeNull();
  await expect(cancelRentFor(reg, other, rent.id)).rejects.toThrow(/not your rent/);
  const cancelled = await cancelRentFor(reg, agent, rent.id);
  expect(cancelled.status).toBe("cancelled");
});

test("registerProviderFor sets ownerWallet + listMyProvidersFor filters by it", async () => {
  const reg = new InMemoryRegistry();
  const p = await registerProviderFor(reg, agent, {
    alias: "a1", endpointUrl: "http://x", resourceType: "GPU", region: "US-East",
    specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 5,
  });
  expect(p.ownerWallet).toBe("0xAGENT");
  expect((await listMyProvidersFor(reg, agent)).map((x) => x.id)).toEqual([p.id]);
  expect(await listMyProvidersFor(reg, other)).toEqual([]);
});

test("setProviderOnlineFor persists the toggle and enforces ownership", async () => {
  const reg = new InMemoryRegistry();
  const p = await registerProviderFor(reg, agent, {
    alias: "a1", endpointUrl: "http://x", resourceType: "GPU", region: "US-East",
    specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 5,
  });
  await expect(setProviderOnlineFor(reg, other, p.id, false)).rejects.toThrow(/not your server/);
  await setProviderOnlineFor(reg, agent, p.id, false);
  expect((await reg.getProvider(p.id))?.online).toBe(false);
  // offline listings drop out of matching (onlineOnly) but stay on the owner's board
  expect(await reg.listProviders({ onlineOnly: true })).toEqual([]);
  expect((await listMyProvidersFor(reg, agent)).map((x) => x.id)).toEqual([p.id]);
});

test("delistProviderFor blocks while leases are active, then hides the listing", async () => {
  const reg = new InMemoryRegistry();
  const p = await registerProviderFor(reg, agent, {
    alias: "a1", endpointUrl: "http://x", resourceType: "GPU", region: "US-East",
    specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 5,
  });
  const rent = await createRentFor(reg, other, { name: "j", spec: { resourceType: "GPU", region: null } });
  await reg.updateRent(rent.id, { status: "running", providerId: p.id });

  await expect(delistProviderFor(reg, other, p.id)).rejects.toThrow(/not your server/);
  await expect(delistProviderFor(reg, agent, p.id)).rejects.toThrow(/1 active lease/);

  await reg.updateRent(rent.id, { status: "completed" });
  await delistProviderFor(reg, agent, p.id);
  // gone from every listing surface, but history lookups still resolve
  expect(await reg.listProviders()).toEqual([]);
  expect(await listMyProvidersFor(reg, agent)).toEqual([]);
  expect((await reg.getProvider(p.id))?.alias).toBe("a1");
});
