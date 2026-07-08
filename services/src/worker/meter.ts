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
import type { NetworkAdapter } from "../network/adapter";
import { descriptorFor } from "../services/registry";

const isoNow = () => new Date().toISOString();

// Only a genuinely dry wallet should suspend a lease. Everything else the funding path can
// throw (a Circle API rate limit, a transient on-chain approve/deposit failure, an RPC blip)
// is retryable, and suspending on it parks a healthy funded lease forever: nothing ever
// auto-resumes a suspend. Balance errors are the ones that need the renter to act.
const isBalanceError = (msg: string) =>
  /insufficient|exceeds\s.*balance|not enough|balance (is )?too low/i.test(msg);

// Best-effort: money has already stopped by the time we revoke, so a failed revoke must not
// throw out of the tick. Tailscale ephemeral keys expire on their own as a backstop.
async function revokeNetwork(network: NetworkAdapter | undefined, rentId: string): Promise<void> {
  if (!network) return;
  try {
    await network.revokeRentAccess(rentId);
  } catch (e) {
    console.warn(`network revoke failed for lease ${rentId} (will expire on its own):`, e);
  }
}

export type ProvisionDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  rank?: RankStrategy;
  maxUnits: number;    // advisory estimate (display/buffer basis), no longer a hard stop
  topupUnits?: number; // buffer chunk deposited at provision + on low-water (default = maxUnits)
  network?: NetworkAdapter; // optional: unset behaves as no-op (no connectivity provisioned)
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
    if (isBalanceError(reason)) {
      await registry.updateRent(rentId, { status: "suspended", statusReason: reason });
      return { status: "suspended", reason };
    }
    // Transient funding error: leave the rent queued; the next worker pass retries provisioning.
    return { status: "queued", reason: `transient funding error, retrying: ${reason}` };
  }

  let leaseAccessToken: string = crypto.randomUUID();
  let networkHostname: string | null = null;
  let networkStatus: string | null = null;
  if (deps.network) {
    try {
      const access = await deps.network.mintRentAccess({ rentId, providerId: match.chosen.id });
      if (access) {
        leaseAccessToken = access.authKey;
        networkHostname = access.hostname;
        networkStatus = "provisioned";
      }
    } catch (e) {
      // Connectivity is additive: a slow/down network service must not block the money path.
      // Keep the fallback token, mark it for a later retry pass, and let the lease run.
      networkStatus = "unprovisioned";
      console.warn(`network mint failed for lease ${rentId}, running without connectivity:`, e);
    }
  }

  await registry.updateRent(rentId, {
    status: "running",
    providerId: match.chosen.id,
    startedAt: isoNow(),
    leaseAccessToken,
    networkHostname,
    networkStatus,
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
  // Max units billed in one pass. Must stay <= the provider's maxUnitsPerCharge clamp (60): the
  // provider silently clamps units=N, so a larger value records units the payment didn't buy. It
  // must also exceed the worst-case pass latency in ticks, or a lagging lease can never catch up:
  // at the old default of 10, a lease visited every 18s billed 10, fell 8 behind, forever.
  perTickCap?: number;     // default 60, matching the provider clamp
  readUsage?: (url: string) => Promise<number>; // cumulative accrued units from the provider's /usage
  // Autonomous hand-off on degradation is opt-in: only when BOTH a health tracker and the broker's
  // degradation deps are wired does a failing provider trigger a migrate/hold. Absent them, a
  // transient failure just retries next tick, exactly as before.
  health?: LeaseHealthTracker;
  degradation?: DegradationDeps;
  rank?: RankStrategy;     // used when re-ranking alternatives for a hand-off
  maxMigrations?: number;  // cap on hand-offs per lease (default 0 = never migrate)
  network?: NetworkAdapter; // optional: revoke a lease's connectivity when it reaches a terminal state
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

  // Optional spend cap: stop before a charge that would push total spend over it, and remember
  // how many whole units the cap still allows so a multi-unit catch-up tick can't blow past it
  // either (the loop below bills up to perTickCap units after this check).
  let capUnitsLeft = Infinity;
  if (rent.maxSpendAtomic != null) {
    const spent = await registry.rentCost(rentId);
    if (spent + Number(priceAtomic) > rent.maxSpendAtomic) {
      await registry.updateRent(rentId, { status: "completed", totalCost: spent, endedAt: isoNow(), statusReason: `reached spend cap of ${rent.maxSpendAtomic} atomic` });
      await revokeNetwork(deps.network, rentId);
      return { charged: false, status: "completed", reason: "spend cap reached" };
    }
    if (priceAtomic > 0n) capUnitsLeft = Math.floor((rent.maxSpendAtomic - spent) / Number(priceAtomic));
  }

  // Optional time cap: stop once we're at/past expires_at.
  if (rent.expiresAt != null && clock() >= new Date(rent.expiresAt).getTime()) {
    await registry.updateRent(rentId, { status: "completed", totalCost: await registry.rentCost(rentId), endedAt: isoNow(), statusReason: "reached time limit" });
    await revokeNetwork(deps.network, rentId);
    return { charged: false, status: "completed", reason: "time cap reached" };
  }

  // What a "unit" is comes from the descriptor. Volume types (VPN, storage) owe however many whole
  // units accrued at the provider since the last charge, read unpaywalled from /usage. Time types
  // owe one unit per tickMs of wall-clock elapsed since the last charge, NOT a flat one-per-tick:
  // the worker pass can lag far behind tickMs under load, so a flat unit billed the same 1 unit for
  // 1s or for 3min of real usage. Scaling by elapsed time makes the bill track reality no matter how
  // often the loop reaches this lease. The first ever charge bootstraps a single unit (the lease
  // just went live; there's no elapsed span to bill yet). `watermarkMs` is the billing high-water we
  // advance from once the nanopayments land.
  const now = clock();
  const d = descriptorFor(provider.resourceType);
  const perTickCap = deps.perTickCap ?? 60;
  const chargedSoFar = await registry.billedUnits(rentId);
  let pending: number;
  let watermarkMs: number;
  let bootstrap = false;
  if (d.metering === "volume") {
    const accrued = deps.readUsage
      ? await deps.readUsage(`${provider.endpointUrl}/usage?session=${rent.id}`)
      : 0;
    pending = Math.max(0, accrued - chargedSoFar);
    watermarkMs = now;
  } else if (rent.lastChargedAt) {
    watermarkMs = new Date(rent.lastChargedAt).getTime();
    pending = Math.floor((now - watermarkMs) / tickMs);
  } else {
    watermarkMs = now;
    pending = 1;
    bootstrap = true;
  }
  if (pending === 0) {
    await registry.updateRent(rentId, { lastChargedAt: new Date(now).toISOString() });
    return { charged: false, status: "running", reason: "no units pending" };
  }

  const toCharge = Math.min(pending, perTickCap, capUnitsLeft);

  // Keep the Gateway float fed as a rolling buffer of topupUnits of runway, refilled from the EOA
  // in one chunk (ensureFunded is a no-op when the float still covers it). The trigger is "will
  // this tick's charges cross a topupUnits boundary", NOT "does the count sit exactly on one": a
  // catch-up tick bills several units at once and skips exact multiples, which under the old
  // modulo check meant the refill could simply never fire again and the float drained while the
  // lease still said running. Crossing detection can't be skipped. If the EOA can't cover the
  // refill the wallet is dry: suspend and stamp suspended_at for the grace timer.
  const topupUnits = deps.topupUnits ?? maxUnits;
  if (topupUnits > 0 && priceAtomic > 0n) {
    const crossesBoundary =
      Math.floor(chargedSoFar / topupUnits) !== Math.floor((chargedSoFar + toCharge) / topupUnits);
    if (chargedSoFar === 0 || crossesBoundary) {
      try {
        await settlement.ensureFunded(BigInt(Math.max(topupUnits, toCharge)) * priceAtomic);
      } catch (e) {
        const reason = e instanceof Error ? e.message : "top-up failed";
        if (isBalanceError(reason)) {
          await registry.updateRent(rentId, { status: "suspended", statusReason: reason, suspendedAt: isoNow() });
          return { charged: false, status: "suspended", reason };
        }
        // Transient refill failure: try the charge anyway (the float may still cover it). If
        // the pay fails too, the stall path advances the watermark so the gap is never
        // retro-billed, and the next tick retries the refill.
      }
    }
  }

  // ONE batched nanopayment covers all `toCharge` units owed this tick. The payment is still
  // a single off-chain x402 authorization (Circle batches settlement on its side); pricing it
  // at units * listed price is what lets one worker meter any number of leases in real time,
  // where paying per unit made fleet throughput = lanes / pay-latency and every meter lagged.
  // maxAtomic hands the guard this call's exact ceiling so an endpoint can't overbill a batch.
  const url = `${provider.endpointUrl}${d.path}?session=${rent.id}&units=${toCharge}`;
  const lh = deps.health && deps.degradation ? deps.health.for(rentId, provider.id) : null;
  let chargedAny = false;
  let chargedUnits = 0;
  let degradedReason: string | null = null;
  // The ceiling is round(units * price), matching how the provider prices the batch: listings
  // can price finer than one atomic unit (4.5 atomic/sec), so rounding per unit first would
  // undercut the provider's honest ask and refuse the batch.
  const batchCeilingAtomic = BigInt(Math.round(toCharge * provider.pricePerCharge * 1_000_000));
  try {
    const paid = await settlement.payForCompute(url, batchCeilingAtomic);
    const paidAtomic = Number(paid.amountAtomic);
    // The platform fee is a RECEIVABLE the provider owes from this payment (they received
    // gross; they remit fee from their Gateway earnings). Nothing extra leaves the renter,
    // and no second payment happens here. fee_settlement_ref is stamped when a verified
    // remittance covers this charge.
    const feeAtomic = Math.floor((paidAtomic * (deps.feeBps ?? 0)) / 10_000);
    await registry.recordCharge({
      rentId, providerId: provider.id, seq: chargedSoFar, units: toCharge,
      amount: paidAtomic, feeAmount: feeAtomic, feeSettlementRef: null,
      authorizationRef: null, settled: false, settlementRef: paid.settlementRef,
    });
    chargedAny = true;
    chargedUnits = toCharge;
    lh?.monitor.observe({ ok: true }); // a paid hit is a healthy sample; clears the failure streak
  } catch (e) {
    if (e instanceof SpendCapError) {
      await registry.updateRent(rentId, { status: "suspended", statusReason: e.message });
      return { charged: false, status: "suspended", reason: e.message };
    }
    // Before blaming the provider, check whose failure this was. A pay that failed because OUR
    // float ran dry is a funding problem: probing ensureFunded either refills it (deposited =
    // true -> retry next tick, no health penalty for the provider) or throws (the EOA is dry
    // end-to-end -> balance-suspend with the grace stamp, same as the pre-loop refill path).
    // Only a failure with a healthy float is a provider health sample; once the streak crosses
    // the monitor's threshold we resolve a migrate/hold below instead of just retrying forever.
    let fundingShaped = false;
    try {
      const probe = await settlement.ensureFunded(BigInt(Math.max(topupUnits, toCharge)) * priceAtomic);
      fundingShaped = probe.deposited;
    } catch (fundErr) {
      const reason = fundErr instanceof Error ? fundErr.message : "top-up failed";
      if (isBalanceError(reason)) {
        await registry.updateRent(rentId, { status: "suspended", statusReason: reason, suspendedAt: isoNow() });
        return { charged: false, status: "suspended", reason };
      }
      // Transient probe failure (rate limit, RPC blip): funding-shaped, not the provider's
      // fault. Keep running, no health penalty; the stall watermark bills nothing for the gap.
      fundingShaped = true;
    }
    if (!fundingShaped && lh) {
      const h = lh.monitor.observe({ ok: false });
      if (!h.healthy) degradedReason = h.reason;
    }
    // transient: nothing billed this tick; the watermark below advances to `now` so the
    // un-served gap is never retroactively billed once the lease recovers.
  }

  // Advance the billing watermark by exactly what we billed. On a healthy time tick that consumes
  // `chargedUnits` whole ticks, leaving any cap-limited remainder to bill next tick (so a slow pass
  // catches up rather than dropping time). Bootstrap and volume are usage/now-driven, and when a
  // pay() failed mid-loop (a stall or a degrading provider) we advance to `now` so the un-served gap
  // isn't retroactively billed when the lease recovers: a stalled lease bills nothing for the stall.
  const stalled = chargedUnits < toCharge;
  const newWatermarkMs =
    d.metering === "volume" || bootstrap || stalled ? now : watermarkMs + chargedUnits * tickMs;

  if (lh && degradedReason) {
    const reason = await resolveDegradation(rentId, rent, provider, lh, degradedReason, deps);
    await registry.updateRent(rentId, { totalCost: await registry.rentCost(rentId), lastChargedAt: new Date(newWatermarkMs).toISOString(), suspendedAt: null });
    return { charged: chargedAny, status: "running", reason };
  }

  // A healthy running tick clears any prior balance-suspend stamp so the grace timer resets.
  await registry.updateRent(rentId, {
    totalCost: await registry.rentCost(rentId),
    lastChargedAt: new Date(newWatermarkMs).toISOString(),
    suspendedAt: null,
  });
  return { charged: chargedAny, status: "running", reason: chargedAny ? "charged" : "transient" };
}

export type SweepDeps = { registry: Registry; graceMs: number; nowMs?: () => number; network?: NetworkAdapter };

// A lease suspended for balance whose suspended_at is older than the grace window is terminated
// (completed with a reason) so dead leases don't linger. Only acts on balance-suspends: those carry
// a suspended_at stamp. A refund that flipped the lease back to running cleared the stamp already.
export async function sweepSuspended(rentId: string, deps: SweepDeps): Promise<{ status: RentStatus | "missing" }> {
  const clock = deps.nowMs ?? Date.now;
  const rent = await deps.registry.getRent(rentId);
  if (!rent) return { status: "missing" };
  if (rent.status !== "suspended" || !rent.suspendedAt) return { status: rent.status };
  if (clock() - new Date(rent.suspendedAt).getTime() < deps.graceMs) return { status: "suspended" };
  await deps.registry.updateRent(rentId, {
    status: "completed", totalCost: await deps.registry.rentCost(rentId), endedAt: isoNow(),
    statusReason: "ended after balance stayed low past the grace window",
  });
  await revokeNetwork(deps.network, rentId);
  return { status: "completed" };
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
