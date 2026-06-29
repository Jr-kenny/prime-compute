# Soul/Policy Agent Runtime Implementation Plan (Plan 7 of N)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the generic, soul-agnostic agent runtime: parse versioned `SOUL.md`/`POLICY.md`, assemble them plus a decision context into a model prompt, get back ranked action proposals (`decide()`), let an injected deterministic validator pick the first valid one, enforce a hold retry-budget, and record a version-stamped decision log, with a deterministic fallback when the model is down.

**Architecture:** One generic runtime module that knows nothing about brokers, providers, or trust. The model is an advisory planner (`decide()` returns ranked proposals and never executes); a deterministic validator injected by the consumer is the verifier (`selectProposal`); the consumer owns execution. The model call sits behind a thin `DecideClient` seam (like the existing `llm-rank` `RankClient`) so the whole runtime tests offline with a stub, and a gated live probe proves that changing only `SOUL.md` changes behavior while the runtime is untouched. This plan does NOT wire the Plan 6 broker onto the runtime and does NOT change the trust model; those are the next plan.

**Tech Stack:** Bun + TypeScript, `bun test`. Reuses `makeModel()` (`src/llm.ts`) and the AI SDK tool-calling pattern proven in `probes/llm-toolcall.ts` and `src/broker/llm-rank.ts`.

**Spec:** [`docs/superpowers/specs/2026-06-29-soul-policy-agent-runtime-design.md`](../specs/2026-06-29-soul-policy-agent-runtime-design.md) — the soul-agnostic runtime (`loadPolicy → loadSoul → loadContext → loadActions → decide → validate → execute`), the file formats (schema + version), the `decide()` contract (ranked `Proposal`s, advisory `score`, `rationale`/`userExplanation`), the retry-budget hold backstop, decision logging with version provenance, and the testing strategy (offline bulk + gated two-soul divergence probe).

**Naming:** `Rent`/`Charge` elsewhere are untouched here. This plane is generic: `Soul`, `Policy`, `Proposal`, `Decision`, `DecisionContext`, `ActionSpec`, `DecisionLog`, `RetryBudget`.

**Branch:** `git checkout -b feat/soul-runtime` off `main`.

**Handoff note:** Tasks 1-6 run fully offline (stub `DecideClient`, no network). Task 7's `soul:divergence` probe is gated on `LLM_BASE_URL`/`LLM_API_KEY`. No existing code is modified; everything is additive under `services/src/runtime/` and `services/agent/`.

---

## File Structure

**Created:**
- `services/src/runtime/types.ts` — shared types: `Soul`, `Policy`, `Proposal`, `Decision`, `DecisionContext`, `ActionSpec`, `DecisionLog`
- `services/src/runtime/soul.ts` — `parseSoul` (frontmatter `schema`/`version`/`name` + body)
- `services/src/runtime/soul.test.ts`
- `services/src/runtime/policy.ts` — `parsePolicy` (frontmatter `schema`/`version` + body)
- `services/src/runtime/policy.test.ts`
- `services/src/runtime/prompt.ts` — `assemblePrompt` (policy → soul → context)
- `services/src/runtime/prompt.test.ts`
- `services/src/runtime/decide.ts` — `decide()` + `DecideClient` seam + `makeDecideClient()`
- `services/src/runtime/decide.test.ts`
- `services/src/runtime/select.ts` — `selectProposal` (walk ranked proposals through an injected validator)
- `services/src/runtime/select.test.ts`
- `services/src/runtime/log.ts` — `buildDecisionLog` (version-stamped audit record)
- `services/src/runtime/log.test.ts`
- `services/src/runtime/budget.ts` — `RetryLeash` (the hold retry-budget)
- `services/src/runtime/budget.test.ts`
- `services/agent/policy.md` — the platform constitution (schema `policy/v1`)
- `services/agent/broker.soul.md` — the agent soul (schema `soul/v1`)
- `services/agent/souls/cost-first.soul.md` — divergence-probe fixture
- `services/agent/souls/uptime-first.soul.md` — divergence-probe fixture
- `services/probes/soul-divergence.ts` — gated live probe: two souls → divergent decisions

