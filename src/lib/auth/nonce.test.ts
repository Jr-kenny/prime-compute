import { test, expect } from "bun:test";
import { issueNonce, verifyNonce } from "./nonce";

const secret = "test-secret-please-change";
const addr = "0xabc0000000000000000000000000000000000001";

test("a freshly issued nonce verifies for its address", () => {
  const nonce = issueNonce(addr, { secret, now: 1000 });
  expect(verifyNonce(nonce, addr, { secret, now: 1000 + 30_000 }).ok).toBe(true);
});

test("a nonce for one address does not verify for another", () => {
  const nonce = issueNonce(addr, { secret, now: 1000 });
  expect(verifyNonce(nonce, "0xdifferent", { secret, now: 1000 }).ok).toBe(false);
});

test("an expired nonce is rejected", () => {
  const nonce = issueNonce(addr, { secret, now: 1000 });
  expect(verifyNonce(nonce, addr, { secret, now: 1000 + 10 * 60_000 }).ok).toBe(false);
});

test("a tampered nonce is rejected", () => {
  const nonce = issueNonce(addr, { secret, now: 1000 });
  expect(verifyNonce(nonce + "x", addr, { secret, now: 1000 }).ok).toBe(false);
});
