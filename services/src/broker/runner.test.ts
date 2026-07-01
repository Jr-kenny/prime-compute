import { test, expect } from "bun:test";
import { defaultTrust } from "../trust/trust";
import { runRent } from "./runner";
import { InMemoryRegistry } from "../registry/in-memory";
import { FakeSettlementAdapter } from "../settlement/fake";
import type { NewProvider } from "../registry/registry";
import type { SettlementAdapter, PaidCompute, SettlementStatus } from "../settlement/adapter";

const base: Pick<NewProvider, "ownerWallet" | "endpointUrl" | "specs" | "avgLatencyMs"> = {
  ownerWallet: "0x0", endpointUrl: "http://prov", specs: {}, avgLatencyMs: 5,
};

async function seeded() {
  const reg = new InMemoryRegistry();
  await reg.registerProvider({ ...base, alias: "A", resourceType: "GPU", region: "US-East", online: true, trust: defaultTrust(), pricePerCharge: 0.0001, computeScore: 95 });
  const rent = await reg.createRent({ name: "train", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null }, autonomyArmed: true });
  return { reg, rent };
}

test("happy path: records a decision, streams, finalizes completed with exact cost", async () => {
  const { reg, rent } = await seeded();
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  const result = await runRent(rent.id, { registry: reg, settlement }, { maxUnits: 3 });
  expect(result.stoppedBy).toBe("maxUnits");
  const finalized = await reg.getRent(rent.id);
  expect(finalized?.status).toBe("completed");
  expect(finalized?.providerId).toBeTruthy();
  expect(finalized?.totalCost).toBe(300);
});

test("cancel finalizes the rent as cancelled", async () => {
  const { reg, rent } = await seeded();
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  let n = 0;
  const result = await runRent(rent.id, { registry: reg, settlement }, { maxUnits: 100, shouldStop: () => n++ >= 1 });
  expect(result.stoppedBy).toBe("cancel");
  expect((await reg.getRent(rent.id))?.status).toBe("cancelled");
});

test("no matching provider fails the rent without spending", async () => {
  const reg = new InMemoryRegistry();
  const rent = await reg.createRent({ name: "x", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "Storage", region: null } });
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  const result = await runRent(rent.id, { registry: reg, settlement }, { maxUnits: 3 });
  expect(result.stoppedBy).toBe("no-provider");
  expect((await reg.getRent(rent.id))?.status).toBe("failed");
  expect(await reg.rentCost(rent.id)).toBe(0);
});

test("autonomy: finalizes failed when the only provider degrades with no alternative", async () => {
  const reg = new InMemoryRegistry();
  await reg.registerProvider({ ...base, alias: "A", resourceType: "GPU", region: "US-East", online: true, trust: defaultTrust(), pricePerCharge: 0.0001, computeScore: 95 });
  const rent = await reg.createRent({ name: "x", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null }, autonomyArmed: true });

  // An adapter that always throws a non-cap error: the provider never serves.
  const failing: SettlementAdapter = {
    buyerAddress: "0xB",
    async ensureFunded() { return { deposited: false }; },
    async payForCompute(): Promise<PaidCompute> { throw new Error("402 not honored"); },
    async reconcile(ref): Promise<SettlementStatus> { return { ref, status: "unknown", settled: false }; },
  };

  const result = await runRent(rent.id, { registry: reg, settlement: failing }, { maxUnits: 5, maxMigrations: 1 });
  expect(result.stoppedBy).toBe("no-alternative");
  expect((await reg.getRent(rent.id))?.status).toBe("failed");
  expect(await reg.rentCost(rent.id)).toBe(0);
});

test("autonomy: a held-then-recovered provider finishes completed on the same provider", async () => {
  const { decideMigrateOrHold } = await import("./degradation"); // ensure module wires
  void decideMigrateOrHold;
  const reg = new InMemoryRegistry();
  await reg.registerProvider({ ...base, alias: "A", resourceType: "GPU", region: "US-East", online: true, trust: defaultTrust(), pricePerCharge: 0.0001, computeScore: 95 });
  const rent = await reg.createRent({ name: "x", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null }, autonomyArmed: true });

  // A fails twice then recovers; the soul holds; default monitor trips at 3, so use a monitor
  // that trips at 2 to exercise the hold path quickly.
  let downHits = 0;
  const settlement: SettlementAdapter = {
    buyerAddress: "0xB",
    async ensureFunded() { return { deposited: false }; },
    async payForCompute(): Promise<PaidCompute> {
      if (downHits < 2) { downHits++; throw new Error("transient"); }
      return { amountAtomic: 100n, settlementRef: `r-${downHits++}`, data: {}, status: 200 };
    },
    async reconcile(ref): Promise<SettlementStatus> { return { ref, status: "completed", settled: true }; },
  };

  const client = { propose: async () => [{ action: "hold", score: 1, rationale: ["transient"], userExplanation: "holding" }] };
  const soul = { schema: "soul/v1", version: "1.0.0", name: "Broker", body: "s" };
  const policy = { schema: "policy/v1", version: "1.0.0", body: "p" };

  const result = await runRent(rent.id, {
    registry: reg, settlement, degradation: { soul, policy, client },
    healthOpts: { maxConsecutiveFailures: 2 },
  }, { maxUnits: 2, maxMigrations: 1, holdBudget: { maxRetries: 3, maxDurationMs: 60_000, maxExtraSpend: 10_000n } });

  expect(result.stoppedBy).toBe("maxUnits");
  expect((await reg.getRent(rent.id))?.status).toBe("completed");
});