**Modified:**
- `services/package.json` — add `soul:divergence` script

---

## Task 1: Runtime types

**Files:**
- Create: `services/src/runtime/types.ts`

No test of its own (types only); it is exercised by every later task. tsc is the gate.

- [ ] **Step 1: Write the types**

Write `services/src/runtime/types.ts`:

```ts
// The generic agent-runtime plane. Nothing here knows about brokers, providers, or trust.

export type Soul = {
  schema: string;   // e.g. "soul/v1"
  version: string;  // e.g. "1.0.0"
  name: string;     // e.g. "Broker"
  body: string;     // the markdown below the frontmatter
};

export type Policy = {
  schema: string;   // e.g. "policy/v1"
  version: string;
  body: string;
};

// One option the agent may propose. The model self-scores; score is ADVISORY ONLY
// (ordering + audit), never an input to a safety decision.
export type Proposal = {
  action: string;          // the available action set defines the allowed values
  target?: string;         // optional target id (e.g. a providerId for "migrate")
  score: number;           // [0..1], advisory
  rationale: string[];     // structured factors for the audit log
  userExplanation: string; // one concise natural-language line
};

export type Decision = {
  proposals: Proposal[];   // ranked best-first
  soulVersion: string;
  policyVersion: string;
  decisionId: string;
  usedFallback: boolean;   // true when the model was unavailable and this is deterministic
};

// What the runtime is deciding about. The consumer builds this however it likes; the
// runtime and soul never depend on its internals beyond `objective`.
export type DecisionContext = {
  objective: string;
  telemetry?: unknown;
  candidates?: unknown;
  constraints?: unknown;
  memory?: unknown; // RESERVED: agent memory is not built in this slice
};

// An action the model may pick, surfaced to it as a tool.
export type ActionSpec = {
  name: string;
  description: string;
};

export type DecisionLog = {
  decisionId: string;
  soulVersion: string;
  policyVersion: string;
  objective: string;
  proposals: Proposal[];
  chosenAction: { action: string; target?: string } | null;
  rejectedReason: string | null;
  usedFallback: boolean;
  createdAt: string;
};
```

- [ ] **Step 2: Type-check**

Run: `cd services && bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add services/src/runtime/types.ts
git commit -m "feat(runtime): shared soul/policy runtime types"
```

---

## Task 2: SOUL.md parser

**Files:**
- Create: `services/src/runtime/soul.ts`, `services/src/runtime/soul.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/runtime/soul.test.ts`:

```ts
import { test, expect } from "bun:test";
import { parseSoul } from "./soul";

const sample = `---
schema: soul/v1
version: 1.2.3
name: Broker
---
# Identity
You are the Prime Compute broker.
`;

test("parses frontmatter and body", () => {
  const soul = parseSoul(sample);
  expect(soul.schema).toBe("soul/v1");
  expect(soul.version).toBe("1.2.3");
  expect(soul.name).toBe("Broker");
  expect(soul.body).toContain("# Identity");
  expect(soul.body).not.toContain("schema:");
});

test("throws when a required frontmatter field is missing", () => {
  const noName = `---\nschema: soul/v1\nversion: 1.0.0\n---\nbody`;
  expect(() => parseSoul(noName)).toThrow(/name/);
});

test("throws when there is no frontmatter block", () => {
  expect(() => parseSoul("# just a body")).toThrow(/frontmatter/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/runtime/soul.test.ts`
Expected: FAIL — `Cannot find module "./soul"`.

- [ ] **Step 3: Write the parser**

Write `services/src/runtime/soul.ts`:

