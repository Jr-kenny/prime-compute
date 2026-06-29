import type { Soul, Policy, DecisionContext, ActionSpec } from "./types";

export type AssembledPrompt = { system: string; user: string };

// Policy first (hard constraints), then soul (judgment), then the available actions. The
// concrete situation goes in the user turn. The model returns ranked proposals via a tool.
export function assemblePrompt(
  soul: Soul,
  policy: Policy,
  context: DecisionContext,
  actions: ActionSpec[],
): AssembledPrompt {
  const actionLines = actions.map((a) => `- ${a.name}: ${a.description}`).join("\n");
  const system = [
    "# PLATFORM POLICY (hard constraints — never violate)",
    policy.body,
    "",
    "# YOUR SOUL (how you judge)",
    soul.body,
    "",
    "# AVAILABLE ACTIONS",
    actionLines,
    "",
    "Propose the available actions ranked best-first for the situation. For each, give a",
    "self-assessed score in [0,1] (advisory only), structured rationale factors, and one",
    "concise user-facing explanation. You propose; the runtime decides what is allowed.",
  ].join("\n");
  const user = [
    `Objective: ${context.objective}`,
    `Situation: ${JSON.stringify({ telemetry: context.telemetry, candidates: context.candidates, constraints: context.constraints })}`,
  ].join("\n");
  return { system, user };
}
