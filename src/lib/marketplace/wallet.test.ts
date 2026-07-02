// src/lib/marketplace/wallet.test.ts
import { test, expect } from "bun:test";
import { walletProviderFor } from "./wallet";

test("circle backend provisions through the circle store", async () => {
  const calls: string[] = [];
  const provider = walletProviderFor(
    { kind: "agent", id: "a1", walletAddress: "" },
    {
      backend: "circle",
      circle: { getOrCreate: async (kind, id) => { calls.push(`${kind}:${id}`); return { walletId: "w1", address: "0xc" }; } } as any,
      legacy: { getOrCreate: async () => { throw new Error("legacy must not be called"); } } as any,
    },
  );
  const w = await provider.getOrCreate();
  expect(w.address).toBe("0xc");
  expect(calls).toEqual(["agent:a1"]);
});

test("raw backend still provisions through the legacy store", async () => {
  const provider = walletProviderFor(
    { kind: "user", id: "u1", walletAddress: "" },
    {
      backend: "raw",
      circle: { getOrCreate: async () => { throw new Error("circle must not be called"); } } as any,
      legacy: { getOrCreate: async (id: string) => ({ address: `0xlegacy-${id}` }) } as any,
    },
  );
  expect((await provider.getOrCreate()).address).toBe("0xlegacy-u1");
});
