import { test, expect } from "bun:test";
import { defaultTrust } from "../trust/trust";
import { streamRent } from "./stream";
import { InMemoryRegistry } from "../registry/in-memory";
import { FakeSettlementAdapter } from "../settlement/fake";
import type { SettlementAdapter, PaidCompute, SettlementStatus } from "../settlement/adapter";
import type { Provider, Rent } from "../domain";

const provider: Provider = {
  id: "p1", alias: "n", ownerWallet: "0x0", endpointUrl: "http://prov", resourceType: "GPU",
  region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001,
  computeScore: 90, avgLatencyMs: 5,
};

async function makeRent(reg: InMemoryRegistry): Promise<Rent> {
  return reg.createRent({ name: "r", userId: "u1", spec: { resourceType: "GPU", region: null } });
}

test("streams maxUnits, records a charge each, cost is exact", async () => {
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  const result = await streamRent(rent, provider, { registry: reg, settlement }, { maxUnits: 3 });
  expect(result.units).toBe(3);
  expect(result.stoppedBy).toBe("maxUnits");
  expect(await reg.rentCost(rent.id)).toBe(300);
  expect((await reg.listCharges(rent.id)).length).toBe(3);
});

test("stops cleanly when the spend cap is hit, cost stays exact", async () => {
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 250n });
  const result = await streamRent(rent, provider, { registry: reg, settlement }, { maxUnits: 10 });
  expect(result.stoppedBy).toBe("cap");
  expect(result.units).toBe(2); // 100 + 100 = 200; third would breach 250
  expect(await reg.rentCost(rent.id)).toBe(200);
});

test("cancel stops within one unit", async () => {
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  let n = 0;
  const result = await streamRent(rent, provider, { registry: reg, settlement }, {
    maxUnits: 100,
    shouldStop: () => n++ >= 2, // allow 2 units, then cancel
  });
  expect(result.stoppedBy).toBe("cancel");
  expect(result.units).toBe(2);
});

// An adapter that fails its first `transientFailures` payForCompute calls with a non-cap
// error (a transient x402/facilitator hiccup), then pays normally. Failures within the
// HealthMonitor tolerance keep the stream alive and make streamRent `continue` (re-poll).
function flakyAdapter(transientFailures: number): SettlementAdapter {
  let attempts = 0;
  let seq = 0;
  return {
    buyerAddress: "0xB",
    async ensureFunded() { return { deposited: false }; },
    async payForCompute(): Promise<PaidCompute> {
      attempts++;
      if (attempts <= transientFailures) throw new Error("transient x402 hiccup");
      return { amountAtomic: 100n, settlementRef: `ref-${seq++}`, data: {}, status: 200 };
    },
    async reconcile(ref): Promise<SettlementStatus> { return { ref, status: "completed", settled: true }; },
  };
}

test("REPRO: a poll-counting cancel is consumed by transient-failure retries (cancels at 0 charges)", async () => {
  // streamRent re-polls shouldStop on every attempt, including transient-failure retries. A
  // cancel that counts *poll calls* (not charges) therefore fires before any charge lands when
  // the first payments fail transiently. This is the on-chain integration scenario-2 trap.
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  let n = 0;
  const result = await streamRent(rent, provider, { registry: reg, settlement: flakyAdapter(2) }, {
    maxUnits: 100,
    shouldStop: () => n++ >= 2, // poll-counting: burned by the 2 transient retries
  });
  expect(result.stoppedBy).toBe("cancel");
  expect(result.units).toBe(0); // never charged: the trap
  expect((await reg.listCharges(rent.id)).length).toBe(0);
});

test("a charge-counting cancel survives transient payment failures and stops after N charges", async () => {
  // The robust pattern: cancel on charges actually made, not poll calls. Wrap the adapter to
  // count successful payments; transient failures no longer consume the cancel budget.
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  const inner = flakyAdapter(2); // first 2 payments fail transiently, then succeed
  let paid = 0;
  const counting: SettlementAdapter = {
    ...inner,
    async payForCompute(url: string): Promise<PaidCompute> {
      const res = await inner.payForCompute(url); // throws on transient; only counts on success
      paid++;
      return res;
    },
  };
  const result = await streamRent(rent, provider, { registry: reg, settlement: counting }, {
    maxUnits: 100,
    shouldStop: () => paid >= 2, // charge-counting: cancel after 2 real charges
  });
  expect(result.stoppedBy).toBe("cancel");
  expect(result.units).toBe(2);
  expect((await reg.listCharges(rent.id)).length).toBe(2);
});

test("a persistently failing provider trips unhealthy and stops", async () => {
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  // An adapter whose payForCompute always throws a non-cap error (x402 failure).
  const failing: SettlementAdapter = {
    buyerAddress: "0xB",
    async ensureFunded() { return { deposited: false }; },
    async payForCompute(): Promise<PaidCompute> { throw new Error("402 not honored"); },
    async reconcile(ref): Promise<SettlementStatus> { return { ref, status: "unknown", settled: false }; },
  };
  const result = await streamRent(rent, provider, { registry: reg, settlement: failing }, { maxUnits: 100 });
  expect(result.stoppedBy).toBe("unhealthy");
  expect(result.units).toBe(0); // never paid
  expect((await reg.listCharges(rent.id)).length).toBe(0);
});

test("startSeq continues charge numbering from a previous leg", async () => {
  const reg = new InMemoryRegistry();
  const rent = await makeRent(reg);
  const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 100n, capAtomic: 100_000n });
  const result = await streamRent(rent, provider, { registry: reg, settlement }, { maxUnits: 2, startSeq: 5 });
  expect(result.units).toBe(2);
  const seqs = (await reg.listCharges(rent.id)).map((c) => c.seq);
  expect(seqs).toEqual([5, 6]);
});
