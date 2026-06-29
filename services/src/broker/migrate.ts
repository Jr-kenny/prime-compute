import type { Registry } from "../registry/registry";
import type { SettlementAdapter } from "../settlement/adapter";
import type { Provider, Rent, RentSpec } from "../domain";
import { matchProviders, type RankStrategy } from "./matching";
import { revalidateProvider } from "./guardrails";
import { streamRent, type StreamOptions, type StoppedBy } from "./stream";
import { HealthMonitor } from "./health";
import { RetryLeash, type RetryBudget } from "../runtime/budget";
import { decideMigrateOrHold, type DegradationDeps } from "./degradation";

export type MigrationDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  rank?: RankStrategy;
  healthOpts?: { maxConsecutiveFailures?: number; maxLatencyMs?: number };
  degradation?: DegradationDeps; // when set, the broker asks the soul migrate/hold on degrade
};

export type MigrationOptions = StreamOptions & {
  maxMigrations?: number;   // how many times the broker may re-point the stream
  holdBudget?: RetryBudget; // bounds soul-chosen holds; required for the degradation path
};

export type MigrationStoppedBy = StoppedBy | "no-alternative";

export type MigrationResult = {
  units: number;
  stoppedBy: MigrationStoppedBy;
  reason: string;
  providersUsed: string[];
  migrations: number;
};

const atomicPerCharge = (p: Provider): bigint => BigInt(Math.round(p.pricePerCharge * 1_000_000));

// Stream a rent, responding to provider degradation. When `degradation` deps are present the
// broker asks the soul to choose migrate/hold (validated by the runtime); otherwise it keeps
// the deterministic Plan 6 behavior (migrate to the best untried alternative). A fresh
// HealthMonitor per leg means a new (or re-held) provider never inherits a stale streak.
export async function streamWithMigration(
  rent: Rent,
  firstProvider: Provider,
  deps: MigrationDeps,
  opts: MigrationOptions = {},
): Promise<MigrationResult> {
  const { registry, settlement } = deps;
  const maxUnits = opts.maxUnits ?? Number.POSITIVE_INFINITY;
  const maxMigrations = opts.maxMigrations ?? 0;
  const leash = opts.holdBudget ? new RetryLeash(opts.holdBudget) : null;

  const used = new Set<string>([firstProvider.id]);
  let provider = firstProvider;
  let totalUnits = 0;
  let migrations = 0;

  const result = (stoppedBy: MigrationStoppedBy, reason: string): MigrationResult =>
    ({ units: totalUnits, stoppedBy, reason, providersUsed: [...used], migrations });

  while (true) {
    const remaining = maxUnits === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : maxUnits - totalUnits;
    if (remaining <= 0) return result("maxUnits", `reached maxUnits=${maxUnits}`);

    const leg = await streamRent(
      rent,
      provider,
      { registry, settlement, health: new HealthMonitor(deps.healthOpts) },
      { maxUnits: remaining, shouldStop: opts.shouldStop, startSeq: totalUnits },
    );
    totalUnits += leg.units;

    if (leg.stoppedBy !== "unhealthy") return result(leg.stoppedBy, leg.reason);

    // The provider degraded. Decide what to do.
    if (deps.degradation && leash) {
      const candidates = await untriedValidProviders(registry, rent.spec, used, deps.rank);
      const choice = await decideMigrateOrHold(deps.degradation, {
        current: provider,
        reason: leg.reason,
        candidates,
        spec: rent.spec,
        leash,
        nextChargeAtomic: atomicPerCharge(provider),
      });

      if (choice.action === "hold") {
        await registry.recordDecisionLog(rent.id, choice.log);
        continue; // another bounded leg on the same provider
      }
      if (choice.action === "migrate") {
        if (migrations >= maxMigrations) return result("unhealthy", `migration cap reached after ${provider.id} degraded`);
        await registry.recordDecisionLog(rent.id, choice.log);
        await registry.updateRent(rent.id, { providerId: choice.target.id });
        used.add(choice.target.id);
        provider = choice.target;
        migrations++;
        continue;
      }
      // choice.action === "fallback": drop into the deterministic block below.
    }

    // Deterministic path (no decision deps, or the soul path bounced to fallback).
    if (migrations >= maxMigrations) return result("unhealthy", leg.reason);
    const next = (await untriedValidProviders(registry, rent.spec, used, deps.rank))[0] ?? null;
    if (!next) return result("no-alternative", `no healthy alternative after ${provider.id} degraded`);

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

// Best-first untried providers that still pass the deterministic guardrail.
export async function untriedValidProviders(
  registry: Registry,
  spec: RentSpec,
  used: Set<string>,
  rank?: RankStrategy,
): Promise<Provider[]> {
  const match = await matchProviders(registry, spec, rank);
  const out: Provider[] = [];
  for (const c of match.candidates) {
    if (used.has(c.providerId)) continue;
    const p = await registry.getProvider(c.providerId);
    if (p && revalidateProvider(p, spec).ok) out.push(p);
  }
  return out;
}
