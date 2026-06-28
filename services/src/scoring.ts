import type { Provider, JobSpec } from "./domain";

export function hardFilter(providers: Provider[], job: JobSpec): Provider[] {
  return providers.filter(
    (p) =>
      p.online &&
      p.stakeAmount > 0 &&
      p.resourceType === job.resourceType &&
      (job.region === null || p.region === job.region),
  );
}

// Lower price is better; higher score is better; lower latency is better.
// Normalize each dimension across the candidate set, then weight.
export function scoreProviders(providers: Provider[], _job: JobSpec): Provider[] {
  if (providers.length === 0) return [];
  const prices = providers.map((p) => p.pricePerTick);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const norm = (v: number, lo: number, hi: number) =>
    hi === lo ? 1 : (v - lo) / (hi - lo);

  function rank(p: Provider): number {
    const priceTerm = 1 - norm(p.pricePerTick, minP, maxP); // cheaper => higher
    const scoreTerm = p.computeScore / 100;
    const latencyTerm = 1 - norm(p.avgLatencyMs, 0, 20);
    return 0.4 * priceTerm + 0.45 * scoreTerm + 0.15 * latencyTerm;
  }

  return [...providers].sort((a, b) => rank(b) - rank(a));
}
