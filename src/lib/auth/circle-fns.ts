// src/lib/auth/circle-fns.ts
// Identity v2 server-fns: the email-OTP login handshake, the userToken -> session bridge,
// and PIN-gated treasury transfers. Circle SDK imports are dynamic so they stay out of the
// client bundle (same pattern as src/lib/wallet/server-fns.ts).
import { createServerFn } from "@tanstack/react-start";
import { circleGateLogin } from "./circle-bridge";
import { mintSessionForWallet } from "./mint-session";
import { requireUser } from "./require-user";

async function gate() {
  const { CircleUserGate, makeCircleUserApi } = await import("@services/wallet/circle-user");
  const usdc = process.env.USDC_ADDRESS;
  if (!usdc) throw new Error("USDC_ADDRESS required");
  return new CircleUserGate(makeCircleUserApi(), usdc);
}

// Step 1 of login: the client hands us its SDK deviceId + the user's email; Circle emails
// the OTP and we return the device token triple the Web SDK's OTP modal needs.
export const startEmailLogin = createServerFn({ method: "POST" })
  .validator((d: { deviceId: string; email: string }) => d)
  .handler(async ({ data }) => (await gate()).startEmailLogin(data.deviceId, data.email));

// Step 2 (and 3, after a first-login wallet challenge): verify the userToken, then either
// hand back the PIN+wallet challengeId or mint the app session.
export const completeCircleLogin = createServerFn({ method: "POST" })
  .validator((d: { userToken: string }) => d)
  .handler(async ({ data }) => {
    const g = await gate();
    return circleGateLogin(
      {
        status: (t) => g.status(t),
        arcWallet: (t) => g.arcWallet(t),
        createArcWalletChallenge: (t) => g.createArcWalletChallenge(t),
        mint: (input) => mintSessionForWallet(input),
      },
      data.userToken,
    );
  });

// Treasury action: a PIN-gated USDC transfer challenge from the user's own Circle wallet
// (fund the spend wallet, or withdraw to any external address). The userToken must belong
// to the signed-in profile, so one user can't build challenges against another's session.
export const treasuryTransferChallenge = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; userToken: string; amount: string; destinationAddress: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    if (!/^\d+(\.\d{1,6})?$/.test(data.amount.trim()) || Number(data.amount) <= 0) throw new Error("invalid amount");
    if (!/^0x[0-9a-fA-F]{40}$/.test(data.destinationAddress)) throw new Error("invalid destination address");

    const g = await gate();
    const status = await g.status(data.userToken);
    if (!status) throw new Error("Circle session expired — sign in again");
    const { supabaseAdmin } = await import("../supabase/server");
    const { data: profile, error } = await supabaseAdmin()
      .from("profiles").select("circle_user_id").eq("id", user.id).single();
    if (error) throw error;
    if (!profile.circle_user_id || profile.circle_user_id !== status.circleUserId) {
      throw new Error("Circle session does not belong to this account");
    }

    const wallet = await g.arcWallet(data.userToken);
    if (!wallet) throw new Error("no Arc treasury wallet on this Circle account");
    const challengeId = await g.createTransferChallenge(data.userToken, {
      walletId: wallet.walletId, amount: data.amount.trim(), destinationAddress: data.destinationAddress,
    });
    return { challengeId };
  });

// The treasury balance is an ordinary on-chain read of the session's wallet address (the
// identity anchor) — no Circle token needed, so the sheet shows it whenever the app
// session is live.
export const getTreasuryBalance = createServerFn({ method: "GET" })
  .validator((d: { accessToken: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    const { getOnchain } = await import("../wallet/store");
    try {
      const atomic = await getOnchain().usdcBalance(user.walletAddress);
      return { address: user.walletAddress, usdcFormatted: (Number(atomic) / 1_000_000).toFixed(6) };
    } catch {
      return { address: user.walletAddress, usdcFormatted: null };
    }
  });
