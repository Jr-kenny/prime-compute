import { privateKeyToAccount } from "viem/accounts";
import { createProviderApp } from "../src/provider/server";
import { SimulatedExecutor } from "../src/provider/executor";
import type { ResourceType } from "../src/domain";

const key = process.env.PROVIDER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) throw new Error("Set PROVIDER_WALLET_PRIVATE_KEY in services/.env");

const sellerAddress = privateKeyToAccount(key).address;
const port = Number(process.env.PROVIDER_PORT ?? 4001);
const price = process.env.PROVIDER_PRICE ?? "$0.0001";
const resourceType = (process.env.PROVIDER_RESOURCE_TYPE ?? "GPU") as ResourceType;
const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com";
const hasGpu = resourceType === "GPU" || resourceType === "Full Server";

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
});

app.listen(port, () => {
  console.log(`provider ${sellerAddress} serving compute on :${port} at ${price}/charge`);
});
