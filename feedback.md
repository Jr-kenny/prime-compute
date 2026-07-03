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

### A passkey Modular Wallet can't be the x402/Gateway nano-payment payer, so each user needs a second wallet
- **Area:** Modular Wallets / x402 / Gateway
- **What happened:** We wanted each user to stream their own USDC nano-payments from the same wallet
  they log in with (their passkey Modular Wallet). It can't: the buyer `GatewayClient` only takes a
  raw `privateKey`, and `@circle-fin/modular-wallets-core` exposes no Gateway / EIP-3009 surface at
  all. A Modular Wallet signs via WebAuthn/P-256 in the browser and can't produce the ECDSA EIP-3009
  `TransferWithAuthorization` that Gateway settlement needs server-side. We confirmed against Circle's
  own samples that this is the intended shape: arc-nanopayments uses a raw `BUYER_PRIVATE_KEY` EOA,
  arc-commerce uses server-side developer-controlled wallets. So we had to generate and custody a
  separate per-user EOA spend wallet just to stream payments, and keep the Modular Wallet as identity
  only, then move funds between the two.
- **Impact:** "Users pay from their own wallet" turns into "give every user a second, custodial EOA,
  encrypt its key, and build a fund-transfer step between their identity wallet and their spend
  wallet." That's real custody and key-management surface no one wants in a hackathon build, and it
  contradicts the seedless/passkey value prop of Modular Wallets.
- **Suggestion:** Provide a first-class path to pay x402/Gateway nano-payments *from* a Modular
  Wallet (e.g. a Gateway/x402 adapter that accepts the smart account + bundler, or a documented
  user-operation recipe that performs the deposit + batched authorization), so the login wallet and
  the paying wallet can be the same one.
- **Date:** 2026-06-30

### No clear "which chains do Modular Wallets support" list; you confirm it by grepping a d.ts enum
- **Area:** Modular Wallets / Docs
- **What happened:** Before moving our Modular Wallet onboarding to Arc, we wanted to confirm Modular
  Wallets actually support Arc testnet (since an earlier Arc attempt had errored). There's no obvious
  supported-chains list in the docs for Modular Wallets. We ended up confirming it by grepping the
  installed SDK types and finding `ContractAddress.ArcTestnet_USDC = 0x3600…` in `index.d.ts`.
- **Impact:** "Is chain X supported for Modular Wallets?" is a basic, blocking question for any team
  picking a chain, and the answer currently lives in a buried enum rather than a docs table. It's
  easy to wrongly conclude a chain is unsupported (especially when a misconfigured passkey domain
  throws an unrelated "entity config" error on that chain, see the entry above).
- **Suggestion:** Publish a plain supported-chains/segments table for Modular Wallets (chain name,
  the transport URL segment, USDC address), and have the SDK expose it programmatically.
- **Date:** 2026-06-30

### No documented recipe for sending an on-chain transfer (e.g. USDC) from a Modular Wallet
- **Area:** Modular Wallets / SDK / Docs
- **What happened:** To move USDC from a user's Modular Wallet to their spend wallet we had to wire
  the smart account to a viem `createBundlerClient` and `sendUserOperation` ourselves. The SDK ships
  the pieces (`toCircleSmartAccount`, the modular transport, `getUserOperationGasPrice`) but there's
  no end-to-end "send a token transfer from a Modular Wallet" example, and the gas-price helper
  returns string tiers (`low/medium/high`) that don't drop straight into viem's `estimateFeesPerGas`
  (which wants bigints). Whether gas is sponsored by a paymaster on a given testnet (Arc) vs. needs
  the account funded is also not stated, so the simplest send is guesswork until you test on-chain.
- **Impact:** A basic "let the user send USDC from their wallet" feature becomes ERC-4337 plumbing
  plus trial-and-error on gas/paymaster behavior, which is a lot of surface for what reads like a
  one-liner.
- **Suggestion:** Ship a documented, copy-pasteable recipe for "send a token transfer from a Modular
  Wallet" including the bundler client wiring, the gas-price → fees conversion, and a clear statement
  of paymaster/gas-sponsorship behavior per network (especially Arc testnet).
