import { describe, test, expect } from "bun:test";
import { issueLoginNonce, checkLoginNonce } from "./siwe";

const opts = { secret: "test-secret", now: 1_700_000_000_000 };
const addr = "0xAbC0000000000000000000000000000000000001";

describe("login nonce", () => {
  test("round-trips for the issuing address", () => {
    const nonce = issueLoginNonce(addr, opts);
    expect(nonce).toMatch(/^[a-f0-9]{16,}$/); // SIWE-legal: alphanumeric, >8 chars
    expect(checkLoginNonce(nonce, addr, opts)).toBe(true);
  });

  test("rejects a different address", () => {
    const nonce = issueLoginNonce(addr, opts);
    expect(checkLoginNonce(nonce, "0x" + "9".repeat(40), opts)).toBe(false);
  });

  test("address check is case-insensitive", () => {
    const nonce = issueLoginNonce(addr.toLowerCase(), opts);
    expect(checkLoginNonce(nonce, addr.toUpperCase().replace("0X", "0x"), opts)).toBe(true);
  });

  test("expires after the TTL", () => {
    const nonce = issueLoginNonce(addr, opts);
    expect(checkLoginNonce(nonce, addr, { ...opts, now: opts.now + 5 * 60_000 + 1 })).toBe(false);
  });

  test("rejects a tampered mac", () => {
    const nonce = issueLoginNonce(addr, opts);
    const bad = nonce.slice(0, -1) + (nonce.endsWith("0") ? "1" : "0");
    expect(checkLoginNonce(bad, addr, opts)).toBe(false);
  });
});
