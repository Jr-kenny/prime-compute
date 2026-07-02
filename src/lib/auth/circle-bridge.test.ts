// src/lib/auth/circle-bridge.test.ts
import { test, expect } from "bun:test";
import { circleGateLogin, type CircleBridgeDeps } from "./circle-bridge";

function deps(overrides: Partial<CircleBridgeDeps> = {}): CircleBridgeDeps & { minted: any[] } {
  const minted: any[] = [];
  return {
    minted,
    status: async () => ({ circleUserId: "cu-1", pinStatus: "ENABLED" }),
    arcWallet: async () => ({ walletId: "w-1", address: "0xabc" }),
    createArcWalletChallenge: async () => "ch-9",
    mint: async (input) => { minted.push(input); return { access_token: "at", refresh_token: "rt" }; },
    ...overrides,
  };
}

test("a valid token with a wallet mints a session and stamps circle_user_id", async () => {
  const d = deps();
  const out = await circleGateLogin(d, "tok");
  expect(out).toEqual({ kind: "session", access_token: "at", refresh_token: "rt" });
  expect(d.minted).toEqual([{ address: "0xabc", walletId: "w-1", circleUserId: "cu-1" }]);
});

test("a rejected token is a failed login", async () => {
  const d = deps({ status: async () => null });
  await expect(circleGateLogin(d, "bad")).rejects.toThrow(/login/i);
  expect(d.minted).toEqual([]);
});

test("no wallet yet -> returns the PIN+wallet challenge instead of a session", async () => {
  const d = deps({ arcWallet: async () => null });
  const out = await circleGateLogin(d, "tok");
  expect(out).toEqual({ kind: "challenge", challengeId: "ch-9" });
  expect(d.minted).toEqual([]);
});

test("an existing wallet keeps mapping to the same user (mint is keyed by address)", async () => {
  const d = deps();
  await circleGateLogin(d, "tok");
  await circleGateLogin(d, "tok");
  expect(d.minted.map((m) => m.address)).toEqual(["0xabc", "0xabc"]);
});
