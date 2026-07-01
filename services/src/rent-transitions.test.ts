import { test, expect } from "bun:test";
import { canPause, canResume, canCancel } from "./rent-transitions";
import type { Rent, RentStatus } from "./domain";

function rentWithStatus(status: RentStatus): Rent {
  return {
    id: "r1",
    name: "test-rent",
    userId: "u1",
    agentId: null,
    spec: { resourceType: "GPU", region: null },
    estimatedUsage: null,
    autonomyArmed: false,
    status,
    providerId: null,
    totalCost: 0,
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    lastChargedAt: null,
    leaseAccessToken: null,
  };
}

function rent(status: Rent["status"]): Rent {
  return rentWithStatus(status);
}

test("a suspended lease can be resumed", () => {
  expect(canResume(rent("suspended"))).toBe(true);
  expect(canResume(rent("paused"))).toBe(true);
  expect(canResume(rent("running"))).toBe(false);
});

test("canPause is true only for running", () => {
  expect(canPause(rentWithStatus("running"))).toBe(true);
  for (const status of ["queued", "paused", "completed", "cancelled", "failed"] as RentStatus[]) {
    expect(canPause(rentWithStatus(status))).toBe(false);
  }
});

test("canResume is true only for paused", () => {
  expect(canResume(rentWithStatus("paused"))).toBe(true);
  for (const status of ["queued", "running", "completed", "cancelled", "failed"] as RentStatus[]) {
    expect(canResume(rentWithStatus(status))).toBe(false);
  }
});

test("canCancel is true for queued, running, and paused; false for terminal states", () => {
  for (const status of ["queued", "running", "paused"] as RentStatus[]) {
    expect(canCancel(rentWithStatus(status))).toBe(true);
  }
  for (const status of ["completed", "cancelled", "failed"] as RentStatus[]) {
    expect(canCancel(rentWithStatus(status))).toBe(false);
  }
});
