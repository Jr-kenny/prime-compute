// services/scripts/circle-roundtrip.ts
// Live proof (spends real testnet USDC): a Circle-custodied wallet funds Gateway and pays
// one x402 charge against a local provider. Needs: CIRCLE_* env, CIRCLE_WALLET_ID (funded
// with Arc testnet USDC — faucet to its address first), USDC_ADDRESS.
import { createServer } from "node:http";
import { createProviderApp } from "../src/provider/server";
import { SimulatedExecutor } from "../src/provider/executor";
import { CircleGatewaySettlementAdapter } from "../src/settlement/circle-gateway";
import { makeCircleClient } from "../src/wallet/circle";

const walletId = process.env.CIRCLE_WALLET_ID;
const usdc = process.env.USDC_ADDRESS;
if (!walletId || !usdc) throw new Error("CIRCLE_WALLET_ID and USDC_ADDRESS required");

const client = makeCircleClient();
const wallet: any = await client.getWallet({ id: walletId });
const address = wallet.data?.wallet?.address as string;
console.log("[1] paying from Circle wallet", address);

const app = createProviderApp({
  executor: new SimulatedExecutor(),
  sellerAddress: process.env.PROVIDER_OWNER_WALLET ?? address,
  price: "$0.0001",
  platformFeeBps: 100,
  facilitatorUrl: "https://gateway-api-testnet.circle.com",
  meta: { alias: "circle-rt", resourceType: "GPU", region: "US-East", specs: {} },
});
const server = createServer(app);
await new Promise<void>((r) => server.listen(4111, r));

const adapter = new CircleGatewaySettlementAdapter({
  client: client as any, walletId, address, capAtomic: 10_000n, usdcAddress: usdc,
});
console.log("[2] ensureFunded(1000)…");
console.log(await adapter.ensureFunded(1000n));
console.log("[3] paying one charge…");
const paid = await adapter.payForCompute("http://localhost:4111/compute?session=circle-rt");
console.log("paid:", paid.amountAtomic, "ref:", paid.settlementRef);
console.log("[4] reconcile:", await adapter.reconcile(paid.settlementRef));
server.close();
console.log("✅ Circle-custodied wallet paid a real x402 charge (net of the 1% fee).");
