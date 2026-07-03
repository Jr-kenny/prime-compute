import { describe, test, expect } from "bun:test";
import { issueLoginNonce, checkLoginNonce, siweLogin, type SiweLoginDeps } from "./siwe";
import { parseSiweMessage } from "viem/siwe";

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

const now = 1_700_000_000_000;
function makeMessage(a: string, nonce: string): string {
  // Minimal valid EIP-4361 message; parseSiweMessage must read address+nonce out of it.
  return [
    "primecompute.vercel.app wants you to sign in with your Ethereum account:",
    a,
    "",
    "Sign in to Prime Compute",
    "",
    "URI: https://primecompute.vercel.app",
    "Version: 1",
    "Chain ID: 5042002",
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(now).toISOString()}`,
  ].join("\n");
}

describe("siweLogin bridge", () => {
  const address = "0x52908400098527886E0F7030069857D2E4169EE7"; // EIP-55 valid
  const deps = (ok: boolean): SiweLoginDeps => ({
    verify: async () => ok,
    mint: async (input) => {
      expect(input.address).toBe(address.toLowerCase());
      return { access_token: "at", refresh_token: "rt" };
    },
  });
  const o = { secret: "test-secret", now };

  test("valid signature mints a session for the lower-cased address", async () => {
    const nonce = issueLoginNonce(address, o);
    const r = await siweLogin(deps(true), { message: makeMessage(address, nonce), signature: "0xsig" }, o);
    expect(r).toEqual({ access_token: "at", refresh_token: "rt" });
  });

  test("bad signature throws with the address named", async () => {
    const nonce = issueLoginNonce(address, o);
    await expect(
      siweLogin(deps(false), { message: makeMessage(address, nonce), signature: "0xsig" }, o),
    ).rejects.toThrow(/signature didn't verify/);
  });

  test("nonce for another address throws", async () => {
    const nonce = issueLoginNonce("0x" + "1".repeat(40), o);
    await expect(
      siweLogin(deps(true), { message: makeMessage(address, nonce), signature: "0xsig" }, o),
    ).rejects.toThrow(/nonce/);
  });

  test("sanity: viem parses the test message", () => {
    const nonce = issueLoginNonce(address, o);
    const parsed = parseSiweMessage(makeMessage(address, nonce));
    expect(parsed.address).toBe(address);
    expect(parsed.nonce).toBe(nonce);
  });
});
