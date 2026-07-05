import { GatewayClient } from "@circle-fin/x402-batching/client";

// Instant Gateway reclaim for a raw-key wallet: the proven SDK path (GatewayClient.withdraw does the
// burn-intent + /transfer + mint itself), so raw-key wallets don't need the reconstructed dance that
// Circle-custodied wallets do. Lives in services so the x402-batching SDK stays out of the app bundle
// (the app calls this via @services). Amount is atomic; the SDK takes a decimal USDC string.
export async function rawGatewayReclaim(
  privateKey: `0x${string}`,
  amountAtomic: bigint,
  recipient: `0x${string}`,
  opts: { rpcUrl?: string } = {},
): Promise<string> {
  const gc = new GatewayClient({ chain: "arcTestnet", privateKey, ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}) });
  const res = await gc.withdraw((Number(amountAtomic) / 1_000_000).toString(), { recipient });
  return res.mintTxHash;
}
