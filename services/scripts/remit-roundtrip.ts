// services/scripts/remit-roundtrip.ts
// Live proof (spends real testnet USDC): a raw-key buyer pays N gross x402 charges to a
// local provider; the provider's remitter withdraws the accrued fee from its Gateway
// earnings to the treasury; the local remittance handler verifies the tx on-chain and
// stamps the receivables. Needs: BROKER_WALLET_PRIVATE_KEY (funded buyer),
// PROVIDER_WALLET_PRIVATE_KEY (seller, needs gas for the withdraw), USDC_ADDRESS,
// ARC_RPC_URL, PLATFORM_TREASURY_ADDRESS.
import { createServer } from "node:http";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createProviderApp } from "../src/provider/server";
import { SimulatedExecutor } from "../src/provider/executor";
import { createFeeRemitter } from "../src/provider/remitter";
import { GatewaySettlementAdapter } from "../src/settlement/gateway";
import { InMemoryRegistry } from "../src/registry/in-memory";
import { defaultTrust } from "../src/trust/trust";
import { handleRemittance } from "../src/worker/remit";
import { transferredToTreasury, makeReceiptReader } from "../src/worker/verify-remittance";

const buyerKey = process.env.BROKER_WALLET_PRIVATE_KEY as `0x${string}`;
const sellerKey = process.env.PROVIDER_WALLET_PRIVATE_KEY as `0x${string}`;
const usdc = process.env.USDC_ADDRESS!;
const rpcUrl = process.env.ARC_RPC_URL!;
const treasury = process.env.PLATFORM_TREASURY_ADDRESS as `0x${string}`;
if (!buyerKey || !sellerKey || !usdc || !rpcUrl || !treasury) throw new Error("missing env (see header)");

const reg = new InMemoryRegistry();
const provider = await reg.registerProvider({
  alias: "remit-rt", ownerWallet: "0xseller", endpointUrl: "http://localhost:4112", resourceType: "GPU",
  region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 1,
});
const rent = await reg.createRent({ name: "remit-rt", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null } });

const sellerGateway = new GatewayClient({ chain: "arcTestnet", privateKey: sellerKey });
const reports: { txHash: string; amountAtomic: bigint }[] = [];
const remitter = createFeeRemitter({
  feeBps: 100, thresholdAtomic: 1n, // remit on the first accrual for the proof
  withdraw: async (atomic) => {
    const res = await sellerGateway.withdraw((Number(atomic) / 1_000_000).toString(), { recipient: treasury });
    return { txHash: res.mintTxHash };
  },
  report: async (r) => { reports.push(r); },
});

const app = createProviderApp({
  executor: new SimulatedExecutor(), sellerAddress: sellerGateway.address, price: "$0.0001",
  facilitatorUrl: "https://gateway-api-testnet.circle.com",
  meta: { alias: "remit-rt", resourceType: "GPU", region: "US-East", specs: {} },
  onPayment: (atomic) => { void remitter.onPayment(atomic); },
});
const server = createServer(app);
await new Promise<void>((r) => server.listen(4112, r));

const buyer = new GatewaySettlementAdapter({ privateKey: buyerKey, capAtomic: 10_000n, chain: "arcTestnet", rpcUrl });
console.log("[1] funding + paying 3 gross charges…");
await buyer.ensureFunded(1_000n);
for (let seq = 0; seq < 3; seq++) {
  const paid = await buyer.payForCompute("http://localhost:4112/compute?session=remit-rt");
  await reg.recordCharge({
    rentId: rent.id, providerId: provider.id, seq, amount: Number(paid.amountAtomic),
    feeAmount: Math.floor(Number(paid.amountAtomic) / 100), feeSettlementRef: null,
    authorizationRef: null, settled: false, settlementRef: paid.settlementRef,
  });
  console.log(`  charge ${seq}: paid ${paid.amountAtomic} (gross)`);
}
console.log("[2] flushing the remitter (withdraw earnings -> treasury)…");
// onPayment kicks off a threshold flush in the background; flush() no-ops while one is
// in flight, so poll until the withdraw lands (or times out) instead of checking once.
for (let i = 0; i < 30 && reports.length === 0; i++) {
  await remitter.flush();
  if (reports.length === 0) await new Promise((r) => setTimeout(r, 5_000));
}
const report = reports[0];
if (!report) throw new Error("remitter produced no report — withdraw failed? (check seller gas + Gateway balance timing: batch settlement must land before earnings are withdrawable)");
console.log("  remitted", report.amountAtomic, "tx", report.txHash);

console.log("[3] verifying + stamping via the worker handler…");
const reader = makeReceiptReader(rpcUrl);
const res = await handleRemittance(
  new Request("http://local/remittances", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId: provider.id, txHash: report.txHash, amountAtomic: report.amountAtomic.toString() }) }),
  { registry: reg, verify: (tx) => transferredToTreasury(reader, tx, usdc, treasury) },
);
console.log("  handler:", res.status, await res.json());
console.log("  outstanding after:", (await reg.listOutstandingFeeCharges(provider.id)).length);
server.close();
console.log("✅ gross stream -> provider Gateway earnings -> fee remitted on-chain -> receivables stamped");
