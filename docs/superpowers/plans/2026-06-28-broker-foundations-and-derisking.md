# Broker Foundations & De-risking Implementation Plan (Plan 1 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the backend service skeleton and prove out the three risky unknowns (Kimchi tool-calling through the gateway, the exact x402/Gateway SDK surface, and real Arc testnet settlement) so the later plans build on confirmed ground instead of guesses.

**Architecture:** A `services/` workspace inside the existing repo holds a Node/Bun + TypeScript backend (broker and provider live here later). This plan adds the workspace, a typed config/env loader, the Kimchi model client via the Vercel AI SDK, a viem client for Arc, and two probe scripts that perform a real Kimchi tool-call and a real end-to-end x402 payment on Arc testnet. Findings (exact APIs, chain config, friction) are written to a foundations report and to `feedback.md`.

**Tech Stack:** Bun + TypeScript, `bun test`, Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`) pointed at Kimchi Inference, `viem` for Arc (EVM), Circle's x402/Gateway packages (`@circle-fin/x402-batching` + the facilitator), `zod` for schemas. The repo already uses Bun (`bun.lock`).

**Spec:** [`docs/superpowers/specs/2026-06-28-autonomous-compute-broker-design.md`](../specs/2026-06-28-autonomous-compute-broker-design.md)

**Plan series (build order):**
1. Foundations & De-risking (this plan)
2. State & Registry (Supabase schema + `Registry` interface)
3. Provider Service (x402 seller template + `ComputeExecutor` + `SimulatedExecutor`)
4. Settlement Adapter (Arc wallet, EIP-3009 signing, Gateway deposit/settle)
5. Matching Engine + Stream Engine + Guardrails
6. Broker Autonomous Loop + Frontend (Lumen) wiring + full integration test

**Branch:** create a feature branch off `main` (do not work directly on `main`):
`git checkout -b feat/broker-foundations`

---

## File Structure

**Created:**
- `services/package.json` — backend workspace manifest (Bun, TypeScript)
- `services/tsconfig.json` — TS config for the backend
- `services/.env.example` — documented env vars (no secrets committed)
- `services/src/config.ts` — typed config loader (reads + validates env)
- `services/src/config.test.ts` — tests for the config loader
- `services/src/kimchi.ts` — Kimchi model client (AI SDK OpenAI-compatible provider)
- `services/src/scoring.ts` — deterministic fallback scoring function
- `services/src/scoring.test.ts` — tests for the deterministic scorer
- `services/src/arc.ts` — Arc chain definition + viem public client
- `services/probes/kimchi-toolcall.ts` — real Kimchi tool-call probe (the first gate)
- `services/probes/x402-roundtrip.ts` — real x402 buyer/seller settlement probe on Arc
- `docs/superpowers/foundations-report.md` — findings from the probes (filled in by the tasks)

**Modified:**
- `feedback.md` — append any Circle tooling friction found during probes
- `.gitignore` — ignore `services/.env` and `services/node_modules`

**Unchanged:** the entire existing frontend (`src/`), `vite.config.ts`, etc. This plan does not touch the frontend.

---

## Task 1: Scaffold the `services/` workspace

**Files:**
- Create: `services/package.json`
- Create: `services/tsconfig.json`
- Create: `services/.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Create the workspace manifest**

Write `services/package.json`:

```json
{
  "name": "@prime-compute/services",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bun test",
    "probe:kimchi": "bun run probes/kimchi-toolcall.ts",
    "probe:x402": "bun run probes/x402-roundtrip.ts"
  },
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/openai-compatible": "^0.1.0",
    "viem": "^2.21.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create the TypeScript config**

Write `services/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src", "probes"]
}
```

- [ ] **Step 3: Document env vars**

Write `services/.env.example`:

```bash
# Kimchi Inference (OpenAI-compatible)
KIMCHI_BASE_URL=https://llm.kimchi.dev/openai/v1
KIMCHI_API_KEY=
KIMCHI_MODEL=kimi-k2.6

