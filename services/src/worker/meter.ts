// services/src/worker/meter.ts
import type { Registry } from "../registry/registry";
import type { SettlementAdapter } from "../settlement/adapter";
import type { RankStrategy } from "../broker/matching";
import { matchProviders } from "../broker/matching";
import { revalidateProvider } from "../broker/guardrails";
import { untriedValidProviders } from "../broker/migrate";
import { decideMigrateOrHold, type DegradationDeps } from "../broker/degradation";
import { SpendCapError } from "../settlement/spend-policy";
import type { Provider, Rent, RentStatus } from "../domain";
import type { LeaseHealthTracker, LeaseHealthState } from "./lease-health";
import { descriptorFor } from "../services/registry";

const isoNow = () => new Date().toISOString();

export type ProvisionDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  rank?: RankStrategy;
  maxUnits: number;    // advisory estimate (display/buffer basis), no longer a hard stop
  topupUnits?: number; // buffer chunk deposited at provision + on low-water (default = maxUnits)
};

export type ProvisionResult = { status: RentStatus; reason: string };

// queued -> running: match, guard, record the decision, fund the lease budget. A lease that can't
// be matched/guarded fails; one that can't be funded suspends (recoverable once topped up).
export async function provisionLease(rentId: string, deps: ProvisionDeps): Promise<ProvisionResult> {
  const { registry, settlement, rank, maxUnits } = deps;
  const rent = await registry.getRent(rentId);
  if (!rent) throw new Error(`rent not found: ${rentId}`);
  if (rent.status !== "queued") return { status: rent.status, reason: "not queued" };

  const match = await matchProviders(registry, rent.spec, rank);
  if (!match.chosen) {
    await registry.updateRent(rentId, { status: "failed", endedAt: isoNow() });
    return { status: "failed", reason: match.rationale };
  }
  const guard = revalidateProvider(match.chosen, rent.spec);
  if (!guard.ok) {
    await registry.updateRent(rentId, { status: "failed", endedAt: isoNow() });
    return { status: "failed", reason: guard.reason };
  }
  await registry.recordDecision({
    rentId, candidates: match.candidates, chosenProviderId: match.chosen.id, rationale: match.rationale,
  });

  const chunkUnits = deps.topupUnits ?? maxUnits;
  const minAtomic = BigInt(chunkUnits) * BigInt(Math.round(match.chosen.pricePerCharge * 1_000_000));
  try {
    if (minAtomic > 0n) await settlement.ensureFunded(minAtomic);
  } catch (e) {
    const reason = e instanceof Error ? e.message : "funding failed";
    await registry.updateRent(rentId, { status: "suspended", statusReason: reason });
    return { status: "suspended", reason };
  }

  await registry.updateRent(rentId, {
    status: "running",
    providerId: match.chosen.id,
    startedAt: isoNow(),
    leaseAccessToken: crypto.randomUUID(),
    statusReason: null,
  });
  return { status: "running", reason: "provisioned" };
}

export type TickDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  tickMs: number;          // minimum ms between charges for one lease
  maxUnits: number;        // advisory estimate (buffer basis / display), no longer a hard stop
  topupUnits?: number;     // float buffer size; refilled from the EOA every topupUnits charges (default maxUnits)
  nowMs?: () => number;    // injectable clock (tests)
  feeBps?: number;         // platform fee in basis points; recorded as a receivable, never paid here
  perTickCap?: number;     // max paid hits in one tick so a volume burst can't run away (default 10)
  readUsage?: (url: string) => Promise<number>; // cumulative accrued units from the provider's /usage
  // Autonomous hand-off on degradation is opt-in: only when BOTH a health tracker and the broker's
  // degradation deps are wired does a failing provider trigger a migrate/hold. Absent them, a
  // transient failure just retries next tick, exactly as before.
  health?: LeaseHealthTracker;
  degradation?: DegradationDeps;
  rank?: RankStrategy;     // used when re-ranking alternatives for a hand-off
  maxMigrations?: number;  // cap on hand-offs per lease (default 0 = never migrate)
};

export type TickResult = { charged: boolean; status: RentStatus | "missing"; reason: string };

