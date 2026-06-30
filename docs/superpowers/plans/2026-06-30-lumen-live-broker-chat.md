# Lumen Live: Wiring the Chat to the Real Broker Brain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Lumen's chat produce every reply and recommendation from the real soul-driven broker brain over real registry data, and take every action through the existing verified-identity server-fns, deleting the scripted/simulated chat.

**Architecture:** One new server function (`brokerChat`) loads the shipped broker agent (`broker.soul.md` + policy), builds a `DecisionContext` from real `listProviders()` (and the caller's real rents when signed in), runs it through the generic `decide()` runtime, and shapes the top proposal into `{ reply, action, provider? }`. A small pure helper does the proposal→result shaping and is unit-tested with a stubbed `DecideClient`. `LumenOverlay` is rewired to call `brokerChat`, render the real provider in the confirm card, and create a real `queued` rent on confirm via the existing `createRent`.

**Tech Stack:** TanStack Start server functions, the `services/` agent runtime (`decide`, `loadBrokerAgent`, `makeDecideClient`), Supabase registry, `bun test`, React.

**Reference spec:** `docs/superpowers/specs/2026-06-30-lumen-live-broker-chat-design.md`

---

## File Structure

- **Create** `src/lib/broker/lumen-chat.ts` — pure, model-agnostic chat logic: the chat `ActionSpec[]`, the deterministic `fallback`, and `shapeChatResult(decision, providers)` → `{ reply, action, provider? }`. No I/O, no model, no TanStack. This is the unit-tested core.
- **Create** `src/lib/broker/lumen-chat.test.ts` — `bun test` over `shapeChatResult` (valid recommend, invented-target degrades, report_status, answer/fallback).
- **Modify** `src/lib/broker/server-fns.ts` — add the `brokerChat` server fn that wires real data + `decide()` to `lumen-chat.ts`. Build the `DecideClient` defensively (null on missing `LLM_*` config).
- **Modify** `src/components/site/LumenOverlay.tsx` — delete `getReply`; `send()` calls `brokerChat`; confirm card uses real provider; confirm calls real `createRent`; drop fake balance.

Splitting the pure logic (`lumen-chat.ts`) from the I/O wrapper (`server-fns.ts`) is what makes the bridge testable without a network or a model — the same `DecideClient` seam `decide()` already exposes.

---

## Task 1: Pure chat logic — actions, fallback, and result shaping

**Files:**
- Create: `src/lib/broker/lumen-chat.ts`
- Test: `src/lib/broker/lumen-chat.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/broker/lumen-chat.test.ts
import { test, expect } from "bun:test";
import { shapeChatResult, CHAT_ACTIONS, chatFallback } from "./lumen-chat";
import type { Decision } from "@services/runtime/types";
import type { Provider } from "@services/domain";

function provider(id: string, alias: string): Provider {
  return {
    id,
    alias,
    ownerWallet: "0xowner",
    endpointUrl: "https://node.example/compute",
    resourceType: "GPU",
    region: "US-East",
    specs: { gpu: "H100", vramGb: 80 },
    online: true,
    trust: { tier: "Community", signals: { uptime: 1, successfulRentals: 0, health: "healthy", verification: false } },
    pricePerCharge: 0.0000045,
    computeScore: 98,
    avgLatencyMs: 12,
  };
}

function decision(proposals: Decision["proposals"], usedFallback = false): Decision {
  return { proposals, soulVersion: "1.0.0", policyVersion: "1.0.0", decisionId: "d1", usedFallback };
}

const astral = provider("p1", "node-astral-1");

test("a recommend_provider proposal with a real target returns that provider", () => {
  const d = decision([
    { action: "recommend_provider", target: "p1", score: 0.9, rationale: ["cheapest H100"], userExplanation: "node-astral-1 fits, want me to queue it?" },
  ]);
  const r = shapeChatResult(d, [astral]);
  expect(r.action).toBe("recommend_provider");
  expect(r.reply).toBe("node-astral-1 fits, want me to queue it?");
  expect(r.provider?.id).toBe("p1");
});

test("a recommend_provider with an invented target degrades to a plain answer", () => {
  const d = decision([
    { action: "recommend_provider", target: "ghost", score: 0.9, rationale: [], userExplanation: "Try node-ghost." },
  ]);
  const r = shapeChatResult(d, [astral]);
  expect(r.action).toBe("answer");
  expect(r.provider).toBeUndefined();
  expect(r.reply).toBe("Try node-ghost.");
});

test("a report_status proposal passes through as report_status with no provider", () => {
  const d = decision([
    { action: "report_status", score: 0.8, rationale: [], userExplanation: "You have 2 rents running." },
  ]);
  const r = shapeChatResult(d, [astral]);
  expect(r.action).toBe("report_status");
  expect(r.provider).toBeUndefined();
  expect(r.reply).toBe("You have 2 rents running.");
});

test("an answer proposal passes through as answer", () => {
  const d = decision([
    { action: "answer", score: 0.5, rationale: [], userExplanation: "I can find providers, check your rents, or queue compute." },
  ]);
  const r = shapeChatResult(d, [astral]);
  expect(r.action).toBe("answer");
  expect(r.reply).toBe("I can find providers, check your rents, or queue compute.");
});

test("an empty decision yields a safe default answer", () => {
  const r = shapeChatResult(decision([], true), [astral]);
  expect(r.action).toBe("answer");
  expect(r.reply.length).toBeGreaterThan(0);
});

test("chatFallback returns a single answer proposal", () => {
  const props = chatFallback();
  expect(props).toHaveLength(1);
  expect(props[0]!.action).toBe("answer");
});

test("CHAT_ACTIONS exposes the three chat actions", () => {
  expect(CHAT_ACTIONS.map((a) => a.name).sort()).toEqual(["answer", "recommend_provider", "report_status"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/lib/broker/lumen-chat.test.ts`
Expected: FAIL — `Cannot find module "./lumen-chat"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/broker/lumen-chat.ts
import type { ActionSpec, Decision, Proposal } from "@services/runtime/types";
import type { Provider } from "@services/domain";

// The conversational action set. The model picks one per turn; only `recommend_provider`
// carries a target (a provider id). Money and persistence never happen here — a
// recommendation is only a proposal; the user confirms, and the real `createRent`
// server-fn disposes. (Runtime principle: model proposes, code disposes.)
export const CHAT_ACTIONS: ActionSpec[] = [
  {
    name: "recommend_provider",
    description:
      "Recommend one currently-listed provider to rent for what the user described. " +
      "Pass its provider id as `target`. Use only when the user wants compute.",
  },
  {
    name: "report_status",
    description: "Summarize the user's current rents and account state. Use for questions about their orders.",
  },
  {
    name: "answer",
    description:
      "Reply to the user without taking an action: capabilities, clarifying questions, or when nothing fits.",
  },
];

// What `brokerChat` returns to the overlay. `provider` is present only for a verified
// recommend_provider.
export type ChatResult = {
  reply: string;
  action: "recommend_provider" | "report_status" | "answer";
  provider?: Provider;
};

// The deterministic plan for when the model is unavailable or unconfigured. A single,
// honest answer so the chat never errors out.
export function chatFallback(): Proposal[] {
  return [
    {
      action: "answer",
      score: 1,
      rationale: ["model unavailable; deterministic fallback"],
      userExplanation:
        "I can't reach my reasoning model right now, but I can still help you browse providers and queue compute from the marketplace.",
    },
  ];
}

const DEFAULT_REPLY = "I can find providers, check your rents, or queue compute. What do you need?";

// Pure: turn the runtime's top proposal into a UI-ready result. Enforces the policy's
// "never recommend an unavailable provider" structurally — a recommend_provider whose
// target isn't a real, currently-listed provider degrades to a plain answer rather than
// fabricating one.
export function shapeChatResult(decision: Decision, providers: Provider[]): ChatResult {
  const top = decision.proposals[0];
  if (!top) return { reply: DEFAULT_REPLY, action: "answer" };

  const reply = top.userExplanation || DEFAULT_REPLY;

  if (top.action === "recommend_provider") {
    const provider = providers.find((p) => p.id === top.target);
    if (provider) return { reply, action: "recommend_provider", provider };
    return { reply, action: "answer" };
  }

  if (top.action === "report_status") return { reply, action: "report_status" };

  return { reply, action: "answer" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/broker/lumen-chat.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/broker/lumen-chat.ts src/lib/broker/lumen-chat.test.ts
git commit -m "feat(lumen): pure chat action set, fallback, and result shaping"
```

---

## Task 2: The `brokerChat` server function

**Files:**
- Modify: `src/lib/broker/server-fns.ts`

- [ ] **Step 1: Add imports at the top of `src/lib/broker/server-fns.ts`**

Add these alongside the existing imports (the file already imports `createServerFn`, `getRegistry`, `requireUser`):

```ts
import { loadBrokerAgent } from "@services/broker/agent";
import { decide, makeDecideClient, type DecideClient } from "@services/runtime/decide";
import type { DecisionContext } from "@services/runtime/types";
import { CHAT_ACTIONS, chatFallback, shapeChatResult, type ChatResult } from "./lumen-chat";
```

- [ ] **Step 2: Add a defensive client builder above the `brokerChat` definition**

`makeDecideClient()` constructs the model eagerly via `makeModel()` → `loadConfig()`, which **throws** when `LLM_BASE_URL`/`LLM_API_KEY` are unset — before `decide()` could ever reach its fallback. So build it in a try/catch and treat "no client" as the fallback path.

```ts
// Build the model client, or null if LLM_* isn't configured. makeDecideClient() throws
// eagerly on missing config (loadConfig throws), which would 500 the chat before decide()'s
// own fallback can engage — so a missing/broken model degrades to a deterministic answer.
function tryMakeDecideClient(): DecideClient | null {
  try {
    return makeDecideClient();
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Add the `brokerChat` server function at the end of the file**

`accessToken` is optional: providers are public, so "find a GPU" works signed-out; identity-bound context (the user's rents) is only added when a token verifies. An invalid token is treated as signed-out, not a hard error.

```ts
// One conversational turn, driven by the real broker soul + decide() runtime over real
// registry data. The model only proposes; the recommend_provider result is the user's to
// confirm, and creation still goes through the real createRent server-fn. Uses
// `strict: { output: false }` because the returned Provider carries the same unknown-valued
// `specs` jsonb index signature as the other provider-returning fns.
export const brokerChat = createServerFn({ method: "POST", strict: { output: false } })
  .validator((d: { accessToken?: string; message: string }) => d)
  .handler(async ({ data }): Promise<ChatResult> => {
    const registry = getRegistry();
    const { soul, policy } = await loadBrokerAgent();
    const providers = await registry.listProviders();

    // Identity-bound context, only when a token actually verifies.
    let signedIn = false;
    let rentSummary: { count: number; rents: { name: string; status: string }[] } | undefined;
    if (data.accessToken) {
      try {
        const user = await requireUser(data.accessToken);
        const rents = await registry.listRents({ userId: user.id });
        signedIn = true;
        rentSummary = { count: rents.length, rents: rents.map((r) => ({ name: r.name, status: r.status })) };
      } catch {
        signedIn = false; // invalid/expired token → treat as signed-out, never break the chat
      }
    }

    const context: DecisionContext = {
      objective: data.message,
      candidates: providers.map((p) => ({
        id: p.id,
        alias: p.alias,
        resourceType: p.resourceType,
        region: p.region,
        pricePerCharge: p.pricePerCharge,
        computeScore: p.computeScore,
        avgLatencyMs: p.avgLatencyMs,
        online: p.online,
        tier: p.trust.tier,
      })),
      telemetry: rentSummary,
      constraints: { signedIn },
    };

    const client = tryMakeDecideClient();
    const decision = client
      ? await decide({ soul, policy, context, actions: CHAT_ACTIONS, client, fallback: chatFallback })
      : { proposals: chatFallback(), soulVersion: soul.version, policyVersion: policy.version, decisionId: crypto.randomUUID(), usedFallback: true };

    return shapeChatResult(decision, providers);
  });
```

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit -p tsconfig.json`
Expected: no new errors from `server-fns.ts` or `lumen-chat.ts`. (If the repo's baseline `tsc` already reports unrelated errors, confirm none reference these two files.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/broker/server-fns.ts
git commit -m "feat(lumen): brokerChat server fn drives a chat turn through decide()"
```

---

## Task 3: Rewire `LumenOverlay` to the live `brokerChat`

**Files:**
- Modify: `src/components/site/LumenOverlay.tsx`

This task deletes the scripted brain and the fake balance, and points the existing UI at real data. The component's message types (`TextMsg`, `ConfirmMsg`), `MessageBubble`, `ConfirmCard`, `LumenFab`, and `LumenSidebarEntry` are reused; only the data source and the confirm action change.

- [ ] **Step 1: Replace imports and delete the scripted `getReply` block**

At the top of the file, add the real dependencies and drop nothing else from the existing icon/UI imports:

```ts
import { useRouter } from "@tanstack/react-router";
import { brokerChat, createRent } from "@/lib/broker/server-fns";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Provider } from "@services/domain";
```

Delete the entire `getReply(input: string)` function and the `Scripted responses` comment banner (the block from `function getReply` through its closing `}`). Keep `quickActions`, the `Msg`/`TextMsg`/`ConfirmMsg` types, and everything below `MessageBubble`.

- [ ] **Step 2: Extend `ConfirmMsg` to carry the real provider**

The confirm card now needs the real provider so confirm can build the rent spec. Update the `ConfirmMsg` interface:

```ts
interface ConfirmMsg extends BaseMsg {
  role: "lumen";
  kind: "confirm";
  title: string;
  details: { label: string; value: string }[];
  cta: string;
  provider: Provider;
  onConfirm: () => void;
}
```

- [ ] **Step 3: Rewrite the `send()` function to call `brokerChat`**

Replace the existing `send()` (the one with `setTimeout` + `getReply`) with a real async call. The router hook goes at the top of the `LumenOverlay` component body: `const router = useRouter();`

```ts
  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: TextMsg = { id: cryptoId(), role: "user", kind: "text", text: trimmed };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setThinking(true);

    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const result = await brokerChat({
        data: { accessToken: sess.session?.access_token, message: trimmed },
      });

      if (result.action === "recommend_provider" && result.provider) {
        const p = result.provider;
        const gpu = p.specs.gpu as string | undefined;
        const vramGb = p.specs.vramGb as number | undefined;
        const hardware = gpu ? `${gpu}${vramGb ? ` · ${vramGb}GB VRAM` : ""}` : p.resourceType;
        setMessages((m) => [
          ...m,
          { id: cryptoId(), role: "lumen", kind: "text", text: result.reply },
          {
            id: cryptoId(),
            role: "lumen",
            kind: "confirm",
            title: `Rent from ${p.alias}?`,
            details: [
              { label: "Provider", value: p.alias },
              { label: "Hardware", value: hardware },
              { label: "Rate", value: `$${p.pricePerCharge.toFixed(7)}/s` },
              { label: "Compute Score", value: `${p.computeScore} / 100` },
              { label: "Region", value: p.region },
            ],
            cta: "Confirm & queue rent",
            provider: p,
            onConfirm: () => {},
          },
        ]);
      } else {
        setMessages((m) => [...m, { id: cryptoId(), role: "lumen", kind: "text", text: result.reply }]);
      }
    } catch {
      setMessages((m) => [
        ...m,
        { id: cryptoId(), role: "lumen", kind: "text", text: "Something went wrong reaching the broker. Try again in a moment." },
      ]);
    } finally {
      setThinking(false);
    }
  }