# Arc testnet (pinned in Task 5)
ARC_RPC_URL=
ARC_CHAIN_ID=
ARC_EXPLORER_URL=

# Funded broker wallet (buyer)
BROKER_WALLET_PRIVATE_KEY=

# Funded provider wallet (seller)
PROVIDER_WALLET_PRIVATE_KEY=

# Circle Gateway / x402 (pinned in Task 6)
GATEWAY_WALLET_ADDRESS=
X402_FACILITATOR_URL=
```

- [ ] **Step 4: Ignore secrets and deps**

Add to `.gitignore` (append):

```
# Backend services
services/.env
services/node_modules
```

- [ ] **Step 5: Install deps**

Run: `cd services && bun install`
Expected: a `services/bun.lock` is written and `node_modules` populated, exit 0. (If a listed version range fails to resolve, let Bun pick the latest compatible and note the resolved version.)

- [ ] **Step 6: Commit**

```bash
cd /Users/user/Documents/prime-compute
git add services/package.json services/tsconfig.json services/.env.example services/bun.lock .gitignore
git commit -m "chore(services): scaffold backend workspace (bun + typescript)"
```

---

## Task 2: Typed config loader

**Files:**
- Create: `services/src/config.ts`
- Test: `services/src/config.test.ts`

- [ ] **Step 1: Write the failing test**

Write `services/src/config.test.ts`:

```ts
import { test, expect } from "bun:test";
import { loadConfig } from "./config";

test("loadConfig reads required kimchi vars", () => {
  const cfg = loadConfig({
    KIMCHI_BASE_URL: "https://llm.kimchi.dev/openai/v1",
    KIMCHI_API_KEY: "test-key",
    KIMCHI_MODEL: "kimi-k2.6",
  });
  expect(cfg.kimchi.baseUrl).toBe("https://llm.kimchi.dev/openai/v1");
  expect(cfg.kimchi.apiKey).toBe("test-key");
  expect(cfg.kimchi.model).toBe("kimi-k2.6");
});

