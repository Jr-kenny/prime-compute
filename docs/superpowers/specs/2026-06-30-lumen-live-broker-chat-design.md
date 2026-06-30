# Lumen live: wiring the chat to the real broker brain — Design

**Status:** approved (brainstormed 2026-06-30). Next: implementation plan via writing-plans.

**One-line contract:** When the user chats with Lumen, every reply and recommendation is produced by
the real soul-driven broker brain reasoning over real registry data, and every action it takes runs
through the same verified-identity server-fns the rest of the app already uses. Nothing in the chat
is scripted or simulated anymore.

This is sub-project C, the conversational deploy surface. It is the last piece after the live-data
read path (A) and the write paths (B). Those proved every read and write goes through the real
`services/` registry. This one proves the chat does too.

The broker brain already exists: the generic `decide()` runtime (`services/src/runtime/`) plus the
shipped `broker.soul.md`, which states outright "When you speak with the user you are Lumen: the
same agent, one voice." Lumen is not a separate assistant; it is the broker talking. The only thing
missing is the bridge that turns a chat turn into a `decide()` call and renders the result.

---

## The gap

`src/components/site/LumenOverlay.tsx` calls a local `getReply()` that keyword-matches the user's
text and returns canned strings, a hardcoded `node-astral-1` provider, a fake `$1,284.93` balance,
and a "Confirm" button whose only effect is to append the false line "Payment stream opened to
node-astral-1." None of it touches the registry or the broker. That whole block is deleted here.

---

## Scope

**In scope:**
- One new server function, `brokerChat`, that drives a single chat turn through the real broker
  soul + `decide()` runtime over real provider/rent data.
- Rewiring `LumenOverlay` to call `brokerChat` instead of `getReply`, render real provider data in
  the confirm card, and create a real rent on confirm.
- Removing the simulated state the old chat carried: the canned replies, the hardcoded provider, the
  fake balance, and the "payment stream opened" lie.

**Out of scope:**
- No new always-on broker process, no on-chain payment streaming from the web app. Lumen creates a
  `queued`, unmatched rent exactly like the marketplace `RentSheet` does; the `services/` roundtrip
  scripts remain the only thing that streams real charges. The system stays exactly as capable as it
  is today; this just stops the chat from pretending otherwise.
- No streaming chat tokens. One `generateText` round-trip per turn, the same shape the ranker
  (`rankDecideStrategy`) already uses.
- No real wallet-balance read. The fake balance is removed; a real Arc/Circle balance read is a
  later, separate piece.