- **Date:** 2026-06-30

### Faucet API returns a bare 403 for developer-controlled wallets on Arc testnet
- **Area:** API (faucet, developer-controlled wallets)
- **What happened:** `client.requestTestnetTokens({ address, blockchain: "ARC-TESTNET", usdc: true })` (the SDK wrapper for `POST /v1/faucet/drips`) returned a bare 403 with no body explaining why, for an API key that can create wallets, sign, and execute contracts on Arc testnet just fine. There's no way to tell whether the faucet doesn't support Arc, isn't enabled for this key tier, or needs some console toggle; the docs for the faucet endpoint don't list supported blockchains.
- **Impact:** an end-to-end test of "Circle wallet funds Gateway and pays an x402 charge" dead-ends at funding: everything else is automatable through the SDK, but getting the first testnet USDC into the wallet requires a human at faucet.circle.com, so CI or an agent can't run the proof unattended.
- **Suggestion:** return a reason with the 403 (unsupported chain vs. key permissions), document which blockchains `POST /v1/faucet/drips` supports, and ideally support Arc testnet since Circle's own Gateway/x402 stack targets it.
- **Date:** 2026-07-02

### Insufficient-balance error on contractExecution doesn't say which asset or how much
- **Area:** API (developer-controlled wallets, contract execution)
- **What happened:** `POST /v1/w3s/developer/transactions/contractExecution` on an unfunded Arc-testnet wallet returned 400 code 155258 `the asset amount owned by the wallet is insufficient for the transaction`. It doesn't say which asset (the USDC being approved? the USDC-denominated gas Arc uses?), the required amount, or the wallet's current balance.
- **Impact:** on Arc, where gas is also USDC, "insufficient" is ambiguous between transfer value and fee; you have to look up the balance separately and guess which leg fell short before knowing how much to fund.
- **Suggestion:** include asset, required amount, and available amount in the error body (the estimation layer clearly knows all three).
- **Date:** 2026-07-02

### Gateway withdraw fee isn't documented or queryable before you try the withdraw
- **Area:** SDK (`@circle-fin/x402-batching` GatewayClient)
- **What happened:** `gateway.withdraw()` on Arc testnet charges a same-chain fee of ~0.0035 USDC, but nothing exposes that number upfront: no `estimateWithdrawFee`, no constant in the SDK, and the docs only mention the `maxFee` cap (default 2.01 USDC). The only way to learn the real fee is to attempt a withdraw and parse it out of the insufficient-balance error (`available 0.002300, required 0.003501` when withdrawing 0.000001).
- **Impact:** any accrue-then-remit design has to pick its remittance threshold blind. We shipped a $0.01 default, discovered the fee is 35% of that from a failed live run, and had to recalibrate to $0.10. An agent can't budget fees it can't query.
- **Suggestion:** expose a fee quote (an `estimateWithdrawFee()` or a field on `getBalances()`), and document the typical same-chain fee next to `maxFee` so the default isn't the only visible number.
- **Date:** 2026-07-02

### Gateway deposit credits minutes after the deposit tx confirms, with no status to poll
- **Area:** SDK (`@circle-fin/x402-batching` GatewayClient)
- **What happened:** `gateway.deposit("0.05")` returned a confirmed `depositTxHash` immediately, but `getBalances()` kept reporting the old available balance for a couple of minutes until Circle's attestation credited it. Nothing in the deposit result or balances object says "pending attestation": the deposit just looks lost until it suddenly isn't.
- **Impact:** scripts that deposit-then-spend have to hand-roll a polling loop against `getBalances()` with a guessed timeout, because there's no pending-deposit state to watch and no docs stating the expected attestation delay.
- **Suggestion:** surface in-flight deposits in `getBalances()` (a `pendingDeposit` bucket, like `withdrawing` already exists for the other direction) or document the attestation delay and a recommended polling pattern.
- **Date:** 2026-07-02