// One metering step for one running lease. Charges at most one unit per tickMs (this is also what
// makes a worker restart safe: a just-charged lease isn't charged again until tickMs elapses, and
// charge seq comes from the persisted count). Genuine spend-cap stops suspend the lease; transient
// pay failures leave it running to retry next tick.
export async function meterTick(rentId: string, deps: TickDeps): Promise<TickResult> {
  const { registry, settlement, tickMs, maxUnits } = deps;
  const clock = deps.nowMs ?? Date.now;

  const rent = await registry.getRent(rentId);
  if (!rent) return { charged: false, status: "missing", reason: "rent not found" };
  if (rent.status !== "running") return { charged: false, status: rent.status, reason: "not running" };

  if (rent.lastChargedAt && clock() - new Date(rent.lastChargedAt).getTime() < tickMs) {
    return { charged: false, status: "running", reason: "not yet" };
  }

  const provider = rent.providerId ? await registry.getProvider(rent.providerId) : null;
  if (!provider) {
    await registry.updateRent(rentId, { status: "suspended", statusReason: "the lease's provider is no longer registered" });
    return { charged: false, status: "suspended", reason: "no provider" };
  }

  // Keep the Gateway float fed as a rolling buffer. The float is a fixed topupUnits-of-runway
  // buffer; every topupUnits charges it has drained, so we refill it from the EOA in one chunk
  // (ensureFunded is a no-op the rest of the time). Doing it on a charge-count boundary keeps
  // deposits chunked (not per tick) and stateless, so a restart resumes correctly. If the EOA
  // can't cover the refill the wallet is dry: suspend and stamp suspended_at for the grace timer.
  const priceAtomic = BigInt(Math.round(provider.pricePerCharge * 1_000_000));

  // Optional spend cap: stop before a charge that would push total spend over it.
  if (rent.maxSpendAtomic != null) {
    const spent = await registry.rentCost(rentId);
    if (spent + Number(priceAtomic) > rent.maxSpendAtomic) {
      await registry.updateRent(rentId, { status: "completed", totalCost: spent, endedAt: isoNow(), statusReason: `reached spend cap of ${rent.maxSpendAtomic} atomic` });
      return { charged: false, status: "completed", reason: "spend cap reached" };
    }
  }

  const topupUnits = deps.topupUnits ?? maxUnits;
  if (topupUnits > 0 && priceAtomic > 0n) {
    const charged = (await registry.listCharges(rentId)).length;
    if (charged % topupUnits === 0) {
      try {
        await settlement.ensureFunded(BigInt(topupUnits) * priceAtomic);
      } catch (e) {
        const reason = e instanceof Error ? e.message : "top-up failed";
        await registry.updateRent(rentId, { status: "suspended", statusReason: reason, suspendedAt: isoNow() });
        return { charged: false, status: "suspended", reason };
      }
    }
  }

  // What a "unit" is comes from the descriptor. Time types owe one unit per tick (unchanged cadence);
  // volume types (VPN, storage) owe however many whole units accrued at the provider since the last
  // charge, read unpaywalled from /usage. An idle volume session owes nothing and is never charged.
  const d = descriptorFor(provider.resourceType);
  const perTickCap = deps.perTickCap ?? 10;
  let pending = 1;
  if (d.metering === "volume") {
    const accrued = deps.readUsage
      ? await deps.readUsage(`${provider.endpointUrl}/usage?session=${rent.id}`)
      : 0;
    pending = Math.max(0, accrued - (await registry.listCharges(rentId)).length);
  }
  if (pending === 0) {
    await registry.updateRent(rentId, { lastChargedAt: new Date(clock()).toISOString() });
    return { charged: false, status: "running", reason: "no units pending" };
  }

  const url = `${provider.endpointUrl}${d.path}?session=${rent.id}`;
  const lh = deps.health && deps.degradation ? deps.health.for(rentId, provider.id) : null;
  let chargedAny = false;
  let degradedReason: string | null = null;
  const toCharge = Math.min(pending, perTickCap);
  for (let i = 0; i < toCharge; i++) {
    const charges = await registry.listCharges(rentId);
    try {
      const paid = await settlement.payForCompute(url);
      const paidAtomic = Number(paid.amountAtomic);
      // The platform fee is a RECEIVABLE the provider owes from this payment (they received
      // gross; they remit fee from their Gateway earnings). Nothing extra leaves the renter,
      // and no second payment happens here. fee_settlement_ref is stamped when a verified
      // remittance covers this charge.
      const feeAtomic = Math.floor((paidAtomic * (deps.feeBps ?? 0)) / 10_000);
      await registry.recordCharge({
        rentId, providerId: provider.id, seq: charges.length,
        amount: paidAtomic, feeAmount: feeAtomic, feeSettlementRef: null,
        authorizationRef: null, settled: false, settlementRef: paid.settlementRef,
      });
      chargedAny = true;
      lh?.monitor.observe({ ok: true }); // a paid hit is a healthy sample; clears the failure streak
    } catch (e) {
      if (e instanceof SpendCapError) {
        await registry.updateRent(rentId, { status: "suspended", statusReason: e.message });
        return { charged: chargedAny, status: "suspended", reason: e.message };
      }
      // A failed hit is a health sample too. Once the streak crosses the monitor's threshold the
      // provider is degraded and we resolve a migrate/hold below instead of just retrying forever.
      if (lh) {
        const h = lh.monitor.observe({ ok: false });
        if (!h.healthy) degradedReason = h.reason;
      }
      break; // transient: stop this tick
    }
  }

  if (lh && degradedReason) {
    const reason = await resolveDegradation(rentId, rent, provider, lh, degradedReason, deps);
    await registry.updateRent(rentId, { totalCost: await registry.rentCost(rentId), lastChargedAt: new Date(clock()).toISOString() });
    return { charged: chargedAny, status: "running", reason };
  }

  await registry.updateRent(rentId, {
    totalCost: await registry.rentCost(rentId),
    lastChargedAt: new Date(clock()).toISOString(),
  });
  return { charged: chargedAny, status: "running", reason: chargedAny ? "charged" : "transient" };
}

