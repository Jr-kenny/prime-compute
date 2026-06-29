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

### `pay()` connection failures don't say which URL couldn't be reached
- **Area:** x402 / Gateway / SDK
- **What happened:** On a live Arc-testnet integration run, `GatewayClient.pay(url)`
  threw `Error: "Unable to connect. Is the computer able to access the url?"` from inside
  `@circle-fin/x402-batching/dist/client/index.mjs`. `pay()` talks to two different
  endpoints (the x402 resource URL you pass in, and the Gateway facilitator it settles
  through), but the error names neither, carries no `cause`, no status, and no host. The
  provider in this case was a local server that was definitely up and had served payments
  seconds earlier, so the unreachable endpoint was almost certainly the Gateway side, but
  there was no way to confirm that from the error. Same run: `getTransferById` reported
  all four prior charges still unsettled after 90s of polling, so the Gateway side did
  look degraded/slow at that moment.
- **Impact:** A transient Gateway connectivity blip is indistinguishable from "your
  resource URL is wrong/down." Diagnosing it took multiple real-money testnet runs purely
  because the error couldn't tell us which hop failed. Anyone building retry/migration
  logic can't branch on "provider unreachable" vs "Gateway unreachable" without it.
- **Suggestion:** Include the failing URL (or at least "resource" vs "gateway") and the
  underlying `cause` on connection errors thrown by `pay()`. A typed error (e.g.
  `GatewayConnectionError` with `.url` / `.phase`) would let callers react correctly.
- **Date:** 2026-06-29

### Modular Wallets don't slot into standard wallet auth (counterfactual smart accounts)
- **Area:** Modular Wallets / SDK / Docs
- **What happened:** Designing passkey login for an app on Circle Modular Wallets, the obvious
  path was a standard "Sign-In with Ethereum" / EIP-4361 provider (Supabase's built-in Web3 auth,
  and most off-the-shelf wallet-auth providers work this way). It doesn't work: a Modular Wallet
  is a passkey-controlled smart-contract account that signs via ERC-1271 with a P-256 passkey, not
  an EOA ECDSA secp256k1 signature, and EIP-4361 providers verify ECDSA only. On top of that the
  account is counterfactual (not deployed until the first user op), so even an ERC-1271-aware
  verifier has to handle the undeployed case via ERC-6492. Net: you can't use the common SIWE auth
  building blocks; you must roll your own nonce + signature verification with an ERC-6492-aware
  verifier (e.g. viem's public-client verifyMessage) before you can mint an app session.
- **Impact:** "Add wallet login" is a much bigger lift than it looks for Modular Wallets, because
  the ecosystem's standard auth integrations assume EOAs. It's easy to start down the SIWE path and
  only discover the mismatch after wiring it up.
- **Suggestion:** Call this out prominently in the Modular Wallets auth docs ("these are smart
  accounts; standard SIWE/EIP-4361 auth providers won't verify their signatures"), and ideally ship
  a small helper or documented recipe for "prove control of a Modular Wallet to my backend" that
  handles the counterfactual ERC-6492 case, so app developers don't each re-derive it.
- **Date:** 2026-06-29

### "Cannot find the entity config in the system" really means "you didn't set a passkey domain"
- **Area:** Modular Wallets / SDK / Console
- **What happened:** Building passkey onboarding with the Modular Wallets Web SDK, the wallet-creation
  call (`toCircleSmartAccount` flow) failed with `An unknown RPC error occurred. Details: Cannot find
  the entity config in the system.` Nothing in that message points at the cause. We first suspected
  the chain (we were on `arcTestnet`), switched to `baseSepolia`, and got the identical error, which
  ruled the chain out. The actual cause was that only the Client Key's Allowed Domain had been set in
  the console; the separate **Passkey Domain Name** had not. Once the passkey domain was set to
  `localhost`, the exact same code worked first try on both chains.
- **Impact:** The error text sends you chasing the wrong things (chain support, client URL, client key
  validity) when the real fix is a one-field console setting. It cost a multi-step debugging loop and a
  chain swap to isolate, and "entity config" is not vocabulary the setup docs use, so it isn't
  greppable back to the missing step.
- **Suggestion:** Make the error name the missing configuration, e.g. "No passkey domain configured for
  this client key (set the Passkey Domain Name in the console to match the Allowed Domain)." Even
  better, surface it at SDK init / `toPasskeyTransport` rather than deep in the smart-account RPC call.
- **Date:** 2026-06-29

<!-- Add new entries above this line as we hit them during implementation. -->
