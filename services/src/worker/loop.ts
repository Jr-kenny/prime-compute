// services/src/worker/loop.ts
import type { Registry } from "../registry/registry";
import type { Rent } from "../domain";
import type { RankStrategy } from "../broker/matching";
import type { DegradationDeps } from "../broker/degradation";
import type { SettlementFactory } from "./settlement-factory";
import type { LeaseHealthTracker } from "./lease-health";
import type { NetworkAdapter } from "../network/adapter";
import type { Provider } from "../domain";
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
  concurrency?: number;     // how many running leases to meter at once per pass (default 10)
  network?: NetworkAdapter; // optional VPN provisioner; mints access at open, revokes at close
  state?: WorkerState;       // persistent for the process lifetime; rebuilt safely after restart
  queuedPollMs?: number;     // idle discovery cadence (default every pass)
  suspendedPollMs?: number;  // grace sweep cadence (default every pass)
  providerCacheMs?: number;  // stable provider metadata refresh cadence (default 60s)
};

type ProviderCache = { provider: Provider | null; loadedAt: number };

export type WorkerState = {
  billedUnits: Map<string, number>;
  spentAtomic: Map<string, number>;
  providers: Map<string, ProviderCache>;
  lastQueuedPollAt: number | null;
  lastSuspendedPollAt: number | null;
};

export function createWorkerState(): WorkerState {
  return {
    billedUnits: new Map(),
    spentAtomic: new Map(),
    providers: new Map(),
    lastQueuedPollAt: null,
    lastSuspendedPollAt: null,
  };
}

function pollDue(last: number | null, interval: number | undefined, now: number): boolean {
  return last === null || !interval || interval <= 0 || now - last >= interval;
}

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
  const now = deps.nowMs?.() ?? Date.now();
  const state = deps.state;

  const pollQueued = !state || pollDue(state.lastQueuedPollAt, deps.queuedPollMs, now);
  const queued = pollQueued
    ? await registry.listRents({ status: "queued" })
    : [];
  if (state && pollQueued) state.lastQueuedPollAt = now;
  for (const rent of queued) {
    try {
      const maxUnits = budget(rent, deps.defaultMaxUnits);
      const settlement = await deps.settlementFor(rent, maxUnits);
      const res = await provisionLease(rent.id, { registry, settlement, rank: deps.rank, maxUnits, topupUnits: deps.topupUnits, network: deps.network });
      // A suspend/fail carries the real cause (a funding/gateway error, an unmatched spec). It used
      // to be swallowed here, so an outage looked like silence in the logs; surface it.
      if (res.status === "suspended" || res.status === "failed") {
        console.error(`[worker] provision ${rent.id} -> ${res.status}: ${res.reason}`);
      }
    } catch (e) {
      console.error(`[worker] provision ${rent.id} failed:`, e instanceof Error ? e.message : e);
    }
  }

  // Meter running leases with bounded concurrency. Each lease pays from its own cached adapter and
  // touches only its own rows, so they're independent; running one-at-a-time made a pass as slow as
  // the whole fleet's I/O put together (an HTTP pay() hop plus DB round-trips per lease), which under
  // load left each lease metered only once every couple of minutes. Fanning out a bounded batch at a
  // time keeps the pass near real time so the elapsed-time meter bills ~one unit per second per lease.
  const runningLeases = await registry.listRents({ status: "running" });
  if (state) {
    const active = new Set(runningLeases.map((rent) => rent.id));
    for (const rentId of state.billedUnits.keys()) if (!active.has(rentId)) state.billedUnits.delete(rentId);
    for (const rentId of state.spentAtomic.keys()) if (!active.has(rentId)) state.spentAtomic.delete(rentId);
  }
  const concurrency = Math.max(1, deps.concurrency ?? 10);
  const meterOne = async (rent: Rent) => {
    try {
      const maxUnits = budget(rent, deps.defaultMaxUnits);
      const settlement = await deps.settlementFor(rent, maxUnits);
      let provider: Provider | null | undefined;
      let billedUnits: number | undefined;
      let spentAtomic: number | undefined;
      if (state) {
        if (rent.providerId) {
          const cached = state.providers.get(rent.providerId);
          const ttl = deps.providerCacheMs ?? 60_000;
          if (cached && now - cached.loadedAt < ttl) provider = cached.provider;
          else {
            provider = await registry.getProvider(rent.providerId);
            state.providers.set(rent.providerId, { provider, loadedAt: now });
          }
        } else provider = null;
        billedUnits = state.billedUnits.get(rent.id);
        if (billedUnits === undefined) {
          billedUnits = await registry.billedUnits(rent.id);
          state.billedUnits.set(rent.id, billedUnits);
        }
        spentAtomic = state.spentAtomic.get(rent.id);
        if (spentAtomic === undefined) {
          spentAtomic = await registry.rentCost(rent.id);
          state.spentAtomic.set(rent.id, spentAtomic);
        }
      }
      const res = await meterTick(rent.id, {
        registry, settlement, tickMs: deps.tickMs, maxUnits, topupUnits: deps.topupUnits, nowMs: deps.nowMs, feeBps: deps.feeBps, perTickCap: deps.perTickCap, readUsage,
        health: deps.health, degradation: deps.degradation, rank: deps.rank, maxMigrations: deps.maxMigrations,
        network: deps.network, rentSnapshot: state ? rent : undefined, providerSnapshot: provider,
        billedUnitsSnapshot: billedUnits, spentAtomicSnapshot: spentAtomic,
      });
      if (state) {
        state.billedUnits.set(rent.id, (billedUnits ?? 0) + (res.chargedUnits ?? 0));
        state.spentAtomic.set(rent.id, (spentAtomic ?? 0) + (res.chargedAmountAtomic ?? 0));
      }
      // A lease that left the running state won't be ticked again, so drop its ephemeral health
      // record to keep the in-memory tracker from growing without bound.
      if (res.status !== "running") deps.health?.clear(rent.id);
    } catch (e) {
      // A payment may have landed before a later database call failed. Force an exact ledger
      // reload next pass so the cache can never cause a duplicate sequence or cap overspend.
      state?.billedUnits.delete(rent.id);
      state?.spentAtomic.delete(rent.id);
      console.error(`[worker] tick ${rent.id} failed:`, e instanceof Error ? e.message : e);
    }
  };
  for (let i = 0; i < runningLeases.length; i += concurrency) {
    await Promise.all(runningLeases.slice(i, i + concurrency).map(meterOne));
  }

  // Terminate leases that have sat suspended for balance past the grace window.
  if (deps.suspendGraceMs && deps.suspendGraceMs > 0 && (!state || pollDue(state.lastSuspendedPollAt, deps.suspendedPollMs, now))) {
    const suspended = await registry.listRents({ status: "suspended" });
    if (state) state.lastSuspendedPollAt = now;
    for (const rent of suspended) {
      try {
        await sweepSuspended(rent.id, { registry, graceMs: deps.suspendGraceMs, nowMs: deps.nowMs, network: deps.network, rentSnapshot: rent });
      } catch (e) {
        console.error(`[worker] sweep ${rent.id} failed:`, e instanceof Error ? e.message : e);
      }
    }
  }
}