### w3s-pw-web-sdk needs a full Node polyfill set to load in the browser, and it crashes at import if you don't
- **Area:** SDK (`@circle-fin/w3s-pw-web-sdk`, the user-controlled Web SDK)
- **What happened:** a plain `import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk"` in a Vite app throws at module init: `TypeError: Cannot read properties of undefined (reading 'from')` (safe-buffer reading `require('buffer').Buffer`, which Vite externalizes to `undefined` for the browser). Fixing buffer just surfaces the next one: `TypeError: Object prototype may only be an Object or null: undefined` from `util.inherits` inside the SDK's bundled `jsonwebtoken`/`jws` stream code. The Web SDK drags jsonwebtoken (and its safe-buffer/crypto-browserify/readable-stream chain) into the browser, so it needs buffer/crypto/stream/util/events/process all polyfilled with correct CommonJS interop.
- **Impact:** you can't just install and import the browser SDK in a modern bundler; you have to add `vite-plugin-node-polyfills` (or equivalent) before it will even evaluate. Worse in an SSR framework (TanStack Start / nitro / Cloudflare): the global polyfill that makes the client work then breaks the server build, because the same jsonwebtoken chain gets shimmed in the SSR bundle (`node:buffer is not exported by .../shims/buffer`). Scoping the polyfill to only the client is fiddly because the plugin works through Vite's global `config` hook, not per-environment hooks.
- **Suggestion:** ship a browser-native build of the Web SDK that doesn't pull jsonwebtoken/node-stream into the client (use WebCrypto + a browser JWT decoder), or document the exact polyfill setup the SDK needs, including an SSR-safe (client-only) configuration for Vite/Next/TanStack Start. Right now the happy-path `import` is a landmine.
- **Date:** 2026-07-02

<!-- Add new entries above this line as we hit them during implementation. -->

### signTypedData rejects viem-style typed data with a cryptic count error
- **Area:** SDK (developer-controlled wallets)
- **What happened:** `POST /v1/w3s/developer/sign/typedData` returned 400 code 156026, `error: there is extra data provided in the message (0 < 4) with external msg: Failed during the validation for typed data`, for a payload that viem/ethers accept as-is. The actual problem: Circle's validator requires `EIP712Domain` to be declared explicitly in `types`; viem-style payloads (and Circle's own x402-batching `BatchEvmSigner` interface!) omit it because it's inferable from the `domain` object. Nothing in the error names `EIP712Domain`, and the SDK's own signTypedData doc example omits it too.
- **Impact:** a probe validating the "Circle wallet as x402 payer" architecture failed on a payload copied field-for-field from Circle's own x402-batching SDK; decoding "(0 < 4)" into "declare the domain type" took a debugging round-trip. Any adapter bridging Circle wallets into `BatchEvmScheme` must now inject `EIP712Domain` into `types` before every call.
- **Suggestion:** either accept payloads without `EIP712Domain` (infer from `domain`, like viem/ethers), or return a message that says "types must declare EIP712Domain matching the domain fields". Aligning with the shape `@circle-fin/x402-batching` emits would make the two Circle SDKs composable out of the box.
- **Date:** 2026-07-02

### Entity secret errors never say it's account-global or where it was registered
- **Area:** SDK / Docs (developer-controlled wallets)
- **What happened:** registering an entity secret returned 409 code 156015 `The secret for this entity has already been set`, then signing with a freshly generated secret returned 400 code 156013 `The provided entity secret is invalid`. The secret had been registered months earlier by a different project on the same Circle account; nothing in either error, the console, or the quickstart says the entity secret is one-per-account (not per-project/per-API-key), or gives any hint where/when one was already registered.
- **Impact:** a second project on the same account walks the documented "generate + register" quickstart and hits a dead end twice, with the fix (dig the original secret out of the first project's env) discoverable only by remembering the account's history.
- **Suggestion:** make the 409 say "an entity secret was registered on <date>; reuse it or reset via the recovery file (Configurator -> Entity Secret)", and state clearly in the quickstart that the secret is account-wide and every project must share it.
- **Date:** 2026-07-02
