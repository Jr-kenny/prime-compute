import type { ActionSpec, Decision, Proposal } from "@services/runtime/types";
import type { Provider } from "@services/domain";

// The conversational action set. The model picks one per turn; only `recommend_provider`
// carries a target (a provider id). Money and persistence never happen here — a
// recommendation is only a proposal; the user confirms, and the real `createRent`
// server-fn disposes. (Runtime principle: model proposes, code disposes.)
export const CHAT_ACTIONS: ActionSpec[] = [
  {
    name: "recommend_provider",
    description:
      "Recommend one currently-listed provider to rent for what the user described. " +
      "Pass its provider id as `target`. Use only when the user wants compute.",
  },
  {
    name: "report_status",
    description: "Summarize the user's current rents and account state. Use for questions about their orders.",
  },
  {
    name: "answer",
    description:
      "Reply to the user without taking an action: capabilities, clarifying questions, or when nothing fits.",
  },
];

// What `brokerChat` returns to the overlay. `provider` is present only for a verified
// recommend_provider.
export type ChatResult = {
  reply: string;
  action: "recommend_provider" | "report_status" | "answer";
  provider?: Provider;
};

// The deterministic plan for when the model is unavailable or unconfigured. A single,
// honest answer so the chat never errors out.
export function chatFallback(): Proposal[] {
  return [
    {
      action: "answer",
      score: 1,
      rationale: ["model unavailable; deterministic fallback"],
      userExplanation:
        "I can't reach my reasoning model right now, but I can still help you browse providers and queue compute from the marketplace.",
    },
  ];
}

const DEFAULT_REPLY = "I can find providers, check your rents, or queue compute. What do you need?";

// Pure: turn the runtime's top proposal into a UI-ready result. Enforces the policy's
// "never recommend an unavailable provider" structurally — a recommend_provider whose
// target isn't a real, currently-listed provider degrades to a plain answer rather than
// fabricating one.
export function shapeChatResult(decision: Decision, providers: Provider[]): ChatResult {
  const top = decision.proposals[0];
  if (!top) return { reply: DEFAULT_REPLY, action: "answer" };

  const reply = top.userExplanation || DEFAULT_REPLY;

  if (top.action === "recommend_provider") {
    const provider = providers.find((p) => p.id === top.target);
    if (provider) return { reply, action: "recommend_provider", provider };
    return { reply, action: "answer" };
  }

  if (top.action === "report_status") return { reply, action: "report_status" };

  return { reply, action: "answer" };
}
