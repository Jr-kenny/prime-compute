// src/lib/marketplace/service.test.ts
import { test, expect } from "bun:test";
import { InMemoryRegistry } from "@services/registry/in-memory";
import { defaultTrust } from "@services/trust/trust";
import type { Principal } from "@services/domain";
import { createRentFor, listRentsFor, getRentFor, cancelRentFor, registerProviderFor, listMyProvidersFor } from "./service";

const agent: Principal = { kind: "agent", id: "agent-1", walletAddress: "0xAGENT" };
const other: Principal = { kind: "agent", id: "agent-2", walletAddress: "0xOTHER" };

test("createRentFor + listRentsFor scope to the principal", async () => {
  const reg = new InMemoryRegistry();
  const rent = await createRentFor(reg, agent, { name: "j", spec: { resourceType: "GPU", region: null } });
  expect(rent.agentId).toBe("agent-1");
  expect((await listRentsFor(reg, agent)).map((r) => r.id)).toEqual([rent.id]);
  expect(await listRentsFor(reg, other)).toEqual([]);
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
