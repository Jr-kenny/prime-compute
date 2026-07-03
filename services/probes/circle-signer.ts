// Probe: can a Circle developer-controlled wallet be the x402/Gateway payer's signer?
//
// The hypothesis behind CircleWalletSettlementAdapter (Phase 2): replace the raw-key EOA
// with a Circle-custodied wallet so no private key ever sits in our database. The seam is
// BatchEvmSigner = { address, signTypedData } and the payload is the EIP-3009
// TransferWithAuthorization that BatchEvmScheme signs on every streamed charge (domain
// "GatewayWalletBatched" v1, verifyingContract = the GatewayWallet).
//
// Verdict logic: Gateway's facilitator accepts a payment iff the EIP-712 signature
// recovers to the paying address. So if Circle's signTypedData output recovers to the
// wallet's address locally (viem recoverTypedDataAddress), the signature IS
// Gateway-acceptable; no funds need to move to prove the hypothesis.
//
// Setup (one-time, Circle console + CLI):
//   1. https://console.circle.com -> API Keys -> create a TEST API key (Web3 Services).
//   2. Generate + register an entity secret:
//        bun run -e 'import("@circle-fin/developer-controlled-wallets").then(m => m.generateEntitySecret())'
//      then register it (writes a recovery file; do this once):
//        import { registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets"
//        await registerEntitySecretCiphertext({ apiKey, entitySecret, recoveryFileDownloadPath: "./" })
//   3. Put CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET in services/.env.
//   Optional: CIRCLE_WALLET_ID to reuse a wallet across runs instead of creating one.
//
// Run: bun run probe:circle-signer

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { recoverTypedDataAddress, getAddress, type Hex } from "viem";

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
if (!apiKey || !entitySecret) {
  console.error(
    "CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are required (see the setup comment at the top of this probe).\n" +
      "This is the W3S API key from console.circle.com, NOT the modular-wallets client key.",
  );
  process.exit(1);
}

// Canonical Arc-testnet Gateway constants (locked in foundations-report.md; the domain
// name/version and types mirror BatchEvmScheme in @circle-fin/x402-batching exactly).
const ARC_TESTNET_CHAIN_ID = 5042002;
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;
const BLOCKCHAIN = process.env.CIRCLE_BLOCKCHAIN ?? "ARC-TESTNET";

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

// ---- Stage 1: get or create an EOA wallet on Arc testnet -------------------------------
async function ensureWallet(): Promise<{ id: string; address: string }> {
  const existing = process.env.CIRCLE_WALLET_ID;
  if (existing) {
    const res = (await client.getWallet({ id: existing })) as any;
    const w = res.data?.wallet;
    if (!w) throw new Error(`CIRCLE_WALLET_ID ${existing} not found: ${JSON.stringify(res.data)}`);
    console.log(`[1] reusing wallet ${w.id} (${w.blockchain}, ${w.accountType}) ${w.address}`);
    return { id: w.id, address: w.address };
  }

  const set = (await client.createWalletSet({ name: "prime-compute-signer-probe" })) as any;
  const walletSetId = set.data?.walletSet?.id;
  if (!walletSetId) throw new Error(`createWalletSet gave no id: ${JSON.stringify(set.data)}`);

  // accountType EOA is load-bearing: EIP-3009 needs an ECDSA signature that recovers to
  // the token-holding address itself; an SCA signs ERC-1271-style and can't be the payer.
  const created = (await client.createWallets({
    walletSetId,
    blockchains: [BLOCKCHAIN as any],
    accountType: "EOA",
    count: 1,
  })) as any;
  const w = created.data?.wallets?.[0];
  if (!w) throw new Error(`createWallets gave no wallet: ${JSON.stringify(created.data)}`);
  console.log(`[1] created wallet ${w.id} on ${BLOCKCHAIN}: ${w.address}`);
  console.log(`    (export CIRCLE_WALLET_ID=${w.id} to reuse it next run)`);
  return { id: w.id, address: w.address };
}

// ---- Stage 2: sign the exact pay-path payload -------------------------------------------
function randomNonce(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

async function main() {
  const wallet = await ensureWallet();

  const nonce = randomNonce();
  const domain = {
    name: "GatewayWalletBatched", // CIRCLE_BATCHING_NAME
    version: "1", //                 CIRCLE_BATCHING_VERSION
    chainId: ARC_TESTNET_CHAIN_ID,
    verifyingContract: GATEWAY_WALLET,
  };
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  const now = Math.floor(Date.now() / 1000);
  // One representative streamed charge: 100 atomic units (0.0001 USDC), like the meter's.
  const message = {
    from: getAddress(wallet.address),
    to: GATEWAY_WALLET,
    value: "100",
    validAfter: "0",
    validBefore: String(now + 600),
    nonce,
  };

  console.log(`[2] asking Circle to sign the TransferWithAuthorization typed data…`);
  // Circle's validator wants EIP712Domain declared explicitly (their own GatewayClient does
  // the same); viem infers it from the domain object, so it's only in the Circle payload.
  const circleTypes = {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    ...types,
  };
  const signed = (await client.signTypedData({
    walletId: wallet.id,
    data: JSON.stringify({ domain, types: circleTypes, primaryType: "TransferWithAuthorization", message }),
    memo: "prime-compute probe: Gateway pay-path signature",
  })) as any;
  const signature = signed.data?.signature as Hex | undefined;
  if (!signature) throw new Error(`signTypedData gave no signature: ${JSON.stringify(signed.data)}`);
  console.log(`    signature: ${signature.slice(0, 24)}… (${signature.length} chars)`);

  // ---- Stage 3: the verdict — does it recover to the wallet address? --------------------
  const recovered = await recoverTypedDataAddress({
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message: {
      ...message,
      value: BigInt(message.value),
      validAfter: BigInt(message.validAfter),
      validBefore: BigInt(message.validBefore),
    },
    signature,
  });

  const ok = getAddress(recovered) === getAddress(wallet.address);
  console.log(`[3] recovered signer: ${recovered}`);
  console.log(`    wallet address:   ${wallet.address}`);
  if (ok) {
    console.log(
      "\n✅ PASS: a Circle developer-controlled wallet produces a Gateway-valid EIP-3009 signature.\n" +
        "   The CircleWalletSettlementAdapter hypothesis holds; remaining work is plumbing\n" +
        "   (deposit via Circle's contract-execution API + driving x402Client with this signer).",
    );
  } else {
    console.error(
      "\n❌ FAIL: the signature does not recover to the wallet address.\n" +
        "   Gateway would reject payments signed this way; the adapter needs a different path.",
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("probe failed:", e?.response?.data ?? e);
  process.exit(1);
});
