import { test, expect } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { verifyWalletOwnership } from "./verify-ownership";

test("accepts a valid signature over the message for the signing address", async () => {
  const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const message = "prime-nonce-abc";
  const signature = await account.signMessage({ message });
  expect(await verifyWalletOwnership({ address: account.address, message, signature })).toBe(true);
});

test("rejects a signature over a different message", async () => {
  const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const signature = await account.signMessage({ message: "other" });
  expect(await verifyWalletOwnership({ address: account.address, message: "prime-nonce-abc", signature })).toBe(false);
});
