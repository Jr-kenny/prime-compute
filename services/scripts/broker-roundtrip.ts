import { privateKeyToAccount } from "viem/accounts";
import type { AddressInfo } from "node:net";
import { createProviderApp } from "../src/provider/server";
import { SimulatedExecutor } from "../src/provider/executor";
import { InMemoryRegistry } from "../src/registry/in-memory";
import { GatewaySettlementAdapter } from "../src/settlement/gateway";
import { runRent } from "../src/broker/runner";
import { reconcileRent } from "../src/broker/reconcile";

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
  meta: { alias: "node-broker", resourceType: "GPU", region: "US-East", specs: { gpu: "H100" } },
});
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;

try {
  const reg = new InMemoryRegistry();
  await reg.registerProvider({
    alias: "node-broker", ownerWallet: sellerAddress, endpointUrl: `http://localhost:${port}`,
    resourceType: "GPU", region: "US-East", specs: { gpu: "H100" }, online: true,
    stakeAmount: 100, pricePerCharge: 0.0001, computeScore: 95, avgLatencyMs: 5,
  });
  const rent = await reg.createRent({ name: "broker-demo", userId: "u1", spec: { resourceType: "GPU", region: null }, autonomyArmed: true });

  const settlement = new GatewaySettlementAdapter({ privateKey: brokerKey, capAtomic: 1000n });
  console.log("broker buyer:", settlement.buyerAddress);

  console.log("running the rent for 3 units...");
  const result = await runRent(rent.id, { registry: reg, settlement }, { maxUnits: 3 });
  console.log("  stoppedBy:", result.stoppedBy, "units:", result.units);

  const finalized = await reg.getRent(rent.id);
  console.log("  rent status:", finalized?.status, "totalCost (atomic):", finalized?.totalCost);
  console.log("  charges:", (await reg.listCharges(rent.id)).map((c) => `${c.seq}:${c.amount}:${c.settlementRef}`));

  console.log("reconciling...");
  const settled = await reconcileRent(reg, settlement, rent.id);
  console.log("  newly settled:", settled, "(batches may still be pending right after paying)");

  console.log("\n✅ full broker loop ran on Arc testnet.");
} catch (err) {
  console.error("\n❌ broker loop failed:", err instanceof Error ? err.message : err);
  console.error("If the buyer has no testnet USDC, fund it at https://faucet.circle.com and retry.");
  process.exitCode = 1;
} finally {
  server.close();
}
