import type { Registry } from "../registry/registry";
import type { SettlementAdapter } from "../settlement/adapter";
import type { Provider, Rent } from "../domain";
import { SpendCapError } from "../settlement/spend-policy";
import { HealthMonitor } from "./health";

export type StreamDeps = {
  registry: Registry;
  settlement: SettlementAdapter;
  health?: HealthMonitor;
};

export type StreamOptions = {
  maxUnits?: number; // safety bound on iterations
  shouldStop?: () => boolean; // external cancel signal, checked before each unit
};

export type StoppedBy = "cancel" | "cap" | "maxUnits" | "unhealthy";

export type StreamResult = {
  units: number;
  totalCostAtomic: bigint;
  stoppedBy: StoppedBy;
  reason: string;
};

// The per-rent payment loop. Pays one charge per unit, records it, watches health,
// and stops instantly on cancel / spend cap / health failure. Migration to another
// provider on degrade is Plan 6; here an unhealthy provider just stops the stream.
export async function streamRent(
  rent: Rent,
  provider: Provider,
  deps: StreamDeps,
  opts: StreamOptions = {},
): Promise<StreamResult> {
  const url = `${provider.endpointUrl}/compute?session=${rent.id}`;
  const maxUnits = opts.maxUnits ?? Number.POSITIVE_INFINITY;
  const health = deps.health ?? new HealthMonitor();

  let units = 0;
  let totalCostAtomic = 0n;
  let seq = 0;

  const done = (stoppedBy: StoppedBy, reason: string): StreamResult =>
    ({ units, totalCostAtomic, stoppedBy, reason });

  while (units < maxUnits) {
    if (opts.shouldStop?.()) return done("cancel", "cancelled by caller");

    let paid;
    try {
      paid = await deps.settlement.payForCompute(url);
    } catch (err) {
      if (err instanceof SpendCapError) return done("cap", err.message);
      const h = health.observe({ ok: false }); // x402/facilitator failure: no charge advances
      if (!h.healthy) return done("unhealthy", h.reason);
      continue; // transient: try the next unit
    }

    await deps.registry.recordCharge({
      rentId: rent.id,
      providerId: provider.id,
      seq: seq++,
      amount: Number(paid.amountAtomic),
      authorizationRef: null,
      settled: false,
      settlementRef: paid.settlementRef,
    });
    totalCostAtomic += paid.amountAtomic;
    units++;

    const h = health.observe({ ok: true });
    if (!h.healthy) return done("unhealthy", h.reason);
  }

  return done("maxUnits", `reached maxUnits=${maxUnits}`);
}
