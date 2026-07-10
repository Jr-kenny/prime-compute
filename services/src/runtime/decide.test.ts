import { test, expect } from "bun:test";
import { decide, proposeArgsSchema, type DecideClient } from "./decide";
import type { Soul, Policy, DecisionContext, ActionSpec, Proposal } from "./types";

const policy: Policy = { schema: "policy/v1", version: "9.9.9", body: "p" };
const soul: Soul = { schema: "soul/v1", version: "1.2.3", name: "Broker", body: "s" };
const context: DecisionContext = { objective: "respond-to-degradation" };
const actions: ActionSpec[] = [{ name: "migrate", description: "" }, { name: "hold", description: "" }];

const ranked: Proposal[] = [
  { action: "hold", score: 0.8, rationale: ["transient"], userExplanation: "holding" },
  { action: "migrate", target: "B", score: 0.2, rationale: ["fallback"], userExplanation: "would move" },
];

test("returns the client's ranked proposals and stamps versions", async () => {
  const client: DecideClient = { propose: async () => ranked };
  const d = await decide({ soul, policy, context, actions, client });
  expect(d.proposals).toEqual(ranked);
  expect(d.soulVersion).toBe("1.2.3");
  expect(d.policyVersion).toBe("9.9.9");
  expect(d.usedFallback).toBe(false);
  expect(d.decisionId).toBeTruthy();
});

test("falls back deterministically when the client throws", async () => {
  const client: DecideClient = { propose: async () => { throw new Error("model down"); } };
  const fallback = () => [{ action: "migrate", target: "B", score: 1, rationale: ["deterministic"], userExplanation: "fallback" }];
  const d = await decide({ soul, policy, context, actions, client, fallback });
  expect(d.usedFallback).toBe(true);
  expect(d.proposals[0]?.action).toBe("migrate");
});

test("falls back when the client returns no proposals", async () => {
  const client: DecideClient = { propose: async () => [] };
  const fallback = () => [{ action: "hold", score: 1, rationale: [], userExplanation: "f" }];
  const d = await decide({ soul, policy, context, actions, client, fallback });
  expect(d.usedFallback).toBe(true);
  expect(d.proposals[0]?.action).toBe("hold");
});

test("with no fallback and a dead client, returns empty proposals flagged as fallback", async () => {
  const client: DecideClient = { propose: async () => { throw new Error("down"); } };
  const d = await decide({ soul, policy, context, actions, client });
  expect(d.usedFallback).toBe(true);
  expect(d.proposals).toEqual([]);
});

test("falls back when the client hangs past the timeout", async () => {
  // A client that never resolves — simulates a hung model endpoint. The injected timer fires
  // the timeout immediately, so the test proves the timeout path deterministically instead of
  // racing a real wall-clock delay (which flakes under parallel-test load).
  const client: DecideClient = { propose: () => new Promise<Proposal[]>(() => {}) };
  const fallback = () => [{ action: "hold", score: 1, rationale: ["timed out"], userExplanation: "f" }];
  const immediateTimer = { set: (cb: () => void) => { queueMicrotask(cb); return 0; }, clear: () => {} };
  const d = await decide({ soul, policy, context, actions, client, fallback, timeoutMs: 50, timer: immediateTimer });
  expect(d.usedFallback).toBe(true);
  expect(d.proposals[0]?.action).toBe("hold");
});

// The UI turns usedFallback into a user-facing excuse, so the decision must say WHY the
// model path failed: a slow endpoint, a prose answer with no tool call, and a dead endpoint
// need different messages (today they all render as "can't reach my reasoning model").
test("a generic client error is classified as 'error' and passed to the fallback", async () => {
  const seen: (string | undefined)[] = [];
  const client: DecideClient = { propose: async () => { throw new Error("connect ECONNREFUSED"); } };
  const fallback = (reason?: string) => { seen.push(reason); return [{ action: "hold", score: 1, rationale: [], userExplanation: "f" }]; };
  const d = await decide({ soul, policy, context, actions, client, fallback });
  expect(d.fallbackReason).toBe("error");
  expect(seen).toEqual(["error"]);
});

test("a prose answer without the tool call is classified as 'no_tool_call'", async () => {
  const client: DecideClient = { propose: async () => { throw new Error("model did not call propose_actions"); } };
  const d = await decide({ soul, policy, context, actions, client });
  expect(d.fallbackReason).toBe("no_tool_call");
});

test("an empty proposal list is classified as 'no_proposals'", async () => {
  const client: DecideClient = { propose: async () => [] };
  const d = await decide({ soul, policy, context, actions, client });
  expect(d.fallbackReason).toBe("no_proposals");
});

test("a hung call past the timeout is classified as 'timeout'", async () => {
  const client: DecideClient = { propose: () => new Promise<Proposal[]>(() => {}) };
  const immediateTimer = { set: (cb: () => void) => { queueMicrotask(cb); return 0; }, clear: () => {} };
  const d = await decide({ soul, policy, context, actions, client, timeoutMs: 50, timer: immediateTimer });
  expect(d.fallbackReason).toBe("timeout");
});

test("a successful decision carries no fallbackReason", async () => {
  const client: DecideClient = { propose: async () => ranked };
  const d = await decide({ soul, policy, context, actions, client });
  expect(d.fallbackReason).toBeUndefined();
});

// Small models (e.g. llama-3.1-8b via NIM) often double-encode nested tool args, sending
// `proposals` as a JSON *string* instead of an array. The schema must accept both shapes,
// or every chat turn silently degrades to the fallback.
test("proposeArgsSchema accepts proposals as an array", () => {
  const args = { proposals: [{ action: "answer", score: 1, rationale: ["r"], user_explanation: "hi" }] };
  const parsed = proposeArgsSchema.parse(args);
  expect(parsed.proposals[0]?.action).toBe("answer");
});

test("proposeArgsSchema accepts proposals double-encoded as a JSON string", () => {
  const args = { proposals: JSON.stringify([{ action: "answer", score: 1, rationale: ["r"], user_explanation: "hi" }]) };
  const parsed = proposeArgsSchema.parse(args);
  expect(parsed.proposals[0]?.action).toBe("answer");
  expect(parsed.proposals[0]?.user_explanation).toBe("hi");
});

test("proposeArgsSchema still rejects a string that isn't JSON", () => {
  expect(() => proposeArgsSchema.parse({ proposals: "not json" })).toThrow();
});