```

- [ ] **Step 4: Make `ConfirmCard` create a real queued rent on confirm**

Replace the `ConfirmCard` component. It now creates a real rent (or routes to onboarding if signed out) and shows honest copy. It takes a callback so the overlay can append Lumen's follow-up message.

```ts
function ConfirmCard({ msg, onQueued }: { msg: ConfirmMsg; onQueued: (text: string) => void }) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    const { data: sess } = await supabaseBrowser.auth.getSession();
    if (!sess.session) {
      router.navigate({ to: "/onboarding", search: { redirect: router.state.location.pathname } });
      return;
    }
    setBusy(true);
    try {
      const p = msg.provider;
      await createRent({
        data: {
          accessToken: sess.session.access_token,
          name: `lumen-${p.alias}`,
          spec: { resourceType: p.resourceType, region: p.region },
          estimatedUsage: null,
        },
      });
      setConfirmed(true);
      onQueued("Rent queued. The broker will match it when it processes the queue — track it on the Dashboard.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] w-full rounded-2xl rounded-bl-sm border border-primary/30 bg-card overflow-hidden">
        <div className="flex items-center gap-2 bg-primary/10 px-4 py-2.5 border-b border-primary/20">
          <Zap className="h-4 w-4 text-glow" />
          <span className="text-sm font-medium text-white">{msg.title}</span>
        </div>
        <div className="px-4 py-3 space-y-2">
          {msg.details.map((d) => (
            <div key={d.label} className="flex items-center justify-between text-xs">
              <span className="text-white/50">{d.label}</span>
              <span className="text-white font-mono">{d.value}</span>
            </div>
          ))}
        </div>
        <div className="px-4 pb-3">
          {confirmed ? (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-success/15 py-2.5 text-sm text-success">
              <Check className="h-4 w-4" /> Rent queued
            </div>
          ) : (
            <Button
              onClick={confirm}
              disabled={busy}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {msg.cta} <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Thread `onQueued` through `MessageBubble`**

`MessageBubble` renders `ConfirmCard`, so it needs to pass the callback down. Update its signature and the confirm branch:

```ts
function MessageBubble({ msg, onQueued }: { msg: Msg; onQueued: (text: string) => void }) {
  if (msg.kind === "confirm") {
    return <ConfirmCard msg={msg} onQueued={onQueued} />;
  }
  // ...unchanged text-bubble body...
```

And in the overlay's messages map, pass the callback (define `appendLumen` in the component body):

```ts
  const appendLumen = (text: string) =>
    setMessages((m) => [...m, { id: cryptoId(), role: "lumen", kind: "text", text }]);
```

```tsx
            {messages.map((m) => (
              <MessageBubble key={m.id} msg={m} onQueued={appendLumen} />
            ))}
```

- [ ] **Step 6: Delete the fake balance from the header**

In the header's right-hand block, remove the balance node entirely (the `<div className="text-right">…$1,284.93…</div>`), leaving just the close button:

```tsx
            <div className="flex items-center gap-3">
              <button
                onClick={() => onOpenChange(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/60 hover:text-white hover:bg-white/5"
                aria-label="Close Lumen"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
```

- [ ] **Step 7: Update the intro message copy (drop the canned promise)**

The intro line is fine, but make sure no remaining string claims a payment stream opens. Confirm by grepping:

Run: `grep -n "payment stream\|1,284\|node-astral\|node-cygnus\|node-lyra" src/components/site/LumenOverlay.tsx`
Expected: no matches (all simulated strings gone).

- [ ] **Step 8: Typecheck and build**

Run: `bunx tsc --noEmit -p tsconfig.json`
Expected: no new errors referencing `LumenOverlay.tsx`.

Run: `bun run build`
Expected: build succeeds (SSR bundle emits as before).

- [ ] **Step 9: Commit**

```bash
git add src/components/site/LumenOverlay.tsx
git commit -m "feat(lumen): wire the chat overlay to brokerChat and real createRent"
```

---

## Task 4: Manual verification

**Files:** none (runtime check). Requires `LLM_*` in `services/.env` (already present) and the dev server.

- [ ] **Step 1: Start the dev server**

Run: `bun run dev`
Expected: app serves on the configured port (`:8080`).

- [ ] **Step 2: Signed-out provider find**

Open Lumen (FAB or sidebar), signed out. Type "find me an H100". Expected: Lumen replies in its own voice and, if a matching provider is listed, shows a confirm card populated with a **real** provider's alias/rate/score (not `node-astral-1`). Click confirm → routed to `/onboarding`.

- [ ] **Step 3: Signed-in queue**

Sign in (passkey). Reopen Lumen, ask for compute, confirm the card. Expected: success copy reads "Rent queued. The broker will match it when it processes the queue", and a new `queued` rent for `lumen-<alias>` appears on the Dashboard.

- [ ] **Step 4: Status from real data**

Signed in, type "what are my orders". Expected: the reply reflects the real rents from `listRents` (counts/statuses match the Dashboard), not the old canned "2 active rents".

- [ ] **Step 5: Fallback when model unconfigured (optional)**

Temporarily unset `LLM_API_KEY` in `services/.env`, restart dev, send any message. Expected: Lumen returns the deterministic fallback answer (no 500, no crash). Restore the key afterward.

- [ ] **Step 6: Confirm no simulated strings remain**

Run: `grep -rn "payment stream opened\|1,284\|node-astral-1\|getReply" src/components/site/LumenOverlay.tsx`
Expected: no matches.

---

## Self-Review Notes

- **Spec coverage:** §1 `brokerChat` → Task 2; pure action set/fallback/shaping → Task 1; §2 overlay rewire (send/confirm/balance) → Task 3; §3 identity/honesty (queued rent, real providers only, signed-out guard, token-as-signed-out) → Tasks 2 (token try/catch, invented-id degrade) + 3 (onboarding guard, honest copy); testing → Task 1 unit tests + Task 4 manual.
- **Type consistency:** `ChatResult`/`shapeChatResult`/`CHAT_ACTIONS`/`chatFallback` are defined in Task 1 and consumed identically in Tasks 2–3. `brokerChat` input `{ accessToken?, message }` matches the overlay call in Task 3. `ConfirmMsg.provider: Provider` (Task 3 Step 2) is what `ConfirmCard` reads in Step 4.
- **Honesty:** the only rent created is `queued`/unmatched via the existing `createRent`; no "payment stream" string survives (Task 3 Step 7 + Task 4 Step 6 grep gates).
