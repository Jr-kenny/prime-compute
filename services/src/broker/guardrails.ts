import type { Provider, RentSpec } from "../domain";

export type GuardResult = { ok: true } | { ok: false; reason: string };

// Re-validate the AI's pick against the hard requirements before any money moves.
// The spend/balance guard lives in the settlement adapter (checkSpend +
// ensureFunded); this covers liveness, stake, and requirement fit.
export function revalidateProvider(p: Provider, spec: RentSpec): GuardResult {
  if (!p.online) return { ok: false, reason: `provider ${p.id} is offline` };
  if (p.stakeAmount <= 0) return { ok: false, reason: `provider ${p.id} has no active stake` };
  if (p.resourceType !== spec.resourceType) {
    return { ok: false, reason: `provider ${p.id} is ${p.resourceType}, need ${spec.resourceType}` };
  }
  if (spec.region !== null && p.region !== spec.region) {
    return { ok: false, reason: `provider ${p.id} is in ${p.region}, need ${spec.region}` };
  }
  return { ok: true };
}
