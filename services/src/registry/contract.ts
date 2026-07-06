import { describe, test, expect, beforeEach } from "bun:test";
import type { Registry, NewProvider } from "./registry";
import { defaultTrust } from "../trust/trust";
import type { DecisionLog } from "../runtime/types";

const sampleProvider: NewProvider = {
  alias: "node-astral-1",
  ownerWallet: "0xprovider",
  endpointUrl: "http://localhost:4001",
  resourceType: "GPU",
  region: "US-East",
  specs: { gpu: "H100", vramGb: 80 },
  online: true,
  trust: defaultTrust(),
  pricePerCharge: 0.000006,
  avgLatencyMs: 5,
};

// Generous so the network-bound SupabaseRegistry run (resets + round-trips to a
// remote region) fits; harmless for the instant in-memory run.
const T = 30_000;

export function registryContract(
  name: string,
  makeRegistry: () => Promise<Registry>,
) {
  describe(`Registry contract: ${name}`, () => {
    let reg: Registry;
    beforeEach(async () => {
      reg = await makeRegistry();
    }, T);

    test("registerProvider assigns an id and default computeScore", async () => {
      const p = await reg.registerProvider(sampleProvider);
      expect(p.id).toBeTruthy();
      expect(p.alias).toBe("node-astral-1");
      expect(typeof p.computeScore).toBe("number");
    }, T);

    test("a provider's trust tier round-trips", async () => {
      const p = await reg.registerProvider({ ...sampleProvider, alias: "bonded-1", trust: defaultTrust("Bonded") });
      const fetched = await reg.getProvider(p.id);
      expect(fetched?.trust.tier).toBe("Bonded");
      expect(fetched?.trust.signals.health).toBe("healthy");
    }, T);

    test("recordDecisionLog persists structured provenance and lists it back", async () => {
      const provider = await reg.registerProvider({ ...sampleProvider, alias: "log-target" });
      const rent = await reg.createRent({ name: "log-rent", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
      const log: DecisionLog = {
        decisionId: crypto.randomUUID(),
        soulVersion: "1.2.3",
        policyVersion: "0.9.0",
        objective: "respond-to-degradation",
        proposals: [{ action: "migrate", target: provider.id, score: 0.9, rationale: ["pricier but healthy"], userExplanation: "moving to log-target" }],
        chosenAction: { action: "migrate", target: provider.id },
        rejectedReason: null,
        usedFallback: false,
        createdAt: new Date().toISOString(),
      };
      await reg.recordDecisionLog(rent.id, log);
      const logs = await reg.listDecisionLogs(rent.id);
      expect(logs).toHaveLength(1);
      expect(logs[0]?.soulVersion).toBe("1.2.3");
      expect(logs[0]?.policyVersion).toBe("0.9.0");
      expect(logs[0]?.objective).toBe("respond-to-degradation");
      expect(logs[0]?.chosenAction).toEqual({ action: "migrate", target: provider.id });
      expect(logs[0]?.usedFallback).toBe(false);
      expect(logs[0]?.proposals).toHaveLength(1);
    }, T);

    test("listProviders filters by resourceType and onlineOnly", async () => {
      await reg.registerProvider(sampleProvider);
      await reg.registerProvider({ ...sampleProvider, alias: "cpu-1", resourceType: "CPU" });
      await reg.registerProvider({ ...sampleProvider, alias: "off-1", online: false });

      const gpus = await reg.listProviders({ resourceType: "GPU" });
      expect(gpus.map((p) => p.alias).sort()).toEqual(["node-astral-1", "off-1"]);

      const onlineGpus = await reg.listProviders({ resourceType: "GPU", onlineOnly: true });
      expect(onlineGpus.map((p) => p.alias)).toEqual(["node-astral-1"]);
    }, T);

    test("getProvider returns null for unknown id", async () => {
      // A well-formed but absent id (real stores type the id column as uuid).
      expect(await reg.getProvider(crypto.randomUUID())).toBeNull();
    }, T);

    test("bumpComputeScore adjusts and persists the score", async () => {
      const p = await reg.registerProvider({ ...sampleProvider, computeScore: 90 });
      const bumped = await reg.bumpComputeScore(p.id, -5);
      expect(bumped.computeScore).toBe(85);
      const fetched = await reg.getProvider(p.id);
      expect(fetched?.computeScore).toBe(85);
    }, T);

    test("createRent defaults status to queued and autonomy to false", async () => {
      const rent = await reg.createRent({
        name: "train-x",
        owner: { kind: "user", id: "u1", walletAddress: "0x0" },
        spec: { resourceType: "GPU", region: null },
      });
      expect(rent.id).toBeTruthy();
      expect(rent.status).toBe("queued");
      expect(rent.autonomyArmed).toBe(false);
      expect(rent.totalCost).toBe(0);
    }, T);

    test("updateRent patches fields", async () => {
      const provider = await reg.registerProvider(sampleProvider);
      const rent = await reg.createRent({ name: "j", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
      const updated = await reg.updateRent(rent.id, { status: "running", providerId: provider.id });
      expect(updated.status).toBe("running");
      expect(updated.providerId).toBe(provider.id);
    }, T);

    test("continuous-rental fields default null and round-trip through create/patch", async () => {
      const created = await reg.createRent({
        name: "caps", owner: { kind: "user", id: "u-caps", walletAddress: "0x0" },
        spec: { resourceType: "GPU", region: null }, maxSpendAtomic: 5000, expiresAt: "2030-01-01T00:00:00.000Z",
      });
      expect(created.maxSpendAtomic).toBe(5000);
      // timestamptz round-trips as +00:00 not Z on Postgres, so compare by instant, not string.
      expect(new Date(created.expiresAt!).getTime()).toBe(new Date("2030-01-01T00:00:00.000Z").getTime());
      expect(created.suspendedAt).toBeNull();
      const suspended = await reg.updateRent(created.id, { suspendedAt: "2030-01-02T00:00:00.000Z" });
      expect(new Date(suspended.suspendedAt!).getTime()).toBe(new Date("2030-01-02T00:00:00.000Z").getTime());
    }, T);

    test("creates and lists an agent-owned rent", async () => {
      const rent = await reg.createRent({
        name: "agent-rent",
        owner: { kind: "agent", id: "agent-1", walletAddress: "0xagent" },
        spec: { resourceType: "GPU", region: null },
      });
      expect(rent.agentId).toBe("agent-1");
      expect(rent.userId).toBeNull();
      const mine = await reg.listRents({ agentId: "agent-1" });
      expect(mine.map((r) => r.id)).toContain(rent.id);
      const notMine = await reg.listRents({ userId: "u1" });
      expect(notMine.map((r) => r.id)).not.toContain(rent.id);
    }, T);

    test("creates a user-owned rent from a user principal", async () => {
      const rent = await reg.createRent({
        name: "user-rent",
        owner: { kind: "user", id: "u1", walletAddress: "0xuser" },
        spec: { resourceType: "GPU", region: null },
      });
      expect(rent.userId).toBe("u1");
      expect(rent.agentId).toBeNull();
    }, T);

    test("persists lastChargedAt and leaseAccessToken through updateRent", async () => {
      const rent = await reg.createRent({ name: "j", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
      expect(rent.lastChargedAt).toBeNull();
      expect(rent.leaseAccessToken).toBeNull();
      const ts = new Date().toISOString();
      const updated = await reg.updateRent(rent.id, { lastChargedAt: ts, leaseAccessToken: "tok-123", status: "running" });
      // Compare by instant, not string: timestamptz round-trips as +00:00, in-memory keeps the Z form.
      expect(new Date(updated.lastChargedAt!).getTime()).toBe(new Date(ts).getTime());
      expect(updated.leaseAccessToken).toBe("tok-123");
      const reread = await reg.getRent(rent.id);
      expect(reread?.leaseAccessToken).toBe("tok-123");
    }, T);

    test("recordCharge + rentCost sums consumed charges exactly", async () => {
      const provider = await reg.registerProvider(sampleProvider);
      const rent = await reg.createRent({ name: "j", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
      await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: 0, units: 1, amount: 100, feeAmount: 0, feeSettlementRef: null, authorizationRef: "a0", settled: false, settlementRef: null });
      await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: 1, units: 1, amount: 100, feeAmount: 0, feeSettlementRef: null, authorizationRef: "a1", settled: false, settlementRef: null });
      expect(await reg.rentCost(rent.id)).toBe(200);
      expect((await reg.listCharges(rent.id)).length).toBe(2);
    }, T);

    test("billedUnits sums units across charges, not rows (metering derives seq and boundaries from it)", async () => {
      const provider = await reg.registerProvider({ ...sampleProvider, alias: "count-p" });
      const rent = await reg.createRent({ name: "count-rent", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
      expect(await reg.billedUnits(rent.id)).toBe(0);
      // One single-unit charge, then one batched payment worth 5 units: 6 units across 2 rows.
      await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: 0, units: 1, amount: 100, feeAmount: 0, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: "ref-0" });
      await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: 1, units: 5, amount: 500, feeAmount: 0, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: "ref-1" });
      expect(await reg.billedUnits(rent.id)).toBe(6);
      expect((await reg.listCharges(rent.id)).length).toBe(2);
      expect((await reg.listCharges(rent.id))[1]?.units).toBe(5);
      expect(await reg.rentCost(rent.id)).toBe(600);
    }, T);

    test("recordCharge persists feeAmount; rentCost is what the renter paid", async () => {
      const provider = await reg.registerProvider({ ...sampleProvider, alias: "fee-p" });
      const rent = await reg.createRent({ name: "fee-rent", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
      await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: 0, units: 1, amount: 99, feeAmount: 1, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: null });
      const [c] = await reg.listCharges(rent.id);
      expect(c?.feeAmount).toBe(1);
      expect(c?.feeSettlementRef).toBeNull();
      expect(await reg.rentCost(rent.id)).toBe(99);
      await reg.markChargeFeeSettled(c!.id, "fee-batch-1");
      expect((await reg.listCharges(rent.id))[0]?.feeSettlementRef).toBe("fee-batch-1");
    }, T);

    test("updateRent persists feesSweptAt", async () => {
      const rent = await reg.createRent({ name: "sweep-rent", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
      const t = new Date().toISOString();
      const updated = await reg.updateRent(rent.id, { feesSweptAt: t });
      expect(new Date(updated.feesSweptAt!).getTime()).toBe(new Date(t).getTime());
    }, T);

    test("markChargeSettled flips a charge to settled", async () => {
      const provider = await reg.registerProvider(sampleProvider);
      const rent = await reg.createRent({ name: "j", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
      const charge = await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: 0, units: 1, amount: 100, feeAmount: 0, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: "ref-0" });
      await reg.markChargeSettled(charge.id);
      const charges = await reg.listCharges(rent.id);
      expect(charges[0]?.settled).toBe(true);
    }, T);

    test("recordDecision stores candidates + rationale", async () => {
      const a = await reg.registerProvider({ ...sampleProvider, alias: "cand-a" });
      const b = await reg.registerProvider({ ...sampleProvider, alias: "cand-b" });
      const rent = await reg.createRent({ name: "j", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
      const d = await reg.recordDecision({
        rentId: rent.id,
        candidates: [{ providerId: b.id, rank: 0 }, { providerId: a.id, rank: 1 }],
        chosenProviderId: b.id,
        rationale: "B is cheaper and higher score",
      });
      expect(d.id).toBeTruthy();
      expect(d.chosenProviderId).toBe(b.id);
    }, T);

    test("listRents filters by userId, providerId, and status", async () => {
      const provider = await reg.registerProvider({ ...sampleProvider, alias: "filter-target" });
      const a = await reg.createRent({ name: "a", owner: { kind: "user", id: "user-a", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
      const b = await reg.createRent({ name: "b", owner: { kind: "user", id: "user-b", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
      await reg.updateRent(a.id, { status: "running", providerId: provider.id });

      expect((await reg.listRents({ userId: "user-a" })).map((r) => r.id)).toEqual([a.id]);
      expect((await reg.listRents({ providerId: provider.id })).map((r) => r.id)).toEqual([a.id]);
      expect((await reg.listRents({ status: "running" })).map((r) => r.id)).toEqual([a.id]);
      expect((await reg.listRents()).map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    }, T);

    test("listOutstandingFeeCharges returns unstamped fee charges for one provider, oldest first", async () => {
      const provider = await reg.registerProvider({
        alias: "recv-p", ownerWallet: "0xs", endpointUrl: "http://x", resourceType: "GPU", region: "US-East",
        specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 1,
      });
      const other = await reg.registerProvider({
        alias: "recv-q", ownerWallet: "0xs", endpointUrl: "http://y", resourceType: "GPU", region: "US-East",
        specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 1,
      });
      const rent = await reg.createRent({ name: "recv-rent", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
      // seq 0: outstanding; seq 1: already stamped; seq 2: zero fee; seq 3: other provider.
      await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: 0, units: 1, amount: 100, feeAmount: 1, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: null });
      await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: 1, units: 1, amount: 100, feeAmount: 2, feeSettlementRef: "0xdone", authorizationRef: null, settled: false, settlementRef: null });
      await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: 2, units: 1, amount: 100, feeAmount: 0, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: null });
      await reg.recordCharge({ rentId: rent.id, providerId: other.id, seq: 3, units: 1, amount: 100, feeAmount: 5, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: null });
      await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq: 4, units: 1, amount: 100, feeAmount: 3, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: null });

      const outstanding = await reg.listOutstandingFeeCharges(provider.id);
      expect(outstanding.map((c) => c.feeAmount)).toEqual([1, 3]); // oldest first, only unstamped fee > 0, only this provider
    }, T);

    test("listProviders filters by ownerWallet", async () => {
      await reg.registerProvider({ ...sampleProvider, alias: "mine-1", ownerWallet: "0xowner" });
      await reg.registerProvider({ ...sampleProvider, alias: "theirs-1", ownerWallet: "0xother" });

      const mine = await reg.listProviders({ ownerWallet: "0xowner" });
      expect(mine.map((p) => p.alias)).toEqual(["mine-1"]);
    }, T);
  });
}
