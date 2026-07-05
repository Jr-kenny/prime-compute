# Canteen: how Prime Compute gets onto Arc

Prime Compute settles real USDC on Arc testnet, which means every part of the app that touches
the chain needs an Arc RPC to talk to. For the hackathon, that RPC comes from Canteen: its
`arc-canteen` CLI hands you a tokenized Arc endpoint that runs your traffic through the host's
RPC instead of a public one. I built the app so that endpoint drops straight in. There's a single
env var, `ARC_RPC_URL`, and everything Arc-facing reads from it.

## Getting the endpoint

Canteen's own setup is the source of truth, but it's three commands:

```bash
uv tool install arc-canteen          # install the CLI (uv)
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

## Posting traction to Canteen

Traction goes to the host through the same CLI, not a Discord post. The command is
`arc-canteen update traction` (and `arc-canteen update product` for build progress); past updates
are visible with `arc-canteen ls traction`. It's a manual snapshot each time, so the way you show
growth is to post an update now, keep posting as the numbers move, and post a final one before the
deadline. The CLI keeps the history and draws the trend on their side.

To get honest numbers to paste in, there's a one-liner that reads them straight from the ledger:

```bash
cd services
bun run traction
```

That prints volume, nanopayment count, rents, and users, plus a paste-ready line. It's read-only
(a `traction_summary()` DB function, service-role only), safe to run anytime, even while the meter
is live.

A note on how to frame it so it stays honest:

- The headline is **volume streamed** and **nanopayments** (the count of metered charges). That's
  the real, novel bit: thousands of streaming micropayments, not a handful of big transactions.
- Call them "nanopayments streamed via Circle Gateway on Arc," **not** "on-chain transactions."
  Each charge carries a Circle Gateway transfer id (a UUID), not an Arc L1 tx hash; Gateway settles
  them, so the on-chain footprint is the Gateway settlement layer, not one L1 tx per charge.
- Don't claim completed rents while the count is zero, and be plain that the user count is small
  early on (mostly our own testing). The strength is throughput and working end-to-end infra.

## Letting them verify on-chain

The CLI update is a manual snapshot, but Arc is public, so the organizers can watch all future
flow themselves. Share these and they can follow the real USDC movement on the Arc explorer
independent of anything we post:

- Payer (per-user spend wallet): `0xaf70175E779786Cf7C08f2ba6d985eD6297e80Fc`
- Payee (first-party provider): `0x6d7050ed44993c6a55e30b342ade8d42193d5a92`
