import { privateKeyToAccount } from "viem/accounts";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createProviderApp } from "../src/provider/server";
import { SimulatedExecutor } from "../src/provider/executor";
import { createFeeRemitter } from "../src/provider/remitter";
import type { ResourceType } from "../src/domain";

const key = process.env.PROVIDER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) throw new Error("Set PROVIDER_WALLET_PRIVATE_KEY in services/.env");

const sellerAddress = privateKeyToAccount(key).address;
// Render (and most hosts) inject $PORT; honor it first so this same script is the always-on
// provider in the cloud, and fall back to PROVIDER_PORT/4001 for local runs.
const port = Number(process.env.PORT ?? process.env.PROVIDER_PORT ?? 4001);
const price = process.env.PROVIDER_PRICE ?? "$0.0001";
const resourceType = (process.env.PROVIDER_RESOURCE_TYPE ?? "GPU") as ResourceType;
const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com";
const hasGpu = resourceType === "GPU" || resourceType === "Full Server";

// Fee remittance: the platform's cut comes out of THIS provider's Gateway earnings.
// Without treasury+remit config the provider simply accrues visible receivables.
const treasury = process.env.PLATFORM_TREASURY_ADDRESS as `0x${string}` | undefined;
const remitUrl = process.env.PLATFORM_REMIT_URL; // e.g. https://<worker-host>
const providerId = process.env.PROVIDER_ID;      // printed by seed/registration
const feeBps = Number(process.env.PLATFORM_FEE_BPS ?? "100");

let onPayment: ((amountAtomic: bigint) => void) | undefined;
let remitterFlush: (() => Promise<void>) | undefined;
if (treasury && remitUrl && providerId && feeBps > 0) {
  const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: key });
  const remitter = createFeeRemitter({
    feeBps,
    thresholdAtomic: BigInt(process.env.FEE_REMIT_THRESHOLD_ATOMIC ?? "100000"), // $0.10 (withdraw fee is ~0.0035 USDC)
    withdraw: async (atomic) => {
      const res = await gateway.withdraw((Number(atomic) / 1_000_000).toString(), {
        recipient: treasury,
        ...(process.env.FEE_REMIT_MAX_FEE_USDC ? { maxFee: process.env.FEE_REMIT_MAX_FEE_USDC } : {}),
      });
      return { txHash: res.mintTxHash };
    },
    report: async (r) => {
      const res = await fetch(`${remitUrl}/remittances`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId, txHash: r.txHash, amountAtomic: r.amountAtomic.toString() }),
      });
      if (!res.ok) throw new Error(`remit report failed (${res.status})`);
    },
  });
  onPayment = (atomic) => { void remitter.onPayment(atomic); };
  remitterFlush = remitter.flush;
  console.log(`[provider] remitting ${feeBps}bps of earnings to ${treasury} via ${remitUrl}`);
} else {
  console.warn("[provider] fee remitter disabled (needs PLATFORM_TREASURY_ADDRESS, PLATFORM_REMIT_URL, PROVIDER_ID, PLATFORM_FEE_BPS>0)");
}

const app = createProviderApp({
  executor: new SimulatedExecutor({ hasGpu }),
  sellerAddress,
  price,
  facilitatorUrl,
  meta: {
    alias: process.env.PROVIDER_ALIAS ?? "node-local-1",
    resourceType,
    region: process.env.PROVIDER_REGION ?? "US-East",
    specs: hasGpu ? { gpu: "NVIDIA H100", vramGb: 80 } : { cpuCores: 64, ramGb: 256 },
  },
  onPayment,
});

app.listen(port, () => {
  console.log(`provider ${sellerAddress} serving compute on :${port} at ${price}/charge`);
});

// Flush accrued fees on graceful shutdown so small remainders don't strand until restart.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    try { await remitterFlush?.(); } finally { process.exit(0); }
  });
}
