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

## Kimchi tool-calling (Task 4) — PENDING RUN

- Needs `KIMCHI_API_KEY` in `services/.env`, then `bun run probe:kimchi`.
- Result: TBD (WORKS / DOES NOT WORK)
- Decision: broker uses Kimchi tool-calls if it works, else the deterministic scorer
  in `src/scoring.ts` as primary.

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

## x402 settlement (Task 7) — PENDING RUN

- x402 facilitator base URL is NOT listed on the Arc contract-addresses page; pin it
  from the Circle x402 / Gateway docs and the installed `@circle-fin/x402-batching`
  package during Task 7.
- Needs funded broker + provider wallets (faucet) and the buyer's one-time Gateway
  deposit. Result: TBD.

## Decisions locked for Plans 2-6

- Arc chain config and the Gateway Wallet address above are canonical.
- AI SDK provider export is `createOpenAICompatible`; model id from `KIMCHI_MODEL`
  (default `kimi-k2.6`).
- Deterministic scorer (`src/scoring.ts`) is the always-present pre-filter + ranking
  fallback regardless of the tool-calling result.
- Still to lock in Task 7: exact x402 middleware/client/settle API names and the
  facilitator base URL.
