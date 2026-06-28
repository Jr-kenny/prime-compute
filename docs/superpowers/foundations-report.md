# Foundations Report

Findings from Plan 1 (broker foundations & de-risking). Plans 2-6 reference this
instead of re-discovering anything.

## Installed versions (Task 1)

- ai: 4.3.19
- @ai-sdk/openai-compatible: 0.1.17 (export used: `createOpenAICompatible`)
- viem: 2.53.1
- zod: 3.25.76
- typescript: 5.9.3
- bun: 1.3.13

Note: `typescript@^5.6.0` failed to resolve on the first `bun install` ("no version
matching"); relaxed to `^5`, resolved to 5.9.3. Newer majors exist for ai (v7), zod
(v4), openai-compatible (v3) but the v4/v0.1/v3 set installed is mutually compatible
and the `tool()` + `createOpenAICompatible` APIs type-check.

## Tool-calling (Task 4) — PASS (via NVIDIA NIM)

- `bun run probe:llm` against **NVIDIA NIM** (`https://integrate.api.nvidia.com/v1`,
  model `meta/llama-3.3-70b-instruct`) emitted a real tool call:
  `pick_provider({ provider_id: "B", reason: "Cheapest provider for GPU job" })`,
  `finishReason: tool-calls`. It also picked the correct provider. Tool-calling
  through the AI SDK works. NVIDIA free tier limit is ~40 RPM, fine for the broker
  (it calls the model on decisions, not per tick).
- The broker brain is provider-agnostic by design: `LLM_BASE_URL`/`LLM_API_KEY`/
  `LLM_MODEL` select the endpoint; `src/llm.ts` + the AI SDK openai-compatible
  provider are unchanged across providers.
- Kimchi note: every Kimchi model (kimi-k2.6/k2.7, minimax-m3/m2.7,
  nemotron-3-ultra-fp4, deepseek-v4-flash, glm-5.2-fp8) returned
  `"the provider for model <m> has exhausted its credits"` despite a non-zero
  account balance — looks key-scoped (the `prime compute` key's provider pools),
  the `Kimchi CLI` key has working usage on kimi-k2.7. Kimchi remains a drop-in
  alternative once that key can reach a model (config in `.env.example`).
- The deterministic scorer in `src/scoring.ts` remains the hard pre-filter and the
  fallback whenever the model is unavailable.

## Arc testnet config (Task 6) — CONFIRMED

| Field | Value |
|---|---|
| Chain ID (decimal) | `5042002` |
| RPC (primary) | `https://rpc.testnet.arc.network` |
| RPC (alts) | Blockdaemon / dRPC / QuickNode `https://rpc.<provider>.testnet.arc.network` |
| WebSocket | `wss://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` |
| Gas token | USDC (6 decimals) — confirms `arc.ts` nativeCurrency |
| USDC contract | `0x3600000000000000000000000000000000000000` (native USDC ERC-20 interface) |
| Circle Gateway Wallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` (Gateway Domain 26) |

Sources: `https://docs.arc.io/arc/references/connect-to-arc.md`,
`https://docs.arc.io/arc/references/contract-addresses.md`.

Connectivity probe (Task 6 step 3): PASS — `getChainId()` returned `5042002`
(matches) and `getBlockNumber()` returned a live block (~49073890) against the
public RPC. Arc testnet is reachable with the config above; no key needed.

## x402 settlement (Task 7) — PASS (real settlement on Arc testnet)

Package: `@circle-fin/x402-batching@3.2.0`. Peer deps required (install manually):
`@x402/core@^2.3.0`, `@x402/evm@^2.3.0`. Seller also needs `express`.

**Seller API** (`@circle-fin/x402-batching/server`):
```ts
const gateway = createGatewayMiddleware({
  sellerAddress,
  networks: ["eip155:5042002"],            // Arc testnet, CAIP-2
  facilitatorUrl: "https://gateway-api-testnet.circle.com", // testnet (default is mainnet)
});
app.get("/tick", gateway.require("$0.0001"), (req, res) => {
  const pay = (req as PaymentRequest).payment; // { verified, payer, amount, network, transaction }
  res.json({ ... });
});
```

**Buyer API** (`@circle-fin/x402-batching/client`):
```ts
const client = new GatewayClient({ chain: "arcTestnet", privateKey });
await client.deposit("0.10");               // one-time, real on-chain tx (depositTxHash)
const { data, amount } = await client.pay(url); // gas-free; amount is bigint atomic units
```
Lower-level: `BatchEvmScheme` exposes `onBeforePaymentCreation` returning
`{ abort, reason }` on amount — this is the deterministic guardrail seam for Plan 5.

**Probe result:** deposit tx `0x87f8e02d...` (on-chain, on the explorer); buyer paid
`$0.0001` (100 atomic units) gas-free; seller saw payer + amount.

**Key nuance:** `req.payment.transaction` returned a **settlement UUID**
(`3f14c4dd-...`), not a tx hash — settlement is batched, the on-chain `submitBatch`
lands async. The `deposit` is a real immediate tx; per-tick settlement is the batch.
This matches the spec's "record optimistically, reconcile when the batch lands."

Facilitator URLs: testnet `https://gateway-api-testnet.circle.com`,
mainnet `https://gateway-api.circle.com`. USDC has 6 decimals
($0.0001 = 100 atomic).

## Decisions locked for Plans 2-6

- **x402 settlement WORKS on Arc testnet** with `@circle-fin/x402-batching@3.2.0`
  (+ `@x402/core`, `@x402/evm`, `express`). Seller = `createGatewayMiddleware`,
  buyer = `GatewayClient` (`deposit` + `pay`), network `eip155:5042002`, testnet
  facilitator `https://gateway-api-testnet.circle.com`. Plan 3 (provider) builds on
  the seller API; Plan 4 (settlement adapter) builds on the buyer API.
- Per-tick settlement is **batched/async** (`req.payment.transaction` is a settlement
  UUID, not a tx hash). Plan 4/5 record ticks optimistically and reconcile on the
  batch — matches the spec's error-handling section.
- The buyer's `BatchEvmScheme.onBeforePaymentCreation(ctx → {abort,reason})` is the
  deterministic spend guardrail seam for Plan 5.
- Arc chain config and the Gateway Wallet address above are canonical.
- AI SDK provider export is `createOpenAICompatible`; model id from `KIMCHI_MODEL`
  (default `kimi-k2.6`).
- **Kimchi tool-calling is unconfirmed (provider credits exhausted at probe time).**
  Until credits return and the probe is rerun, the deterministic scorer
  (`src/scoring.ts`) is the broker's primary ranking and is always the hard
  pre-filter regardless.

## Status

- PASS: workspace, config, scorer, Arc connectivity, x402 settlement on Arc testnet.
- BLOCKED (non-blocking): Kimchi tool-calling gate — rerun `bun run probe:kimchi`
  once Kimchi credits are topped up; the deterministic fallback covers the gap.
- Unit suite green (4 tests), full workspace type-checks.
