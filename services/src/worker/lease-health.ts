// services/src/worker/lease-health.ts
import { HealthMonitor } from "../broker/health";
import { RetryLeash, type RetryBudget } from "../runtime/budget";

// Per-lease health + migration bookkeeping the metering worker keeps IN MEMORY across ticks.
// This is deliberately not persisted: the broker's HealthMonitor is fresh per leg and the
// RetryLeash lives in memory, so a degradation streak is ephemeral by design. Durable truth
// (which provider a lease is on, its charges) still lives in the registry, so a restarted
// worker resumes the lease on its recorded provider and simply re-observes health from zero.
export type LeaseHealthState = {
  monitor: HealthMonitor;   // the current leg's consecutive-failure / latency watch
  used: Set<string>;        // providers already tried for this lease (never migrate back to one)
  migrations: number;       // how many times this lease has handed off (bounded by maxMigrations)
  leash: RetryLeash;        // bounds soul-chosen holds across the whole lease, not per tick
};

export type LeaseHealthOpts = {
  healthOpts?: { maxConsecutiveFailures?: number; maxLatencyMs?: number };
  holdBudget: RetryBudget;
};

export class LeaseHealthTracker {
  private map = new Map<string, LeaseHealthState>();
  constructor(private opts: LeaseHealthOpts) {}

  // The live health record for a lease currently on `providerId`, created on first sight with
  // that provider already marked used (we never want to migrate back to where we started).
  for(rentId: string, providerId: string): LeaseHealthState {
    let s = this.map.get(rentId);
    if (!s) {
      s = {
        monitor: new HealthMonitor(this.opts.healthOpts),
        used: new Set([providerId]),
        migrations: 0,
        leash: new RetryLeash(this.opts.holdBudget),
      };
      this.map.set(rentId, s);
    }
    return s;
  }

  // A hand-off happened: start a fresh monitor for the new leg (a new provider must not inherit
  // the old one's failure streak) and remember the target so we never return to it.
  onMigrate(rentId: string, targetId: string): void {
    const s = this.map.get(rentId);
    if (!s) return;
    s.monitor = new HealthMonitor(this.opts.healthOpts);
    s.used.add(targetId);
    s.migrations++;
  }

  // The lease left the running state (completed / suspended / cancelled / failed): forget it so
  // the map does not grow without bound.
  clear(rentId: string): void {
    this.map.delete(rentId);
  }
}
