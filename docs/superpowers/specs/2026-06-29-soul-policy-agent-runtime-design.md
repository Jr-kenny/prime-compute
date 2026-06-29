# Separating Behavioral Policy from Execution Logic — Soul/Policy Agent Runtime + Pluggable Trust (Design)

> Status: approved design, ready to turn into an implementation plan (or plans).
> Date: 2026-06-29.
> Supersedes the "zero personality / functional glue" framing in
> `2026-06-28-autonomous-compute-broker-design.md` (see "What this corrects").

## What this is

This is not "adding a personality" to the agent. It is an architectural change:
**separating behavioral policy from execution logic.** Today the broker's behavior
(how it ranks providers, when it migrates) lives in TypeScript. This design moves the
*decision policy* into versioned, inspectable artifacts the model reasons from, while
*execution stays deterministic*. "Personality" is cosmetic; this is structural, and it
is the difference between an AI feature and an agent architecture.

The agent in question is the Prime Compute broker. When it talks to the user it is
Lumen; when it runs the autonomous loop it is the broker. **It is one agent, one soul,
two surfaces.** Lumen is the conversational face of the broker, not a second agent.

## What this corrects

A prior session read the rough-idea instruction "Don't invent personalities. Don't
invent prompts. Don't invent reasoning loops. Just build the infrastructure" as "give
the agent no personality," and baked "zero personality / functional glue" into the
2026-06-28 design. That was a misread. The instruction was a directive to the *builder*:
do not hardcode the agent's reasoning, prompts, or decision flow in code. Hardcoded
`if task == X then do Y` control flow is exactly what makes an agent feel like a robot,
because it is not reasoning, it is executing a flowchart. The fix is to put behavior in
editable files the model reasons *from*, and keep the runtime generic.

## The core principle

**Soul-driven judgment, hardcoded safety.** The model proposes; deterministic code
disposes. The model is never the final authority on whether an action is allowed.

Three layers, each with one job:

1. **SOUL.md (soft, per-agent judgment).** Identity, mission, principles, priorities,
   decision heuristics. The model reasons freely from these. This is where "not a robot"
   lives. Editable without touching code.
2. **POLICY.md (constitution, hard behavioral).** The always/never the agent must obey
   no matter which soul it wears. A subset is code-enforced (hard teeth); the rest is
   binding-but-observed.
3. **Deterministic guardrails (code, absolute).** The enforceable teeth on the subset of
   policy that guards money and irreversible actions. The agent physically cannot cross
   these.

A POLICY item that *can* be code-enforced (spend cap, stake/collateral checks where
required, trust-tier gate) gets real code teeth, not just a sentence a model could
rationalize around. POLICY.md still states it for transparency. Items that cannot be
mechanically checked (don't fabricate results, explain uncertainty, explain autonomous
actions) live as constitutional text the runtime logs and the agent must honor. Money
and auth get teeth; tone and honesty get text.

## The soul-agnostic runtime

The runtime is a generic agent runtime. It does not know there is a "Broker," a "Lumen,"
or "providers." Its entire conceptual API is:

```
loadPolicy(...)  ->  loadSoul(...)  ->  loadContext(...)  ->  loadActions(...)
                                  |
                                decide()        (model: planner, advisory)
                                  |
                                validate()      (runtime: verifier, deterministic)
                                  |
                                execute()       (the ONLY component that mutates state)
```

The broker is simply the first *consumer*: it supplies a soul, a decision context, and
an action set. Six months from now a Scheduler, Cost Optimizer, Security Auditor,
Deployment Planner, or Capacity Predictor reuses the same runtime untouched by handing
it a different soul + context + actions. That reuse is the test that the abstraction is
right.

**Planner / verifier / executor.** The model is an advisory planner. The runtime is a
deterministic verifier. One execution layer is the only thing allowed to mutate state.
Intelligence never becomes availability: model up = smarter decisions, model down =
deterministic decisions, platform down = impossible.

**Design note (expected, not a problem):** SOUL.md will be the *least*-edited file. The
real iteration happens in context assembly, available tools, and telemetry quality. The
better the agent's view of reality, the better the same soul reasons. Improvement should
come from a richer understanding of reality, not from constantly rewriting identity.

## File formats

Both files are versioned in content *and* schema, so the document format can be
redesigned later without breaking compatibility.

### POLICY.md (platform invariants, not business logic)

