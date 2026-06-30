import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { SettlementAdapter, PaidCompute, SettlementStatus } from "./adapter";
import { checkSpend, SpendCapError } from "./spend-policy";

export type GatewayAdapterOptions = {
  privateKey: `0x${string}`;
  capAtomic: bigint; // per-stream spend cap
  chain?: "arcTestnet"; // slice 1 target
  // Custom Arc RPC for the on-chain parts (deposit, balance, withdraw). Point this at the
  // Canteen tokenized Arc endpoint (the hackathon host's RPC) so settlement reads/writes go
  // through it; falls back to the SDK's default Arc RPC when unset.
  rpcUrl?: string;
};

// USDC has 6 decimals; the SDK takes deposit amounts as decimal strings.
const USDC_DECIMALS = 6;

export class GatewaySettlementAdapter implements SettlementAdapter {
  private client: GatewayClient;
  readonly buyerAddress: string;
  private spent = 0n;
  private lastAbortReason: string | null = null;

  constructor(private opts: GatewayAdapterOptions) {
    this.client = new GatewayClient({
      chain: opts.chain ?? "arcTestnet",
      privateKey: opts.privateKey,
      ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
    });
    this.buyerAddress = this.client.address;

    // The deterministic guard, wired at the signing seam. Returning { abort } makes
    // pay() throw before any EIP-3009 authorization is signed.
    this.client.onBeforePaymentCreation(async (ctx) => {
      const nextAtomic = BigInt(ctx.selectedRequirements.amount);
      const decision = checkSpend({ nextAtomic, spentAtomic: this.spent, capAtomic: this.opts.capAtomic });
      if (!decision.ok) {
        this.lastAbortReason = decision.reason;
        return { abort: true, reason: decision.reason };
      }
      return undefined;
    });
  }

  async ensureFunded(minAtomic: bigint): Promise<{ deposited: boolean; depositTxHash?: string }> {
    const balances = await this.client.getBalances();
    if (balances.gateway.available >= minAtomic) return { deposited: false };
    const shortfall = minAtomic - balances.gateway.available;
    const amount = formatAtomic(shortfall);
    const dep = await this.client.deposit(amount);
    return { deposited: true, depositTxHash: dep.depositTxHash };
  }

  async payForCompute(url: string): Promise<PaidCompute> {
    this.lastAbortReason = null;
    try {
      const res = await this.client.pay(url);
      this.spent += res.amount;
      return { amountAtomic: res.amount, settlementRef: res.transaction, data: res.data, status: res.status };
    } catch (err) {
      // The guard hook makes pay() throw "Payment creation aborted: <reason>".
      if (this.lastAbortReason) throw new SpendCapError(this.lastAbortReason);
      throw err;
    }
  }

  async reconcile(settlementRef: string): Promise<SettlementStatus> {
    const t = await this.client.getTransferById(settlementRef);
    const settled = t.status === "completed" || t.status === "confirmed";
    return { ref: settlementRef, status: t.status, settled };
  }
}

function formatAtomic(atomic: bigint): string {
  // bigint atomic -> decimal USDC string, e.g. 100n -> "0.0001"
  const negative = atomic < 0n;
  const v = (negative ? -atomic : atomic).toString().padStart(USDC_DECIMALS + 1, "0");
  const whole = v.slice(0, v.length - USDC_DECIMALS);
  const frac = v.slice(v.length - USDC_DECIMALS).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
