// services/src/worker/loop.ts
import type { Registry } from "../registry/registry";
import type { Rent } from "../domain";
import type { RankStrategy } from "../broker/matching";
import type { SettlementFactory } from "./settlement-factory";
import { provisionLease, meterTick } from "./meter";
import { sweepFees } from "./sweep";

export type WorkerDeps = {
  registry: Registry;
  settlementFor: SettlementFactory;
  rank?: RankStrategy;
  tickMs: number;
  defaultMaxUnits: number;
  nowMs?: () => number;
  feeBaseUrl?: string; // the worker's own fee endpoint; unset = platform fees disabled
};

// estimatedUsage is the lease's unit budget; fall back to a sane default when unset.
function budget(rent: Rent, defaultMaxUnits: number): number {
  return rent.estimatedUsage != null && rent.estimatedUsage > 0 ? Math.floor(rent.estimatedUsage) : defaultMaxUnits;
}

// One sweep: provision every queued lease, then tick every running lease. Reads all state from the
// registry, so it is safe to run on an interval and safe to resume after a restart. Per-lease errors
// are swallowed (logged) so one bad lease never stalls the others.
export async function workerPass(deps: WorkerDeps): Promise<void> {
  const { registry } = deps;

  for (const rent of await registry.listRents({ status: "queued" })) {
    try {
      const maxUnits = budget(rent, deps.defaultMaxUnits);
      const settlement = await deps.settlementFor(rent, maxUnits);
      await provisionLease(rent.id, { registry, settlement, rank: deps.rank, maxUnits });
    } catch (e) {
      console.error(`[worker] provision ${rent.id} failed:`, e instanceof Error ? e.message : e);
    }
  }

  for (const rent of await registry.listRents({ status: "running" })) {
    try {
      const maxUnits = budget(rent, deps.defaultMaxUnits);
      const settlement = await deps.settlementFor(rent, maxUnits);
      await meterTick(rent.id, { registry, settlement, tickMs: deps.tickMs, maxUnits, nowMs: deps.nowMs, feeBaseUrl: deps.feeBaseUrl });
    } catch (e) {
      console.error(`[worker] tick ${rent.id} failed:`, e instanceof Error ? e.message : e);
    }
  }

  // Terminal catch-up: collect fee ticks whose live payment failed, via the same rail.
  if (deps.feeBaseUrl) {
    const feeBaseUrl = deps.feeBaseUrl;
    for (const status of ["completed", "cancelled", "failed"] as const) {
      for (const rent of await registry.listRents({ status })) {
        if (rent.feesSweptAt) continue;
        try {
          const settlement = await deps.settlementFor(rent, budget(rent, deps.defaultMaxUnits));
          await sweepFees(rent.id, {
            registry,
            payFee: async (_r, atomic) => (await settlement.payForCompute(`${feeBaseUrl}/fee/${atomic}`)).settlementRef,
          });
        } catch (e) {
          console.error(`[worker] fee sweep failed for ${rent.id}:`, e instanceof Error ? e.message : e);
        }
      }
    }
  }
}
