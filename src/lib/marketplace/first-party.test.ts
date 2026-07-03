import { describe, test, expect } from "bun:test";
import { isFirstParty } from "./first-party";

describe("isFirstParty", () => {
  test("matches a configured first-party wallet (case-insensitive)", () => {
    const wallets = new Set(["0xabc"]);
    expect(isFirstParty({ ownerWallet: "0xABC" }, wallets)).toBe(true);
  });

  test("a third-party wallet is not first-party", () => {
    const wallets = new Set(["0xabc"]);
    expect(isFirstParty({ ownerWallet: "0xdef" }, wallets)).toBe(false);
  });
});
