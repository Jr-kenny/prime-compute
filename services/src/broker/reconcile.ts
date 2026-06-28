import type { Registry } from "../registry/registry";
import type { SettlementAdapter } from "../settlement/adapter";

// Walk a rent's unsettled charges and mark the ones whose batch has landed.
// Returns how many were newly settled. Safe to run repeatedly.
export async function reconcileRent(
  registry: Registry,
  settlement: SettlementAdapter,
  rentId: string,
): Promise<number> {
  const charges = await registry.listCharges(rentId);
  let settled = 0;
  for (const c of charges) {
    if (c.settled || !c.settlementRef) continue;
    const status = await settlement.reconcile(c.settlementRef);
    if (status.settled) {
      await registry.markChargeSettled(c.id);
      settled++;
    }
  }
  return settled;
}
