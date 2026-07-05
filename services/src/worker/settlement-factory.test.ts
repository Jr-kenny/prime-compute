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
  statusReason: null,
  maxSpendAtomic: null,
  expiresAt: null,
  suspendedAt: null,
  };
}

test("caches one adapter per lease and throws when the owner has no wallet", async () => {
  const store = new InMemorySpendWalletStore(await generateEncKey());
  await store.getOrCreate("u1");
  let built = 0;
  // Resolver picks the payer by owner; here every fixture rent is user-owned.
  const factory = makeSettlementFactory(
    async (r) => {
      const signer = await store.loadSigner(r.userId ?? r.agentId ?? "");
      return signer ? { kind: "raw", signer } : null;
    },
    {
      capAtomic: 5_000n,
      build: (signer, cap) => { built++; return { buyerAddress: signer.address, capAtomic: cap } as never; },
    },
  );
  const a = await factory(rent("u1"), 10);
  const b = await factory(rent("u1"), 10);
  expect(a).toBe(b);        // cached per lease id
  expect(built).toBe(1);
  await expect(factory(rent("ghost"), 10)).rejects.toThrow(/no spend wallet/);
});

test("a circle payer builds via the circle builder", async () => {
  const built: string[] = [];
  const factory = makeSettlementFactory(
    async () => ({ kind: "circle" as const, walletId: "w1", address: "0xc" }),
    {
      capAtomic: 10n,
      build: () => { built.push("raw"); return {} as never; },
      buildCircle: (payer) => { built.push(`circle:${payer.walletId}`); return {} as never; },
    },
  );
  await factory(rent("u-circle"), 1);
  expect(built).toEqual(["circle:w1"]);
});

test("a raw payer still builds via the raw builder", async () => {
  const built: string[] = [];
  const factory = makeSettlementFactory(
    async () => ({ kind: "raw" as const, signer: { address: "0xa", privateKey: "0xkey" as `0x${string}` } }),
    { capAtomic: 10n, build: () => { built.push("raw"); return {} as never; }, buildCircle: () => { built.push("circle"); return {} as never; } },
  );
  await factory(rent("u-raw"), 1);
  expect(built).toEqual(["raw"]);
});
