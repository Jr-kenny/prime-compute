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

export function registryContract(
  name: string,
  makeRegistry: () => Promise<Registry>,
) {
  describe(`Registry contract: ${name}`, () => {
    let reg: Registry;
    beforeEach(async () => {
      reg = await makeRegistry();
    });

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
      expect(await reg.getProvider("nope")).toBeNull();
    });

    test("bumpComputeScore adjusts and persists the score", async () => {
      const p = await reg.registerProvider({ ...sampleProvider, computeScore: 90 });
      const bumped = await reg.bumpComputeScore(p.id, -5);
      expect(bumped.computeScore).toBe(85);
      const fetched = await reg.getProvider(p.id);
      expect(fetched?.computeScore).toBe(85);
    });

    test("createJob defaults status to queued and autonomy to false", async () => {
      const job = await reg.createJob({
        name: "train-x",
        userId: "u1",
        spec: { resourceType: "GPU", region: null },
      });
      expect(job.id).toBeTruthy();
      expect(job.status).toBe("queued");
      expect(job.autonomyArmed).toBe(false);
      expect(job.totalCost).toBe(0);
    });

    test("updateJob patches fields", async () => {
      const job = await reg.createJob({ name: "j", userId: "u1", spec: { resourceType: "GPU", region: null } });
      const updated = await reg.updateJob(job.id, { status: "running", providerId: "p1" });
      expect(updated.status).toBe("running");
      expect(updated.providerId).toBe("p1");
    });

    test("recordTick + jobCost sums consumed ticks exactly", async () => {
      const job = await reg.createJob({ name: "j", userId: "u1", spec: { resourceType: "GPU", region: null } });
      await reg.recordTick({ jobId: job.id, providerId: "p1", seq: 0, amount: 100, authorizationRef: "a0", settled: false, settlementRef: null });
      await reg.recordTick({ jobId: job.id, providerId: "p1", seq: 1, amount: 100, authorizationRef: "a1", settled: false, settlementRef: null });
      expect(await reg.jobCost(job.id)).toBe(200);
      expect((await reg.listTicks(job.id)).length).toBe(2);
    });

    test("recordDecision stores candidates + rationale", async () => {
      const job = await reg.createJob({ name: "j", userId: "u1", spec: { resourceType: "GPU", region: null } });
      const d = await reg.recordDecision({
        jobId: job.id,
        candidates: [{ providerId: "B", rank: 0 }, { providerId: "A", rank: 1 }],
        chosenProviderId: "B",
        rationale: "B is cheaper and higher score",
      });
      expect(d.id).toBeTruthy();
      expect(d.chosenProviderId).toBe("B");
    });
  });
}
