import { createServerFn } from "@tanstack/react-start";
import { requireUser } from "../auth/require-user";
import { getSpendWalletStore, getOnchain } from "./store";

// USDC has 6 decimals. Atomic -> human string for the UI.
function formatUsdc(atomic: bigint): string {
  const neg = atomic < 0n;
  const v = (neg ? -atomic : atomic).toString().padStart(7, "0");
  const whole = v.slice(0, v.length - 6);
  const frac = v.slice(v.length - 6).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

// Returns the user's spend-wallet (EOA) address and live USDC balance on Arc. Creates the
// wallet on first call so a brand-new user immediately has an address to fund. The address
// is returned even when the on-chain balance read fails, so the UI can always show and copy
// the EOA address (balance just shows as unavailable until the next poll succeeds).
export const getSpendWalletBalance = createServerFn({ method: "GET" })
  .validator((d: { accessToken: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    // Provisioning goes through the backend switch (Circle-custodied when flipped on),
    // dynamically imported so the Circle SDK stays out of the client bundle. The balance
    // read below is address-based and backend-agnostic.
    const { walletProviderFor, liveWalletDeps } = await import("../marketplace/wallet");
    const principal = { kind: "user" as const, id: user.id, walletAddress: "" };
    const { address } = await walletProviderFor(principal, liveWalletDeps(principal)).getOrCreate();
    try {
      const usdcAtomic = await getOnchain().usdcBalance(address);
      return { address, usdcAtomic: usdcAtomic.toString(), usdcFormatted: formatUsdc(usdcAtomic) };
    } catch {
      return { address, usdcAtomic: null, usdcFormatted: null };
    }
  });

// Signs an ERC-20 USDC transfer out of the user's spend wallet on Arc. The signer (and
// thus the private key) never leaves the server. Amount is a decimal USDC string.
export const withdrawFromSpendWallet = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; toAddress: string; amount: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    if (!/^0x[0-9a-fA-F]{40}$/.test(data.toAddress)) throw new Error("invalid destination address");
    const atomic = parseUsdc(data.amount);
    if (atomic <= 0n) throw new Error("amount must be positive");

    // Circle-custodied wallets first: the key lives at Circle, so the withdrawal is a
    // Circle transaction, not a locally signed transfer. Dynamic imports keep the Circle
    // SDK out of the client bundle. txHash carries the Circle transaction id here.
    const { supabaseAdmin } = await import("../supabase/server");
    const { data: cw } = await supabaseAdmin()
      .from("circle_wallets")
      .select("wallet_id")
      .eq("owner_kind", "user")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (cw) {
      const { makeCircleClient } = await import("@services/wallet/circle");
      const client = makeCircleClient();
      const res: any = await client.createTransaction({
        walletId: cw.wallet_id as string,
        tokenAddress: process.env.USDC_ADDRESS!,
        blockchain: "ARC-TESTNET" as any,
        destinationAddress: data.toAddress,
        amount: [data.amount],
        fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      });
      return { txHash: res.data?.id as string };
    }

    const signer = await getSpendWalletStore().loadSigner(user.id);
    if (!signer) throw new Error("no spend wallet for user");
    const txHash = await getOnchain().usdcTransfer(signer, data.toAddress, atomic);
    return { txHash };
  });

function parseUsdc(s: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(s.trim())) throw new Error("invalid amount");
  const [whole, frac = ""] = s.trim().split(".");
  return BigInt(whole + frac.padEnd(6, "0"));
}
