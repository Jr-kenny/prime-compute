import type { Registry } from "../registry/registry";
import type { SettlementAdapter } from "../settlement/adapter";
import type { Provider, Rent } from "../domain";
import { matchProviders, type RankStrategy } from "./matching";
import { revalidateProvider } from "./guardrails";
import { streamRent, type StreamOptions, type StoppedBy } from "./stream";
import { HealthMonitor } from "./health";

export type MigrationDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  rank?: RankStrategy;
  healthOpts?: { maxConsecutiveFailures?: number; maxLatencyMs?: number };
};

export type MigrationOptions = StreamOptions & {
  maxMigrations?: number; // how many times the broker may re-point the stream
};

export type MigrationStoppedBy = StoppedBy | "no-alternative";

export type MigrationResult = {
  units: number;
  stoppedBy: MigrationStoppedBy;
  reason: string;
  providersUsed: string[];
  migrations: number;
};

// Stream a rent with autonomous migration on degradation. Each leg runs the proven
// streamRent; when a leg stops `unhealthy` and migrations remain, the broker re-runs
// the matching engine, takes the best candidate it has not tried that still passes
// the guardrail, records the decision, re-points the rent, and continues with the
// remaining budget and continuous charge seq. A fresh HealthMonitor per leg means a
// new provider never inherits a dead one's failure streak.
export async function streamWithMigration(
  rent: Rent,
  firstProvider: Provider,
  deps: MigrationDeps,
  opts: MigrationOptions = {},
): Promise<MigrationResult> {
  const { registry, settlement } = deps;
  const maxUnits = opts.maxUnits ?? Number.POSITIVE_INFINITY;
  const maxMigrations = opts.maxMigrations ?? 0;

  const used = new Set<string>([firstProvider.id]);
  let provider = firstProvider;
  let totalUnits = 0;
  let migrations = 0;

  while (true) {
    const remaining = maxUnits === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : maxUnits - totalUnits;
    if (remaining <= 0) {
      return { units: totalUnits, stoppedBy: "maxUnits", reason: `reached maxUnits=${maxUnits}`, providersUsed: [...used], migrations };
    }

    const leg = await streamRent(
      rent,
      provider,
      { registry, settlement, health: new HealthMonitor(deps.healthOpts) },
      { maxUnits: remaining, shouldStop: opts.shouldStop, startSeq: totalUnits },
    );
    totalUnits += leg.units;

    if (leg.stoppedBy !== "unhealthy") {
      return { units: totalUnits, stoppedBy: leg.stoppedBy, reason: leg.reason, providersUsed: [...used], migrations };
    }

    // Provider degraded. Try to re-point the stream if we are allowed to.
    if (migrations >= maxMigrations) {
      return { units: totalUnits, stoppedBy: "unhealthy", reason: leg.reason, providersUsed: [...used], migrations };
    }

    const next = await pickAlternative(registry, rent, used, deps.rank);
    if (!next) {
      return { units: totalUnits, stoppedBy: "no-alternative", reason: `no healthy alternative after ${provider.id} degraded`, providersUsed: [...used], migrations };
    }

    await registry.recordDecision({
      rentId: rent.id,
      candidates: [{ providerId: next.id, rank: 0 }],
      chosenProviderId: next.id,
      rationale: `migrated from ${provider.id} after degradation (${leg.reason}) to ${next.id}`,
    });
    await registry.updateRent(rent.id, { providerId: next.id });

    used.add(next.id);
    provider = next;
    migrations++;
  }
}

// Re-run the matching engine and return the best ranked candidate that has not been
// tried and still passes the deterministic guardrail. Returns null if none.
async function pickAlternative(
  registry: Registry,
  rent: Rent,
  used: Set<string>,
  rank?: RankStrategy,
): Promise<Provider | null> {
  const match = await matchProviders(registry, rent.spec, rank);
  for (const c of match.candidates) {
    if (used.has(c.providerId)) continue;
    const p = await registry.getProvider(c.providerId);
    if (!p) continue;
    if (revalidateProvider(p, rent.spec).ok) return p;
  }
  return null;
}
