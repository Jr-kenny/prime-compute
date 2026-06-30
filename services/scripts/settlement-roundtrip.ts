import { privateKeyToAccount } from "viem/accounts";
import type { AddressInfo } from "node:net";
import { createProviderApp } from "../src/provider/server";
import { SimulatedExecutor } from "../src/provider/executor";
import { GatewaySettlementAdapter } from "../src/settlement/gateway";

const brokerKey = process.env.BROKER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
const providerKey = process.env.PROVIDER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com";

if (!brokerKey || !providerKey) {
  throw new Error("Set BROKER_WALLET_PRIVATE_KEY and PROVIDER_WALLET_PRIVATE_KEY in services/.env");
}

const sellerAddress = privateKeyToAccount(providerKey).address;
const app = createProviderApp({
  executor: new SimulatedExecutor({ hasGpu: true }),
  sellerAddress,
  price: "$0.0001",
  facilitatorUrl,
  meta: { alias: "node-settlement", resourceType: "GPU", region: "US-East", specs: { gpu: "H100" } },
});
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
const url = `http://localhost:${port}/compute?session=settlement`;

try {
  // Cap of 0.001 USDC (1000 atomic) is plenty for a few 100-atomic charges.
  const adapter = new GatewaySettlementAdapter({ privateKey: brokerKey, capAtomic: 1000n, rpcUrl: process.env.ARC_RPC_URL });
  console.log("buyer:", adapter.buyerAddress);

  console.log("ensuring the Gateway balance covers at least 0.0005 USDC...");
  const fund = await adapter.ensureFunded(500n);
  console.log("  funded:", fund.deposited, fund.depositTxHash ?? "(already funded)");

  console.log("paying for one unit of compute...");
  const paid = await adapter.payForCompute(url);
  console.log("  amount (atomic):", paid.amountAtomic.toString());
  console.log("  settlement ref:", paid.settlementRef);
  console.log("  telemetry:", JSON.stringify((paid.data as { telemetry?: unknown }).telemetry));

  console.log("reconciling the batch...");
  const status = await adapter.reconcile(paid.settlementRef);
  console.log("  status:", status.status, "settled:", status.settled);

  console.log("\n✅ settlement adapter paid + reconciled a real charge on Arc testnet.");
} catch (err) {
  console.error("\n❌ settlement round-trip failed:", err instanceof Error ? err.message : err);
  console.error("If the buyer has no testnet USDC, fund it at https://faucet.circle.com and retry.");
  process.exitCode = 1;
} finally {
  server.close();
}