```ts
import type { Soul } from "./types";

// Minimal, dependency-free YAML-ish frontmatter reader: `key: value` lines between the
// opening and closing `---`. Enough for our flat metadata; no nested YAML needed.
export function parseFrontmatter(src: string): { fields: Record<string, string>; body: string } {
  const match = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error("missing frontmatter block (--- ... ---)");
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    fields[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return { fields, body: match[2] };
}

export function parseSoul(src: string): Soul {
  const { fields, body } = parseFrontmatter(src);
  for (const key of ["schema", "version", "name"]) {
    if (!fields[key]) throw new Error(`soul frontmatter missing required field: ${key}`);
  }
  return { schema: fields.schema, version: fields.version, name: fields.name, body: body.trimStart() };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/runtime/soul.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/runtime/soul.ts services/src/runtime/soul.test.ts
git commit -m "feat(runtime): SOUL.md parser (schema/version/name + body)"
```

---

## Task 3: POLICY.md parser

**Files:**
- Create: `services/src/runtime/policy.ts`, `services/src/runtime/policy.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/runtime/policy.test.ts`:

```ts
import { test, expect } from "bun:test";
import { parsePolicy } from "./policy";

const sample = `---
schema: policy/v1
version: 1.0.0
---
# Platform Policy
- Never fabricate execution results.
`;

test("parses frontmatter and body", () => {
  const policy = parsePolicy(sample);
  expect(policy.schema).toBe("policy/v1");
  expect(policy.version).toBe("1.0.0");
  expect(policy.body).toContain("Never fabricate");
});

test("throws when version is missing", () => {
  const noVersion = `---\nschema: policy/v1\n---\nbody`;
  expect(() => parsePolicy(noVersion)).toThrow(/version/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/runtime/policy.test.ts`
Expected: FAIL — `Cannot find module "./policy"`.

- [ ] **Step 3: Write the parser**

Write `services/src/runtime/policy.ts`:

```ts
import type { Policy } from "./types";
import { parseFrontmatter } from "./soul";

export function parsePolicy(src: string): Policy {
  const { fields, body } = parseFrontmatter(src);
  for (const key of ["schema", "version"]) {
    if (!fields[key]) throw new Error(`policy frontmatter missing required field: ${key}`);
  }
  return { schema: fields.schema, version: fields.version, body: body.trimStart() };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/runtime/policy.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/runtime/policy.ts services/src/runtime/policy.test.ts
git commit -m "feat(runtime): POLICY.md parser (schema/version + body)"
```

---

## Task 4: The agent artifacts (policy.md + broker.soul.md)

**Files:**
- Create: `services/agent/policy.md`, `services/agent/broker.soul.md`
- Create: `services/src/runtime/artifacts.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/runtime/artifacts.test.ts`:

```ts
import { test, expect } from "bun:test";
import { parseSoul } from "./soul";
import { parsePolicy } from "./policy";

test("the shipped policy.md parses and is policy/v1", async () => {
  const src = await Bun.file(new URL("../../agent/policy.md", import.meta.url)).text();
  const policy = parsePolicy(src);
  expect(policy.schema).toBe("policy/v1");
  expect(policy.version).toBeTruthy();
  expect(policy.body).toContain("Never fabricate execution results");
});

test("the shipped broker.soul.md parses and is soul/v1 named Broker", async () => {
  const src = await Bun.file(new URL("../../agent/broker.soul.md", import.meta.url)).text();
  const soul = parseSoul(src);
  expect(soul.schema).toBe("soul/v1");
  expect(soul.name).toBe("Broker");
  expect(soul.body).toContain("# Identity");
  expect(soul.body).toContain("# Authoring Rules");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/runtime/artifacts.test.ts`
Expected: FAIL — the files do not exist yet.

