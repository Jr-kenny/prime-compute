// services/src/worker/loop.ts
import type { Registry } from "../registry/registry";
import type { Rent } from "../domain";
import type { RankStrategy } from "../broker/matching";
import type { DegradationDeps } from "../broker/degradation";
import type { SettlementFactory } from "./settlement-factory";
import type { LeaseHealthTracker } from "./lease-health";
import { provisionLease, meterTick, sweepSuspended } from "./meter";

export type WorkerDeps = {
  registry: Registry;
  settlementFor: SettlementFactory;
  rank?: RankStrategy;
  tickMs: number;
  defaultMaxUnits: number;
  nowMs?: () => number;
  feeBps?: number; // platform fee (basis points) recorded as a receivable per charge
  perTickCap?: number; // max paid hits per volume tick (default in meterTick)
  // Autonomous hand-off on provider degradation. Both must be set for a lease to migrate; the
  // tracker is created once and reused across passes so failure streaks live across ticks.
  health?: LeaseHealthTracker;
  degradation?: DegradationDeps;
  maxMigrations?: number;
  topupUnits?: number;      // float buffer size in units (default = each lease's estimate)
  suspendGraceMs?: number;  // terminate a balance-suspended lease after this long (0/unset = never)
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
      const res = await provisionLease(rent.id, { registry, settlement, rank: deps.rank, maxUnits, topupUnits: deps.topupUnits });
      // A suspend/fail carries the real cause (a funding/gateway error, an unmatched spec). It used
      // to be swallowed here, so an outage looked like silence in the logs; surface it.
      if (res.status === "suspended" || res.status === "failed") {
        console.error(`[worker] provision ${rent.id} -> ${res.status}: ${res.reason}`);
      }
    } catch (e) {
      console.error(`[worker] provision ${rent.id} failed:`, e instanceof Error ? e.message : e);
    }
  }

  for (const rent of await registry.listRents({ status: "running" })) {
    try {
      const maxUnits = budget(rent, deps.defaultMaxUnits);
      const settlement = await deps.settlementFor(rent, maxUnits);
      const res = await meterTick(rent.id, {
        registry, settlement, tickMs: deps.tickMs, maxUnits, topupUnits: deps.topupUnits, nowMs: deps.nowMs, feeBps: deps.feeBps, perTickCap: deps.perTickCap, readUsage,
        health: deps.health, degradation: deps.degradation, rank: deps.rank, maxMigrations: deps.maxMigrations,
      });
      // A lease that left the running state won't be ticked again, so drop its ephemeral health
      // record to keep the in-memory tracker from growing without bound.
      if (res.status !== "running") deps.health?.clear(rent.id);
    } catch (e) {
      console.error(`[worker] tick ${rent.id} failed:`, e instanceof Error ? e.message : e);
    }
  }

  // Terminate leases that have sat suspended for balance past the grace window.
  if (deps.suspendGraceMs && deps.suspendGraceMs > 0) {
    for (const rent of await registry.listRents({ status: "suspended" })) {
      try {
        await sweepSuspended(rent.id, { registry, graceMs: deps.suspendGraceMs, nowMs: deps.nowMs });
      } catch (e) {
        console.error(`[worker] sweep ${rent.id} failed:`, e instanceof Error ? e.message : e);
      }
    }
  }
}
