import { test, expect } from "bun:test";
import { selectProposal, type Validation } from "./select";
import type { Decision, Proposal } from "./types";

const proposals: Proposal[] = [
  { action: "hold", score: 0.8, rationale: ["transient"], userExplanation: "holding" },
  { action: "migrate", target: "B", score: 0.2, rationale: ["fallback"], userExplanation: "move to B" },
];
const decision: Decision = { proposals, soulVersion: "1", policyVersion: "1", decisionId: "d", usedFallback: false };

test("returns the first proposal the validator accepts", () => {
  const validate = (p: Proposal): Validation => (p.action === "hold" ? { ok: true } : { ok: false, reason: "n/a" });
  const out = selectProposal(decision, validate);
  expect(out.chosen?.action).toBe("hold");
  expect(out.rejected).toEqual([]);
});

test("skips rejected proposals and records why", () => {
  const validate = (p: Proposal): Validation =>
    p.action === "hold" ? { ok: false, reason: "retry budget exhausted" } : { ok: true };
  const out = selectProposal(decision, validate);
  expect(out.chosen?.action).toBe("migrate");
  expect(out.rejected).toEqual([{ proposal: proposals[0]!, reason: "retry budget exhausted" }]);
});

test("returns null chosen when the validator rejects everything", () => {
  const validate = (): Validation => ({ ok: false, reason: "nope" });
  const out = selectProposal(decision, validate);
  expect(out.chosen).toBeNull();
  expect(out.rejected.length).toBe(2);
});