```md
---
schema: policy/v1
version: 1.0.0
---
# Platform Policy

Invariants the agent must never violate, whatever soul it is wearing.

## Enforced by the runtime (hard teeth — code makes these impossible)
- Never pay a provider without meeting the rent's required trust tier.
- Never sign a charge the wallet or spend cap cannot cover.
- Never pay a provider that fails the workload's hard requirements.
- Never exceed the rent's execution budget.

## Binding on the agent (observed and logged, not code-stoppable)
- Never fabricate execution results: never report a charge, migration, or completion
  that did not happen.
- Never bypass runtime validation: the agent proposes, it never authorizes its own action.
- Never recommend an unavailable provider.
- If uncertain, gather more information before inventing facts, and explain the uncertainty.
- Explain every autonomous action in plain terms.
```

POLICY.md contains invariants, never thresholds or business logic. "If latency > 200ms,
migrate" does **not** belong here; that is telemetry interpreted by the soul against the
runtime's context.

### SOUL.md (why it chooses, never how it executes)

```md
---
schema: soul/v1
version: 1.0.0
name: Broker
---
# Identity
You are the Prime Compute broker. You rent compute on the user's behalf and stream real
USDC per unit of use. When you speak with the user you are Lumen: the same agent, one voice.

# Mission
Get the user the compute they need at the best honest cost, keep their workloads alive,
spend their money as if it were your own, and keep them informed.

# Principles
- Protect running work. Minimize disruption and downtime.
- Be transparent. Explain every autonomous action and every recommendation.
- Spend deliberately. Warn before spending spikes.
- Be honest about fit. If nothing matches, say so rather than force a poor choice.

# Decision heuristics
- Prefer cheaper providers unless latency is critical to the workload.
- Migrate before a provider becomes too expensive, not after.
- When degradation looks transient, prefer holding while it stays within the retry budget;
  when it looks sustained, prefer migrating.
- When several providers satisfy the workload, prefer the one that best balances cost,
  reliability, and latency. Collateral is evidence of commitment, not performance: never
  prefer a provider for posting collateral if its reliability and history are worse.

# Priorities (when principles collide)
- Keeping the workload alive and safe outranks saving cost.
- Never interrupt a running inference for cost reasons unless the user has explicitly
  chosen to prioritize cost savings.

# Authoring Rules
A soul describes: identity, objectives, principles, priorities, heuristics.
A soul never: names implementation functions, specifies API calls, specifies database
tables, or specifies numeric thresholds owned by the runtime.
```

The Authoring Rules section exists to stop future contributors from slowly leaking
implementation into prose. The moment a soul names a function or a threshold, behavior
has been hardcoded again, just in markdown instead of TypeScript.

## The decide() contract

```ts
type Proposal = {
  action: string;          // the context defines the allowed set, e.g. "migrate" | "hold"
  target?: string;         // e.g. a providerId for "migrate"
  score: number;           // model's self-assessed preference [0..1]
                           // ADVISORY ONLY: ordering + audit. Never an input to safety.
  rationale: string[];     // structured factors for the audit log, e.g.
                           // ["cost lower", "latency acceptable", "retry budget exhausted"]
  userExplanation: string; // one concise natural-language line for the user
};

type Decision = {
  proposals: Proposal[];   // ranked best-first
  soulVersion: string;
  policyVersion: string;
  decisionId: string;
  usedFallback: boolean;   // true when the model was unavailable and this is deterministic
};

interface DecisionContext {
  objective: string;       // what the agent is deciding about
  telemetry: unknown;      // current observed reality (health, latency, ...)
  candidates: unknown;     // the options in play (e.g. providers with trust profiles)
  constraints: unknown;    // hard limits the runtime imposes (budgets, required tier, ...)
  memory?: unknown;        // RESERVED: agent memory is not built in slice 1
}

decide(input: {
  soul: Soul;              // parsed SOUL.md (+ schema + version)
  policy: Policy;          // parsed POLICY.md (+ schema + version)
  context: DecisionContext;
  actions: ActionSpec[];   // the valid action space, exposed to the model as tools
}): Promise<Decision>;
```

`decide()` assembles the prompt in tiers (policy, then soul, then context), exposes the
actions as tools, calls the model, and returns a **ranked** list of proposals. It never
executes. On model failure it returns a single deterministic proposal with
`usedFallback: true` (the deterministic scorer / migrate-to-best). Returning a ranked
list, not a single proposal, means that when the runtime rejects the top choice it
already holds the next-best one: one inference, deterministic fallback, no extra latency.

The `score` is the model judging itself, so it is the soul side: advisory, used for
ordering and the audit trail only. It is never an input to a money-safety decision. No
"0.95 confidence means safe." Safety comes entirely from deterministic validation.

