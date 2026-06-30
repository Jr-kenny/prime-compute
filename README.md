# Prime Compute

Prime Compute is a marketplace where people rent out idle compute (GPUs, CPUs, full
servers) and consumers pay for it per second of actual use, settled in real USDC on
[Arc](https://docs.arc.io) (Circle's stablecoin L1). An AI broker sits in the middle:
it discovers and ranks providers, opens the payment stream, watches job health, and
migrates or cancels a rent when a provider degrades. The broker genuinely decides
within deterministic guardrails it can't override; it isn't just automation with
extra steps.

There are four moving pieces:

1. **Marketplace** — providers register idle resources (specs, region, price per
   tick, reliability); consumers post rents (requirements, latency preference,
   estimated usage, budget).
2. **AI broker** — discovers/ranks providers, opens the payment stream, monitors
   health, migrates or rebalances on degradation, routes payments.
3. **Streaming settlement** — nanopayments on Arc via x402 + Circle Gateway: open,
   pay per tick, pause and cancel instantly, only ever pay for what was consumed.
4. **Reputation** — every provider carries a Compute Score built from real outcomes
   (uptime, completion rate, latency, claimed-vs-observed specs), not a vanity stat.

Settlement is genuinely on-chain on Arc testnet, not simulated. See
[`docs/superpowers/specs/2026-06-28-autonomous-compute-broker-design.md`](docs/superpowers/specs/2026-06-28-autonomous-compute-broker-design.md)
for the full design and [`docs/superpowers/foundations-report.md`](docs/superpowers/foundations-report.md)
for the verified chain/settlement/LLM details.

## Repo layout

```
src/                  Frontend: TanStack Start (file-based routing), React 19,
                       Tailwind v4, Radix UI. Talks to the registry/broker through
                       server functions in src/lib/broker/server-fns.ts.
services/              Backend: the broker brain, provider executor, on-chain
                       settlement adapter, registry, trust/reputation scoring.
                       Bun + TypeScript, no framework.
  src/broker/           Discovery, ranking, matching, health, migration, guardrails.
  src/provider/         The x402 seller side (executor + server template).
  src/registry/         Provider/rent state (Supabase-backed, with an in-memory
                       implementation for tests).
  src/runtime/          Soul/policy-driven agent runtime (the broker reasons from
                       SOUL.md/POLICY.md, not hardcoded branching).
  src/settlement/       x402 + Circle Gateway adapter, spend policy.
  src/trust/             Compute Score / reputation.
  scripts/               Standalone round-trip scripts (seed providers, run a
                       provider, exercise settlement/broker/full-integration
                       flows against Arc testnet).
  probes/                One-off capability probes (LLM tool-calling, x402
                       round-trip, soul-driven ranking/divergence).
docs/superpowers/      Specs and implementation plans this project was built from
                       (one spec + one plan per slice of work).
```

## Tech stack

- **Frontend:** TanStack Start, React 19, TanStack Router/Query, Tailwind v4
  (oklch design tokens in `src/styles.css`), Radix UI primitives, framer-motion.
- **Backend:** Bun, TypeScript, Express (provider's x402 seller endpoint),
  Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`) for the broker's LLM calls.
- **Chain/settlement:** [Arc testnet](https://docs.arc.io) (Circle's stablecoin
  L1), `@circle-fin/x402-batching`, `viem`.
- **Identity:** Circle Modular Wallets (passkey-backed wallets, no seed phrases),
  Supabase for session/profile state.
- **Data:** Supabase (registry + realtime), with an in-memory registry
  implementation used by the test suite.

## Getting started

Requires [Bun](https://bun.sh).

```bash
bun install        # frontend deps
cd services && bun install && cd ..   # backend deps
```

Both the frontend and `services/` read from `.env` files that are intentionally
gitignored (they hold wallet keys and service-role credentials). Copy
`services/.env.example` to `services/.env` and fill in:

- An OpenAI-compatible LLM endpoint (`LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`) —
  the broker brain is provider-agnostic, NVIDIA NIM works out of the box.
- A funded broker wallet and a funded provider wallet on Arc testnet
  (`BROKER_WALLET_PRIVATE_KEY` / `PROVIDER_WALLET_PRIVATE_KEY`), faucet at
  `https://faucet.circle.com`.
- Your Supabase project's URL and service role key.

The frontend's `.env` additionally needs `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY`, `VITE_CIRCLE_CLIENT_KEY` / `VITE_CIRCLE_CLIENT_URL`
(Circle Modular Wallets), `VITE_ARC_RPC_URL` / `VITE_ARC_CHAIN_ID`, and a server-side
`AUTH_NONCE_SECRET` for the passkey auth bridge.

```bash
bun run dev         # frontend dev server (vite dev)
bun run build        # production build
```

```bash
cd services
bun test                          # unit + contract tests
bun run probe:llm                  # confirm tool-calling against your LLM endpoint
bun run probe:x402                 # confirm an x402 round-trip on Arc testnet
bun run seed                       # seed sample providers into the registry
bun run integration:roundtrip       # full provider -> broker -> settlement loop
```

## Status

This is a real infrastructure build, not a mockup: the marketplace UI reads and
writes through the registry, the broker makes real ranking/matching decisions, and
settlement is real USDC moving on Arc testnet. Active development; see
`docs/superpowers/plans/` for the sequence of work this was built in.
