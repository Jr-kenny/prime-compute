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

// The user's deposited Gateway float plus a cheap active-lease count, so the wallet sheet can warn
// that reclaiming won't stop a running lease (auto-topup would just re-fund it). Address resolves
// through the same backend switch as the spend-wallet balance; the float read is backend-agnostic.
export const getGatewayBalanceFn = createServerFn({ method: "GET" })
  .validator((d: { accessToken: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    const { walletProviderFor, liveWalletDeps } = await import("../marketplace/wallet");
    const principal = { kind: "user" as const, id: user.id, walletAddress: "" };
    const { address } = await walletProviderFor(principal, liveWalletDeps(principal)).getOrCreate();
    const { getGatewayBalance } = await import("@services/settlement/gateway-balance");
    const { supabaseAdmin } = await import("../supabase/server");
    let availableAtomic = "0", formatted = "0";
    try {
      const b = await getGatewayBalance(address);
      availableAtomic = b.availableAtomic.toString();
      formatted = b.formatted;
    } catch {
      // float read is best-effort; the sheet still shows the address + a zero float on a transient failure
    }
    const { count } = await supabaseAdmin()
      .from("rents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("status", ["queued", "running", "suspended"]);
    return { address, availableAtomic, formatted, activeLeaseCount: count ?? 0 };
  });

// Reclaim the user's full Gateway float (minus a fee buffer) back to their own wallet. Circle-custodied
// (the default backend) signs a burn intent with circleBatchSigner and mints via Circle; a raw-key
// wallet uses the SDK GatewayClient. The fee buffer stays behind to cover the withdraw fee measured
// live (~0.0036 USDC on Arc); reclaimFor no-ops when the float can't cover it.
export const reclaimGatewayFloat = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    const { walletProviderFor, liveWalletDeps } = await import("../marketplace/wallet");
    const principal = { kind: "user" as const, id: user.id, walletAddress: "" };
    const { address } = await walletProviderFor(principal, liveWalletDeps(principal)).getOrCreate();
    const { getGatewayBalance } = await import("@services/settlement/gateway-balance");
    const { reclaimFor } = await import("./reclaim");
    const feeBufferAtomic = BigInt(process.env.RECLAIM_FEE_BUFFER_ATOMIC ?? "5000");
    const readFloat = async () => (await getGatewayBalance(address)).availableAtomic;

    const { supabaseAdmin } = await import("../supabase/server");
    const { data: cw } = await supabaseAdmin()
      .from("circle_wallets")
      .select("wallet_id")
      .eq("owner_kind", "user")
      .eq("owner_id", user.id)
      .maybeSingle();

    if (cw) {
      const { makeCircleClient } = await import("@services/wallet/circle");
      const { circleBatchSigner } = await import("@services/settlement/circle-signer");
      const { gatewayWithdraw } = await import("@services/settlement/gateway-withdraw");
      const { mintViaCircle } = await import("@services/settlement/circle-gateway");
      const client = makeCircleClient();
      const walletId = cw.wallet_id as string;
      const signer = circleBatchSigner(client, walletId, address);
      return reclaimFor({
        address,
        feeBufferAtomic,
        readFloat,
        circle: {
          withdraw: (amount, recipient) =>
            gatewayWithdraw(amount, { signer, recipient, maxFeeAtomic: feeBufferAtomic, mint: (att, sig) => mintViaCircle(client, walletId, att, sig) }).then((r) => r.mintTxHash),
        },
      });
    }

    const signer = await getSpendWalletStore().loadSigner(user.id);
    if (!signer) throw new Error("no spend wallet for user");
    const { rawGatewayReclaim } = await import("@services/settlement/raw-reclaim");
    return reclaimFor({
      address,
      feeBufferAtomic,
      readFloat,
      raw: {
        withdraw: (amount, recipient) => rawGatewayReclaim(signer.privateKey, amount, recipient as `0x${string}`, { rpcUrl: process.env.ARC_RPC_URL }),
      },
    });
  });
