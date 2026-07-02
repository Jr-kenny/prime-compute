export type SpendDecision = { ok: true } | { ok: false; reason: string };

export type SpendArgs = {
  nextAtomic: bigint; // the charge about to be signed
  spentAtomic: bigint; // total already settled/committed this stream
  capAtomic: bigint; // the per-stream spend cap
  maxPerChargeAtomic?: bigint; // ceiling for one charge (the listed price; endpoints can't overbill)
};

// The line the AI cannot cross. Pure and deterministic: no network, no model.
export function checkSpend({ nextAtomic, spentAtomic, capAtomic, maxPerChargeAtomic }: SpendArgs): SpendDecision {
  if (nextAtomic <= 0n) return { ok: false, reason: `non-positive charge amount: ${nextAtomic}` };
  if (maxPerChargeAtomic !== undefined && nextAtomic > maxPerChargeAtomic) {
    return { ok: false, reason: `per-charge amount ${nextAtomic} exceeds the listed price ${maxPerChargeAtomic}` };
  }
  if (spentAtomic + nextAtomic > capAtomic) {
    return {
      ok: false,
      reason: `charge ${nextAtomic} would exceed cap ${capAtomic} (already spent ${spentAtomic})`,
    };
  }
  return { ok: true };
}

export class SpendCapError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SpendCapError";
  }
}
