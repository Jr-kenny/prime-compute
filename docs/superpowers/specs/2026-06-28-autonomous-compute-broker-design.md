# Autonomous Compute Broker — Design (Slice 1)

> Status: approved design, ready to turn into an implementation plan.
> Date: 2026-06-28.

## What we're building

prime-compute is a marketplace where people rent out idle compute and consumers
pay for it per usage, settled in real USDC on Arc (Circle's stablecoin L1). The
demo that currently lives in this repo is just the drawing: a frontend wired to
`src/lib/mock-data.ts` with no backend, no chain, no real settlement. This spec
is the engine room that replaces the mock.

The full product is four layers:

1. **Marketplace** — providers register idle resources (specs, region, price per
   tick, reliability); consumers post jobs (requirements, latency preference,
   estimated usage, priority).
2. **AI Broker** — the brain. Discovers and ranks providers, opens the payment
   stream, monitors job health, migrates/rebalances when a provider degrades,
   and routes payments. It genuinely decides; it does not just automate.
3. **Streaming settlement** — nanopayments on Arc: open, pay per tick, pause and
   cancel instantly, only ever pay for what was consumed.
4. **Reputation** — every provider has a Compute Score built from real outcomes
   (uptime, completion rate, latency, claimed-vs-observed specs).

We are not building all four at once. This spec defines **slice 1**: one real,
autonomous, on-chain-settling thread end to end, built so the rest grows on top
without rewrites.

## How settlement actually works on Arc

Arc nanopayments are not a literal always-open money pipe. They are x402 plus
Circle Gateway batched settlement:

- A provider exposes an HTTP endpoint behind Circle's `createGatewayMiddleware`
  (the x402 protocol, HTTP 402 Payment Required).
- To pay, the buyer signs an EIP-3009 `TransferWithAuthorization` off-chain,
  gasless. The provider verifies via Circle's facilitator and serves immediately.
- Circle Gateway batches many of those signed authorizations and settles them
  on-chain in one `submitBatch()` call on the Gateway Wallet contract. Minimum
  payment is $0.000001. SDK: `@circle-fin/x402-batching`.

So "stream USDC per second, pause instantly, refund the unused part" maps onto a
rapid series of gasless sub-cent x402 payments, one per tick, batched and settled
on Arc. Pause = stop ticking. Cancel = stop ticking. "Refund unused" is automatic
because unconsumed ticks are simply never paid. This is genuinely on-chain on Arc
testnet, not simulated.

## Settled decisions (the stack)

- **Settlement:** x402 + Circle Gateway, real on Arc testnet, funded test wallet.
- **Broker:** full autonomy. The AI makes the real calls (provider selection,
  migration, when to pause/cancel) with zero personality, bounded by
  deterministic guardrails it cannot override.
- **Broker brain:** Kimchi Inference (`kimi-k2.6`) via the Vercel AI SDK. Kimchi
  is OpenAI-compatible (`https://llm.kimchi.dev/openai/v1`), so it drops into the
  AI SDK through the OpenAI-compatible provider. $0 vendor cost, our own infra,
  swappable in one line.
- **Backend:** a Node service (the app is currently frontend-only) plus Supabase
  for state and realtime. The TanStack frontend already committed stays.
- **Compute:** simulated for now behind a pluggable `ComputeExecutor` interface.
  Real compute is the end goal. The likely real substrate is resource-sharing:
  a provider reselling capacity they already rent on Railway/Render rather than
  raw GPUs. That is Phase 2 and the executor interface is designed for it.

## Slice 1 — scope

One real end-to-end thread, fully autonomous, settling real testnet USDC:

> A user asks Lumen to find compute. Lumen searches the registry and helps them
> pick. They name and deploy a job and arm the autonomous operations. The broker
> opens an x402 nanopayment stream to the chosen provider's paywalled endpoint
> and fires one gasless micro-payment per tick. Circle Gateway batches and
> settles them on Arc. The live meter ticks real USDC. On cancel, completion, or
> a health signal, ticking stops instantly and the unused budget is simply never
> spent. Every decision and tick streams to the dashboard in real time.

In scope: registry, the autonomous broker, the x402 streaming engine, real Arc
settlement, a provider running real paywalled endpoints with simulated compute
behind them, payment-stream migration, and a Compute Score that updates from
settled jobs.

Out of scope for slice 1 (designed-for, built later): workload splitting across
providers, live migration of real workload state, on-chain registry, and real
compute execution.

## Components and boundaries

Six units, each with one job and a clean interface:

1. **Frontend** (existing TanStack app) — posts jobs, renders the live meter and
   the broker's decisions by subscribing to Supabase realtime. Lumen is the
   conversational surface (below). No logic in the money path.
2. **Broker service** (Node, always-on) — the autonomous brain. Vercel AI SDK +
   Kimchi. Makes the real decisions and drives the payment loop, wrapped in
   deterministic guardrails.
3. **Provider service** (x402 seller) — the deployable provider template, running
   `createGatewayMiddleware`. Each compute tick is a paywalled request. Behind
   the paywall sits a `ComputeExecutor` interface; slice 1 ships a
   `SimulatedExecutor`, Phase 2 adds `RailwayExecutor` / `RenderExecutor`. We run
   a simulator instance of this real template; the thing we simulate is the thing
   that later becomes the real deployable provider.
4. **Settlement adapter** (Arc + Circle Gateway) — the broker-as-buyer: signs
   EIP-3009 authorizations per tick from the funded Arc wallet; Gateway batches
   and settles. The only place real USDC moves.
5. **State + registry** (Supabase Postgres + realtime) — providers, jobs, ticks,
   reputation. Shared state and the live-update bus, behind a `Registry`
   interface so an on-chain backing can replace it later.
6. **Stream engine** (inside the broker) — opens the stream to the chosen
   provider, fires one x402 payment per tick while watching health, stops
   instantly on cancel/failure, records every tick.

Boundaries are deliberately clean: broker↔provider is plain x402 over HTTP,
everyone shares state through Supabase, settlement is isolated behind one adapter,
and all AI decisions are isolated in the broker behind the guardrails.

## Lumen — the conversational face of the broker

Lumen is not a sentence-to-JSON converter. It is the conversational interface
the whole selection-and-deploy flow runs through:

1. You ask Lumen: "find me [X]."
2. Lumen searches the entire registry and returns the picks that match.
3. If nothing matches, it says so, then recommends the closest ones it judges up
   to par, and can ask what you're trying to run so it can recommend better.
4. You select one (click) or tell it which.
5. It confirms conversationally ("Great, let's use [provider]").
6. It shows that provider's full services/specs.
7. It asks you to name the deployment and give an estimated usage (soft, does not
   bind, you can overrun).
8. You deploy.
9. The agent then asks whether you want the autonomous operations for this job
   (auto-pause / migrate / rebalance). Opt-in per deployment.

The structured job record still exists under the hood, but it is the output of
the Lumen conversation, not a form the user fills.

Lumen's talk is functional glue for the workflow, not invented personality. It
talks to drive search, recommend, confirm, and deploy, nothing more.

## Data flow (happy path, then cancel)

1. **Post.** User picks via Lumen and deploys. The deployment is written to
   `jobs` as `queued`: requirements, estimated usage, autonomy flag, provider.
2. **Pick.** The broker pulls candidate providers from the registry and asks
   Kimchi to rank them against the job. It records the ranked candidates and its
   rationale to `job_decisions` (the audit trail the dashboard renders).
3. **Guard.** Before any money moves, deterministic code checks: chosen rate is
   within any spend policy, wallet can cover the next tick, provider has an active
   stake. The AI never crosses this line.
4. **Fund.** Broker ensures the Arc wallet has USDC in the Gateway Wallet contract
   (one-time on-chain deposit if needed).
5. **Stream.** Job → `running`. Each tick (e.g. 1s): broker hits the provider's
   x402 endpoint → gets 402 with payment terms → signs an EIP-3009 authorization
   (gasless) → retries with it → provider verifies via the facilitator and serves
   the tick (simulated compute heartbeat + telemetry). Broker writes a `ticks`
   row; the UI meter moves via Supabase realtime.
6. **Settle.** Circle Gateway batches the authorizations and settles on Arc with
   `submitBatch`; we record the batch and tx hash against those ticks when it
   lands.
7. **Stop.** User cancels, job completes, or the broker cancels on a health/policy
   signal. Ticking stops immediately. Job → `completed`/`cancelled`. Final cost =
   sum of consumed ticks; unused budget was simply never spent.
8. **Score.** On stop, the provider's Compute Score updates from the outcome
   (completed vs failed, uptime, latency).

## Data model

**Supabase (off-chain state + realtime bus):**

- `providers` — id, alias, owner_wallet, endpoint_url, region, resource_type,
  specs (jsonb), price_per_tick, online, compute_score, stake_amount
- `jobs` — id, user, name, requirements (jsonb), estimated_usage, autonomy_armed,
  status, provider_id, total_cost, created_at, started_at, ended_at
- `job_decisions` — id, job_id, ranked candidates (jsonb), chosen_provider_id,
  rationale, created_at (the broker's real reasoning, for the audit/visualization)
- `ticks` — id, job_id, provider_id, seq, amount, authorization_ref, settled,
  settlement_ref, created_at
- `settlements` — id, batch_ref, tx_hash, tick_ids (array), amount, status,
  created_at (maps Gateway batches to the on-chain tx)

**On-chain (Arc testnet):**

- **Circle Gateway Wallet** — deposit + per-tick authorization + batch settlement.
  This is the payment flow being genuinely on-chain. Provided by Circle.
- **Provider stake/escrow contract (ours)** — a provider stakes USDC to list; it
  is slashable if they take payment and do not deliver. Real skin-in-the-game and
  the trustless anchor even while the registry index lives off-chain. Minimal in
  slice 1 (stake + slash). This is the natural seam where Approach 2 later moves
  the whole registry on-chain.

Everything goes through a `Registry` interface and a `Settlement` adapter, so
"registry goes on-chain" and "compute goes real" are later swaps, not rewrites.

## The broker's decision loop and guardrails

**One matching engine, two surfaces.** The core is a single function: take an ask
or job spec, query the registry for candidates, hand them to Kimchi with the
requirements, get back a ranked list plus rationale. Deterministic code does a
hard pre-filter first (resource type, region if required, online, active stake),
then Kimchi does the fuzzy multi-objective ranking (price vs score vs latency vs
fit). Lumen calls this interactively to help you choose; the broker calls the same
engine autonomously to re-pick mid-job.

**The autonomous loop (per armed job):**

- The stream engine fires a tick and pays for it.
- A health monitor reads the provider's heartbeat and telemetry each tick
  (latency, liveness, claimed-vs-observed specs).
- On a degradation signal, the broker asks Kimchi: here is the situation, here are
  the alternatives, migrate / pause / hold? Kimchi genuinely decides.
- Migration in slice 1 means re-pointing the payment stream to a new provider
  (stop paying A, start paying B). That is real and cheap even with simulated
  compute. Moving real workload state waits for real compute.

**The guardrails (deterministic, the AI cannot override):**

- Every authorization is checked against wallet balance (won't sign if it can't be
  covered) and the optional spend policy (max rate, max cumulative, max ticks/sec).
  The spend bound is wallet balance plus optional policy, never a hard pre-set
  budget.
- A provider must have an active on-chain stake to receive any payment.
- Any provider the AI picks is re-validated against the hard requirements before
  money moves.
- Every AI decision is a proposal; a deterministic executor validates and either
  executes it or bounces it back for a re-pick. AI has the wheel, the rails stop
  the cliff.

## Error handling

- **x402 failures** (402 not honored, signature rejected, facilitator down): retry
  with backoff; a failed tick does not advance and is not paid. Persistent failure
  marks the provider unhealthy and hands the decision to the broker.
- **Settlement lag/failure:** Gateway batches settle async, so ticks are recorded
  optimistically and reconciled when the batch lands; a failed batch is flagged
  for reconciliation, never double-paid.
- **Provider drops mid-job:** heartbeat gap → broker pauses or migrates → paying
  stops instantly.
- **Wallet runs dry:** the guardrail halts new authorizations and the job pauses
  in a clean state until topped up.
- **Model/tool-calling flaky:** the broker falls back to a deterministic weighted
  scoring function, so the money path never blocks on Kimchi being up. The system
  degrades to "still works, less smart," never to "stuck."

## Testing

- **First gate, before anything:** verify a single function-call round-trip
  against `kimi-k2.6` through the AI SDK. If tool calling does not pass the
  gateway, we know on day one and lean on the deterministic fallback.
- **Unit:** matching engine (filter + rank), guardrail checks
  (balance/policy/stake), tick accounting (cost = sum of consumed ticks, exactly).
- **Integration (the real proof):** full thread against Arc testnet with the
  funded wallet and the provider simulator: post → pick → stream → settle →
  cancel, then verify the on-chain settlement and that final cost equals consumed
  ticks.
- **Cancel-mid-stream:** ticking stops within one tick and unused budget is never
  spent.
- **Degrade:** the simulator drops its heartbeat, the broker autonomously
  re-points the payment stream to another provider.

## Roadmap beyond slice 1

- **Approach 2 — on-chain registry.** Move the provider/job registry and
  reputation into a contract on Arc (the stake/escrow contract is the seam).
- **Approach 3 — distributed providers.** The provider template becomes a real,
  independently deployable service others run and register. Core to the product,
  not optional.
- **Real compute.** Swap `SimulatedExecutor` for `RailwayExecutor` / `RenderExecutor`:
  a market for idle cloud capacity people already pay for, rather than raw GPUs.
- **Broker depth.** Workload splitting across providers, live workload-state
  migration, price negotiation.

## Open risks

- **Kimchi tool-calling through the gateway is unconfirmed.** OpenAI-compatible
  and an agentic model make it very likely, but the docs don't state it. The
  first test gate verifies it; the deterministic scoring fallback covers us if
  it's flaky.
- **Arc testnet specifics** (exact chain id, RPC, faucet, Gateway contract
  addresses) need to be pinned from the Circle/Arc docs during implementation.
- **x402 middleware in our runtime.** The reference stack is Next.js + Node; we
  confirm `@circle-fin/x402-batching` and `createGatewayMiddleware` run cleanly in
  our Node provider/broker services early.
