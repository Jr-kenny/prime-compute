import type { Provider, RentSpec } from "../domain";
import type { RankStrategy } from "./matching";
import { scoreProviders } from "../scoring";
import { decide, type DecideClient } from "../runtime/decide";
import type { Soul, Policy, DecisionContext, ActionSpec, Proposal } from "../runtime/types";

export type RankDeps = { soul: Soul; policy: Policy; client: DecideClient };

// Ranking is a single-action decision: the model proposes one `select` per candidate,
// ordered best-first, with the provider id as the target.
const RANK_ACTIONS: ActionSpec[] = [
  {
    name: "select",
    description:
      "rank this candidate provider for the rent; pass the provider id as `target`. " +
      "Propose one `select` per candidate, ordered best-first.",
  },
];

// A soul-driven RankStrategy. The ordering heuristics come from the soul (the prompt is
// assembled by the runtime from policy + soul + context), not a hardcoded weighting. The
// result is always a superset-permutation of the input: invented ids are dropped and
// candidates the model omitted are appended in their original order, so no provider is
// ever lost. `decide()`'s fallback is the deterministic scorer, so a model outage degrades
// to scoreProviders without throwing.
export function rankDecideStrategy(deps: RankDeps): RankStrategy {
  return async (providers, spec) => {
    const context: DecisionContext = {
      objective: "rank-providers",
      candidates: providers.map((p) => ({
        id: p.id,
        pricePerCharge: p.pricePerCharge,
        computeScore: p.computeScore,
        avgLatencyMs: p.avgLatencyMs,
        region: p.region,
        tier: p.trust.tier,
      })),
      constraints: { resourceType: spec.resourceType, region: spec.region },
    };

    const fallback = (): Proposal[] =>
      scoreProviders(providers, spec).map((p, i) => ({
        action: "select",
        target: p.id,
        score: providers.length > 1 ? 1 - i / providers.length : 1,
        rationale: ["deterministic score fallback"],
        userExplanation: `Ranked ${p.alias} by the price/score/latency blend.`,
      }));

    const decision = await decide({
      soul: deps.soul,
      policy: deps.policy,
      context,
      actions: RANK_ACTIONS,
      client: deps.client,
      fallback,
    });

    const byId = new Map(providers.map((p) => [p.id, p]));
    const ranked: Provider[] = [];
    const seen = new Set<string>();
    for (const prop of decision.proposals) {
      const id = prop.target;
      if (!id || seen.has(id)) continue;
      const p = byId.get(id);
      if (p) {
        ranked.push(p);
        seen.add(id);
      }
    }
    for (const p of providers) if (!seen.has(p.id)) ranked.push(p);
    return ranked;
  };
}
