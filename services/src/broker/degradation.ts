import { decide, type DecideClient } from "../runtime/decide";
import { selectProposal, type Validation } from "../runtime/select";
import { RetryLeash } from "../runtime/budget";
import type { Soul, Policy, DecisionContext, ActionSpec, Proposal } from "../runtime/types";
import { revalidateProvider } from "./guardrails";
import type { Provider, RentSpec } from "../domain";

export type DegradationDeps = { soul: Soul; policy: Policy; client: DecideClient };

export type DegradationArgs = {
  current: Provider;
  reason: string;
  candidates: Provider[];   // untried providers that already pass the hard requirements
  spec: RentSpec;
  leash: RetryLeash;        // the per-rent hold retry budget
  nextChargeAtomic: bigint; // what one more charge on the current provider would cost
};

export type DegradationChoice =
  | { action: "hold"; rationale: string }
  | { action: "migrate"; target: Provider; rationale: string }
  | { action: "fallback"; rationale: string };

const ACTIONS: ActionSpec[] = [
  { name: "migrate", description: "stop paying the degraded provider and re-point the stream to a healthy alternative (give its id as target)" },
  { name: "hold", description: "keep the current provider for another short attempt while the retry budget allows; use only if the degradation looks transient" },
];

// Ask the model (reasoning from the soul) to choose migrate/hold for a degrading provider,
// then let deterministic validation decide what is actually allowed. The model proposes; the
// guardrail and the retry budget dispose. A dead model degrades to a deterministic migrate.
export async function decideMigrateOrHold(deps: DegradationDeps, args: DegradationArgs): Promise<DegradationChoice> {
  const context: DecisionContext = {
    objective: "respond-to-degradation",
    telemetry: { current: { id: args.current.id, pricePerCharge: args.current.pricePerCharge, failure: args.reason } },
    candidates: args.candidates.map((c) => ({ id: c.id, pricePerCharge: c.pricePerCharge, computeScore: c.computeScore, avgLatencyMs: c.avgLatencyMs, region: c.region })),
    constraints: { resourceType: args.spec.resourceType, region: args.spec.region },
  };

  const fallback = (): Proposal[] => {
    const first = args.candidates[0];
    if (!first) return [];
    return [{ action: "migrate", target: first.id, score: 1, rationale: ["deterministic fallback"], userExplanation: `Model unavailable; migrating to ${first.alias}.` }];
  };

  const decision = await decide({ soul: deps.soul, policy: deps.policy, context, actions: ACTIONS, client: deps.client, fallback });

  const byId = new Map(args.candidates.map((c) => [c.id, c]));
  const validate = (p: Proposal): Validation => {
    if (p.action === "hold") {
      const v = args.leash.tryConsume(args.nextChargeAtomic);
      return v.ok ? { ok: true } : { ok: false, reason: v.reason };
    }
    if (p.action === "migrate") {
      const target = p.target ? byId.get(p.target) : args.candidates[0];
      if (!target) return { ok: false, reason: `migrate target ${p.target ?? "(none)"} is not an untried candidate` };
      const g = revalidateProvider(target, args.spec);
      return g.ok ? { ok: true } : { ok: false, reason: g.reason };
    }
    return { ok: false, reason: `unknown action ${p.action}` };
  };

  const { chosen } = selectProposal(decision, validate);
  if (!chosen) return { action: "fallback", rationale: "no proposal passed validation" };

  const stamp = `[soul ${decision.soulVersion}/policy ${decision.policyVersion}${decision.usedFallback ? "; deterministic fallback" : ""}]`;
  if (chosen.action === "hold") {
    return { action: "hold", rationale: `${chosen.userExplanation} ${stamp}` };
  }
  const target = (chosen.target ? byId.get(chosen.target) : args.candidates[0])!; // validated non-null above
  return { action: "migrate", target, rationale: `${chosen.userExplanation} ${stamp}` };
}
