// services/src/worker/sweep.ts
import type { Registry } from "../registry/registry";
import type { Rent, RentStatus } from "../domain";

// Pays an outstanding fee amount for a rent — in practice the rent's settlement adapter
// hitting the worker's own /fee endpoint, so sweep money rides the same nano-payment rail
// as live fee ticks. Returns the settlement ref.
export type PayFee = (rent: Rent, amountAtomic: bigint) => Promise<string>;

export type SweepDeps = { registry: Registry; payFee: PayFee };
export type SweepResult = { swept: boolean; reason: string; ref?: string };

const TERMINAL: RentStatus[] = ["completed", "cancelled", "failed"];

// Terminal catch-up: fee ticks normally stream live from the meter; this collects the ones
// whose fee payment failed. One payment for the whole remainder, refs stamped per charge,
// fees_swept_at stamped once nothing is outstanding. Any failure leaves state unstamped so
// the next worker pass retries.
export async function sweepFees(rentId: string, deps: SweepDeps): Promise<SweepResult> {
  const { registry, payFee } = deps;
  const rent = await registry.getRent(rentId);
  if (!rent) return { swept: false, reason: "rent not found" };
  if (!TERMINAL.includes(rent.status)) return { swept: false, reason: "not terminal" };
  if (rent.feesSweptAt) return { swept: false, reason: "already swept" };

  const charges = await registry.listCharges(rentId);
  const outstanding = charges.filter((c) => c.feeAmount > 0 && !c.feeSettlementRef);
  const dueAtomic = outstanding.reduce((s, c) => s + BigInt(c.feeAmount), 0n);
  if (dueAtomic <= 0n) {
    await registry.updateRent(rentId, { feesSweptAt: new Date().toISOString() }); // nothing owed; stop rechecking
    return { swept: false, reason: "no outstanding fees" };
  }

  try {
    const ref = await payFee(rent, dueAtomic);
    for (const c of outstanding) await registry.markChargeFeeSettled(c.id, ref);
    await registry.updateRent(rentId, { feesSweptAt: new Date().toISOString() });
    return { swept: true, reason: "swept", ref };
  } catch (e) {
    return { swept: false, reason: e instanceof Error ? e.message : "fee payment failed" };
  }
}
