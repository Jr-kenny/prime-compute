import type { Decision, DecisionContext, DecisionLog } from "./types";
import type { Selection } from "./select";

// Build the audit record. Carries both version stamps so a behavior change later is
// attributable: runtime change or soul change?
export function buildDecisionLog(
  decision: Decision,
  context: DecisionContext,
  selection: Selection,
): DecisionLog {
  return {
    decisionId: decision.decisionId,
    soulVersion: decision.soulVersion,
    policyVersion: decision.policyVersion,
    objective: context.objective,
    proposals: decision.proposals,
    chosenAction: selection.chosen
      ? { action: selection.chosen.action, target: selection.chosen.target }
      : null,
    rejectedReason: selection.rejected.length > 0 ? selection.rejected[selection.rejected.length - 1].reason : null,
    usedFallback: decision.usedFallback,
    createdAt: new Date().toISOString(),
  };
}
