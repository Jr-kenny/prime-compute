import type { RankStrategy } from "./matching";
import { rankDecideStrategy } from "./rank-decide";
import { loadBrokerAgent } from "./agent";
import type { DegradationDeps } from "./degradation";
import { makeDecideClient, type DecideClient } from "../runtime/decide";
import type { Soul, Policy } from "../runtime/types";

export type BrokerAgentDeps = { rank: RankStrategy; degradation: DegradationDeps };

// The deployed broker's default wiring: rank providers AND respond to degradation by
// reasoning from the shipped soul + policy, sharing one model client. Both surfaces use the
// same soul, so the broker's taste is consistent. The deterministic scorer / migrate-to-best
// stay the fallback inside `decide()`, so a model outage still degrades safely.
//
// Overrides exist for hermetic tests: inject a stub `client` (and optionally soul/policy) to
// exercise the wiring without a live model. With no overrides it builds the real model client
// via `makeDecideClient()`, which needs LLM_BASE_URL/LLM_API_KEY.
export async function liveBrokerDeps(
  overrides: { soul?: Soul; policy?: Policy; client?: DecideClient } = {},
): Promise<BrokerAgentDeps> {
  const agent =
    overrides.soul && overrides.policy
      ? { soul: overrides.soul, policy: overrides.policy }
      : await loadBrokerAgent();
  const client = overrides.client ?? makeDecideClient();
  const deps: DegradationDeps = { soul: agent.soul, policy: agent.policy, client };
  return { rank: rankDecideStrategy(deps), degradation: deps };
}
