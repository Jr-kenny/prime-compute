# Lumen, the broker

Lumen is the AI broker that sits in the middle of Prime Compute. When someone wants to rent
compute, they don't go shopping through a list of providers themselves. They tell Lumen what
they need and Lumen does the work: finds the providers that can actually run it, ranks them,
opens the payment stream, watches the rent while it's live, and moves or cancels it if the
provider starts to degrade. The little lantern in the corner of the app is the face of it, but
the real work happens in `services/`.

The one thing I care about most here: Lumen genuinely decides. It isn't a pile of if-statements
wearing an assistant costume. It reasons from a written soul and a written policy, and the code
around it only exists to stop it doing something unsafe with money. That split is the whole
design, so let me walk through it.

## What it actually does

A rent goes through Lumen in a few beats:

- **Discovery.** Pull the providers that could plausibly serve the rent out of the registry:
  the ones with the right specs, region, and a trust tier the rent is willing to accept.
- **Ranking.** Order those candidates. This is where the model reasons (more on that below). The
  output is always a permutation of the real candidates, best first.
- **Matching.** Pick the top provider that clears the rent's hard requirements, open a streaming
  payment channel to it, and mark the rent running.
- **Health.** While the rent is live, watch the provider. Latency creeping up, missed ticks,
  claimed specs not matching observed behaviour: all of it feeds a degradation signal.
- **Migration.** If a provider degrades past what the rent can tolerate, Lumen moves the rent to
  the next best provider and re-points the payment stream, without the renter having to notice.
- **Reconcile.** Every tick that got paid is settled against what was actually consumed, so the
  renter only ever pays for real usage.

The code for each of these lives in `services/src/broker/` (`rank-decide.ts`, `matching.ts`,
`health.ts`, `degradation.ts`, `migrate.ts`, `reconcile.ts`, with `runner.ts` driving the loop).

## Soul-driven, not hardcoded

The part I'm proud of is the ranking. Lumen loads two documents at startup (see
`services/src/broker/agent.ts`):

- a **broker soul** (`services/agent/broker.soul.md`), which is how it thinks about a good match,
- a **platform policy** (`services/agent/policy.md`), the rules it must never break.

The runtime assembles a prompt out of the policy, the soul, and the live decision context (the
candidate providers with their price, compute score, latency, region), and asks the model to
propose an ordering. There's no hardcoded weighting like "0.6 × price + 0.4 × latency" buried in
the ranker. If I want Lumen to care more about reliability than price, I edit the soul, not the
code. That's the point: the reasoning is a document you can read and change, not a formula you
have to reverse-engineer.

`rankDecideStrategy` in `rank-decide.ts` is where this happens. It's careful in two ways worth
calling out. The result is always a superset-permutation of the input, so if the model invents a
provider id it gets dropped, and any candidate the model forgot gets appended in its original
order. No provider ever silently vanishes from a rent because the model had an off moment. And if
the model call fails outright, `decide()` falls back to the deterministic scorer
(`scoreProviders`), so an LLM outage degrades Lumen to a plain, sane ranker instead of throwing.

## Where the guardrails are

Everything about money is code, and it's not negotiable. The policy file spells out the line
between "the runtime makes this impossible" and "the agent is expected to honour this."

The hard teeth, enforced in code so Lumen literally cannot cross them:

- never pay a provider that doesn't meet the rent's required trust tier,
- never sign a charge the wallet or spend cap can't cover,
- never pay a provider that fails the workload's hard requirements,
- never exceed the rent's execution budget.

The softer set is binding on the agent but only observed and logged: don't fabricate results,
don't authorize your own action (Lumen proposes, the runtime validates), don't recommend a
provider that isn't available, and explain every autonomous move in plain language. If Lumen ever
tries to step over a hard line, the runtime stops it. If it steps over a soft one, we see it in
the decision log. That way the agent gets real autonomy over the judgement calls (which provider,
when to migrate, when to wait) while the things that could lose someone money stay in code that
the model can't talk its way around.

## Why it matters to the app

Without Lumen, Prime Compute is just a list of machines and a wallet. Renting compute by hand
means comparing providers you don't have context on, babysitting the job, and eating the cost
when one degrades halfway through. Lumen is what turns that into "tell me what you need." It's
also what makes the streaming settlement worth having: a broker that can pause and re-route a
payment stream the instant a provider goes bad is the thing that makes pay-per-second safe for
the renter. The marketplace and the settlement rail are the hands; Lumen is the judgement.