- No conversation memory across turns persisted server-side. Each turn builds its own context. (The
  runtime's `DecisionContext.memory` field stays reserved/unused, as it is today.)

---

## 1. `brokerChat` server function

New server fn in `src/lib/broker/server-fns.ts`, alongside the existing read/write fns.

Input: `{ accessToken?: string; message: string }`.

Behavior:
1. Load the shipped agent once per call via `loadBrokerAgent()` (`{ soul, policy }`).
2. Fetch real candidates: `getRegistry().listProviders()`. If `accessToken` is present, verify it
   with `requireUser` and also fetch the caller's `listRents({ userId })`; if absent, the user's
   rents are simply not part of the context (so "find a GPU" works signed-out, but "my orders"
   answers truthfully that the user isn't signed in).
3. Build a `DecisionContext`:
   - `objective` = the user's `message` (verbatim).
   - `candidates` = the providers, projected to the fields the model needs (id, alias, pricePerCharge,
     computeScore, avgLatencyMs, region, resourceType, online, trust tier) — the same projection
     style `rankDecideStrategy` already uses, never the raw row.
   - `telemetry` = a small summary of the user's active rents when signed in (count, names, statuses),
     so `report_status` can answer from real data.
   - `constraints` = `{ signedIn: boolean }` so the soul knows whether identity-bound actions are
     available.
4. Define the chat action set (`ActionSpec[]`):
   - `recommend_provider` — "recommend one provider to rent for what the user described; pass its
     provider id as `target`." Used when the user wants compute.
   - `report_status` — "summarize the user's current rents and account state." Used for "my orders".
   - `answer` — "reply to the user without taking an action." Used for everything else (capabilities,
     small talk, clarifying questions, "nothing matches").
5. Call `decide({ soul, policy, context, actions, client, fallback })`. The `fallback` returns a
   single `answer` proposal with a plain helpful line, so a model outage still yields a usable reply
   instead of an error (mirrors how `decide()` already degrades for ranking). One detail worth
   addressing up front: `makeDecideClient()` constructs the model eagerly through
   `makeModel()` → `loadConfig()`, which *throws* when `LLM_BASE_URL`/`LLM_API_KEY` are unset — that
   throw happens before `decide()` can reach its fallback. So the client is built inside a try/catch
   (or a tiny helper that returns `null` on missing config), and when there's no client `brokerChat`
   takes the fallback path directly. The chat must degrade to a deterministic answer when the model
   is unconfigured, never 500.
6. Take the top proposal and return a serializable result:
   `{ reply: string; action: "recommend_provider" | "report_status" | "answer"; provider?: Provider }`
   where `reply` is the proposal's `userExplanation`, and `provider` is the real provider record
   looked up by `proposal.target` (only when `action === "recommend_provider"` and the id is real;
   an invented id degrades to a plain `answer`, never a fabricated provider — the policy forbids
   recommending an unavailable provider).

`recommend_provider` only ever *proposes*; it never creates anything. Creation stays the user's
explicit confirm, through the existing `createRent`. This is the runtime's "model proposes, code
disposes" split: the chat path can surface a recommendation, but money and persistence only move
through the verified-identity server-fns.

Like the other provider-returning fns, `brokerChat` uses `strict: { output: false }` because
`Provider.specs` is an `unknown`-valued jsonb index signature the static serializability check can't
prove (it still goes over the wire as plain JSON).

---

## 2. Rewiring `LumenOverlay`

- Delete `getReply` entirely. The `quickActions` buttons stay as starter prompts, but they now just
  call `send()` with their label like any typed message, no special-casing.
- `send(text)` calls `brokerChat({ data: { accessToken?, message: text } })`, sourcing the token
  from `supabaseBrowser.auth.getSession()` (present-or-not; the fn handles both).
- On a result:
  - `answer` / `report_status` → render `reply` as a normal Lumen text bubble.
  - `recommend_provider` with a `provider` → render the existing `ConfirmCard`, populated from the
    **real** provider (`alias`, `specs.gpu`/`vramGb`, `pricePerCharge`, `computeScore`, `region`,
    trust tier). The `reply` line precedes it as Lumen's text.
- `ConfirmCard`'s confirm:
  - If signed out, route to `/onboarding` (`redirect` = current path), same guard as `RentSheet`.
  - If signed in, call the existing `createRent` with `spec: { resourceType, region }` from the
    recommended provider (the same hint-not-guarantee spec `RentSheet` sends) and a name derived
    from the chat (e.g. the user's wording, or a default). On success, append the honest line:
    "Rent queued. The broker will match it when it processes the queue." — never "payment stream
    opened." Link to the Dashboard to track it.
- Header: remove the fake balance block entirely (label + `$1,284.93`). Keep the Lumen mascot,
  name, and "AI broker" subtitle.

---

## 3. Identity and honesty rules (carried from the write-paths PR)

- `brokerChat` never trusts a client-supplied user id; when a token is given it goes through
  `requireUser`, the same as every other "my X" fn. An invalid/expired token for an identity-bound
  ask is treated as signed-out, not an error that breaks the chat.
- Lumen creates `queued`, unmatched rents. It does not claim to open payment channels, start
  streaming, or report charges that did not happen — the platform policy ("never fabricate execution
  results") is now actually true of the chat surface, where before it was the one place that lied.
- Recommendations come only from real, currently-listed providers. The policy's "never recommend an
  unavailable provider" is enforced structurally: the result's `provider` is a real registry lookup,
  and a model-invented id falls back to a plain answer.

---

## Testing

- `brokerChat`'s reasoning is the model's, so it isn't unit-asserted on content. The bridge logic is:
  given a `decide()` result, the right `{ reply, action, provider }` is produced — including the
  invented-id-degrades-to-answer rule and the signed-out path. That's testable by injecting a stub
  `DecideClient` (the same seam `decide()` already exposes), no network, no model. Add a focused test
  for the result-shaping function with: a valid `recommend_provider`, an invented-target
  `recommend_provider` (degrades), a `report_status`, and the model-down fallback.
- `requireUser`/`createRent` are already covered (manual + existing). The chat reuses them unchanged.
- Manual verification: signed out, "find me an H100" returns a real listed provider in the confirm
  card and confirming routes to onboarding; signed in, the same confirm creates a real `queued` rent
  visible on the Dashboard; "what are my orders" reflects real `listRents`; with `LLM_*` unset the
  chat still answers via the deterministic fallback.

---

## Resulting PR shape

1. `brokerChat` server fn (loads the broker agent, builds context from real providers/rents, runs
   `decide()`, shapes the result; degrades invented ids and model outages safely).
2. A small pure result-shaping helper + its unit test (stubbed `DecideClient`).
3. `LumenOverlay`: delete `getReply` and the fake balance; `send()` calls `brokerChat`; real provider
   in the confirm card; confirm calls real `createRent` with honest success copy and the signed-out
   onboarding guard.
4. No schema changes, no new env: reuses `loadBrokerAgent`, `makeDecideClient`, `LLM_*` already in
   `services/.env`, and the existing registry/auth fns.
