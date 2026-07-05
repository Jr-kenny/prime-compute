// services/src/settlement/circle-gateway.ts
import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import type { SettlementAdapter, PaidCompute, SettlementStatus } from "./adapter";
import { checkSpend, SpendCapError } from "./spend-policy";
import { circleBatchSigner, type CircleSignerApi } from "./circle-signer";
import { gatewayPay } from "./gateway-pay";

const GATEWAY_API = "https://gateway-api-testnet.circle.com/v1";
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const GATEWAY_MINTER = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";
const ARC_TESTNET_CHAIN_ID = 5042002;

export type CircleExecApi = CircleSignerApi & {
  createContractExecutionTransaction(input: {
    walletId: string;
    contractAddress: string;
    abiFunctionSignature: string;
    abiParameters: string[];
    fee: { type: "level"; config: { feeLevel: "LOW" | "MEDIUM" | "HIGH" } };
  }): Promise<{ data?: { id?: string } }>;
  getTransaction(input: { id: string }): Promise<{ data?: { transaction?: { state?: string; txHash?: string; errorReason?: string } } }>;
};

export type CircleGatewayOptions = {
  client: CircleExecApi;
  walletId: string;
  address: string;      // the Circle wallet's on-chain address (the payer)
  capAtomic: bigint;    // per-stream spend cap (same semantics as the raw-key adapter)
  usdcAddress: string;  // Arc USDC
  maxPerChargeAtomic?: bigint;
  gatewayApi?: string;  // override for tests
  fetchImpl?: typeof fetch;
  pollMs?: number;      // contract-execution poll interval (tests shrink it)
};

// SettlementAdapter whose signer lives at Circle: pay = standalone 402 dance with a
// Circle-backed BatchEvmScheme; funding = approve+deposit through Circle's contract
// execution API. No private key exists on our side of any call.
export class CircleGatewaySettlementAdapter implements SettlementAdapter {
  readonly buyerAddress: string;
  private scheme: BatchEvmScheme;
  private spent = 0n;
  private lastAbortReason: string | null = null;
  private fetchImpl: typeof fetch;
  private api: string;

  constructor(private opts: CircleGatewayOptions) {
    this.buyerAddress = opts.address;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.api = opts.gatewayApi ?? GATEWAY_API;
    this.scheme = new BatchEvmScheme(circleBatchSigner(opts.client, opts.walletId, opts.address));
    // The deterministic guard, same seam as the raw-key adapter: abort before signing.
    this.scheme.onBeforePaymentCreation(async (ctx) => {
      const nextAtomic = BigInt(ctx.selectedRequirements.amount);
      const decision = checkSpend({
        nextAtomic, spentAtomic: this.spent, capAtomic: this.opts.capAtomic, maxPerChargeAtomic: this.opts.maxPerChargeAtomic,
      });
      if (!decision.ok) {
        this.lastAbortReason = decision.reason;
        return { abort: true, reason: decision.reason };
      }
      return undefined;
    });
  }

  async ensureFunded(minAtomic: bigint): Promise<{ deposited: boolean; depositTxHash?: string }> {
    const available = await this.gatewayBalance();
    if (available >= minAtomic) return { deposited: false };
    const shortfall = (minAtomic - available).toString();
    await this.exec("approve(address,uint256)", [GATEWAY_WALLET, shortfall], this.opts.usdcAddress);
    const txHash = await this.exec("deposit(address,uint256)", [this.opts.usdcAddress, shortfall], GATEWAY_WALLET);
    return { deposited: true, depositTxHash: txHash };
  }

  async payForCompute(url: string): Promise<PaidCompute> {
    this.lastAbortReason = null;
    try {
      const paid = await gatewayPay(url, this.scheme, { chainId: ARC_TESTNET_CHAIN_ID, fetchImpl: this.fetchImpl });
      this.spent += paid.amountAtomic;
      return { amountAtomic: paid.amountAtomic, settlementRef: paid.settlementRef, data: paid.data, status: paid.status };
    } catch (err) {
      if (this.lastAbortReason) throw new SpendCapError(this.lastAbortReason);
      throw err;
    }
  }

  async reconcile(settlementRef: string): Promise<SettlementStatus> {
    const res = await this.fetchImpl(`${this.api}/x402/transfers/${encodeURIComponent(settlementRef)}`);
    if (!res.ok) throw new Error(`reconcile failed (${res.status})`);
    const t = (await res.json()) as { status?: string };
    const status = t.status ?? "unknown";
    const settled = status === "completed" || status === "confirmed";
    return { ref: settlementRef, status, settled };
  }

  private async gatewayBalance(): Promise<bigint> {
    const { getGatewayBalance } = await import("./gateway-balance");
    const { availableAtomic } = await getGatewayBalance(this.buyerAddress, { api: this.api, fetchImpl: this.fetchImpl });
    return availableAtomic;
  }

  // One contract call through Circle, polled to completion. Circle pays gas in USDC on Arc.
  private async exec(signature: string, params: string[], contractAddress: string): Promise<string> {
    const created = await this.opts.client.createContractExecutionTransaction({
      walletId: this.opts.walletId, contractAddress,
      abiFunctionSignature: signature, abiParameters: params,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    const id = created.data?.id;
    if (!id) throw new Error(`contract execution gave no id: ${JSON.stringify(created.data)}`);
    const pollMs = this.opts.pollMs ?? 2_000;
    for (let i = 0; i < 60; i++) {
      const res = await this.opts.client.getTransaction({ id });
      const tx = res.data?.transaction;
      if (tx?.state === "COMPLETE" || tx?.state === "CONFIRMED") return tx.txHash ?? id;
      if (tx?.state === "FAILED" || tx?.state === "CANCELLED" || tx?.state === "DENIED") {
        throw new Error(`contract execution ${signature} ${tx.state}: ${tx?.errorReason ?? ""}`);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(`contract execution ${signature} timed out`);
  }
}

// Execute gatewayMint(attestation, signature) on the Arc minter through Circle contract execution,
// polled to completion. Same shape as the adapter's private exec, but standalone so the reclaim path
// can mint an attestation without an adapter instance. Circle pays gas in USDC on Arc.
export async function mintViaCircle(
  client: CircleExecApi, walletId: string, attestation: string, signature: string, opts: { pollMs?: number } = {},
): Promise<string> {
  const created = await client.createContractExecutionTransaction({
    walletId, contractAddress: GATEWAY_MINTER,
    abiFunctionSignature: "gatewayMint(bytes,bytes)", abiParameters: [attestation, signature],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const id = created.data?.id;
  if (!id) throw new Error(`gatewayMint exec gave no id: ${JSON.stringify(created.data)}`);
  const pollMs = opts.pollMs ?? 2_000;
  for (let i = 0; i < 60; i++) {
    const tx = (await client.getTransaction({ id })).data?.transaction;
    if (tx?.state === "COMPLETE" || tx?.state === "CONFIRMED") return tx.txHash ?? id;
    if (tx?.state === "FAILED" || tx?.state === "CANCELLED" || tx?.state === "DENIED") {
      throw new Error(`gatewayMint ${tx.state}: ${tx?.errorReason ?? ""}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error("gatewayMint timed out");
}
