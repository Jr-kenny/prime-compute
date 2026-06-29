import { generateText, tool } from "ai";
import { z } from "zod";
import { makeModel } from "../llm";
import { assemblePrompt, type AssembledPrompt } from "./prompt";
import type { Soul, Policy, DecisionContext, ActionSpec, Proposal, Decision } from "./types";

// The model-call seam. Real impl talks to the model; tests inject a deterministic stub.
export type DecideClient = {
  propose(prompt: AssembledPrompt, actions: ActionSpec[]): Promise<Proposal[]>;
};

export type DecideInput = {
  soul: Soul;
  policy: Policy;
  context: DecisionContext;
  actions: ActionSpec[];
  client: DecideClient;
  // The consumer's deterministic plan for when the model is unavailable. Optional; if
  // omitted, a model failure yields empty proposals flagged usedFallback.
  fallback?: () => Proposal[] | Promise<Proposal[]>;
};

// Assemble policy + soul + context, ask the model for ranked proposals, stamp provenance.
// Never executes. Degrades to the consumer's deterministic fallback when the model is down.
export async function decide(input: DecideInput): Promise<Decision> {
  const { soul, policy, context, actions, client, fallback } = input;
  const prompt = assemblePrompt(soul, policy, context, actions);

  let proposals: Proposal[] = [];
  let usedFallback = false;
  try {
    proposals = await client.propose(prompt, actions);
    if (proposals.length === 0) throw new Error("model returned no proposals");
  } catch {
    usedFallback = true;
    proposals = fallback ? await fallback() : [];
  }

  return {
    proposals,
    soulVersion: soul.version,
    policyVersion: policy.version,
    decisionId: crypto.randomUUID(),
    usedFallback,
  };
}

// The real model-backed client. Network + tool-calling live only here.
export function makeDecideClient(): DecideClient {
  const { provider, modelId } = makeModel();
  return {
    async propose(prompt, _actions) {
      const result = await generateText({
        model: provider(modelId),
        system: prompt.system,
        prompt: prompt.user,
        tools: {
          propose_actions: tool({
            description: "Return the available actions ranked best-first for this situation.",
            parameters: z.object({
              proposals: z.array(
                z.object({
                  action: z.string(),
                  target: z.string().optional(),
                  score: z.number(),
                  rationale: z.array(z.string()),
                  user_explanation: z.string(),
                }),
              ),
            }),
          }),
        },
        maxSteps: 1,
      });
      const call = result.toolCalls.find((c) => c.toolName === "propose_actions");
      if (!call) throw new Error("model did not call propose_actions");
      const raw = (call.args as { proposals: Array<{ action: string; target?: string; score: number; rationale: string[]; user_explanation: string }> }).proposals;
      return raw.map((p) => ({
        action: p.action,
        target: p.target,
        score: p.score,
        rationale: p.rationale,
        userExplanation: p.user_explanation,
      }));
    },
  };
}
