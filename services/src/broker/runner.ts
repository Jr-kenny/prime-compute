import type { Registry } from "../registry/registry";
import type { SettlementAdapter } from "../settlement/adapter";
import type { RentStatus } from "../domain";
import { matchProviders, type RankStrategy } from "./matching";
import { revalidateProvider } from "./guardrails";
import { streamWithMigration, type MigrationStoppedBy, type MigrationOptions } from "./migrate";
import type { DegradationDeps } from "./degradation";

export type RunDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  rank?: RankStrategy;
  degradation?: DegradationDeps;
  healthOpts?: { maxConsecutiveFailures?: number; maxLatencyMs?: number };
};

// runRent passes these straight through to streamWithMigration (maxUnits, shouldStop,
// maxMigrations, holdBudget).
export type RunOptions = MigrationOptions;

export type RunResult = {
  stoppedBy: MigrationStoppedBy | "no-provider" | "guard-failed";
  reason: string;
  units: number;
  migrations: number;
};

const now = () => new Date().toISOString();

// Map how the stream stopped to the rent's terminal status. A clean budget/iteration
// stop is completed; a user cancel is cancelled; a degradation we could not recover
// from is failed.
function finalStatus(stoppedBy: MigrationStoppedBy): RentStatus {
  if (stoppedBy === "cancel") return "cancelled";
  if (stoppedBy === "unhealthy" || stoppedBy === "no-alternative") return "failed";
  return "completed"; // maxUnits | cap
}

// One rent end to end: match -> guard -> record decision -> fund -> stream (with
// autonomous migration on degrade) -> finalize.
export async function runRent(rentId: string, deps: RunDeps, opts: RunOptions = {}): Promise<RunResult> {
  const { registry, settlement } = deps;
  const rent = await registry.getRent(rentId);
  if (!rent) throw new Error(`rent not found: ${rentId}`);

  const match = await matchProviders(registry, rent.spec, deps.rank);
  if (!match.chosen) {
    await registry.updateRent(rentId, { status: "failed", endedAt: now() });
    return { stoppedBy: "no-provider", reason: match.rationale, units: 0, migrations: 0 };
  }

  const guard = revalidateProvider(match.chosen, rent.spec);
  if (!guard.ok) {
    await registry.updateRent(rentId, { status: "failed", endedAt: now() });
    return { stoppedBy: "guard-failed", reason: guard.reason, units: 0, migrations: 0 };
  }

  await registry.recordDecision({
    rentId,
    candidates: match.candidates,
    chosenProviderId: match.chosen.id,
    rationale: match.rationale,
  });

  // Fund enough for the safety bound when it is finite; otherwise a sane floor.
  const cushion = Number.isFinite(opts.maxUnits) ? BigInt(opts.maxUnits ?? 0) : 0n;
  const minAtomic = cushion * BigInt(Math.round(match.chosen.pricePerCharge * 1_000_000));
  if (minAtomic > 0n) await settlement.ensureFunded(minAtomic);

  await registry.updateRent(rentId, { status: "running", providerId: match.chosen.id, startedAt: now() });

  const stream = await streamWithMigration(
    rent,
    match.chosen,
    { registry, settlement, rank: deps.rank, degradation: deps.degradation, healthOpts: deps.healthOpts },
    opts,
  );

  await registry.updateRent(rentId, {
    status: finalStatus(stream.stoppedBy),
    totalCost: await registry.rentCost(rentId),
    endedAt: now(),
  });

  return { stoppedBy: stream.stoppedBy, reason: stream.reason, units: stream.units, migrations: stream.migrations };
}
