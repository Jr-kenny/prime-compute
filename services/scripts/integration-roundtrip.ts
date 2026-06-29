import { privateKeyToAccount } from "viem/accounts";
import { defaultTrust } from "../src/trust/trust";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createProviderApp } from "../src/provider/server";
import { SimulatedExecutor } from "../src/provider/executor";
import { InMemoryRegistry } from "../src/registry/in-memory";
import { GatewaySettlementAdapter } from "../src/settlement/gateway";
import { runRent } from "../src/broker/runner";
import { reconcileRent } from "../src/broker/reconcile";
import { liveBrokerDeps } from "../src/broker/deps";

const brokerKey = process.env.BROKER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
const providerKey = process.env.PROVIDER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com";

if (!brokerKey || !providerKey) {
  throw new Error("Set BROKER_WALLET_PRIVATE_KEY and PROVIDER_WALLET_PRIVATE_KEY in services/.env");
}

const sellerAddress = privateKeyToAccount(providerKey).address;

function startProvider(alias: string): { server: Server; port: number } {
  const app = createProviderApp({
    executor: new SimulatedExecutor({ hasGpu: true }),
    sellerAddress,
    price: "$0.0001",
    facilitatorUrl,
    meta: { alias, resourceType: "GPU", region: "US-East", specs: { gpu: "H100" } },
  });
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

const reg = new InMemoryRegistry();
const settlement = new GatewaySettlementAdapter({ privateKey: brokerKey, capAtomic: 5_000n });
console.log("broker buyer:", settlement.buyerAddress);

// The deployed broker ranks providers by reasoning from the shipped soul (deterministic
// scorer is the fallback when the model is unavailable). Migration stays deterministic in
// these scenarios (no holdBudget set), so the on-chain proof of migrate-on-degrade does not
// depend on the model.
const broker = await liveBrokerDeps();

// ---- Scenario 1: degrade -> migrate -------------------------------------------
const a = startProvider("prov-A");
const b = startProvider("prov-B");
let aClosed = false;

try {
  // A ranks first (at equal price it wins on score + latency, under the soul and the
  // deterministic fallback alike) so the broker starts there, then we kill A.
  const provA = await reg.registerProvider({
    alias: "prov-A", ownerWallet: sellerAddress, endpointUrl: `http://localhost:${a.port}`,
    resourceType: "GPU", region: "US-East", specs: { gpu: "H100" }, online: true,
    trust: defaultTrust(), pricePerCharge: 0.0001, computeScore: 99, avgLatencyMs: 4,
  });
  const provB = await reg.registerProvider({
    alias: "prov-B", ownerWallet: sellerAddress, endpointUrl: `http://localhost:${b.port}`,
    resourceType: "GPU", region: "US-East", specs: { gpu: "H100" }, online: true,
    trust: defaultTrust(), pricePerCharge: 0.0001, computeScore: 80, avgLatencyMs: 6,
  });
  const rent = await reg.createRent({ name: "degrade-demo", userId: "u1", spec: { resourceType: "GPU", region: null }, autonomyArmed: true });

  // Watcher: once A has served 2 real charges, drop it so the next charge fails.
  const watcher = setInterval(async () => {
    const onA = (await reg.listCharges(rent.id)).filter((c) => c.providerId === provA.id).length;
    if (!aClosed && onA >= 2) {
      aClosed = true;
      a.server.close();
      console.log("  ⚡ provider A dropped after", onA, "charges; broker should migrate to B");
    }
  }, 25);

  console.log("running degrade -> migrate rent (maxUnits 4, maxMigrations 1)...");
  const result = await runRent(rent.id, { registry: reg, settlement, ...broker }, { maxUnits: 4, maxMigrations: 1 });
  clearInterval(watcher);

  const finalized = await reg.getRent(rent.id);
  const charges = await reg.listCharges(rent.id);
  const onA = charges.filter((c) => c.providerId === provA.id);
  const onB = charges.filter((c) => c.providerId === provB.id);
  console.log("  stoppedBy:", result.stoppedBy, "migrations:", result.migrations, "units:", result.units);
  console.log("  status:", finalized?.status, "totalCost (atomic):", finalized?.totalCost);
  console.log("  charges on A:", onA.length, "on B:", onB.length, "seq:", charges.map((c) => c.seq).join(","));

  const seqOk = charges.map((c) => c.seq).every((s, i) => s === i);
  if (result.migrations === 1 && onA.length > 0 && onB.length > 0 && finalized?.status === "completed" && seqOk) {
    console.log("  ✅ scenario 1: broker autonomously migrated A -> B and finished on-chain.");
  } else {
    throw new Error("scenario 1 did not migrate cleanly");
  }

  // ---- Scenario 2: cancel-mid-stream ------------------------------------------
  console.log("\nrunning cancel-mid-stream rent on B (cancel after 2)...");
  const rent2 = await reg.createRent({ name: "cancel-demo", userId: "u1", spec: { resourceType: "GPU", region: null }, autonomyArmed: true });
  // Only B is up now; B is the only GPU online provider that still serves.
  let n = 0;
  const result2 = await runRent(rent2.id, { registry: reg, settlement, ...broker }, { maxUnits: 100, maxMigrations: 0, shouldStop: () => n++ >= 2 });
  const finalized2 = await reg.getRent(rent2.id);
  console.log("  stoppedBy:", result2.stoppedBy, "units:", result2.units, "status:", finalized2?.status, "totalCost (atomic):", finalized2?.totalCost);
  if (result2.stoppedBy === "cancel" && result2.units === 2 && finalized2?.status === "cancelled" && finalized2?.totalCost === 200) {
    console.log("  ✅ scenario 2: ticking stopped within one charge; only consumed charges were paid.");
  } else {
    throw new Error("scenario 2 did not cancel cleanly");
  }

  console.log("\nreconciling all charges...");
  const settled = (await reconcileRent(reg, settlement, rent.id)) + (await reconcileRent(reg, settlement, rent2.id));
  console.log("  newly settled:", settled, "(batches may still be pending right after paying)");

  console.log("\n✅ full autonomous broker thread ran on Arc testnet.");
} catch (err) {
  console.error("\n❌ integration run failed:", err instanceof Error ? err.message : err);
  console.error("If the buyer has no testnet USDC, fund it at https://faucet.circle.com and retry.");
  process.exitCode = 1;
} finally {
  if (!aClosed) a.server.close();
  b.server.close();
}