- [ ] **Step 3: Write `services/agent/policy.md`**

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
- Never fabricate execution results: never report a charge, migration, or completion that did not happen.
- Never bypass runtime validation: the agent proposes, it never authorizes its own action.
- Never recommend an unavailable provider.
- If uncertain, gather more information before inventing facts, and explain the uncertainty.
- Explain every autonomous action in plain terms.
```

- [ ] **Step 4: Write `services/agent/broker.soul.md`**

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

- [ ] **Step 5: Run it to verify it passes**

Run: `cd services && bun test src/runtime/artifacts.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add services/agent/policy.md services/agent/broker.soul.md services/src/runtime/artifacts.test.ts
git commit -m "feat(agent): versioned policy.md + broker.soul.md"
```

---

## Task 5: Prompt assembly

**Files:**
- Create: `services/src/runtime/prompt.ts`, `services/src/runtime/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/runtime/prompt.test.ts`:

```ts
import { test, expect } from "bun:test";
import { assemblePrompt } from "./prompt";
import type { Soul, Policy, DecisionContext, ActionSpec } from "./types";

const policy: Policy = { schema: "policy/v1", version: "1.0.0", body: "POLICY-BODY-MARK" };
const soul: Soul = { schema: "soul/v1", version: "1.0.0", name: "Broker", body: "SOUL-BODY-MARK" };
const context: DecisionContext = { objective: "respond-to-degradation", telemetry: { health: "degraded" } };
const actions: ActionSpec[] = [
  { name: "migrate", description: "move to another provider" },
  { name: "hold", description: "keep the current provider" },
];

