// services/src/worker/remit.test.ts
import { test, expect } from "bun:test";
import { InMemoryRegistry } from "../registry/in-memory";
import { defaultTrust } from "../trust/trust";
import { applyRemittance, handleRemittance } from "./remit";
import type { Charge } from "../domain";

const c = (id: string, feeAmount: number) => ({ id, feeAmount } as Charge);

test("applyRemittance stamps oldest fully covered charges and reports the leftover", () => {
  const out = applyRemittance([c("a", 1), c("b", 2), c("c", 3)], 4n);
  expect(out.chargeIds).toEqual(["a", "b"]); // 1 + 2 covered; 3 not fully covered by the remaining 1
  expect(out.remainingAtomic).toBe(1n);
});

test("applyRemittance with nothing outstanding stamps nothing", () => {
  const out = applyRemittance([], 5n);
  expect(out.chargeIds).toEqual([]);
  expect(out.remainingAtomic).toBe(5n);
});

async function seeded() {
  const reg = new InMemoryRegistry();
  const provider = await reg.registerProvider({
    alias: "p", ownerWallet: "0xs", endpointUrl: "http://x", resourceType: "GPU", region: "US-East",
    specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 1,
  });
  const rent = await reg.createRent({ name: "r", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });
  for (const [seq, fee] of [1, 2, 3].entries()) {
    await reg.recordCharge({ rentId: rent.id, providerId: provider.id, seq, amount: 100, feeAmount: fee, feeSettlementRef: null, authorizationRef: null, settled: false, settlementRef: null });
  }
  return { reg, provider };
}

const post = (body: unknown) =>
  new Request("http://worker/remittances", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("a verified remittance stamps FIFO up to the on-chain amount", async () => {
  const { reg, provider } = await seeded();
  const res = await handleRemittance(post({ providerId: provider.id, txHash: "0xabc", amountAtomic: "3" }), {
    registry: reg, verify: async () => 3n, // chain says 3 moved
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, verifiedAtomic: "3", stamped: 2 }); // fees 1 + 2; the 3-fee charge is not fully covered
  const outstanding = await reg.listOutstandingFeeCharges(provider.id);
  expect(outstanding.map((x) => x.feeAmount)).toEqual([3]);
});

test("credits what the chain verified, not what the report claims", async () => {
  const { reg, provider } = await seeded();
  const res = await handleRemittance(post({ providerId: provider.id, txHash: "0xabc", amountAtomic: "999" }), {
    registry: reg, verify: async () => 1n,
  });
  expect((await res.json() as any).stamped).toBe(1); // only the 1-fee charge
});

test("an unverifiable tx stamps nothing and returns 422", async () => {
  const { reg, provider } = await seeded();
  const res = await handleRemittance(post({ providerId: provider.id, txHash: "0xnope", amountAtomic: "3" }), {
    registry: reg, verify: async () => 0n,
  });
  expect(res.status).toBe(422);
  expect((await reg.listOutstandingFeeCharges(provider.id)).length).toBe(3);
});

test("bad bodies get a 400", async () => {
  const { reg } = await seeded();
  for (const body of [{}, { providerId: "p" }, { providerId: "p", txHash: "0x", amountAtomic: "-1" }]) {
    const res = await handleRemittance(post(body), { registry: reg, verify: async () => 0n });
    expect(res.status).toBe(400);
  }
});
