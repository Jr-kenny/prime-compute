// The instant same-chain Gateway reclaim, generalized from the proven probe: build a BurnIntent,
// sign it with any BatchEvmSigner (a viem account for raw-key wallets, circleBatchSigner for
// Circle-custodied), POST /transfer for an attestation, then hand that attestation to an injected
// mint executor (viem writeContract, or Circle contract-exec). fetch + signer + mint are all
// injected so the whole dance unit-tests offline. The burn-intent shape here is the one Circle
// accepted live (probe:gateway-withdraw): domain "GatewayWallet" v1, the 14-field TransferSpec.
import { pad, maxUint256, zeroAddress } from "viem";
import { randomBytes } from "node:crypto";
import type { BatchEvmSigner } from "@circle-fin/x402-batching";

const GATEWAY_API = "https://gateway-api-testnet.circle.com/v1";
const ARC = {
  domain: 26,
  usdc: "0x3600000000000000000000000000000000000000",
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
} as const;

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

export type GatewayWithdrawOpts = {
  signer: BatchEvmSigner; // signs the burn intent (viem account or circleBatchSigner)
  recipient: string; // where the minted USDC lands (usually signer.address)
  maxFeeAtomic: bigint; // protocol fee ceiling
  mint: (attestation: string, signature: string) => Promise<string>; // returns the mint tx hash
  api?: string;
  fetchImpl?: typeof fetch;
};

export async function gatewayWithdraw(
  amountAtomic: bigint,
  opts: GatewayWithdrawOpts,
): Promise<{ mintTxHash: string; amountAtomic: bigint }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const api = opts.api ?? GATEWAY_API;
  const payer = opts.signer.address;
  const burnIntent = {
    maxBlockHeight: maxUint256,
    maxFee: opts.maxFeeAtomic,
    spec: {
      version: 1, sourceDomain: ARC.domain, destinationDomain: ARC.domain,
      sourceContract: b32(ARC.gatewayWallet), destinationContract: b32(ARC.gatewayMinter),
      sourceToken: b32(ARC.usdc), destinationToken: b32(ARC.usdc),
      sourceDepositor: b32(payer), destinationRecipient: b32(opts.recipient),
      sourceSigner: b32(payer), destinationCaller: b32(zeroAddress),
      value: amountAtomic, salt: `0x${randomBytes(32).toString("hex")}`, hookData: "0x",
    },
  };
  const signature = await opts.signer.signTypedData({
    domain: { name: "GatewayWallet", version: "1" },
    types: BURN_INTENT_TYPES,
    primaryType: "BurnIntent",
    message: burnIntent,
  } as unknown as Parameters<BatchEvmSigner["signTypedData"]>[0]);

  const res = await fetchImpl(`${api}/transfer`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ burnIntent, signature }], (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  });
  const out = (await res.json().catch(() => ({}))) as { attestation?: string; signature?: string; error?: string; message?: string };
  if (!res.ok || !out.attestation || !out.signature) {
    throw new Error(`gateway /transfer failed: ${out.message ?? out.error ?? res.status}`);
  }
  const mintTxHash = await opts.mint(out.attestation, out.signature);
  return { mintTxHash, amountAtomic };
}
