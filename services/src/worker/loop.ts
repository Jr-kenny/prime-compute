// services/src/worker/loop.ts
import type { Registry } from "../registry/registry";
import type { Rent } from "../domain";
import type { RankStrategy } from "../broker/matching";
import type { SettlementFactory } from "./settlement-factory";
import { provisionLease, meterTick } from "./meter";

export type WorkerDeps = {
  registry: Registry;
  settlementFor: SettlementFactory;
  rank?: RankStrategy;
  tickMs: number;
  defaultMaxUnits: number;
  nowMs?: () => number;
  feeBps?: number; // platform fee (basis points) recorded as a receivable per charge
  perTickCap?: number; // max paid hits per volume tick (default in meterTick)
};

// Reads the provider's unpaywalled per-session usage so volume services (VPN, storage) can bill the
// whole units accrued since the last charge. Any read failure means "nothing new pending" this tick.
async function readUsage(url: string): Promise<number> {
  try {
    const res = await fetch(url);
    if (!res.ok) return 0;
    const j = (await res.json()) as { units?: number };
    return typeof j.units === "number" ? j.units : 0;
  } catch {
    return 0;
  }
}

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
      await meterTick(rent.id, { registry, settlement, tickMs: deps.tickMs, maxUnits, nowMs: deps.nowMs, feeBps: deps.feeBps, perTickCap: deps.perTickCap, readUsage });
    } catch (e) {
      console.error(`[worker] tick ${rent.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
}
