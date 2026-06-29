import { generateText, tool } from "ai";
import { z } from "zod";
import type { Provider, RentSpec } from "../domain";
import type { RankStrategy } from "./matching";
import { makeModel } from "../llm";

// The seam: hand the candidates to something that returns them ordered best-first.
// Real implementation is the model; tests inject a deterministic fake.
export type RankClient = {
  rankProviderIds(providers: Provider[], spec: RentSpec): Promise<string[]>;
};

// Turn a RankClient into a RankStrategy. The result is always a superset-permutation
// of the input: ids the model invented are dropped, candidates it omitted are
// appended in their original order, so no provider is ever silently lost. Throws if
// the client yields no usable ordering, which matchProviders catches and falls back
// to the deterministic scorer.
export function llmRankStrategy(client: RankClient): RankStrategy {
  return async (providers, spec) => {
    const order = await client.rankProviderIds(providers, spec);
    const byId = new Map(providers.map((p) => [p.id, p]));
    const ranked: Provider[] = [];
    const seen = new Set<string>();
    for (const id of order) {
      const p = byId.get(id);
      if (p && !seen.has(id)) {
        ranked.push(p);
        seen.add(id);
      }
    }
    // No usable ids from the model means it failed: throw so matchProviders falls
    // back to the deterministic scorer rather than silently using registry order.
    if (seen.size === 0) throw new Error("llm rank returned no usable ordering");
    for (const p of providers) if (!seen.has(p.id)) ranked.push(p);
    return ranked;
  };
}

// The real model-backed client. Network + tool-calling live only here.
export function makeRankClient(): RankClient {
  const { provider, modelId } = makeModel();
  return {
    async rankProviderIds(providers, spec) {
      const result = await generateText({
        model: provider(modelId),
        prompt: buildPrompt(providers, spec),
        tools: {
          rank_providers: tool({
            description:
              "Return every candidate provider id ordered best-first for this rent, " +
              "weighing price, compute score, latency, and fit.",
            parameters: z.object({
              ordered_provider_ids: z.array(z.string()).describe("provider ids, best first"),
            }),
          }),
        },
        maxSteps: 1,
      });
      const call = result.toolCalls.find((c) => c.toolName === "rank_providers");
      if (!call) throw new Error("model did not call rank_providers");
      return (call.args as { ordered_provider_ids: string[] }).ordered_provider_ids;
    },
  };
}

function buildPrompt(providers: Provider[], spec: RentSpec): string {
  const lines = providers.map(
    (p) =>
      `- id=${p.id} price/charge=${p.pricePerCharge} score=${p.computeScore} latencyMs=${p.avgLatencyMs} region=${p.region}`,
  );
  return [
    "You are an autonomous compute broker. Rank these providers best-first for the rent.",
    `Rent needs: resourceType=${spec.resourceType}` + (spec.region ? `, region=${spec.region}` : ""),
    "Cheaper price is better, higher compute score is better, lower latency is better.",
    "Candidates:",
    ...lines,
    "Call rank_providers with every id, ordered best first.",
  ].join("\n");
}