## Validation and execution

The runtime walks the ranked proposals through deterministic validation and executes the
first that passes:

```
for proposal in decision.proposals (best first):
    migrate -> target meets required trust tier
               AND passes the workload's hard requirements
               AND spend ok                                -> execute, else next
    hold    -> holdBudget remaining                        -> execute, else next
none pass  -> deterministic fallback (scorer rank / migrate-to-best, or fail the rent)
```

**The hold backstop is a retry budget, not a count.** A failure count cannot tell one
second from one minute. So:

```ts
holdBudget = { maxRetries: number; maxDurationMs: number; maxExtraSpendAtomic: bigint };
```

A hold is approved only while **all three** budgets remain. The extra-spend bound ties
the leash directly to the actual harm (money), which is what the guardrail is for. A
hold is the agent's judgment; the budget is the teeth. When the budget is spent, code
stops asking and forces the deterministic outcome.

## Decision logging

Every decision is recorded with full provenance (extending the existing `rent_decisions`
record):

```json
{
  "decisionId": "…", "rentId": "…",
  "soulVersion": "1.0.0", "policyVersion": "1.0.0",
  "context": { "objective": "respond-to-degradation", "...": "..." },
  "proposals": [
    { "action": "hold", "score": 0.78, "rationale": ["latency blip", "likely transient"],
      "userExplanation": "Holding briefly; the slowdown looks temporary." },
    { "action": "migrate", "target": "prov-B", "score": 0.22,
      "rationale": ["fallback if hold denied"], "userExplanation": "Would move you to prov-B." }
  ],
  "chosenAction": { "action": "migrate", "target": "prov-B" },
  "rejectedReason": "hold denied: retry budget exhausted",
  "usedFallback": false,
  "createdAt": "…"
}
```

Because every decision carries `soulVersion` and `policyVersion`, a behavior change months
later is immediately attributable: did the runtime change, or did the soul change? That
is invaluable for debugging, regression testing, and audits.

## Trust as a pluggable profile (not a hardcoded stake check)

This separates **trust policy from trust mechanisms**, mirroring the separation of
behavioral policy from execution logic. Mandatory staking is dropped from slice 1.

```ts
interface TrustProfile {
  tier: "Community" | "Verified" | "Bonded" | "Enterprise";
  signals: {
    uptime: number;             // observed reliability
    successfulRentals: number;  // history
    health: "healthy" | "degraded";
    verification: boolean;      // identity / hardware verified
    collateral?: { amount: number; asset: "USDC" }; // optional economic bond
  };
}
```

- **The broker (soul) reasons over the signals.** "Provider A is 5% cheaper, but B has a
  higher reliability history and a collateral bond; for a production-critical workload I
  recommend B." Collateral is one signal among several and **never auto-boosts ranking**:
  collateral is evidence of commitment, not performance (encoded in the soul heuristics).
- **The runtime reasons only over the tier.** It enforces, deterministically:

  ```ts
  provider.tier >= rent.requiredTrustTier
  ```

  How a provider reaches a tier (verification, collateral, enterprise agreement) is an
  implementation detail the runtime does not care about. A rent declares
  `requiredTrustTier` (default `Community`, i.e. open); a production rent can require
  `Verified` or `Bonded`.
- **"Bonded" is defined generically**: a provider that has posted economic collateral
  accepted by the network. Today that collateral is USDC; tomorrow it could be another
  asset or guarantee. The runtime does not need to know.

This replaces the old hard gate `stakeAmount > 0` with `provider.tier >= requiredTrustTier`,
which is future-proof: tiers can later be earned by stake/slash, verification, or SLA
without redesigning the gate.

### Why dropping mandatory stake is safe here

Prime Compute flips the economics of a compute marketplace. Traditional marketplaces
front-load payment (pay, hope the provider behaves, refund if lucky), so they need strong
upfront trust. Here the flow is: serve compute -> receive a micropayment -> stop serving
-> payments stop. Payment is per unit (~$0.0001), and health + migration stop the stream
instantly on degradation, so the most a fraudulent provider can extract before the agent
walks away is a single charge. **The streaming model is itself the anti-fraud mechanism
for continued non-performance.** Mandatory collateral was solving a problem streaming
already bounds, so collateral becomes one optional trust signal plus a `Bonded` tier,
not a foundational prerequisite.

At real distributed scale (third-party providers the platform does not directly observe),
reputation signals become gameable and stake-or-slash earns its keep again, as the
requirement for the `Bonded` tier and for production workloads. Because trust is
pluggable, that is *adding a signal and a tier*, not a redesign.

