// services/src/worker/settlement-factory.test.ts
import { test, expect } from "bun:test";
import { InMemorySpendWalletStore } from "../wallet/store";
import { generateEncKey } from "../wallet/crypto";
import { makeSettlementFactory } from "./settlement-factory";
import type { Rent } from "../domain";

function rent(userId: string): Rent {
  return {
    id: `r-${userId}`, name: "n", userId, agentId: null, spec: { resourceType: "GPU", region: null }, estimatedUsage: null,
    autonomyArmed: false, status: "queued", providerId: null, totalCost: 0, createdAt: "",
    startedAt: null, endedAt: null, lastChargedAt: null, leaseAccessToken: null,
  feesSweptAt: null,
  };
}

test("caches one adapter per lease and throws when the owner has no wallet", async () => {
  const store = new InMemorySpendWalletStore(await generateEncKey());
  await store.getOrCreate("u1");
  let built = 0;
  // Resolver picks the payer by owner; here every fixture rent is user-owned.
  const factory = makeSettlementFactory((r) => store.loadSigner(r.userId ?? r.agentId ?? ""), {
    capAtomic: 5_000n,
    build: (signer, cap) => { built++; return { buyerAddress: signer.address, capAtomic: cap } as never; },
  });
  const a = await factory(rent("u1"), 10);
  const b = await factory(rent("u1"), 10);
  expect(a).toBe(b);        // cached per lease id
  expect(built).toBe(1);
  await expect(factory(rent("ghost"), 10)).rejects.toThrow(/no spend wallet/);
});
