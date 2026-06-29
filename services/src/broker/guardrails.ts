import type { Provider, RentSpec } from "../domain";
import { meetsTier, DEFAULT_TIER } from "../trust/trust";

export type GuardResult = { ok: true } | { ok: false; reason: string };

// Re-validate the AI's pick against the hard requirements before any money moves.
// The spend/balance guard lives in the settlement adapter (checkSpend +
// ensureFunded); this covers liveness, trust tier, and requirement fit.
export function revalidateProvider(p: Provider, spec: RentSpec): GuardResult {
  if (!p.online) return { ok: false, reason: `provider ${p.id} is offline` };
  const need = spec.requiredTrustTier ?? DEFAULT_TIER;
  if (!meetsTier(p.trust.tier, need)) {
    return { ok: false, reason: `provider ${p.id} tier ${p.trust.tier} is below required ${need}` };
  }
  if (p.resourceType !== spec.resourceType) {
    return { ok: false, reason: `provider ${p.id} is ${p.resourceType}, need ${spec.resourceType}` };
  }
  if (spec.region !== null && p.region !== spec.region) {
    return { ok: false, reason: `provider ${p.id} is in ${p.region}, need ${spec.region}` };
  }
  return { ok: true };
}
