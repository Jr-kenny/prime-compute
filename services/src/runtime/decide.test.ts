import { test, expect } from "bun:test";
import { decide, type DecideClient } from "./decide";
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

test("falls back when the client hangs past the timeout, within the budget", async () => {
  // A client that never resolves — simulates a hung model endpoint.
  const client: DecideClient = { propose: () => new Promise<Proposal[]>(() => {}) };
  const fallback = () => [{ action: "hold", score: 1, rationale: ["timed out"], userExplanation: "f" }];
  const started = Date.now();
  const d = await decide({ soul, policy, context, actions, client, fallback, timeoutMs: 50 });
  const elapsed = Date.now() - started;
  expect(d.usedFallback).toBe(true);
  expect(d.proposals[0]?.action).toBe("hold");
  expect(elapsed).toBeLessThan(1000); // returned promptly, not hung
});