test("loadConfig throws a clear error when a required var is missing", () => {
  expect(() => loadConfig({ KIMCHI_BASE_URL: "x" })).toThrow(/KIMCHI_API_KEY/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services && bun test src/config.test.ts`
Expected: FAIL — cannot find module `./config`.

- [ ] **Step 3: Write the minimal implementation**

Write `services/src/config.ts`:

```ts
type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export function loadConfig(env: Env = process.env) {
  return {
    kimchi: {
      baseUrl: required(env, "KIMCHI_BASE_URL"),
      apiKey: required(env, "KIMCHI_API_KEY"),
      model: env.KIMCHI_MODEL ?? "kimi-k2.6",
    },
  };
}

export type Config = ReturnType<typeof loadConfig>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services && bun test src/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/config.ts services/src/config.test.ts
git commit -m "feat(services): typed config loader with required-var validation"
```

---

## Task 3: Kimchi model client + chat smoke test

**Files:**
- Create: `services/src/kimchi.ts`

This wires the Vercel AI SDK to Kimchi Inference. The smoke test is a real network call, so it is a manual probe run (not part of `bun test`, which must stay offline/deterministic).

- [ ] **Step 1: Write the client**

Write `services/src/kimchi.ts`:

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { loadConfig } from "./config";

export function makeKimchi() {
  const cfg = loadConfig();
  const provider = createOpenAICompatible({
    name: "kimchi",
    baseURL: cfg.kimchi.baseUrl,
    apiKey: cfg.kimchi.apiKey,
  });
  return { provider, modelId: cfg.kimchi.model };
}
```

- [ ] **Step 2: Add a one-line chat probe to confirm connectivity**

Append to `services/probes/kimchi-toolcall.ts` is done in Task 4; for now verify the client constructs without a real call by type-checking:

Run: `cd services && bunx tsc --noEmit`
Expected: exit 0 (no type errors). If `@ai-sdk/openai-compatible`'s exported factory name differs from `createOpenAICompatible`, read `services/node_modules/@ai-sdk/openai-compatible/dist/index.d.ts` for the exact export and use it; record the exact name in the foundations report.

- [ ] **Step 3: Commit**

```bash
git add services/src/kimchi.ts
git commit -m "feat(services): kimchi model client via ai-sdk openai-compatible provider"
```

---

## Task 4: Kimchi tool-calling probe (THE FIRST GATE)

**Files:**
- Create: `services/probes/kimchi-toolcall.ts`
- Create/append: `docs/superpowers/foundations-report.md`

This proves the single most load-bearing unknown: does Kimchi honor tool/function calls through the gateway? If not, the broker leans on the deterministic scorer (Task 7).

- [ ] **Step 1: Write the probe**

Write `services/probes/kimchi-toolcall.ts`:

```ts
import { generateText, tool } from "ai";
import { z } from "zod";
import { makeKimchi } from "../src/kimchi";

const { provider, modelId } = makeKimchi();

const result = await generateText({
  model: provider(modelId),
  // Force a tool-shaped task so we can see whether the model emits a tool call.
  prompt:
    "You are a compute broker. Pick the cheapest provider for a GPU job. " +
    "Candidates: A ($0.000006/s, score 70), B ($0.000004/s, score 92). " +
    "Call pick_provider with your choice.",
  tools: {
    pick_provider: tool({
      description: "Select the provider to run the job on.",
      parameters: z.object({
        provider_id: z.enum(["A", "B"]),
        reason: z.string(),
      }),
      // No execute — we only want to observe the tool call.
    }),
  },
  maxSteps: 1,
});

console.log("toolCalls:", JSON.stringify(result.toolCalls, null, 2));
console.log("finishReason:", result.finishReason);
console.log("text:", result.text);

if (result.toolCalls.length > 0) {
  console.log("\n✅ TOOL CALLING WORKS through Kimchi.");
} else {
  console.log(
    "\n❌ No tool call emitted. Broker must use the deterministic scorer (scoring.ts).",
  );
}
```

- [ ] **Step 2: Run the probe**

Run (with a real `services/.env` containing `KIMCHI_API_KEY`):
`cd services && bun run probe:kimchi`
Expected: either a printed `toolCalls` array with `pick_provider` (gate passes) or an empty array (gate fails, fall back to deterministic scorer). Both are valid outcomes — the point is to know.

- [ ] **Step 3: Record the result**

Create `docs/superpowers/foundations-report.md` with:

```markdown
# Foundations Report

## Kimchi tool-calling (Task 4)
- Date:
- Result: WORKS / DOES NOT WORK
- toolCalls observed: <paste>
- Exact AI SDK provider export used: <createOpenAICompatible or actual>
- Decision: broker uses Kimchi tool-calls / deterministic scorer as primary
```

Fill in from the probe output.

- [ ] **Step 4: Log any friction to feedback.md**

If anything about the Kimchi gateway was unclear (tool-calling undocumented, error shapes, etc.), append an entry to `feedback.md` using its format. (This is the [[always-log-circle-feedback]] practice, applied to Kimchi too where relevant; Circle-specific friction definitely goes here.)

- [ ] **Step 5: Commit**

```bash
git add services/probes/kimchi-toolcall.ts docs/superpowers/foundations-report.md feedback.md
git commit -m "test(services): probe Kimchi tool-calling through the gateway (first gate)"
```

---

## Task 5: Deterministic fallback scorer

**Files:**
- Create: `services/src/scoring.ts`
- Test: `services/src/scoring.test.ts`

The broker must never block the money path on the model being up. This is the deterministic ranking used as fallback (and as the hard pre-filter that runs before Kimchi in every case).

- [ ] **Step 1: Write the failing test**

Write `services/src/scoring.test.ts`:

```ts
import { test, expect } from "bun:test";
import { hardFilter, scoreProviders, type Provider, type JobSpec } from "./scoring";

const providers: Provider[] = [
  { id: "A", resourceType: "GPU", region: "US-East", online: true, stakeAmount: 100, pricePerTick: 0.000006, computeScore: 70, avgLatencyMs: 5 },
  { id: "B", resourceType: "GPU", region: "EU-West", online: true, stakeAmount: 100, pricePerTick: 0.000004, computeScore: 92, avgLatencyMs: 8 },
  { id: "C", resourceType: "GPU", region: "US-East", online: false, stakeAmount: 100, pricePerTick: 0.000003, computeScore: 99, avgLatencyMs: 4 },
  { id: "D", resourceType: "CPU", region: "US-East", online: true, stakeAmount: 0, pricePerTick: 0.000002, computeScore: 80, avgLatencyMs: 4 },
];

const job: JobSpec = { resourceType: "GPU", region: null };

test("hardFilter drops offline, wrong-type, and unstaked providers", () => {
  const kept = hardFilter(providers, job).map((p) => p.id);
  expect(kept).toEqual(["A", "B"]); // C offline, D wrong type + no stake
});

test("scoreProviders ranks by a weighted blend (cheaper + higher score first)", () => {
  const ranked = scoreProviders(hardFilter(providers, job), job).map((p) => p.id);
  expect(ranked[0]).toBe("B"); // cheaper and higher score than A
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services && bun test src/scoring.test.ts`
Expected: FAIL — cannot find module `./scoring`.

- [ ] **Step 3: Write the implementation**

Write `services/src/scoring.ts`:

```ts
export type Provider = {
  id: string;
  resourceType: "GPU" | "CPU" | "Storage" | "Full Server";
  region: string;
  online: boolean;
  stakeAmount: number;
  pricePerTick: number;
  computeScore: number;
  avgLatencyMs: number;
};

export type JobSpec = {
  resourceType: Provider["resourceType"];
  region: string | null;
};

export function hardFilter(providers: Provider[], job: JobSpec): Provider[] {
  return providers.filter(
    (p) =>
      p.online &&
      p.stakeAmount > 0 &&
      p.resourceType === job.resourceType &&
      (job.region === null || p.region === job.region),
  );
}

// Lower price is better; higher score is better; lower latency is better.
// Normalize each dimension across the candidate set, then weight.
export function scoreProviders(providers: Provider[], _job: JobSpec): Provider[] {
  if (providers.length === 0) return [];
  const prices = providers.map((p) => p.pricePerTick);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const norm = (v: number, lo: number, hi: number) => (hi === lo ? 1 : (v - lo) / (hi - lo));

  return [...providers].sort((a, b) => rank(b) - rank(a));

  function rank(p: Provider): number {
    const priceTerm = 1 - norm(p.pricePerTick, minP, maxP); // cheaper => higher
    const scoreTerm = p.computeScore / 100;
    const latencyTerm = 1 - norm(p.avgLatencyMs, 0, 20);
    return 0.4 * priceTerm + 0.45 * scoreTerm + 0.15 * latencyTerm;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services && bun test src/scoring.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/src/scoring.ts services/src/scoring.test.ts
git commit -m "feat(services): deterministic provider filter + weighted scorer (fallback)"
```

---

## Task 6: Pin Arc testnet config + viem connectivity probe

**Files:**
- Create: `services/src/arc.ts`
- Modify: `docs/superpowers/foundations-report.md`
- Modify: `feedback.md` (if friction)

- [ ] **Step 1: Find the real Arc testnet config**

Read the Arc docs to get the concrete values (chain id, RPC URL, explorer, testnet faucet):
- `https://docs.arc.io/llms.txt` (index), then the "Connect to Arc" and "Contract addresses" pages.
Record chain id, RPC URL, explorer URL, faucet URL into `docs/superpowers/foundations-report.md` under an "Arc testnet config" heading, and fill the matching vars in your local `services/.env`.

- [ ] **Step 2: Write the Arc client**

Write `services/src/arc.ts`:

```ts
import { createPublicClient, http, defineChain } from "viem";

export function arcChain(chainId: number, rpcUrl: string, explorerUrl: string) {
  return defineChain({
    id: chainId,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Arc Explorer", url: explorerUrl } },
    testnet: true,
  });
}

export function arcPublicClient(chainId: number, rpcUrl: string, explorerUrl: string) {
  return createPublicClient({
    chain: arcChain(chainId, rpcUrl, explorerUrl),
    transport: http(rpcUrl),
  });
}
```

> Note: `nativeCurrency` here is a placeholder — confirm Arc's actual gas token from the docs (x402 is gasless for the buyer, but the chain still has a native token). Correct it from the foundations report and note any surprise in `feedback.md`.

- [ ] **Step 3: Connectivity probe (inline, one-off)**

Run this one-liner from `services/` with your `.env` loaded (Bun auto-loads `.env`):

```bash
cd services && bun -e "import { arcPublicClient } from './src/arc'; const c = arcPublicClient(Number(process.env.ARC_CHAIN_ID), process.env.ARC_RPC_URL, process.env.ARC_EXPLORER_URL); console.log('chainId', await c.getChainId()); console.log('block', await c.getBlockNumber());"
```

Expected: prints the chain id (matching `ARC_CHAIN_ID`) and a current block number. If the chain id mismatches, the RPC or `ARC_CHAIN_ID` is wrong — fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add services/src/arc.ts docs/superpowers/foundations-report.md feedback.md
git commit -m "feat(services): arc testnet chain config + viem connectivity probe"
```

---

## Task 7: End-to-end x402 settlement probe on Arc (THE SETTLEMENT GATE)

**Files:**
- Create: `services/probes/x402-roundtrip.ts`
- Modify: `docs/superpowers/foundations-report.md`
- Modify: `feedback.md`

This proves real testnet USDC moves through the x402 + Gateway flow: a paywalled seller endpoint, a buyer that signs and pays, and a settlement we can see on-chain. The exact SDK surface is read from the installed package, not invented.

- [ ] **Step 1: Add the Circle packages**

Run: `cd services && bun add @circle-fin/x402-batching`
Expected: installs, exit 0. If the package name differs from the reference repos, search npm for the current Circle x402 package and use that; record the exact installed package + version in the foundations report, and log the naming friction to `feedback.md`.

- [ ] **Step 2: Read the package's real API**

Open `services/node_modules/@circle-fin/x402-batching/` (its `dist/*.d.ts` and `README`). Record in `docs/superpowers/foundations-report.md` the exact:
- seller middleware factory (reference name: `createGatewayMiddleware`) and its options,
- buyer/payment client used to sign + pay an x402 request,
- the facilitator settle endpoint (reference: `POST /v1/x402/settle`) and base URL,
- the Gateway Wallet contract address on Arc testnet + the deposit call.

Do not guess these — copy them from the package and the Circle docs. This recorded surface is the input to Plan 3 (provider) and Plan 4 (settlement adapter).

- [ ] **Step 3: Write the round-trip probe**

Write `services/probes/x402-roundtrip.ts` using the exact API names recorded in Step 2. It must:
1. Start a tiny HTTP seller with one route paywalled by the Gateway middleware at a sub-cent price (follow the `circle-agent` reference's `server.ts` shape: an Express-style app + `createGatewayMiddleware`).
2. From a buyer using `BROKER_WALLET_PRIVATE_KEY`, call that route, receive the `402`, sign the EIP-3009 authorization, retry with it, and get the resource.
3. Print the settlement UUID / facilitator response, and (after a batch flush) the on-chain `submitBatch` tx hash + explorer URL.

Because the SDK surface is only known after Step 2, write the concrete code here against the recorded API. Keep the seller and buyer in this one file for the probe; Plan 3 and Plan 4 split them into real services.

- [ ] **Step 4: Fund the wallets and run the probe**

- Get the broker (buyer) and provider (seller) wallets testnet USDC from the Arc/Circle faucet (URL recorded in Task 6).
- Deposit buyer USDC into the Gateway Wallet contract once (the deposit call recorded in Step 2).
- Run: `cd services && bun run probe:x402`
- Expected: the buyer receives the paywalled resource, a settlement UUID is returned, and (after the batch flush) an on-chain tx hash is printed. Open the explorer URL and confirm the transfer.

- [ ] **Step 5: Record the result**

Append to `docs/superpowers/foundations-report.md` under "x402 settlement (Task 7)": the exact middleware/client/settle APIs, the Gateway Wallet address, the settlement UUID, the on-chain tx hash + explorer link, and any gotchas (batch flush timing, decimals, headers). Log every friction point to `feedback.md`.

- [ ] **Step 6: Commit**

```bash
git add services/probes/x402-roundtrip.ts services/package.json services/bun.lock docs/superpowers/foundations-report.md feedback.md
git commit -m "test(services): real x402 + Gateway settlement round-trip on Arc testnet"
```

---

## Task 8: Foundations wrap-up

**Files:**
- Modify: `docs/superpowers/foundations-report.md`

- [ ] **Step 1: Confirm the full test suite is green**

Run: `cd services && bun test`
Expected: all unit tests pass (config, scoring). The probes are not part of `bun test` (they hit the network) — that's intentional.

- [ ] **Step 2: Type-check the whole workspace**

Run: `cd services && bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Write the decisions summary**

In `docs/superpowers/foundations-report.md`, add a short "Decisions locked for Plans 2-6" section capturing: tool-calling works or not (and so whether Kimchi or the scorer is primary), the exact Circle package + middleware/client/settle API names, the Arc chain config, and the Gateway Wallet address. Plans 3-6 reference this section instead of re-discovering anything.

- [ ] **Step 4: Commit and open a PR (or report ready)**

```bash
git add docs/superpowers/foundations-report.md
git commit -m "docs: foundations report — locked APIs, chain config, and gate results"
```

If using GitHub, push `feat/broker-foundations` and open a PR titled "Broker foundations & de-risking (Plan 1)". Otherwise report the branch is ready to merge.

---

## Self-Review Notes

**Spec coverage (slice 1):** This plan covers the foundation + the three open risks from the spec (Kimchi tool-calling — Task 4; x402 middleware in our runtime + Arc specifics — Tasks 6-7) and the deterministic fallback the spec's error-handling section requires (Task 5). The remaining spec sections are explicitly assigned to Plans 2-6 in the series list. No spec requirement is dropped; each is scheduled.

**Placeholder scan:** The two probe tasks (4, 7) intentionally read real third-party APIs (AI SDK export name, the Circle x402 package surface, Arc chain config) before writing the call code, because inventing a third-party API signature would be the real failure. Each such step says exactly where to read the API from and what to record — that is a concrete instruction, not a "TODO". All unit-tested code (config, scoring) has full code and full tests inline.

**Type consistency:** `Provider` and `JobSpec` are defined in `scoring.ts` (Task 5) and are the shape Plans 2+ extend; `loadConfig`/`Config` defined in Task 2; `makeKimchi` in Task 3; `arcPublicClient`/`arcChain` in Task 6. Names are used consistently across tasks.

**Not in scope (later plans):** Supabase schema and the `Registry` interface (Plan 2), the provider service and `ComputeExecutor`/`SimulatedExecutor` (Plan 3), the settlement adapter and stake contract (Plan 4), matching + stream engine + guardrails (Plan 5), the autonomous loop and Lumen wiring and full integration test (Plan 6).
