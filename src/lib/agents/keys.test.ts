// src/lib/agents/keys.test.ts
import { test, expect } from "bun:test";
import { generateApiKey, hashApiKey } from "./keys";

test("generateApiKey is prefixed and high-entropy; hash is stable + hex", async () => {
  const a = generateApiKey();
  const b = generateApiKey();
  expect(a.startsWith("pc_")).toBe(true);
  expect(a).not.toBe(b);
  expect(a.length).toBeGreaterThan(20);

  const h1 = await hashApiKey(a);
  const h2 = await hashApiKey(a);
  expect(h1).toBe(h2);                 // deterministic
  expect(h1).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
  expect(await hashApiKey(b)).not.toBe(h1);
});
