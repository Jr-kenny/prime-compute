// Real x402 + Circle Gateway settlement round-trip on Arc testnet.
// Seller: an Express route paywalled by createGatewayMiddleware.
// Buyer: a GatewayClient that deposits once, then pays gas-free.
//
// Needs in services/.env: BROKER_WALLET_PRIVATE_KEY (buyer, funded with testnet
// USDC), PROVIDER_WALLET_PRIVATE_KEY (seller, receives), and the testnet
// facilitator URL. Get testnet USDC from https://faucet.circle.com.

import express from "express";
import { createGatewayMiddleware, type PaymentRequest } from "@circle-fin/x402-batching/server";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { privateKeyToAccount } from "viem/accounts";

const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com";
const explorer = process.env.ARC_EXPLORER_URL ?? "https://testnet.arcscan.app";
const brokerKey = process.env.BROKER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
const providerKey = process.env.PROVIDER_WALLET_PRIVATE_KEY as `0x${string}` | undefined;

if (!brokerKey || !providerKey) {
  throw new Error(
    "Set BROKER_WALLET_PRIVATE_KEY and PROVIDER_WALLET_PRIVATE_KEY in services/.env",
  );
}

const providerAddress = privateKeyToAccount(providerKey).address;
const PORT = 3000;

const app = express();
const gateway = createGatewayMiddleware({
  sellerAddress: providerAddress,
  networks: ["eip155:5042002"], // Arc testnet
  facilitatorUrl,
});

let settledTx: string | undefined;
let settledPayer: string | undefined;
let settledAmount: string | undefined;

app.get("/tick", gateway.require("$0.0001"), (req, res) => {
  const pay = (req as PaymentRequest).payment;
  settledTx = pay?.transaction;
  settledPayer = pay?.payer;
  settledAmount = pay?.amount;
  res.json({ ok: true, telemetry: { cpu: 42, ramGb: 8, ts: Date.now() } });
});

const server = app.listen(PORT);
console.log(`seller up on :${PORT} (provider ${providerAddress})`);

try {
  const client = new GatewayClient({ chain: "arcTestnet", privateKey: brokerKey });

  console.log("buyer: depositing 0.10 USDC into the Gateway Wallet (one-time)...");
  const dep = await client.deposit("0.10");
  console.log("  deposit tx:", dep.depositTxHash, "->", `${explorer}/tx/${dep.depositTxHash}`);

  console.log("buyer: paying for one /tick (gas-free)...");
  const result = await client.pay(`http://localhost:${PORT}/tick`);
  console.log("  resource data:", JSON.stringify(result.data));
  console.log("  amount (atomic):", result.amount.toString());

  console.log("\nsettlement seen by seller:");
  console.log("  payer:", settledPayer);
  console.log("  amount (atomic):", settledAmount);
  console.log("  settlement tx:", settledTx, settledTx ? `-> ${explorer}/tx/${settledTx}` : "(batched, may settle async)");

  console.log("\n✅ x402 + Gateway round-trip succeeded on Arc testnet.");
} catch (err) {
  console.error("\n❌ x402 round-trip failed:", err instanceof Error ? err.message : err);
  console.error("If the buyer wallet has no testnet USDC, fund it at https://faucet.circle.com and retry.");
  process.exitCode = 1;
} finally {
  server.close();
}
