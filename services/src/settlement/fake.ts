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
  fundCalls = 0; // total ensureFunded calls (incl. no-ops)
  deposits = 0;  // ensureFunded calls that actually moved EOA -> float
  private balance = 0n; // the Gateway float; only modeled when fundsRemaining is set

  constructor(public opts: FakeOptions) {
    this.buyerAddress = opts.buyerAddress ?? "0xFAKEBUYER";
  }

  // Tops the float up to `minAtomic` from the EOA, mirroring the real adapter: a no-op when the
  // float already covers it, a real deposit otherwise, and a throw when the EOA can't cover the
  // shortfall (an empty wallet). Legacy tests that don't set fundsRemaining get an infinite float.
  async ensureFunded(minAtomic: bigint): Promise<{ deposited: boolean; depositTxHash?: string }> {
    this.fundCalls++;
    if (this.opts.fundsRemaining === undefined) return { deposited: false };
    if (this.balance >= minAtomic) return { deposited: false };
    const shortfall = minAtomic - this.balance;
    if (shortfall > this.opts.fundsRemaining) throw new Error("insufficient EOA balance for top-up");
    this.opts.fundsRemaining -= shortfall;
    this.balance += shortfall;
    this.deposits++;
    return { deposited: true, depositTxHash: `fake-deposit-${this.deposits}` };
  }

  async payForCompute(url: string, maxAtomic?: bigint): Promise<PaidCompute> {
    // A `units=N` URL is one batched payment worth N units, mirroring the provider's pricing.
    const m = url.match(/[?&]units=(\d+)/);
    const units = m ? BigInt(m[1]!) : 1n;
    const nextAtomic = this.opts.pricePerChargeAtomic * units;
    const decision = checkSpend({ nextAtomic, spentAtomic: this.spent, capAtomic: this.opts.capAtomic, maxPerChargeAtomic: maxAtomic });
    if (!decision.ok) throw new SpendCapError(decision.reason);
    this.spent += nextAtomic;
    if (this.opts.fundsRemaining !== undefined) this.balance -= nextAtomic; // drain the modeled float
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