// The current provider degraded. Ask the broker soul (deterministic fallback when the model is
// down) to migrate or hold, honoring the already-used set so we never hand back to a provider that
// already failed this lease. Migrate re-points the lease and starts a fresh health leg; hold keeps
// the provider while the retry leash allows; a fallback with nothing healthy left just keeps
// retrying the current provider (a stalled lease bills nothing and resumes if it recovers).
async function resolveDegradation(
  rentId: string,
  rent: Rent,
  current: Provider,
  lh: LeaseHealthState,
  reason: string,
  deps: TickDeps,
): Promise<string> {
  const { registry, degradation } = deps;
  const candidates = await untriedValidProviders(registry, rent.spec, lh.used, deps.rank);
  const choice = await decideMigrateOrHold(degradation!, {
    current,
    reason,
    candidates,
    spec: rent.spec,
    leash: lh.leash,
    nextChargeAtomic: BigInt(Math.round(current.pricePerCharge * 1_000_000)),
  });

  if (choice.action === "migrate") {
    const cap = deps.maxMigrations ?? 0;
    if (lh.migrations >= cap) {
      await registry.recordDecisionLog(rentId, choice.log);
      return `degraded (${reason}); migration cap ${cap} reached, staying on ${current.alias}`;
    }
    await registry.recordDecision({
      rentId,
      candidates: candidates.map((p, i) => ({ providerId: p.id, rank: i })),
      chosenProviderId: choice.target.id,
      rationale: choice.rationale,
    });
    await registry.recordDecisionLog(rentId, choice.log);
    await registry.updateRent(rentId, { providerId: choice.target.id });
    deps.health!.onMigrate(rentId, choice.target.id);
    return `degraded (${reason}); migrated to ${choice.target.alias}`;
  }

  await registry.recordDecisionLog(rentId, choice.log);
  if (choice.action === "hold") return `degraded (${reason}); holding on ${current.alias}`;
  return `degraded (${reason}); no healthy alternative, retrying ${current.alias}`;
}
