import { generateText, tool } from "ai";
import { z } from "zod";
import { makeModel } from "../llm";
import { assemblePrompt, type AssembledPrompt } from "./prompt";
import type { Soul, Policy, DecisionContext, ActionSpec, Proposal, Decision } from "./types";

// The model-call seam. Real impl talks to the model; tests inject a deterministic stub.
export type DecideClient = {
  propose(prompt: AssembledPrompt, actions: ActionSpec[]): Promise<Proposal[]>;
};

// A model call that exceeds this is treated as down and falls back. A hung endpoint must
// never leave a caller (a UI chat turn, a ranking, a degradation decision) waiting forever.
// Sized generously: the NVIDIA NIM llama-3.3-70b endpoint measured ~35s for a real
// tool-call, so a tight budget would abort calls that would have succeeded. 60s leaves
// headroom for variance while still bounding a genuine hang.
export const DEFAULT_DECIDE_TIMEOUT_MS = 60_000;

export type DecideInput = {
  soul: Soul;
  policy: Policy;
  context: DecisionContext;
  actions: ActionSpec[];
  client: DecideClient;
  // The consumer's deterministic plan for when the model is unavailable. Optional; if
  // omitted, a model failure yields empty proposals flagged usedFallback.
  fallback?: () => Proposal[] | Promise<Proposal[]>;
  // Upper bound on the model call before it's treated as down. Defaults to
  // DEFAULT_DECIDE_TIMEOUT_MS.
  timeoutMs?: number;
  // The timer behind the timeout. Defaults to real setTimeout/clearTimeout. Tests inject a
  // controllable timer so the timeout path is exercised deterministically, without leaning on
  // wall-clock timing (which flakes under parallel-test load).
  timer?: Timer;
};

// The scheduling seam used by withTimeout. `set` returns an opaque handle that `clear` cancels.
export type Timer = {
  set: (cb: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const realTimer: Timer = {
  set: (cb, ms) => setTimeout(cb, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

// Reject if `p` doesn't settle within `ms`. The race only guarantees the caller stops
// waiting; the real client also wires an AbortSignal so the underlying request is actually
// cancelled rather than left running.
function withTimeout<T>(p: Promise<T>, ms: number, timer: Timer = realTimer): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = timer.set(() => reject(new Error(`decide timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { timer.clear(handle); resolve(v); },
      (e) => { timer.clear(handle); reject(e); },
    );
  });
}

// Assemble policy + soul + context, ask the model for ranked proposals, stamp provenance.
// Never executes. Degrades to the consumer's deterministic fallback when the model is down,
// returns nothing, or hangs past the timeout.
export async function decide(input: DecideInput): Promise<Decision> {
  const { soul, policy, context, actions, client, fallback, timeoutMs = DEFAULT_DECIDE_TIMEOUT_MS, timer } = input;
  const prompt = assemblePrompt(soul, policy, context, actions);

  let proposals: Proposal[] = [];
  let usedFallback = false;
  try {
    proposals = await withTimeout(client.propose(prompt, actions), timeoutMs, timer);
    if (proposals.length === 0) throw new Error("model returned no proposals");
  } catch (e) {
    console.error("[decide fallback reason]", e);
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

// Small models (llama-3.1-8b via NIM, notably) often double-encode nested tool args,
// sending `proposals` as a JSON *string* of the array instead of the array itself. Without
// this preprocess the SDK's schema validation rejects the call and every chat turn silently
// degrades to the fallback, looking like the model is down when it answered fine.
const jsonArrayTolerant = (v: unknown) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v; // let zod report the real shape error
  }
};

export const proposeArgsSchema = z.object({
  proposals: z.preprocess(
    jsonArrayTolerant,
    z.array(
      z.object({
        action: z.string(),
        target: z.string().optional(),
        score: z.number(),
        rationale: z.array(z.string()),
        user_explanation: z.string(),
      }),
    ),
  ),
});

// The real model-backed client. Network + tool-calling live only here.
export function makeDecideClient(): DecideClient {
  const { provider, modelId } = makeModel();
  return {
    async propose(prompt, _actions) {
      const result = await generateText({
        model: provider(modelId),
        system: prompt.system,
        prompt: prompt.user,
        // Cancel the request itself on timeout so a hung endpoint doesn't leak a pending
        // fetch. decide()'s own race is the guarantee; this is the cleanup.
        abortSignal: AbortSignal.timeout(DEFAULT_DECIDE_TIMEOUT_MS),
        // This endpoint is slow (~35s/call). The SDK's default retries (2) would stack
        // multiple slow attempts and blow the timeout budget. One clean attempt is the
        // right trade-off: decide() already has a deterministic fallback if it fails.
        maxRetries: 0,
        tools: {
          propose_actions: tool({
            description: "Return the available actions ranked best-first for this situation.",
            parameters: proposeArgsSchema,
          }),
        },
        maxSteps: 1,
      });
      const call = result.toolCalls.find((c) => c.toolName === "propose_actions");
      if (!call) throw new Error("model did not call propose_actions");
      const raw = (call.args as z.infer<typeof proposeArgsSchema>).proposals;
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
