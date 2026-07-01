// src/lib/broker/rent-phase.test.ts
import { test, expect } from "bun:test";
import { rentPhase } from "./rent-phase";
import type { Rent, Provider } from "@services/domain";
import { defaultTrust } from "@services/trust/trust";

function rent(partial: Partial<Rent>): Rent {
  return {
    id: "r1", name: "n", userId: "u1", spec: { resourceType: "GPU", region: null },
    estimatedUsage: null, autonomyArmed: false, status: "queued", providerId: null,
    totalCost: 0, createdAt: "", startedAt: null, endedAt: null,
    lastChargedAt: null, leaseAccessToken: null, ...partial,
  };
}

const provider: Provider = {
  id: "p1", alias: "p", ownerWallet: "0x", endpointUrl: "http://localhost:1", resourceType: "GPU",
  region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001,
  computeScore: 90, avgLatencyMs: 5,
};

test("queued is non-terminal and cannot connect", () => {
  const p = rentPhase(rent({ status: "queued" }), provider);
  expect(p.phase).toBe("queued");
  expect(p.terminal).toBe(false);
  expect(p.canConnect).toBe(false);
});

test("running with a token and a provider can connect", () => {
  const p = rentPhase(rent({ status: "running", leaseAccessToken: "tok" }), provider);
  expect(p.phase).toBe("running");
  expect(p.canConnect).toBe(true);
  expect(p.terminal).toBe(false);
});

test("running cannot connect when the provider is gone", () => {
  const p = rentPhase(rent({ status: "running", leaseAccessToken: "tok" }), undefined);
  expect(p.canConnect).toBe(false); // rent still shown, just not connectable
});

test("running cannot connect without a token yet", () => {
  const p = rentPhase(rent({ status: "running", leaseAccessToken: null }), provider);
  expect(p.canConnect).toBe(false);
});

test("suspended is non-terminal and points at the wallet", () => {
  const p = rentPhase(rent({ status: "suspended" }), provider);
  expect(p.phase).toBe("suspended");
  expect(p.terminal).toBe(false);
  expect(p.description.toLowerCase()).toContain("top up");
});

test("paused is handled (non-terminal, no connect)", () => {
  const p = rentPhase(rent({ status: "paused" }), provider);
  expect(p.phase).toBe("paused");
  expect(p.terminal).toBe(false);
  expect(p.canConnect).toBe(false);
});

test("terminal statuses are terminal and cannot connect", () => {
  for (const status of ["completed", "cancelled", "failed"] as const) {
    const p = rentPhase(rent({ status }), provider);
    expect(p.phase).toBe(status);
    expect(p.terminal).toBe(true);
    expect(p.canConnect).toBe(false);
  }
});
