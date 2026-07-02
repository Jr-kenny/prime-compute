// services/src/wallet/circle-user.test.ts
import { test, expect } from "bun:test";
import { CircleUserGate, type CircleUserApi } from "./circle-user";

function apiStub(overrides: Partial<CircleUserApi> = {}): CircleUserApi {
  return {
    createDeviceTokenForEmailLogin: async () => ({ data: { deviceToken: "dt", deviceEncryptionKey: "dek", otpToken: "ot" } }) as any,
    getUserStatus: async () => ({ data: { id: "circle-u1", status: "ENABLED", pinStatus: "ENABLED" } }) as any,
    listWallets: async () => ({ data: { wallets: [
      { id: "w-base", address: "0xbase", blockchain: "BASE-SEPOLIA" },
      { id: "w-arc", address: "0xARC", blockchain: "ARC-TESTNET" },
    ] } }) as any,
    createUserPinWithWallets: async () => ({ data: { challengeId: "ch-1" } }) as any,
    createTransaction: async () => ({ data: { challengeId: "ch-tx" } }) as any,
    ...overrides,
  };
}

test("status maps the Circle user; a throwing call (rejected token) is null", async () => {
  const gate = new CircleUserGate(apiStub(), "0x36USDC");
  expect(await gate.status("tok")).toEqual({ circleUserId: "circle-u1", pinStatus: "ENABLED" });
  const rejected = new CircleUserGate(apiStub({ getUserStatus: async () => { throw new Error("401"); } }), "0x36USDC");
  expect(await rejected.status("bad")).toBeNull();
});

test("arcWallet picks the ARC-TESTNET wallet and lower-cases the address", async () => {
  const gate = new CircleUserGate(apiStub(), "0x36USDC");
  expect(await gate.arcWallet("tok")).toEqual({ walletId: "w-arc", address: "0xarc" });
  const none = new CircleUserGate(apiStub({ listWallets: async () => ({ data: { wallets: [] } }) as any }), "0x36USDC");
  expect(await none.arcWallet("tok")).toBeNull();
});

test("createArcWalletChallenge returns the challengeId", async () => {
  const gate = new CircleUserGate(apiStub(), "0x36USDC");
  expect(await gate.createArcWalletChallenge("tok")).toBe("ch-1");
});

test("createTransferChallenge sends a USDC level-fee transfer on ARC-TESTNET", async () => {
  let sent: any;
  const gate = new CircleUserGate(apiStub({ createTransaction: async (input: any) => { sent = input; return { data: { challengeId: "ch-tx" } } as any; } }), "0x36USDC");
  const id = await gate.createTransferChallenge("tok", { walletId: "w-arc", amount: "1.5", destinationAddress: "0xdest" });
  expect(id).toBe("ch-tx");
  expect(sent.amounts).toEqual(["1.5"]);
  expect(sent.destinationAddress).toBe("0xdest");
  expect(sent.walletId).toBe("w-arc");
  expect(sent.tokenAddress).toBe("0x36USDC");
  expect(sent.blockchain).toBe("ARC-TESTNET");
  expect(sent.fee).toEqual({ type: "level", config: { feeLevel: "MEDIUM" } });
  expect(typeof sent.idempotencyKey).toBe("string");
});

test("startEmailLogin returns the device-token triple", async () => {
  const gate = new CircleUserGate(apiStub(), "0x36USDC");
  expect(await gate.startEmailLogin("dev-1", "a@b.c")).toEqual({ deviceToken: "dt", deviceEncryptionKey: "dek", otpToken: "ot" });
});
