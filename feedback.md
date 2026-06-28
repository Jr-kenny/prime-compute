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

### GatewayClient doesn't compose with Circle's own developer-controlled wallets
- **Area:** SDK / x402 / Gateway
- **What happened:** The buyer `GatewayClient` (`@circle-fin/x402-batching/client`)
  only accepts `privateKey: Hex`. The lower-level `BatchEvmScheme` does take a
  `BatchEvmSigner` (`{ address, signTypedData }`), which a Circle developer-controlled
  wallet could satisfy, but `GatewayClient` (the thing that has `deposit()` and the
  full 402 `pay()` flow) gives you no way to pass a custom signer, and `deposit()` is
  an on-chain approve+deposit that needs a transaction sender, not just a typed-data
  signer.
- **Impact:** You can't drive the batching buyer flow with Circle's *own* wallet
  product without abandoning `GatewayClient` and reimplementing deposit + the 402
  retry loop around `BatchEvmScheme` + `x402Client` yourself. Two Circle products
  (developer-controlled wallets + x402 batching) don't compose on the buyer side.
- **Suggestion:** Let `GatewayClient` accept a `signer: BatchEvmSigner` (or a wallet
  adapter) as an alternative to `privateKey`, and document a deposit path that works
  with a developer-controlled wallet. That makes "autonomous agent on a Circle wallet
  paying via x402" a first-class, documented path.
- **Date:** 2026-06-28

### Spend-guard abort surfaces as an untyped string error
- **Area:** SDK / x402
- **What happened:** Registering a guard via `onBeforePaymentCreation` and returning
  `{ abort: true, reason }` makes `pay()` throw a generic
  `Error("Payment creation aborted: <reason>")`. There's no typed error class, so to
  react to "the guard stopped this payment" vs any other failure you have to
  string-match the message or track your own flag. I ended up stashing the last abort
  reason and rethrowing my own typed `SpendCapError` around `pay()`.
- **Impact:** Programmatic handling of the deterministic spend guard (the whole point
  of the hook) is awkward and brittle; string-matching an error message is the only
  built-in way to distinguish an intentional abort from a real fault.
- **Suggestion:** Throw a typed error (e.g. `PaymentAbortedError` with a `.reason`
  field) when a before-payment hook aborts, so callers can `instanceof`-check it.
- **Date:** 2026-06-28

### No confirmation signal or stated latency for when a batched payment settles
- **Area:** x402 / Gateway / Docs
- **What happened:** After every `pay()` across three separate live runs on Arc
  testnet, `getTransferById(transferId)` returned `status: "received"` with
  `settled: false`, and the batch never flipped to settled within a script's runtime.
  There's no documented expected settlement latency, the `TransferStatus` enum
  (`received | batched | confirmed | completed | failed`) isn't explained (which of
  these counts as "money landed"?), and there's no webhook/event to learn when a batch
  settles, so reconciliation is reduced to "poll `getTransferById` and hope."
- **Impact:** You can pay successfully but have no reliable, documented way to know
  when it actually settled on-chain, which makes building correct reconciliation (and
  knowing when it's safe to consider a charge final) guesswork.
- **Suggestion:** Document each `TransferStatus` and a rough settlement-time
  expectation, and offer a settlement webhook/notification (or a documented
  "terminal status" to poll for) so reconciliation isn't blind polling.
- **Date:** 2026-06-28

<!-- Add new entries above this line as we hit them during implementation. -->
