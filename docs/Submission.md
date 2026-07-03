# Prime Compute: submission

## What it is

Prime Compute is a marketplace for renting idle compute (GPUs, CPUs, whole servers) where you pay
by the second of actual use, settled in real USDC on Arc. An AI broker called Lumen sits in the
middle: you tell it what you need, and it finds the providers that can run it, ranks them, opens a
streaming payment channel, watches the rent while it's live, and moves or cancels it if the
provider degrades. You only ever pay for compute you actually consumed, and the payment stops the
instant the rent does.

The pitch in one line: renting a GPU should feel like turning on a tap, not signing a lease.

## The problem I wanted to solve

Renting compute today is lumpy and trust-heavy. You commit up front, you pay for whole blocks of
time whether you use them or not, and if the machine you rented turns out to be slower or flakier
than advertised, that's your problem. On the payment side, crypto rails are usually all-or-nothing:
you can send a payment, but you can't really stream one that pauses the moment the work stops. So
the two natural fits for this (idle compute + per-use payment) never quite meet.

Circle's nanopayments stack is what closes that gap. Batched x402 settlement on Arc lets me open a
payment, charge per tick, and stop instantly, which is exactly the shape "pay for the seconds you
used" needs. The rest of the app is built around making that safe and hands-off.

## How it uses Circle's stack

This isn't a mockup with a chain logo on it. Settlement is real USDC moving on Arc testnet, and the
Circle pieces are load-bearing:

- **Nanopayments / x402 / Gateway.** The provider runs an x402 seller endpoint; the broker is the
  buyer. Charges settle through `@circle-fin/x402-batching` and the Circle Gateway facilitator, so a
  live rent is a stream of tiny batched USDC payments, not one big invoice at the end.
- **Arc.** Everything settles on Arc testnet (chain id 5042002), where gas is itself USDC. Every
  Arc-facing call in the app reads a single `ARC_RPC_URL`, which for the hackathon points at a
  Canteen tokenized endpoint (see [Canteen.md](Canteen.md)).
- **Wallets.** Each user gets their own Arc spend wallet, the EOA that streams their nano-payments.
  Login is wallet-connect + a SIWE signature: your address is your identity, and a signature proves
  it. (I started on Circle Modular Wallets and the user-controlled Web SDK, hit a wall where a
  passkey smart account can't be the x402 payer, and moved to a connected-wallet + SIWE flow. The
  full story of why is in [Feedback.md](Feedback.md).)

## The broker is the actual product

Lumen is what makes the streaming rail worth having. It's a soul-driven agent, not a pile of
if-statements: it reasons from a written soul and a written policy, and the only hardcoded parts are
the money guardrails it can't override (trust tier, spend caps, budget). It ranks providers by
reasoning over their price, compute score, latency, and region, and if the model call ever fails it
degrades cleanly to a deterministic scorer instead of falling over. A broker that can re-route a
payment stream the instant a provider goes bad is the thing that makes pay-per-second safe for the
renter. The full mechanics are in [Lumen/broker.md](Lumen/broker.md).

## What's genuinely real

- The marketplace UI reads and writes through a real registry, not fixtures.
- The broker makes real ranking and matching decisions from the soul/policy runtime.
- Settlement is real USDC on Arc testnet: deposits, batched charges, reconciliation, withdrawals.
- An always-on metering worker streams charges for live rents whether or not a browser is open, and
  it's fully resumable, so a restart never double-charges or skips (see [WORKER_DEPLOY.md](WORKER_DEPLOY.md)).

## Developer-experience feedback

Building this end-to-end on Circle's stack meant hitting a lot of real friction, and I logged every
piece of it as I went, dated, with exact errors and codes, so it's concrete enough for a Circle
engineer to act on. That log is [Feedback.md](Feedback.md). Highlights: the buyer `GatewayClient`
not composing with Circle's own developer-controlled wallets, batched settlement returning a UUID
where you expect a tx hash with no way to poll for "money landed," the Web SDK needing a full Node
polyfill set to even import in a modern bundler, and the entity secret being account-global with no
error that says so. Each entry ends with the specific change that would've saved me the round-trip.

## Try it

Live: [primecompute.vercel.app](https://primecompute.vercel.app). Connect a wallet on the
onboarding page (it'll switch you to Arc automatically), sign in, and fund your spend wallet with a
small amount of testnet USDC to rent. Setup and the full architecture are in the
[README](../README.md).
