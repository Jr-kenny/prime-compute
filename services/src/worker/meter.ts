// services/src/worker/meter.ts
import type { Registry } from "../registry/registry";
import type { SettlementAdapter } from "../settlement/adapter";
import type { RankStrategy } from "../broker/matching";
import { matchProviders } from "../broker/matching";
import { revalidateProvider } from "../broker/guardrails";
import { SpendCapError } from "../settlement/spend-policy";
import type { RentStatus } from "../domain";

const isoNow = () => new Date().toISOString();

export type ProvisionDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  rank?: RankStrategy;
  maxUnits: number; // budget bound (estimatedUsage or a default)
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

  const minAtomic = BigInt(maxUnits) * BigInt(Math.round(match.chosen.pricePerCharge * 1_000_000));
  try {
    if (minAtomic > 0n) await settlement.ensureFunded(minAtomic);
  } catch (e) {
    await registry.updateRent(rentId, { status: "suspended" });
    return { status: "suspended", reason: e instanceof Error ? e.message : "funding failed" };
  }

  await registry.updateRent(rentId, {
    status: "running",
    providerId: match.chosen.id,
    startedAt: isoNow(),
    leaseAccessToken: crypto.randomUUID(),
  });
  return { status: "running", reason: "provisioned" };
}

export type TickDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  tickMs: number;          // minimum ms between charges for one lease
  maxUnits: number;        // budget bound
  nowMs?: () => number;    // injectable clock (tests)
  feeBps?: number;         // platform fee in basis points; recorded as a receivable, never paid here
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

  const charges = await registry.listCharges(rentId);
  if (charges.length >= maxUnits) {
    await registry.updateRent(rentId, { status: "completed", totalCost: await registry.rentCost(rentId), endedAt: isoNow() });
    return { charged: false, status: "completed", reason: "budget reached" };
  }

  const provider = rent.providerId ? await registry.getProvider(rent.providerId) : null;
  if (!provider) {
    await registry.updateRent(rentId, { status: "suspended" });
    return { charged: false, status: "suspended", reason: "no provider" };
  }

  const url = `${provider.endpointUrl}/compute?session=${rent.id}`;
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
    await registry.updateRent(rentId, {
      totalCost: await registry.rentCost(rentId),
      lastChargedAt: new Date(clock()).toISOString(),
    });
    return { charged: true, status: "running", reason: "charged" };
  } catch (e) {
    if (e instanceof SpendCapError) {
      await registry.updateRent(rentId, { status: "suspended" });
      return { charged: false, status: "suspended", reason: e.message };
    }
    return { charged: false, status: "running", reason: e instanceof Error ? e.message : "transient" };
  }
}
