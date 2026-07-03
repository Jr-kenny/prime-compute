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

  // Honor a renter-pinned provider ("Rent from X"): if it survived the hard filters (still
  // online and meets the spec), move it to the front so provisioning starts there. If it dropped
  // out (offline, or no longer qualifies), we silently fall back to the ranked top. The migration
  // path re-derives candidates minus the providers already used, so a pinned provider that later
  // degrades hands off normally rather than getting re-pinned.
  if (spec.preferredProviderId) {
    const pinned = ranked.find((p) => p.id === spec.preferredProviderId);
    if (pinned) {
      ranked = [pinned, ...ranked.filter((p) => p.id !== pinned.id)];
      rationale = `pinned to ${pinned.alias} at the renter's request`;
    }
  }

  return {
    candidates: ranked.map((p, i) => ({ providerId: p.id, rank: i })),
    chosen: ranked[0] ?? null,
    rationale,
  };
}
