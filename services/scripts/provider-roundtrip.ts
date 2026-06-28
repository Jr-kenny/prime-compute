import { privateKeyToAccount } from "viem/accounts";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createProviderApp } from "../src/provider/server";
import { SimulatedExecutor } from "../src/provider/executor";
import type { AddressInfo } from "node:net";

const providerKey = process.env.PROVIDER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
const brokerKey = process.env.BROKER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com";
const explorer = process.env.ARC_EXPLORER_URL ?? "https://testnet.arcscan.app";

if (!providerKey || !brokerKey) {
  throw new Error("Set PROVIDER_WALLET_PRIVATE_KEY and BROKER_WALLET_PRIVATE_KEY in services/.env");
}

const sellerAddress = privateKeyToAccount(providerKey).address;
const app = createProviderApp({
  executor: new SimulatedExecutor({ hasGpu: true }),
  sellerAddress,
  price: "$0.0001",
  facilitatorUrl,
  meta: { alias: "node-roundtrip", resourceType: "GPU", region: "US-East", specs: { gpu: "H100" } },
});
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
console.log(`provider ${sellerAddress} up on :${port}`);

try {
  const client = new GatewayClient({ chain: "arcTestnet", privateKey: brokerKey });
  console.log("buyer: depositing 0.10 USDC (one-time)...");
  const dep = await client.deposit("0.10");
  console.log("  deposit tx:", `${explorer}/tx/${dep.depositTxHash}`);

  console.log("buyer: paying for one /tick (gas-free)...");
  const result = await client.pay(`http://localhost:${port}/tick?session=roundtrip`);
  console.log("  telemetry:", JSON.stringify((result.data as { telemetry?: unknown }).telemetry));
  console.log("  amount (atomic):", result.amount.toString());

  console.log("\n✅ provider template served a real paid tick on Arc testnet.");
} catch (err) {
  console.error("\n❌ round-trip failed:", err instanceof Error ? err.message : err);
  console.error("If the buyer has no testnet USDC, fund it at https://faucet.circle.com and retry.");
  process.exitCode = 1;
} finally {
  server.close();
}
