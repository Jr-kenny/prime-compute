# Circle Developer Tooling — Feedback Log

Running log of friction points, product-improvement ideas, and developer-experience
insights found while building prime-compute on Circle's stack (Nanopayments / x402 /
Gateway / Arc / Agent Stack). Kept current as we build so the best, most concrete
feedback is ready to submit, not reconstructed from memory later.

**How to use this file:** every time something about Circle's tooling causes
friction, surprises us, or could be better, add an entry the same day with enough
specifics (exact URL, exact error, exact missing thing) that a Circle engineer
could act on it. Concrete beats vague.

---

## Format

```
### <short title>
- **Area:** Nanopayments / x402 / Gateway / Arc / Agent Stack / SDK / Docs
- **What happened:** the concrete friction, with exact URLs / errors / commands
- **Impact:** how it slowed us down or what we got wrong because of it
- **Suggestion:** the specific improvement that would have helped
- **Date:**
```

---

## Entries

### Nanopayments concept docs don't surface the actual SDK/API
- **Area:** Docs / Nanopayments
- **What happened:** `https://developers.circle.com/gateway/nanopayments` explains
  the model (batched settlement, x402, EIP-3009) well, but the page doesn't show
  the SDK surface. The actual package (`@circle-fin/x402-batching`), the
  middleware (`createGatewayMiddleware`), and the facilitator endpoint
  (`POST /v1/x402/settle`) only became clear by reading the demo GitHub repos
  (`circlefin/arc-nanopayments`, `the-canteen-dev/circle-agent`).
- **Impact:** Had to reverse-engineer the integration surface from example repos
  instead of a reference page. Slower start, and easy to miss the right package.
- **Suggestion:** On the nanopayments concept page, link directly to a "Build it"
  section: the package name, the seller middleware, the buyer signing flow, and
  the settle endpoint, with one minimal framework-agnostic example.
- **Date:** 2026-06-28

### Getting basic Arc network config takes several hops
- **Area:** Arc / Docs
- **What happened:** `https://docs.arc.network/` 301-redirects to
  `https://docs.arc.io/`, and the landing page is a navigation hub with no concrete
  network config. Chain id, RPC URL, testnet faucet, and Gateway contract addresses
  aren't on the entry page; you have to dig through "Connect to Arc" / contract
  addresses / `llms.txt`.
- **Impact:** The single most-needed thing to start (chain id + RPC + faucet) isn't
  one click from the docs home.
- **Suggestion:** Put a copy-pasteable network config block (chain id, RPC, explorer,
  faucet, Gateway Wallet address for testnet) on the docs landing page or one click
  away, clearly labeled.
- **Date:** 2026-06-28

### Agent buyer tool/function-calling support not stated
- **Area:** Agent Stack / Nanopayments
- **What happened:** The agent-stack and nanopayments docs describe autonomous
  buyer agents but don't state whether/which model interfaces support tool-calling
  for the buy decision, or give a non-LangChain example. Reference buyer is built
  on LangChain + Deep Agents (OpenAI-flavored).
- **Impact:** Teams not on LangChain/OpenAI have to infer the agent integration
  rather than follow a documented pattern.
- **Suggestion:** A framework-agnostic "autonomous buyer" example (plain
  fetch/SDK) showing the x402 retry-with-authorization loop, independent of any
  agent framework.
- **Date:** 2026-06-28

### x402-batching peer deps aren't installed or flagged clearly
- **Area:** SDK / x402 / Gateway
- **What happened:** `@circle-fin/x402-batching@3.2.0` lists `@x402/core` and
  `@x402/evm` as peerDependencies with no `dependencies`. Installing just the Circle
  package and running it throws at runtime: `Cannot find module '@x402/evm/exact/server'`.
  You only discover the two `@x402/*` peers by reading the package's `package.json`.
- **Impact:** First run of any integration crashes with a module-not-found that
  doesn't name Circle's own package, which is confusing.
- **Suggestion:** Either depend on `@x402/core` / `@x402/evm` directly, or put a loud
  "also install these peers" line at the top of the Quick Start, or fail with a
  friendly error ("install @x402/core and @x402/evm") instead of a raw module error.
- **Date:** 2026-06-28

### Batched settlement returns a UUID where devs expect a tx hash
- **Area:** x402 / Gateway
- **What happened:** On the seller, `req.payment.transaction` (typed/named like a
  "Transaction hash after settlement") returns a settlement **UUID**
  (e.g. `3f14c4dd-...`), not an on-chain tx hash, because settlement is batched and
  the `submitBatch` lands asynchronously. The `deposit` call, by contrast, returns a
  real immediate `depositTxHash`.
- **Impact:** Naively building `${explorer}/tx/${transaction}` produces a dead link,
  and it's easy to assume settlement failed when it's just batched.
- **Suggestion:** Name/type the field to reflect that it's a settlement reference for
  batched payments (or expose both the UUID and the eventual batch tx hash once it
  lands), and say so in the lifecycle-hooks docs.
- **Date:** 2026-06-28

<!-- Add new entries above this line as we hit them during implementation. -->
