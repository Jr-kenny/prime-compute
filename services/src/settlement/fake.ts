import type { SettlementAdapter, PaidCompute, SettlementStatus } from "./adapter";
import { checkSpend, SpendCapError } from "./spend-policy";

export type FakeOptions = {
  pricePerChargeAtomic: bigint;
  capAtomic: bigint;
  buyerAddress?: string;
  // Continuous-rental test hooks. `fundsRemaining` is the EOA ceiling: each ensureFunded that
  // needs a deposit draws from it, and once it can't cover the shortfall it throws (empty wallet).
  fundsRemaining?: bigint;
};

// Deterministic, no network. Enforces the same spend guard as the real adapter so
// the stream engine (Plan 5) can be developed and tested offline.
export class FakeSettlementAdapter implements SettlementAdapter {
  readonly buyerAddress: string;
  private spent = 0n;
  private seq = 0;
  private refs = new Set<string>();
  fundCalls = 0;
  private funded = 0n;

  constructor(public opts: FakeOptions) {
    this.buyerAddress = opts.buyerAddress ?? "0xFAKEBUYER";
  }

  async ensureFunded(minAtomic: bigint): Promise<{ deposited: boolean; depositTxHash?: string }> {
    this.fundCalls++;
    if (this.opts.fundsRemaining === undefined) return { deposited: false };
    if (this.funded >= minAtomic) return { deposited: false };
    const shortfall = minAtomic - this.funded;
    if (shortfall > this.opts.fundsRemaining) throw new Error("insufficient EOA balance for top-up");
    this.opts.fundsRemaining -= shortfall;
    this.funded += shortfall;
    return { deposited: true, depositTxHash: `fake-deposit-${this.fundCalls}` };
  }

  async payForCompute(_url: string): Promise<PaidCompute> {
    const nextAtomic = this.opts.pricePerChargeAtomic;
    const decision = checkSpend({ nextAtomic, spentAtomic: this.spent, capAtomic: this.opts.capAtomic });
    if (!decision.ok) throw new SpendCapError(decision.reason);
    this.spent += nextAtomic;
    const settlementRef = `fake-settlement-${this.seq++}`;
    this.refs.add(settlementRef);
    return {
      amountAtomic: nextAtomic,
      settlementRef,
      data: { ok: true, telemetry: { cpu: 42, gpuUtil: 70, seq: this.seq - 1, ts: Date.now() } },
      status: 200,
    };
  }

  async reconcile(settlementRef: string): Promise<SettlementStatus> {
    const known = this.refs.has(settlementRef);
    return { ref: settlementRef, status: known ? "completed" : "unknown", settled: known };
  }
}
