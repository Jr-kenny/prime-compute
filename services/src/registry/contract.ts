import { describe, test, expect, beforeEach } from "bun:test";
import type { Registry, NewProvider } from "./registry";

const sampleProvider: NewProvider = {
  alias: "node-astral-1",
  ownerWallet: "0xprovider",
  endpointUrl: "http://localhost:4001",
  resourceType: "GPU",
  region: "US-East",
  specs: { gpu: "H100", vramGb: 80 },
  online: true,
  stakeAmount: 100,
  pricePerTick: 0.000006,
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
    });

    test("listProviders filters by resourceType and onlineOnly", async () => {
      await reg.registerProvider(sampleProvider);
      await reg.registerProvider({ ...sampleProvider, alias: "cpu-1", resourceType: "CPU" });
      await reg.registerProvider({ ...sampleProvider, alias: "off-1", online: false });

      const gpus = await reg.listProviders({ resourceType: "GPU" });
      expect(gpus.map((p) => p.alias).sort()).toEqual(["node-astral-1", "off-1"]);

      const onlineGpus = await reg.listProviders({ resourceType: "GPU", onlineOnly: true });
      expect(onlineGpus.map((p) => p.alias)).toEqual(["node-astral-1"]);
    });

    test("getProvider returns null for unknown id", async () => {
      // A well-formed but absent id (real stores type the id column as uuid).
      expect(await reg.getProvider(crypto.randomUUID())).toBeNull();
    });

    test("bumpComputeScore adjusts and persists the score", async () => {
      const p = await reg.registerProvider({ ...sampleProvider, computeScore: 90 });
      const bumped = await reg.bumpComputeScore(p.id, -5);
      expect(bumped.computeScore).toBe(85);
      const fetched = await reg.getProvider(p.id);
      expect(fetched?.computeScore).toBe(85);
    });

    test("createRent defaults status to queued and autonomy to false", async () => {
      const rent = await reg.createRent({
        name: "train-x",
        userId: "u1",
        spec: { resourceType: "GPU", region: null },
      });
      expect(rent.id).toBeTruthy();
      expect(rent.status).toBe("queued");
      expect(rent.autonomyArmed).toBe(false);
      expect(rent.totalCost).toBe(0);
    });

    test("updateRent patches fields", async () => {
      const provider = await reg.registerProvider(sampleProvider);
      const rent = await reg.createRent({ name: "j", userId: "u1", spec: { resourceType: "GPU", region: null } });
      const updated = await reg.updateRent(rent.id, { status: "running", providerId: provider.id });
      expect(updated.status).toBe("running");
      expect(updated.providerId).toBe(provider.id);
    });

    test("recordTick + rentCost sums consumed ticks exactly", async () => {
      const provider = await reg.registerProvider(sampleProvider);
      const rent = await reg.createRent({ name: "j", userId: "u1", spec: { resourceType: "GPU", region: null } });
      await reg.recordTick({ rentId: rent.id, providerId: provider.id, seq: 0, amount: 100, authorizationRef: "a0", settled: false, settlementRef: null });
      await reg.recordTick({ rentId: rent.id, providerId: provider.id, seq: 1, amount: 100, authorizationRef: "a1", settled: false, settlementRef: null });
      expect(await reg.rentCost(rent.id)).toBe(200);
      expect((await reg.listTicks(rent.id)).length).toBe(2);
    });

    test("recordDecision stores candidates + rationale", async () => {
      const a = await reg.registerProvider({ ...sampleProvider, alias: "cand-a" });
      const b = await reg.registerProvider({ ...sampleProvider, alias: "cand-b" });
      const rent = await reg.createRent({ name: "j", userId: "u1", spec: { resourceType: "GPU", region: null } });
      const d = await reg.recordDecision({
        rentId: rent.id,
        candidates: [{ providerId: b.id, rank: 0 }, { providerId: a.id, rank: 1 }],
        chosenProviderId: b.id,
        rationale: "B is cheaper and higher score",
      });
      expect(d.id).toBeTruthy();
      expect(d.chosenProviderId).toBe(b.id);
    });
  });
}
