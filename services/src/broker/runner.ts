import type { Registry } from "../registry/registry";
import type { SettlementAdapter } from "../settlement/adapter";
import { matchProviders, type RankStrategy } from "./matching";
import { revalidateProvider } from "./guardrails";
import { streamRent, type StreamOptions, type StoppedBy } from "./stream";
import { HealthMonitor } from "./health";

export type RunDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  health?: HealthMonitor;
  rank?: RankStrategy;
};

export type RunResult = {
  stoppedBy: StoppedBy | "no-provider" | "guard-failed";
  reason: string;
  units: number;
};

const now = () => new Date().toISOString();

// One rent end to end: match -> guard -> record decision -> fund -> stream ->
// finalize. Single provider; model-driven migration on degrade is Plan 6.
export async function runRent(rentId: string, deps: RunDeps, opts: StreamOptions = {}): Promise<RunResult> {
  const { registry, settlement } = deps;
  const rent = await registry.getRent(rentId);
  if (!rent) throw new Error(`rent not found: ${rentId}`);

  const match = await matchProviders(registry, rent.spec, deps.rank);
  if (!match.chosen) {
    await registry.updateRent(rentId, { status: "failed", endedAt: now() });
    return { stoppedBy: "no-provider", reason: match.rationale, units: 0 };
  }

  const guard = revalidateProvider(match.chosen, rent.spec);
  if (!guard.ok) {
    await registry.updateRent(rentId, { status: "failed", endedAt: now() });
    return { stoppedBy: "guard-failed", reason: guard.reason, units: 0 };
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

  const stream = await streamRent(rent, match.chosen, { registry, settlement, health: deps.health }, opts);

  await registry.updateRent(rentId, {
    status: stream.stoppedBy === "cancel" ? "cancelled" : "completed",
    totalCost: await registry.rentCost(rentId),
    endedAt: now(),
  });

  return { stoppedBy: stream.stoppedBy, reason: stream.reason, units: stream.units };
}
