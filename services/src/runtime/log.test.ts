import { test, expect } from "bun:test";
import { buildDecisionLog } from "./log";
import type { Decision, DecisionContext, Proposal } from "./types";
import type { Selection } from "./select";

const proposals: Proposal[] = [
  { action: "hold", score: 0.8, rationale: ["transient"], userExplanation: "holding" },
  { action: "migrate", target: "B", score: 0.2, rationale: ["fallback"], userExplanation: "move" },
];
const decision: Decision = { proposals, soulVersion: "1.0.0", policyVersion: "2.0.0", decisionId: "dec-1", usedFallback: false };
const context: DecisionContext = { objective: "respond-to-degradation" };

test("stamps versions, objective, chosen action and rejection reason", () => {
  const selection: Selection = { chosen: proposals[1], rejected: [{ proposal: proposals[0], reason: "retry budget exhausted" }] };
  const log = buildDecisionLog(decision, context, selection);
  expect(log.decisionId).toBe("dec-1");
  expect(log.soulVersion).toBe("1.0.0");
  expect(log.policyVersion).toBe("2.0.0");
  expect(log.objective).toBe("respond-to-degradation");
  expect(log.chosenAction).toEqual({ action: "migrate", target: "B" });
  expect(log.rejectedReason).toBe("retry budget exhausted");
  expect(log.usedFallback).toBe(false);
  expect(log.createdAt).toBeTruthy();
});

test("chosenAction is null and rejectedReason is null when nothing was chosen", () => {
  const selection: Selection = { chosen: null, rejected: [] };
  const log = buildDecisionLog(decision, context, selection);
  expect(log.chosenAction).toBeNull();
  expect(log.rejectedReason).toBeNull();
});
