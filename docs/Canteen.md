# Canteen: how Prime Compute gets onto Arc

Prime Compute settles real USDC on Arc testnet, which means every part of the app that touches
the chain needs an Arc RPC to talk to. For the hackathon, that RPC comes from Canteen: its
`arc-canteen` CLI hands you a tokenized Arc endpoint that runs your traffic through the host's
RPC instead of a public one. I built the app so that endpoint drops straight in. There's a single
env var, `ARC_RPC_URL`, and everything Arc-facing reads from it.

## Getting the endpoint

Canteen's own setup is the source of truth, but it's three commands:

```bash
uv tool install git+https://github.com/the-canteen-dev/ARC-cli.git   # install the CLI (uv)
arc-canteen login                    # log in and sync your Arc context
arc-canteen rpc eth_chainId          # sanity check: returns 0x4cef52 (5042002)
```

That last call confirms you're actually reaching Arc. Copy the tokenized RPC URL it configures.

## Dropping it in

The web app reads root `.env`, and the broker/worker/scripts read `services/.env`, so the Canteen
endpoint goes in both:

```bash
# .env and services/.env
ARC_RPC_URL=<your arc-canteen tokenized RPC URL>
ARC_CHAIN_ID=5042002
USDC_ADDRESS=0x3600000000000000000000000000000000000000
```

## Where that one value ends up

Setting `ARC_RPC_URL` once is enough because every Arc call in the app funnels through it:

- **Gateway settlement** (`services/src/settlement/gateway.ts`): the settlement adapter takes an
  optional `rpcUrl` and the roundtrip scripts pass `process.env.ARC_RPC_URL`, so on-chain
  deposits, balance reads, and withdrawals all go through Canteen. The batched `pay()` itself
  still goes to the Circle Gateway facilitator at `X402_FACILITATOR_URL`; Canteen is the Arc
  read/write side, not the x402 batching side.
- **Per-user spend wallets** (`services/src/wallet/onchain.ts`): USDC balance reads and
  withdrawals for each user's spend wallet run over `ARC_RPC_URL`.
- **Login signature verification** (`src/lib/auth/siwe-fns.ts`): when someone signs in with their
  wallet, the server verifies the SIWE signature against a public client pointed at
  `process.env.ARC_RPC_URL`, so even the auth check rides the Canteen RPC.

## Checking it works

```bash
cd services
bun run settlement:roundtrip     # fund / pay / reconcile on Arc via the Canteen RPC
bun run integration:roundtrip     # full provider -> broker -> settlement loop
```

If the Canteen token expires, re-run `arc-canteen login` and update `ARC_RPC_URL` in both files.
Nothing else in the app has to change, which was the whole idea: keep the host's RPC to exactly
one seam so swapping it in or out is a one-line move.
