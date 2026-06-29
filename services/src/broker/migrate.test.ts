import { test, expect } from "bun:test";
import { streamWithMigration } from "./migrate";
import { InMemoryRegistry } from "../registry/in-memory";
import type { NewProvider } from "../registry/registry";
import type { SettlementAdapter, PaidCompute, SettlementStatus } from "../settlement/adapter";
import { SpendCapError } from "../settlement/spend-policy";
import type { Provider, Rent } from "../domain";

const base: Pick<NewProvider, "ownerWallet" | "specs" | "avgLatencyMs"> = {
  ownerWallet: "0x0", specs: {}, avgLatencyMs: 5,
};

// A url-keyed fake: payForCompute throws for any url containing a "down" marker
// (a dead provider endpoint), and otherwise pays and enforces the spend cap. This
// models reality: the broker wallet is fine; a specific provider's endpoint is not.
function urlAdapter(downMarkers: string[], pricePerChargeAtomic = 100n, capAtomic = 1_000_000n): SettlementAdapter {
  let spent = 0n;
  let seq = 0;
  const refs = new Set<string>();
  return {
    buyerAddress: "0xBROKER",
    async ensureFunded(): Promise<{ deposited: boolean }> { return { deposited: false }; },
    async payForCompute(url: string): Promise<PaidCompute> {
      if (downMarkers.some((d) => url.includes(d))) throw new Error(`x402 failed: ${url} unreachable`);
      if (spent + pricePerChargeAtomic > capAtomic) throw new SpendCapError(`cap ${capAtomic} reached`);
      spent += pricePerChargeAtomic;
      const settlementRef = `ref-${seq++}`;
      refs.add(settlementRef);
      return { amountAtomic: pricePerChargeAtomic, settlementRef, data: { ok: true }, status: 200 };
    },
    async reconcile(ref: string): Promise<SettlementStatus> {
      return { ref, status: refs.has(ref) ? "completed" : "unknown", settled: refs.has(ref) };
    },
  };
}

async function seedTwo(reg: InMemoryRegistry) {
  // A ranks first (higher score) so it is chosen first; its endpoint is the dead one.
  const a = await reg.registerProvider({ ...base, alias: "A", endpointUrl: "http://aaa", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 99 });
  const b = await reg.registerProvider({ ...base, alias: "B", endpointUrl: "http://bbb", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 80 });
  return { a, b };
}

async function makeRent(reg: InMemoryRegistry): Promise<Rent> {
  return reg.createRent({ name: "r", userId: "u1", spec: { resourceType: "GPU", region: null }, autonomyArmed: true });
}

test("migrates from a degraded provider to the next-best, continuing the stream", async () => {
  const reg = new InMemoryRegistry();
  const { a, b } = await seedTwo(reg);
  const rent = await makeRent(reg);
  const settlement = urlAdapter(["aaa"]); // provider A is dead from the first charge

  const result = await streamWithMigration(rent, a as Provider, { registry: reg, settlement }, { maxUnits: 3, maxMigrations: 1 });

  expect(result.stoppedBy).toBe("maxUnits");
  expect(result.migrations).toBe(1);
  expect(result.providersUsed).toEqual([a.id, b.id]);
  expect(result.units).toBe(3); // all three charges came from B
  // The rent now points at B and a migration decision was recorded.
  expect((await reg.getRent(rent.id))?.providerId).toBe(b.id);
  const charges = await reg.listCharges(rent.id);
  expect(charges.every((c) => c.providerId === b.id)).toBe(true);
  expect(charges.map((c) => c.seq)).toEqual([0, 1, 2]);
});

test("a healthy first provider streams to maxUnits with zero migrations", async () => {
  const reg = new InMemoryRegistry();
  const { a } = await seedTwo(reg);
  const rent = await makeRent(reg);
  const settlement = urlAdapter([]); // nobody is down
  const result = await streamWithMigration(rent, a as Provider, { registry: reg, settlement }, { maxUnits: 3, maxMigrations: 1 });
  expect(result.stoppedBy).toBe("maxUnits");
  expect(result.migrations).toBe(0);
  expect(result.providersUsed).toEqual([a.id]);
  expect(result.units).toBe(3);
});

test("with no valid alternative, stops as no-alternative", async () => {
  const reg = new InMemoryRegistry();
  // Only A exists, and A is down.
  const a = await reg.registerProvider({ ...base, alias: "A", endpointUrl: "http://aaa", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 99 });
  const rent = await makeRent(reg);
  const settlement = urlAdapter(["aaa"]);
  const result = await streamWithMigration(rent, a as Provider, { registry: reg, settlement }, { maxUnits: 3, maxMigrations: 2 });
  expect(result.stoppedBy).toBe("no-alternative");
  expect(result.units).toBe(0);
  expect(result.migrations).toBe(0);
});

test("maxMigrations 0 stops unhealthy without re-pointing (matches Plan 5 behavior)", async () => {
  const reg = new InMemoryRegistry();
  const { a } = await seedTwo(reg);
  const rent = await makeRent(reg);
  const settlement = urlAdapter(["aaa"]);
  const result = await streamWithMigration(rent, a as Provider, { registry: reg, settlement }, { maxUnits: 3, maxMigrations: 0 });
  expect(result.stoppedBy).toBe("unhealthy");
  expect(result.migrations).toBe(0);
  expect(result.providersUsed).toEqual([a.id]);
});

test("cancel during a leg stops the whole stream", async () => {
  const reg = new InMemoryRegistry();
  const { a } = await seedTwo(reg);
  const rent = await makeRent(reg);
  const settlement = urlAdapter([]);
  let n = 0;
  const result = await streamWithMigration(rent, a as Provider, { registry: reg, settlement }, {
    maxUnits: 100, maxMigrations: 1, shouldStop: () => n++ >= 2,
  });
  expect(result.stoppedBy).toBe("cancel");
  expect(result.units).toBe(2);
});
