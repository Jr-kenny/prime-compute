// The generic agent-runtime plane. Nothing here knows about brokers, providers, or trust.

export type Soul = {
  schema: string;   // e.g. "soul/v1"
  version: string;  // e.g. "1.0.0"
  name: string;     // e.g. "Broker"
  body: string;     // the markdown below the frontmatter
};

export type Policy = {
  schema: string;   // e.g. "policy/v1"
  version: string;
  body: string;
};

// One option the agent may propose. The model self-scores; score is ADVISORY ONLY
// (ordering + audit), never an input to a safety decision.
export type Proposal = {
  action: string;          // the available action set defines the allowed values
  target?: string;         // optional target id (e.g. a providerId for "migrate")
  score: number;           // [0..1], advisory
  rationale: string[];     // structured factors for the audit log
  userExplanation: string; // one concise natural-language line
};

// Why the model path failed, when it did. Consumers surface different messages for a slow
// endpoint ("timeout"), a prose answer with no tool call ("no_tool_call"), an empty ranking
// ("no_proposals"), and a genuinely failed call ("error").
export type FallbackReason = "timeout" | "no_tool_call" | "no_proposals" | "error";

export type Decision = {
  proposals: Proposal[];   // ranked best-first
  soulVersion: string;
  policyVersion: string;
  decisionId: string;
  usedFallback: boolean;   // true when the model was unavailable and this is deterministic
  fallbackReason?: FallbackReason; // set only when usedFallback is true
};

// What the runtime is deciding about. The consumer builds this however it likes; the
// runtime and soul never depend on its internals beyond `objective`.
export type DecisionContext = {
  objective: string;
  telemetry?: unknown;
  candidates?: unknown;
  constraints?: unknown;
  memory?: unknown; // RESERVED: agent memory is not built in this slice
};

// An action the model may pick, surfaced to it as a tool.
export type ActionSpec = {
  name: string;
  description: string;
};

export type DecisionLog = {
  decisionId: string;
  soulVersion: string;
  policyVersion: string;
  objective: string;
  proposals: Proposal[];
  chosenAction: { action: string; target?: string } | null;
  rejectedReason: string | null;
  usedFallback: boolean;
  createdAt: string;
};
