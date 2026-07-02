// services/src/wallet/circle-user.ts
// The user-controlled wallets slice the identity gate needs. Same idiom as circle.ts
// (developer-controlled): a factory over the real SDK client plus a narrow wrapper the
// bridge takes as a seam, so unit tests never touch the network.
import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import { randomUUID } from "node:crypto";

// The API slice we use; the real client satisfies it, tests stub it.
export type CircleUserApi = {
  createDeviceTokenForEmailLogin(input: { deviceId: string; email: string; idempotencyKey: string }): Promise<any>;
  getUserStatus(input: { userToken: string }): Promise<any>;
  listWallets(input: { userToken: string }): Promise<any>;
  createUserPinWithWallets(input: { userToken: string; blockchains: any[]; accountType: "EOA" }): Promise<any>;
  createTransaction(input: any): Promise<any>;
};

export function makeCircleUserApi(env: Record<string, string | undefined> = process.env): CircleUserApi {
  const apiKey = env.CIRCLE_API_KEY;
  if (!apiKey) throw new Error("CIRCLE_API_KEY required");
  return initiateUserControlledWalletsClient({ apiKey });
}

export type CircleUserStatus = { circleUserId: string; pinStatus: string };
export type ArcWallet = { walletId: string; address: string };

export class CircleUserGate {
  constructor(private api: CircleUserApi, private usdcAddress: string) {}

  /** Email OTP step 1: mint the device token the Web SDK's OTP modal needs. */
  async startEmailLogin(deviceId: string, email: string): Promise<{ deviceToken: string; deviceEncryptionKey?: string; otpToken?: string }> {
    const res = await this.api.createDeviceTokenForEmailLogin({ deviceId, email, idempotencyKey: randomUUID() });
    const d = res.data;
    if (!d?.deviceToken) throw new Error("Circle returned no deviceToken");
    return { deviceToken: d.deviceToken, deviceEncryptionKey: d.deviceEncryptionKey, otpToken: d.otpToken };
  }

  /** Server-side proof a live userToken maps to a Circle user. null = token rejected. */
  async status(userToken: string): Promise<CircleUserStatus | null> {
    try {
      const res = await this.api.getUserStatus({ userToken });
      const u = res.data;
      return u?.id ? { circleUserId: u.id, pinStatus: u.pinStatus ?? "UNSET" } : null;
    } catch {
      return null;
    }
  }

  /** The user's Arc wallet, if the create-wallet challenge has run. */
  async arcWallet(userToken: string): Promise<ArcWallet | null> {
    const res = await this.api.listWallets({ userToken });
    const w = (res.data?.wallets ?? []).find((x: any) => x.blockchain === "ARC-TESTNET");
    return w ? { walletId: w.id, address: String(w.address).toLowerCase() } : null;
  }

  /** First login: one challenge sets the PIN and creates the Arc wallet. */
  async createArcWalletChallenge(userToken: string): Promise<string> {
    const res = await this.api.createUserPinWithWallets({ userToken, blockchains: ["ARC-TESTNET"], accountType: "EOA" });
    const id = res.data?.challengeId;
    if (!id) throw new Error("Circle returned no challengeId");
    return id;
  }

  /** Treasury action: a PIN-gated USDC transfer challenge on Arc. */
  async createTransferChallenge(
    userToken: string,
    input: { walletId: string; amount: string; destinationAddress: string },
  ): Promise<string> {
    const res = await this.api.createTransaction({
      userToken,
      amounts: [input.amount],
      destinationAddress: input.destinationAddress,
      walletId: input.walletId,
      tokenAddress: this.usdcAddress,
      blockchain: "ARC-TESTNET",
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      idempotencyKey: randomUUID(),
    });
    const id = res.data?.challengeId;
    if (!id) throw new Error("Circle returned no challengeId");
    return id;
  }
}