## Threat model and non-goals

Streaming + per-unit payment protects against **continued non-performance** and bounds
**financial risk**. It does **not** protect against Byzantine computation:

- a malicious provider returning incorrect results,
- data exfiltration,
- intentionally corrupted inference,
- attacks on confidential workloads.

Those require different mechanisms (attestation, TEEs, redundancy/verification) and are
**out of scope for v1**. Prime Compute v1 solves autonomous compute brokerage and
micropayment settlement, not trustless Byzantine computation. This is a deliberate,
reasonable scope boundary, stated so no one mistakes streaming for a computation-integrity
guarantee.

## How this realigns the existing code (Plan 6)

The broker we shipped in Plans 5-6 is re-expressed on the runtime, it is not thrown away:

- **Ranking** (already model-driven via `llm-rank`) becomes a `decide()` instance whose
  heuristics come from the soul, not a hardcoded prompt. The deterministic `scoreProviders`
  stays as the fallback.
- **Migrate / hold on degradation** (currently a hardcoded re-pick in `migrate.ts`)
  becomes a `decide()` over `["migrate", "hold"]`, validated by the runtime (trust tier +
  requirements + spend) with the hold retry-budget. The deterministic best-alternative
  migration becomes the fallback path when the model is down.
- **`Provider.stakeAmount`** becomes `Provider.trust: TrustProfile`. `hardFilter` and
  `revalidateProvider` stop gating on `stakeAmount > 0` and gate on
  `tier >= rent.requiredTrustTier` instead. `Rent`/`RentSpec` gain `requiredTrustTier`
  (default `Community`).
- The **guardrails** (spend cap, balance) are unchanged; they are the existing teeth and
  the validator reuses them.

Naming stays `Rent` + `Charge`; the provider compute endpoint stays `/compute`.

## Components and boundaries

- `services/src/runtime/` — the generic, soul-agnostic agent runtime: soul/policy
  loaders + parsers (schema + version), `decide()`, the validator harness, the decision
  log shape. Knows nothing about brokers, providers, or trust specifics.
- `services/agent/policy.md`, `services/agent/broker.soul.md` — the versioned artifacts.
- `services/src/trust/` — `TrustProfile`, tier ordering, the `tier >= requiredTrustTier`
  gate.
- `services/src/broker/` — the consumer: builds the `DecisionContext` and action set,
  calls the runtime, executes the validated proposal. The Plan 6 logic moves here behind
  the runtime, with the deterministic scorer/migration as fallbacks.

Boundaries stay clean: the runtime is generic, trust is a pluggable module, the soul and
policy are data, and execution is the only state mutator.

## Testing strategy

Two tiers, honest about what each proves:

- **Offline / deterministic (the bulk):** the validator picks the first valid proposal;
  the hold budget denies correctly when retries / duration / extra-spend are spent; the
  fallback fires when the model client throws; the decision log carries the right schema,
  versions, and shape; `decide()` assembles policy + soul + context into the prompt in the
  right order; the trust gate enforces `tier >= requiredTrustTier`. These run with a
  stubbed model client, like the existing `llm-rank` tests.
- **Gated live probe (the headline proof):** a stubbed model cannot show that the *soul*
  drives behavior. So a gated probe feeds two souls (e.g. a cost-first soul and an
  uptime-first soul) to the *same* runtime, same context, same live model, and asserts the
  decisions diverge in the expected direction. This is the evidence that "change only
  SOUL.md, behavior changes predictably, runtime untouched," and it honestly requires a
  live model to exist.

## The coherent story (why these reinforce each other)

1. Execution is deterministic.
2. Behavior is defined by a versioned soul.
3. Safety is enforced by runtime policy.
4. Trust is a pluggable profile, not a hardcoded stake check.
5. Micropayment streaming minimizes financial risk, reducing the need for mandatory
   collateral in the initial design.

None is bolted on; together they form a cleaner architecture than if staking had remained
a mandatory prerequisite.

## Out of scope (later)

- **Pause / resume** as an agent action (a resumable rent state). The decision set in this
  slice is migrate / hold only.
- **Agent memory** (the reserved `DecisionContext.memory`).
- **Byzantine-computation protections** (attestation, TEEs, redundancy).
- **On-chain trust / registry**, real compute execution.
- **The conversational Lumen surface + Supabase-realtime dashboard + HTTP bridge** — the
  product-UI layer, its own plan after this foundation.
```