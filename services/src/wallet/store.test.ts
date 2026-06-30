import { expect, test, describe } from "bun:test";
import { InMemorySpendWalletStore } from "./store";
import { generateEncKey } from "./crypto";

describe("InMemorySpendWalletStore", () => {
  test("get-or-create is idempotent and returns a real address", async () => {
    const store = new InMemorySpendWalletStore(await generateEncKey());
    const a = await store.getOrCreate("user-1");
    const b = await store.getOrCreate("user-1");
    expect(a.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(b.address).toBe(a.address); // same user -> same wallet
  });

  test("different users get different wallets", async () => {
    const store = new InMemorySpendWalletStore(await generateEncKey());
    const a = await store.getOrCreate("user-1");
    const b = await store.getOrCreate("user-2");
    expect(b.address).not.toBe(a.address);
  });

  test("loadSigner returns the matching key, getAddress reads without creating", async () => {
    const store = new InMemorySpendWalletStore(await generateEncKey());
    expect(await store.getAddress("ghost")).toBeNull();
    const { address } = await store.getOrCreate("user-1");
    const signer = await store.loadSigner("user-1");
    expect(signer?.address.toLowerCase()).toBe(address.toLowerCase());
    expect(signer?.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });
});
