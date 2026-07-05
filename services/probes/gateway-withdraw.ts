// Probe: can a Circle developer-controlled wallet reclaim its Gateway float instantly?
//
// The instant Gateway withdraw is: sign a BurnIntent (EIP-712, domain "GatewayWallet" v1) ->
// POST /transfer -> receive { attestation, signature } -> call gatewayMint(attestation, signature)
// on the minter. A Circle-custodied wallet has no private key, so we sign with circleBatchSigner
// (already proven for the pay path) and execute the mint via Circle contract execution (the same
// mechanism ensureFunded uses to deposit). PASS = a real mint tx + the float drops.
//
// Requires: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_ID (a wallet holding a small
// Gateway float). Run: bun run probe:gateway-withdraw
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { pad, maxUint256, zeroAddress } from "viem";
import { randomBytes } from "node:crypto";
import { getGatewayBalance } from "../src/settlement/gateway-balance";
import { circleBatchSigner } from "../src/settlement/circle-signer";

const API = "https://gateway-api-testnet.circle.com/v1";
const ARC = {
  domain: 26,
  usdc: "0x3600000000000000000000000000000000000000",
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
};
const b32 = (a: string) => pad(a.toLowerCase() as `0x${string}`, { size: 32 });

const BURN_INTENT_TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" }, { name: "sourceDomain", type: "uint32" }, { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" }, { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" }, { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" }, { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" }, { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" }, { name: "salt", type: "bytes32" }, { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [{ name: "maxBlockHeight", type: "uint256" }, { name: "maxFee", type: "uint256" }, { name: "spec", type: "TransferSpec" }],
};

const apiKey = process.env.CIRCLE_API_KEY, entitySecret = process.env.CIRCLE_ENTITY_SECRET, walletId = process.env.CIRCLE_WALLET_ID;
if (!apiKey || !entitySecret || !walletId) {
  console.error("need CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_ID");
  process.exit(1);
}
const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret }) as unknown as {
  getWallet(i: { id: string }): Promise<{ data: { wallet: { address: string } } }>;
  signTypedData(i: { walletId: string; data: string; memo?: string }): Promise<{ data?: { signature?: string } }>;
  createContractExecutionTransaction(i: Record<string, unknown>): Promise<{ data?: { id?: string } }>;
  getTransaction(i: { id: string }): Promise<{ data?: { transaction?: { state?: string; txHash?: string; errorReason?: string } } }>;
};

async function main() {
  const address = (await client.getWallet({ id: walletId! })).data.wallet.address;
  const before = await getGatewayBalance(address);
  console.log(`[0] wallet ${address}\n    float before: ${before.formatted} (${before.availableAtomic} atomic)`);
  if (before.availableAtomic < 100n) {
    console.error("float too low to test; deposit a little first");
    process.exit(1);
  }

  const value = 100n; // reclaim 100 atomic (0.0001 USDC)
  const maxFee = 50_000n; // 0.05 USDC ceiling; the real fee is far lower (this probe reveals it)
  const burnIntent = {
    maxBlockHeight: maxUint256,
    maxFee,
    spec: {
      version: 1, sourceDomain: ARC.domain, destinationDomain: ARC.domain,
      sourceContract: b32(ARC.gatewayWallet), destinationContract: b32(ARC.gatewayMinter),
      sourceToken: b32(ARC.usdc), destinationToken: b32(ARC.usdc),
      sourceDepositor: b32(address), destinationRecipient: b32(address),
      sourceSigner: b32(address), destinationCaller: b32(zeroAddress),
      value, salt: `0x${randomBytes(32).toString("hex")}`, hookData: "0x",
    },
  };

  // Sign with the same Circle signer the pay path uses (injects EIP712Domain, bigint-safe JSON).
  const signer = circleBatchSigner(client, walletId!, address);
  const signature = await signer.signTypedData({
    domain: { name: "GatewayWallet", version: "1" },
    types: BURN_INTENT_TYPES,
    primaryType: "BurnIntent",
    message: burnIntent,
  } as unknown as Parameters<typeof signer.signTypedData>[0]);

  const res = await fetch(`${API}/transfer`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ burnIntent, signature }], (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  });
  const out = (await res.json().catch(() => ({}))) as { attestation?: string; signature?: string; error?: string; message?: string };
  console.log(`[1] /transfer ${res.status}: ${JSON.stringify(out).slice(0, 300)}`);
  if (!out.attestation || !out.signature) {
    console.error("no attestation returned; burn-intent shape likely rejected");
    process.exit(1);
  }

  // Mint via Circle contract execution (Circle pays gas in USDC on Arc).
  const created = await client.createContractExecutionTransaction({
    walletId, contractAddress: ARC.gatewayMinter,
    abiFunctionSignature: "gatewayMint(bytes,bytes)", abiParameters: [out.attestation, out.signature],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const id = created.data?.id;
  let txHash = "";
  for (let i = 0; i < 60; i++) {
    const tx = (await client.getTransaction({ id: id! })).data?.transaction;
    if (tx?.state === "COMPLETE" || tx?.state === "CONFIRMED") { txHash = tx.txHash ?? id!; break; }
    if (tx && ["FAILED", "CANCELLED", "DENIED"].includes(tx.state ?? "")) { console.error(`mint ${tx.state}: ${tx.errorReason}`); process.exit(1); }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`[2] mint tx: ${txHash}`);
  const after = await getGatewayBalance(address);
  console.log(`[3] float after: ${after.formatted} (dropped ${before.availableAtomic - after.availableAtomic} atomic incl. fee)`);
  console.log(after.availableAtomic < before.availableAtomic ? "PASS" : "INCONCLUSIVE (balance not yet reflected; recheck in a minute)");
}
main();
