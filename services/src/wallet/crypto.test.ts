import { expect, test, describe } from "bun:test";
import { encryptSecret, decryptSecret, generateEncKey } from "./crypto";

describe("wallet crypto", () => {
  test("round-trips a secret", async () => {
    const key = await generateEncKey();
    const secret = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    const blob = await encryptSecret(secret, key);
    expect(blob).not.toContain(secret); // ciphertext, not plaintext
    expect(await decryptSecret(blob, key)).toBe(secret);
  });

  test("rejects a tampered blob", async () => {
    const key = await generateEncKey();
    const blob = await encryptSecret("hello", key);
    const tampered = blob.slice(0, -2) + (blob.endsWith("AA") ? "BB" : "AA");
    await expect(decryptSecret(tampered, key)).rejects.toThrow();
  });

  test("rejects the wrong key", async () => {
    const blob = await encryptSecret("hello", await generateEncKey());
    await expect(decryptSecret(blob, await generateEncKey())).rejects.toThrow();
  });
});
