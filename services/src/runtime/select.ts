import type { Decision, Proposal } from "./types";

export type Validation = { ok: true } | { ok: false; reason: string };

export type Selection = {
  chosen: Proposal | null;
  rejected: { proposal: Proposal; reason: string }[];
};

// Walk the ranked proposals through the consumer's deterministic validator and return the
// first one it accepts, recording why each earlier one was rejected. The runtime never
// decides what is allowed; `validate` (trust tier, spend, hold budget, ...) does.
export function selectProposal(
  decision: Decision,
  validate: (p: Proposal) => Validation,
): Selection {
  const rejected: { proposal: Proposal; reason: string }[] = [];
  for (const proposal of decision.proposals) {
    const v = validate(proposal);
    if (v.ok) return { chosen: proposal, rejected };
    rejected.push({ proposal, reason: v.reason });
  }
  return { chosen: null, rejected };
}
