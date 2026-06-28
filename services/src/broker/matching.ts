import type { Provider, RentSpec } from "../domain";
import type { Registry } from "../registry/registry";
import { hardFilter, scoreProviders } from "../scoring";

export type MatchResult = {
  candidates: { providerId: string; rank: number }[];
  chosen: Provider | null;
  rationale: string;
};

// Ranks pre-filtered candidates. Default is deterministic; an LLM strategy can
// replace it (Plan 6), with the deterministic scorer always the fallback.
export type RankStrategy = (providers: Provider[], spec: RentSpec) => Promise<Provider[]>;

export const deterministicRank: RankStrategy = async (providers, spec) =>
  scoreProviders(providers, spec);

export async function matchProviders(
  registry: Registry,
  spec: RentSpec,
  rank: RankStrategy = deterministicRank,
): Promise<MatchResult> {
  const candidatesRaw = await registry.listProviders({ resourceType: spec.resourceType, onlineOnly: true });
  const filtered = hardFilter(candidatesRaw, spec);
  if (filtered.length === 0) {
    return { candidates: [], chosen: null, rationale: "no providers match the hard requirements" };
  }

  let ranked: Provider[];
  let rationale: string;
  try {
    ranked = await rank(filtered, spec);
    rationale = rank === deterministicRank
      ? "ranked by deterministic price/score/latency blend"
      : "ranked by the broker model";
  } catch (err) {
    ranked = scoreProviders(filtered, spec);
    rationale = `model rank failed (${err instanceof Error ? err.message : "unknown"}); fell back to deterministic scorer`;
  }

  return {
    candidates: ranked.map((p, i) => ({ providerId: p.id, rank: i })),
    chosen: ranked[0] ?? null,
    rationale,
  };
}