test("system prompt puts policy before soul, and lists the actions", () => {
  const { system, user } = assemblePrompt(soul, policy, context, actions);
  expect(system.indexOf("POLICY-BODY-MARK")).toBeLessThan(system.indexOf("SOUL-BODY-MARK"));
  expect(system).toContain("migrate");
  expect(system).toContain("hold");
  // context goes in the user turn, not the system turn
  expect(user).toContain("respond-to-degradation");
  expect(user).toContain("degraded");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/runtime/prompt.test.ts`
Expected: FAIL — `Cannot find module "./prompt"`.

- [ ] **Step 3: Write the assembler**

Write `services/src/runtime/prompt.ts`:

```ts
import type { Soul, Policy, DecisionContext, ActionSpec } from "./types";

export type AssembledPrompt = { system: string; user: string };

// Policy first (hard constraints), then soul (judgment), then the available actions. The
// concrete situation goes in the user turn. The model returns ranked proposals via a tool.
export function assemblePrompt(
  soul: Soul,
  policy: Policy,
  context: DecisionContext,
  actions: ActionSpec[],
): AssembledPrompt {
  const actionLines = actions.map((a) => `- ${a.name}: ${a.description}`).join("\n");
  const system = [
    "# PLATFORM POLICY (hard constraints — never violate)",
    policy.body,
    "",
    "# YOUR SOUL (how you judge)",
    soul.body,
    "",
    "# AVAILABLE ACTIONS",
    actionLines,
    "",
    "Propose the available actions ranked best-first for the situation. For each, give a",
    "self-assessed score in [0,1] (advisory only), structured rationale factors, and one",
    "concise user-facing explanation. You propose; the runtime decides what is allowed.",
  ].join("\n");
  const user = [
    `Objective: ${context.objective}`,
    `Situation: ${JSON.stringify({ telemetry: context.telemetry, candidates: context.candidates, constraints: context.constraints })}`,
  ].join("\n");
  return { system, user };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/runtime/prompt.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add services/src/runtime/prompt.ts services/src/runtime/prompt.test.ts
git commit -m "feat(runtime): prompt assembly (policy -> soul -> context + actions)"
```

---

## Task 6: `decide()` + the model-client seam

**Files:**
- Create: `services/src/runtime/decide.ts`, `services/src/runtime/decide.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/runtime/decide.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/runtime/decide.test.ts`
Expected: FAIL — `Cannot find module "./decide"`.

- [ ] **Step 3: Write `decide()` + `makeDecideClient()`**

Write `services/src/runtime/decide.ts`:

```ts
import { generateText, tool } from "ai";
import { z } from "zod";
import { makeModel } from "../llm";
import { assemblePrompt, type AssembledPrompt } from "./prompt";
import type { Soul, Policy, DecisionContext, ActionSpec, Proposal, Decision } from "./types";

// The model-call seam. Real impl talks to the model; tests inject a deterministic stub.
export type DecideClient = {
  propose(prompt: AssembledPrompt, actions: ActionSpec[]): Promise<Proposal[]>;
};

export type DecideInput = {
  soul: Soul;
  policy: Policy;
  context: DecisionContext;
  actions: ActionSpec[];
  client: DecideClient;
  // The consumer's deterministic plan for when the model is unavailable. Optional; if
  // omitted, a model failure yields empty proposals flagged usedFallback.
  fallback?: () => Proposal[] | Promise<Proposal[]>;
};

// Assemble policy + soul + context, ask the model for ranked proposals, stamp provenance.
// Never executes. Degrades to the consumer's deterministic fallback when the model is down.
export async function decide(input: DecideInput): Promise<Decision> {
  const { soul, policy, context, actions, client, fallback } = input;
  const prompt = assemblePrompt(soul, policy, context, actions);

  let proposals: Proposal[] = [];
  let usedFallback = false;
  try {
    proposals = await client.propose(prompt, actions);
    if (proposals.length === 0) throw new Error("model returned no proposals");
  } catch {
    usedFallback = true;
    proposals = fallback ? await fallback() : [];
  }

  return {
    proposals,
    soulVersion: soul.version,
    policyVersion: policy.version,
    decisionId: crypto.randomUUID(),
    usedFallback,
  };
}

// The real model-backed client. Network + tool-calling live only here.
export function makeDecideClient(): DecideClient {
  const { provider, modelId } = makeModel();
  return {
    async propose(prompt, _actions) {
      const result = await generateText({
        model: provider(modelId),
        system: prompt.system,
        prompt: prompt.user,
        tools: {
          propose_actions: tool({
            description: "Return the available actions ranked best-first for this situation.",
            parameters: z.object({
              proposals: z.array(
                z.object({
                  action: z.string(),
                  target: z.string().optional(),
                  score: z.number(),
                  rationale: z.array(z.string()),
                  user_explanation: z.string(),
                }),
              ),
            }),
          }),
        },
        maxSteps: 1,
      });
      const call = result.toolCalls.find((c) => c.toolName === "propose_actions");
      if (!call) throw new Error("model did not call propose_actions");
      const raw = (call.args as { proposals: Array<{ action: string; target?: string; score: number; rationale: string[]; user_explanation: string }> }).proposals;
      return raw.map((p) => ({
        action: p.action,
        target: p.target,
        score: p.score,
        rationale: p.rationale,
        userExplanation: p.user_explanation,
      }));
    },
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/runtime/decide.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/runtime/decide.ts services/src/runtime/decide.test.ts
git commit -m "feat(runtime): decide() with model-client seam + deterministic fallback"
```

---

## Task 7: `selectProposal` (the validator walk)

**Files:**
- Create: `services/src/runtime/select.ts`, `services/src/runtime/select.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/runtime/select.test.ts`:

```ts
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
  expect(out.rejected).toEqual([{ proposal: proposals[0], reason: "retry budget exhausted" }]);
});

test("returns null chosen when the validator rejects everything", () => {
  const validate = (): Validation => ({ ok: false, reason: "nope" });
  const out = selectProposal(decision, validate);
  expect(out.chosen).toBeNull();
  expect(out.rejected.length).toBe(2);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/runtime/select.test.ts`
Expected: FAIL — `Cannot find module "./select"`.

- [ ] **Step 3: Write the selector**

Write `services/src/runtime/select.ts`:

```ts
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/runtime/select.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/runtime/select.ts services/src/runtime/select.test.ts
git commit -m "feat(runtime): selectProposal (walk ranked proposals through injected validator)"
```

---

## Task 8: `buildDecisionLog` (version-stamped audit)

**Files:**
- Create: `services/src/runtime/log.ts`, `services/src/runtime/log.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/runtime/log.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/runtime/log.test.ts`
Expected: FAIL — `Cannot find module "./log"`.

- [ ] **Step 3: Write the log builder**

Write `services/src/runtime/log.ts`:

```ts
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/runtime/log.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/runtime/log.ts services/src/runtime/log.test.ts
git commit -m "feat(runtime): buildDecisionLog (version-stamped audit record)"
```

---

## Task 9: `RetryLeash` (the hold retry-budget)

**Files:**
- Create: `services/src/runtime/budget.ts`, `services/src/runtime/budget.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/runtime/budget.test.ts`:

```ts
import { test, expect } from "bun:test";
import { RetryLeash, type RetryBudget } from "./budget";

const budget: RetryBudget = { maxRetries: 3, maxDurationMs: 1000, maxExtraSpend: 500n };

test("approves while all three budgets remain", () => {
  let t = 0;
  const leash = new RetryLeash(budget, () => t);
  expect(leash.tryConsume(100n).ok).toBe(true); // 1 retry, 100 spent, t=0
  t = 100;
  expect(leash.tryConsume(100n).ok).toBe(true); // 2 retries, 200 spent
});

test("denies when retries run out", () => {
  let t = 0;
  const leash = new RetryLeash({ ...budget, maxRetries: 1 }, () => t);
  expect(leash.tryConsume(1n).ok).toBe(true);
  const d = leash.tryConsume(1n);
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.reason).toMatch(/retries/);
});

test("denies when extra-spend would be exceeded", () => {
  const leash = new RetryLeash({ ...budget, maxExtraSpend: 150n }, () => 0);
  expect(leash.tryConsume(100n).ok).toBe(true); // 100 <= 150
  const d = leash.tryConsume(100n); // would be 200 > 150
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.reason).toMatch(/spend/);
});

test("denies when the duration window has passed", () => {
  let t = 0;
  const leash = new RetryLeash({ ...budget, maxDurationMs: 500 }, () => t);
  expect(leash.tryConsume(1n).ok).toBe(true);
  t = 600; // past the window
  const d = leash.tryConsume(1n);
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.reason).toMatch(/duration/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services && bun test src/runtime/budget.test.ts`
Expected: FAIL — `Cannot find module "./budget"`.

- [ ] **Step 3: Write the leash**

Write `services/src/runtime/budget.ts`:

```ts
export type RetryBudget = {
  maxRetries: number;
  maxDurationMs: number;
  maxExtraSpend: bigint;
};

export type LeashDecision = { ok: true } | { ok: false; reason: string };

// The hold backstop as a retry budget, not a count: a hold is approved only while ALL
// three budgets (retries, wall-clock window, extra spend) remain. Deterministic; the
// `now` injection makes the duration bound testable.
export class RetryLeash {
  private retries = 0;
  private spent = 0n;
  private readonly start: number;

  constructor(private budget: RetryBudget, private now: () => number = Date.now) {
    this.start = now();
  }

  tryConsume(extraSpend: bigint): LeashDecision {
    if (this.retries + 1 > this.budget.maxRetries) {
      return { ok: false, reason: `hold denied: out of retries (${this.budget.maxRetries})` };
    }
    if (this.now() - this.start > this.budget.maxDurationMs) {
      return { ok: false, reason: `hold denied: duration window ${this.budget.maxDurationMs}ms passed` };
    }
    if (this.spent + extraSpend > this.budget.maxExtraSpend) {
      return { ok: false, reason: `hold denied: extra spend would exceed ${this.budget.maxExtraSpend}` };
    }
    this.retries++;
    this.spent += extraSpend;
    return { ok: true };
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services && bun test src/runtime/budget.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/runtime/budget.ts services/src/runtime/budget.test.ts
git commit -m "feat(runtime): RetryLeash (hold retry-budget: retries + duration + spend)"
```

---

## Task 10: Gated two-soul divergence probe

The headline proof from the spec: change only the soul, behavior changes, runtime
untouched. Two fixture souls and a probe that runs both through the same runtime + same
live model + same situation and shows the decisions diverge.

**Files:**
- Create: `services/agent/souls/cost-first.soul.md`, `services/agent/souls/uptime-first.soul.md`
- Create: `services/probes/soul-divergence.ts`
- Modify: `services/package.json`

- [ ] **Step 1: Write `services/agent/souls/cost-first.soul.md`**

```md
---
schema: soul/v1
version: 1.0.0
name: CostFirst
---
# Identity
You are a cost-first compute broker.

# Priorities
- Minimizing spend outranks almost everything.
- Tolerate a degraded provider and prefer holding while any retry budget remains, rather
  than migrating to a more expensive one.
- Only migrate if the current provider is effectively unusable.
```

- [ ] **Step 2: Write `services/agent/souls/uptime-first.soul.md`**

```md
---
schema: soul/v1
version: 1.0.0
name: UptimeFirst
---
# Identity
You are an uptime-first compute broker for production workloads.

# Priorities
- Keeping the workload healthy outranks saving cost.
- At the first sign of sustained degradation, prefer migrating to a healthy provider.
- Do not hold on a degraded provider to save money.
```

- [ ] **Step 3: Write the probe**

Write `services/probes/soul-divergence.ts`:

```ts
import { parseSoul } from "../src/runtime/soul";
import { parsePolicy } from "../src/runtime/policy";
import { decide, makeDecideClient } from "../src/runtime/decide";
import type { DecisionContext, ActionSpec } from "../src/runtime/types";

// Gated: needs LLM_BASE_URL / LLM_API_KEY. Proves that swapping ONLY the soul changes the
// decision while the runtime, policy, context, and actions are identical.
const policy = parsePolicy(await Bun.file(new URL("../agent/policy.md", import.meta.url)).text());
const costFirst = parseSoul(await Bun.file(new URL("../agent/souls/cost-first.soul.md", import.meta.url)).text());
const uptimeFirst = parseSoul(await Bun.file(new URL("../agent/souls/uptime-first.soul.md", import.meta.url)).text());

const actions: ActionSpec[] = [
  { name: "hold", description: "keep paying the current (degraded) provider while retry budget remains" },
  { name: "migrate", description: "re-point the stream to a healthy but pricier provider" },
];

// A genuinely ambiguous situation: current provider degraded but cheaper; alternative healthy but pricier.
const context: DecisionContext = {
  objective: "respond-to-degradation",
  telemetry: { current: { health: "degraded", failures: 2, pricePerCharge: 0.0001 } },
  candidates: { alternative: { health: "healthy", pricePerCharge: 0.0002 } },
  constraints: { retryBudgetRemaining: true },
};

const client = makeDecideClient();

try {
  const a = await decide({ soul: costFirst, policy, context, actions, client });
  const b = await decide({ soul: uptimeFirst, policy, context, actions, client });
  console.log("cost-first   top action:", a.proposals[0]?.action, "| reasons:", a.proposals[0]?.rationale);
  console.log("uptime-first top action:", b.proposals[0]?.action, "| reasons:", b.proposals[0]?.rationale);

  if (a.proposals[0]?.action === "hold" && b.proposals[0]?.action === "migrate") {
    console.log("\n✅ same runtime, different soul, divergent decision (cost-first holds, uptime-first migrates).");
  } else {
    console.log("\n⚠️  decisions did not diverge as expected. Souls/prompt may need tuning, or the model hedged.");
    console.log("    (The architecture still holds; this probe just tests soul sensitivity.)");
  }
} catch (err) {
  console.error("\n❌ divergence probe failed:", err instanceof Error ? err.message : err);
  console.error("Set LLM_BASE_URL/LLM_API_KEY to run the live model path.");
  process.exitCode = 1;
}
```

- [ ] **Step 4: Add the probe script**

In `services/package.json` add to scripts: `"soul:divergence": "bun run probes/soul-divergence.ts"`.

- [ ] **Step 5: Type-check + run the offline gates**

Run: `cd services && bun test src/runtime/ && bunx tsc --noEmit`
Expected: all runtime tests pass, tsc exit 0. (The live `soul:divergence` probe is run by
hand when `LLM_*` is set; without it, it prints the clear "Set ..." error.)

- [ ] **Step 6: Commit**

```bash
git add services/agent/souls services/probes/soul-divergence.ts services/package.json
git commit -m "test(runtime): gated two-soul divergence probe (soul changes behavior, runtime fixed)"
```

---

## Task 11: Wrap-up

- [ ] **Step 1: Full suite + type-check**

Run: `cd services && bun test && bunx tsc --noEmit`
Expected: all tests pass (the existing suite plus the new runtime tests: soul, policy,
artifacts, prompt, decide, select, log, budget). tsc exit 0.

- [ ] **Step 2: No existing code touched**

This plan is additive under `services/src/runtime/` and `services/agent/`. The Plan 6
broker, the settlement adapter, and the registry are unchanged. Wiring the broker onto
this runtime and the trust-profile retrofit are the next plan.

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch (verify tests, present options, execute
choice). Default to merging `feat/soul-runtime` to `main` once green.

- [ ] **Step 4: Update the project memory**

Update `autonomous-compute-broker-project.md`: the soul/policy runtime (Plan 7) is built
and merged (generic runtime: parsers, prompt assembly, `decide()` + client seam,
`selectProposal`, `buildDecisionLog`, `RetryLeash`, the shipped `policy.md` +
`broker.soul.md`, and the gated `soul:divergence` probe). Next: the trust-profile retrofit
+ wiring the Plan 6 broker decisions (rank, migrate/hold) onto the runtime.

---

## Self-Review Notes

**Spec coverage:** Builds the soul-agnostic runtime the spec describes. `loadPolicy`/
`loadSoul` are `parsePolicy`/`parseSoul` (Tasks 2-3) over the shipped versioned artifacts
(Task 4); `loadContext`/`loadActions` are the `DecisionContext`/`ActionSpec` types (Task 1)
assembled in `assemblePrompt` (Task 5, policy → soul → context per the spec). `decide()`
(Task 6) returns ranked `Proposal`s with advisory `score` + `rationale[]` +
`userExplanation`, stamps `soulVersion`/`policyVersion`/`decisionId`, never executes, and
degrades to the consumer's deterministic `fallback` with `usedFallback` (spec: "intelligence
never becomes availability"). `selectProposal` (Task 7) is the verifier walk with an
injected validator (keeping the runtime generic; trust/spend/budget rules belong to the
consumer, next plan). `buildDecisionLog` (Task 8) is the version-stamped audit record that
answers "runtime or soul?". `RetryLeash` (Task 9) is the retry-budget hold backstop
(retries + duration + spend, all three). The gated divergence probe (Task 10) is the spec's
headline test: same runtime, different soul, divergent decision.

**Placeholder scan:** No TBDs. Every code step has complete code. The frontmatter reader is
a real minimal parser (flat `key: value`), sufficient for our metadata and noted as such.
The divergence probe is gated with exact expected output and degrades clearly without keys.

**Type consistency:** `Soul`/`Policy`/`Proposal`/`Decision`/`DecisionContext`/`ActionSpec`/
`DecisionLog` (Task 1) are used unchanged across Tasks 2-10. `parseFrontmatter` (Task 2) is
reused by `parsePolicy` (Task 3). `AssembledPrompt` (Task 5) is consumed by `DecideClient`
(Task 6). `Validation`/`Selection` (Task 7) feed `buildDecisionLog` (Task 8). `Proposal`
fields are spelled `rationale` (string[]) and `userExplanation` everywhere; the real client
maps the model's snake_case `user_explanation` to it at the single parse point. `RetryBudget`
uses `maxExtraSpend: bigint` to match the atomic-USDC convention used by the settlement
layer.

**Out of scope (next plan):** wiring the Plan 6 broker (rank, migrate/hold) onto this
runtime, the `TrustProfile` model + `tier >= requiredTrustTier` gate replacing the
`stakeAmount > 0` check, and persisting `DecisionLog` to `rent_decisions`. This plan proves
the runtime in isolation.
```