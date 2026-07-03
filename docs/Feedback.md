# Circle developer tooling: my feedback log

This is my running log of the friction I hit building Prime Compute on Circle's stack
(Nanopayments / x402 / Gateway / Arc / Modular Wallets / Agent Stack). I kept it as I built so the
feedback would be concrete and dated instead of reconstructed from memory at the end. Each entry is
a real thing that slowed me down or caught me out, with the exact URL, error, or missing piece so a
Circle engineer can actually act on it. Newest sit near the bottom; I've left the dates on so you can
see the order I ran into them.

---

## Nanopayments docs explain the model but not the SDK

Area: Docs / Nanopayments - 2026-06-28

The nanopayments page (`https://developers.circle.com/gateway/nanopayments`) does a good job
explaining the idea: batched settlement, x402, EIP-3009. What it doesn't show is the actual code
surface. I only figured out that the package is `@circle-fin/x402-batching`, the middleware is
`createGatewayMiddleware`, and the facilitator endpoint is `POST /v1/x402/settle` by reading the demo
repos (`circlefin/arc-nanopayments`, `the-canteen-dev/circle-agent`). Reverse-engineering the
integration off example repos is slower than it needs to be, and it's easy to miss the right package
entirely. I'd love a "build it" section right on the concept page: the package name, the seller
middleware, the buyer signing flow, the settle endpoint, one minimal framework-agnostic example.

## Getting basic Arc network config takes too many hops

Area: Arc / Docs - 2026-06-28

`https://docs.arc.network/` 301s to `https://docs.arc.io/`, and the landing page is a nav hub with no
concrete config on it. Chain id, RPC URL, faucet, Gateway contract addresses: none of it is on the
entry page, so I had to dig through "Connect to Arc", the contract addresses page, and `llms.txt` to
piece it together. The single most-needed thing to start (chain id + RPC + faucet) should be one
click from the docs home. A copy-pasteable network config block on the landing page would have saved
me the scavenger hunt.

## Not clear whether agent buyers support tool-calling

Area: Agent Stack / Nanopayments - 2026-06-28

The agent-stack and nanopayments docs talk about autonomous buyer agents but never say whether (or
which) model interfaces support tool-calling for the actual buy decision, and the only example is
LangChain + Deep Agents, OpenAI-flavored. I'm not on LangChain, so I had to infer the integration
instead of following a documented pattern. A framework-agnostic "autonomous buyer" example, plain
fetch or SDK, showing the x402 retry-with-authorization loop without any agent framework, would make
this land for everyone.

## x402-batching peer deps aren't installed or flagged

Area: SDK / x402 / Gateway - 2026-06-28

`@circle-fin/x402-batching@3.2.0` lists `@x402/core` and `@x402/evm` as peerDependencies with no
`dependencies`. Install just the Circle package, run it, and it throws at runtime with
`Cannot find module '@x402/evm/exact/server'`. You only find the two `@x402/*` peers by reading the
package's own `package.json`. The confusing part is the module-not-found doesn't even name Circle's
package, so it reads like something's broken on your end. Either depend on those two directly, put a
loud "also install these peers" line at the top of the quick start, or fail with a friendly "install
@x402/core and @x402/evm" instead of a raw module error.

## Batched settlement returns a UUID where I expected a tx hash

Area: x402 / Gateway - 2026-06-28

On the seller, `req.payment.transaction` (named and typed like it's a settlement tx hash) actually
returns a settlement UUID like `3f14c4dd-...`, because settlement is batched and `submitBatch` lands
async. `deposit`, by contrast, hands back a real immediate `depositTxHash`. I naively built
`${explorer}/tx/${transaction}` and got a dead link, and it's easy to assume settlement failed when
it's just batched. I'd name or type that field so it reads as a settlement reference for batched
payments, or expose both the UUID and the eventual batch tx hash once it lands, and say so in the
lifecycle-hooks docs.

## GatewayClient doesn't compose with Circle's own developer-controlled wallets

Area: SDK / x402 / Gateway - 2026-06-28

The buyer `GatewayClient` (`@circle-fin/x402-batching/client`) only takes `privateKey: Hex`. The
lower-level `BatchEvmScheme` does accept a `BatchEvmSigner` (`{ address, signTypedData }`), which a
Circle developer-controlled wallet could satisfy, but `GatewayClient`, the thing that actually has
`deposit()` and the full 402 `pay()` flow, gives you no way to pass a custom signer. And `deposit()`
is an on-chain approve+deposit that needs a transaction sender, not just a typed-data signer. So you
can't drive the batching buyer flow with Circle's own wallet product without abandoning
`GatewayClient` and reimplementing deposit plus the 402 retry loop around `BatchEvmScheme` +
`x402Client` yourself. Two Circle products that should compose don't, on the buyer side. Letting
`GatewayClient` accept a `signer: BatchEvmSigner` as an alternative to `privateKey`, with a documented
deposit path that works with a developer-controlled wallet, would make "autonomous agent on a Circle
wallet paying via x402" a first-class path.

## Spend-guard abort comes back as an untyped string error

Area: SDK / x402 - 2026-06-28

Register a guard via `onBeforePaymentCreation`, return `{ abort: true, reason }`, and `pay()` throws a
generic `Error("Payment creation aborted: <reason>")`. There's no typed error class, so to tell "my
guard stopped this" apart from any other failure I had to string-match the message. I ended up
stashing the last abort reason and rethrowing my own `SpendCapError` around `pay()`. The whole point
of the hook is programmatic control of the spend guard, and string-matching an error message is the
only built-in way to react to it. A typed error, `PaymentAbortedError` with a `.reason` field, would
let callers `instanceof`-check it.

## No confirmation signal or stated latency for when a batched payment settles

Area: x402 / Gateway / Docs - 2026-06-28

Across three separate live runs on Arc testnet, every `pay()` left `getTransferById(transferId)` at
`status: "received"`, `settled: false`, and the batch never flipped inside the script's runtime.
There's no documented settlement latency, the `TransferStatus` enum
(`received | batched | confirmed | completed | failed`) isn't explained (which one means the money
actually landed?), and there's no webhook or event to learn when a batch settles. So reconciliation
comes down to "poll `getTransferById` and hope." I can pay successfully but have no reliable,
documented way to know when it settled, which makes correct reconciliation guesswork. Document each
`TransferStatus`, give a rough settlement-time expectation, and offer a settlement webhook (or a clear
terminal status to poll for).

## pay() connection failures don't say which URL couldn't be reached

Area: x402 / Gateway / SDK - 2026-06-29

On a live Arc-testnet run, `GatewayClient.pay(url)` threw
`Error: "Unable to connect. Is the computer able to access the url?"` from inside
`@circle-fin/x402-batching/dist/client/index.mjs`. `pay()` talks to two endpoints, the x402 resource
URL I pass in and the Gateway facilitator it settles through, and the error names neither, carries no
`cause`, no status, no host. My provider was a local server that was definitely up and had served
payments seconds earlier, so the unreachable side was almost certainly Gateway, but I couldn't confirm
that from the error. Same run, `getTransferById` reported all four prior charges unsettled after 90s of
polling, so Gateway did look degraded right then. A transient Gateway blip is indistinguishable from
"your resource URL is wrong," and diagnosing it cost me multiple real-money testnet runs. Put the
failing URL (or at least "resource" vs "gateway") and the underlying `cause` on the error, ideally a
typed `GatewayConnectionError` with `.url` / `.phase`.

## Modular Wallets don't slot into standard wallet auth

Area: Modular Wallets / SDK / Docs - 2026-06-29

Designing passkey login on Circle Modular Wallets, the obvious path was a standard Sign-In-with-Ethereum
/ EIP-4361 provider (Supabase's built-in Web3 auth and most off-the-shelf wallet-auth providers work
this way). It doesn't work. A Modular Wallet is a passkey-controlled smart-contract account that signs
via ERC-1271 with a P-256 passkey, not an EOA ECDSA secp256k1 signature, and EIP-4361 providers verify
ECDSA only. On top of that the account is counterfactual (not deployed until the first user op), so even
an ERC-1271-aware verifier has to handle the undeployed case via ERC-6492. Net: none of the common SIWE
building blocks work, and you have to roll your own nonce + signature verification with an ERC-6492-aware
verifier (viem's public-client `verifyMessage`) before you can mint a session. "Add wallet login" is a
much bigger lift than it looks, because the ecosystem's standard integrations assume EOAs, and it's easy
to get halfway down the SIWE path before you hit the mismatch. Call this out loudly in the Modular
Wallets auth docs, and ship a helper or recipe for "prove control of a Modular Wallet to my backend"
that handles the counterfactual ERC-6492 case.

## "Cannot find the entity config in the system" really means "you didn't set a passkey domain"

Area: Modular Wallets / SDK / Console - 2026-06-29

Building passkey onboarding, the wallet-creation call (the `toCircleSmartAccount` flow) failed with
`An unknown RPC error occurred. Details: Cannot find the entity config in the system.` Nothing in that
points at the cause. I suspected the chain first (I was on `arcTestnet`), switched to `baseSepolia`, got
the identical error, so the chain was ruled out. The actual cause: only the Client Key's Allowed Domain
was set in the console; the separate Passkey Domain Name wasn't. Set the passkey domain to `localhost`
and the exact same code worked first try on both chains. The error text sends you chasing chain support,
client URL, key validity, when the real fix is a one-field console setting, and "entity config" isn't
vocabulary the setup docs use so you can't grep back to the missing step. Make the error name the
missing config: "No passkey domain configured for this client key (set the Passkey Domain Name to match
the Allowed Domain)," ideally surfaced at SDK init rather than deep in the smart-account RPC call.

## A passkey Modular Wallet can't be the x402 payer, so every user needs a second wallet

Area: Modular Wallets / x402 / Gateway - 2026-06-30

I wanted each user to stream their own USDC nano-payments from the same wallet they log in with, their
passkey Modular Wallet. It can't be done. The buyer `GatewayClient` only takes a raw `privateKey`, and
`@circle-fin/modular-wallets-core` exposes no Gateway / EIP-3009 surface at all. A Modular Wallet signs
via WebAuthn/P-256 in the browser and can't produce the ECDSA EIP-3009 `TransferWithAuthorization` that
Gateway settlement needs server-side. I confirmed against Circle's own samples that this is the intended
shape: arc-nanopayments uses a raw `BUYER_PRIVATE_KEY` EOA, arc-commerce uses server-side
developer-controlled wallets. So I had to generate and custody a separate per-user EOA spend wallet just
to stream payments, keep the Modular Wallet as identity only, and move funds between the two. "Users pay
from their own wallet" turns into "give every user a second custodial EOA, encrypt its key, and build a
transfer step between their identity wallet and their spend wallet." That's real custody surface no one
wants in a hackathon build, and it cuts against the seedless value prop of Modular Wallets. Give me a
first-class path to pay x402 from a Modular Wallet: a Gateway/x402 adapter that accepts the smart account
+ bundler, or a documented user-operation recipe that does the deposit + batched authorization.

## No "which chains do Modular Wallets support" list; I confirmed it by grepping a d.ts enum

Area: Modular Wallets / Docs - 2026-06-30

Before moving my onboarding to Arc, I wanted to confirm Modular Wallets actually support Arc testnet,
since an earlier Arc attempt had errored. There's no obvious supported-chains list in the docs. I ended up
confirming it by grepping the installed SDK types and finding `ContractAddress.ArcTestnet_USDC = 0x3600…`
in `index.d.ts`. "Is chain X supported?" is a basic, blocking question when you're picking a chain, and the
answer shouldn't live in a buried enum, especially when a misconfigured passkey domain throws an unrelated
"entity config" error on that same chain and makes you think it's unsupported. Publish a plain
supported-chains table for Modular Wallets (chain name, transport URL segment, USDC address) and expose it
from the SDK programmatically.

## No recipe for sending a plain USDC transfer from a Modular Wallet

Area: Modular Wallets / SDK / Docs - 2026-06-30

To move USDC from a user's Modular Wallet to their spend wallet I had to wire the smart account to a viem
`createBundlerClient` and `sendUserOperation` myself. The SDK ships the pieces
(`toCircleSmartAccount`, the modular transport, `getUserOperationGasPrice`) but there's no end-to-end
"send a token transfer from a Modular Wallet" example, and the gas-price helper returns string tiers
(`low/medium/high`) that don't drop into viem's `estimateFeesPerGas`, which wants bigints. Whether gas is
paymaster-sponsored on Arc or the account needs funding isn't stated either, so the simplest send is
guesswork until you test on-chain. A basic "let the user send USDC" feature becomes ERC-4337 plumbing plus
trial-and-error. Ship a copy-pasteable recipe including the bundler wiring, the gas-price to fees
conversion, and a clear statement of paymaster behaviour per network, especially Arc.

## Faucet API returns a bare 403 for developer-controlled wallets on Arc

Area: API (faucet, developer-controlled wallets) - 2026-07-02

`client.requestTestnetTokens({ address, blockchain: "ARC-TESTNET", usdc: true })` (the SDK wrapper for
`POST /v1/faucet/drips`) returned a bare 403 with no body, for an API key that can create wallets, sign,
and execute contracts on Arc testnet just fine. I couldn't tell whether the faucet doesn't support Arc,
isn't enabled for my key tier, or needs a console toggle, and the faucet docs don't list supported
blockchains. It means an end-to-end "Circle wallet funds Gateway and pays an x402 charge" test dead-ends at
funding: everything else automates through the SDK, but getting the first testnet USDC in needs a human at
faucet.circle.com, so CI or an agent can't run the proof unattended. Return a reason with the 403
(unsupported chain vs key permissions), document which chains the faucet supports, and ideally support Arc,
since Circle's own stack targets it.

## Insufficient-balance error on contractExecution doesn't say which asset or how much

Area: API (developer-controlled wallets, contract execution) - 2026-07-02

`POST /v1/w3s/developer/transactions/contractExecution` on an unfunded Arc wallet returned 400 code 155258
`the asset amount owned by the wallet is insufficient for the transaction`. It doesn't say which asset (the
USDC being approved? the USDC-denominated gas Arc uses?), the required amount, or the wallet's balance. On
Arc, where gas is also USDC, "insufficient" is genuinely ambiguous between transfer value and fee, so I had
to look up the balance separately and guess which leg fell short before I knew how much to fund. The
estimation layer clearly knows all three numbers; put asset, required, and available in the error body.

## signTypedData rejects viem-style typed data with a cryptic count error

Area: SDK (developer-controlled wallets) - 2026-07-02

`POST /v1/w3s/developer/sign/typedData` returned 400 code 156026,
`error: there is extra data provided in the message (0 < 4) ... Failed during the validation for typed
data`, for a payload viem and ethers both accept as-is. The real problem: Circle's validator requires
`EIP712Domain` to be declared explicitly in `types`, and viem-style payloads (and Circle's own
x402-batching `BatchEvmSigner` interface) omit it because it's inferable from the `domain` object. Nothing
in the error names `EIP712Domain`, and the SDK's own signTypedData example omits it too. So a probe
validating "Circle wallet as x402 payer" failed on a payload copied field-for-field from Circle's own
x402-batching SDK, and decoding "(0 < 4)" into "declare the domain type" cost me a debugging round-trip.
Any adapter bridging Circle wallets into `BatchEvmScheme` now has to inject `EIP712Domain` before every
call. Either accept payloads without it (infer from `domain`, like viem/ethers) or say "types must declare
EIP712Domain matching the domain fields." Aligning with what `@circle-fin/x402-batching` emits would make
the two SDKs composable out of the box.

## Entity secret errors never say it's account-global or where it was registered

Area: SDK / Docs (developer-controlled wallets) - 2026-07-02

Registering an entity secret returned 409 code 156015 `The secret for this entity has already been set`,
and then signing with a freshly generated one returned 400 code 156013 `The provided entity secret is
invalid`. The secret had been registered months earlier by a different project on the same Circle account,
and nothing in either error, the console, or the quickstart says the entity secret is one-per-account, not
per-project or per-API-key, or hints where it was already registered. So a second project on the same
account walks the documented "generate + register" quickstart and dead-ends twice, and the fix (dig the
original secret out of the first project's env) is only findable if you remember the account's history.
Make the 409 say "an entity secret was registered on <date>; reuse it or reset via the recovery file," and
state clearly in the quickstart that the secret is account-wide and every project shares it.

## Gateway withdraw fee isn't documented or queryable before you try it

Area: SDK (`@circle-fin/x402-batching` GatewayClient) - 2026-07-02

`gateway.withdraw()` on Arc testnet charges a same-chain fee of ~0.0035 USDC, but nothing exposes that
number up front: no `estimateWithdrawFee`, no constant in the SDK, and the docs only mention the `maxFee`
cap (default 2.01 USDC). The only way I learned the real fee was attempting a withdraw and parsing it out
of the insufficient-balance error (`available 0.002300, required 0.003501` when withdrawing 0.000001). Any
accrue-then-remit design has to pick its remittance threshold blind. I shipped a $0.01 default, found out
from a failed live run that the fee is 35% of that, and recalibrated to $0.10. An agent can't budget fees it
can't query. Expose a fee quote (an `estimateWithdrawFee()` or a field on `getBalances()`), and document the
typical same-chain fee next to `maxFee`.

## Gateway deposit credits minutes after the tx confirms, with no status to poll

Area: SDK (`@circle-fin/x402-batching` GatewayClient) - 2026-07-02

`gateway.deposit("0.05")` returned a confirmed `depositTxHash` immediately, but `getBalances()` kept
reporting the old available balance for a couple of minutes until Circle's attestation credited it. Nothing
in the deposit result or the balances object says "pending attestation": the deposit just looks lost until
it suddenly isn't. Scripts that deposit-then-spend have to hand-roll a polling loop against `getBalances()`
with a guessed timeout, because there's no pending-deposit state to watch and no documented attestation
delay. Surface in-flight deposits in `getBalances()` (a `pendingDeposit` bucket, like the `withdrawing` one
that already exists for the other direction), or document the delay and a recommended polling pattern.

## w3s-pw-web-sdk needs a full Node polyfill set to load in the browser, and crashes at import without it

Area: SDK (`@circle-fin/w3s-pw-web-sdk`, the user-controlled Web SDK) - 2026-07-02

A plain `import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk"` in a Vite app throws at module init:
`TypeError: Cannot read properties of undefined (reading 'from')` (safe-buffer reading
`require('buffer').Buffer`, which Vite externalizes to `undefined` in the browser). Fix buffer and the next
one surfaces: `TypeError: Object prototype may only be an Object or null: undefined` from `util.inherits`
inside the SDK's bundled `jsonwebtoken`/`jws` stream code. The Web SDK drags jsonwebtoken (and its
safe-buffer / crypto-browserify / readable-stream chain) into the browser, so it needs
buffer/crypto/stream/util/events/process all polyfilled with correct CommonJS interop. You can't just
install and import it in a modern bundler; you have to add `vite-plugin-node-polyfills` before it will even
evaluate. It's worse in an SSR framework (I'm on TanStack Start / nitro / Cloudflare): the global polyfill
that fixes the client then breaks the server build, because the same jsonwebtoken chain gets shimmed into
SSR (`node:buffer is not exported by .../shims/buffer`), and scoping the polyfill to the client only is
fiddly because the plugin works through Vite's global `config` hook, not per-environment hooks. Ship a
browser-native build that doesn't pull jsonwebtoken/node-stream into the client (WebCrypto + a browser JWT
decoder), or document the exact polyfill setup including an SSR-safe, client-only config for Vite / Next /
TanStack Start. Right now the happy-path import is a landmine. (Postscript: I've since dropped the Web SDK
entirely and moved login to wallet-connect + SIWE, which let me delete this whole polyfill apparatus.)

## The Web SDK's OTP/PIN modals ignore the host app's theme

Area: SDK (user-controlled wallets, w3s-pw-web-sdk) - 2026-07-03

The email-OTP verification modal and the PIN screens render as a fixed white card. My app is dark-themed, so
the modal glows in the middle of it. The SDK exposes `setThemeColor`-style accent customization but there's
no dark mode and no way to restyle the modal surface to match the host. The single most user-visible step of
onboarding looks like a third-party popup instead of part of the product, which is exactly where users bail
on a custody flow. Support a dark theme (or arbitrary background/foreground tokens) in the ChallengeUI
customization, or offer a headless mode where the host app renders the inputs and the SDK just does the
crypto.

## OTP verification fails in production with no error surfaced anywhere

Area: SDK (user-controlled wallets, w3s-pw-web-sdk) - 2026-07-03

On the deployed app (primecompute.vercel.app) the user enters the emailed OTP correctly and the flow just
fails: the SDK's error callback delivers nothing actionable, and nothing shows in the modal either, it fails
closed. The exact same flow worked on localhost with the same App ID. That's a production login outage with
zero diagnostics: I couldn't tell if the deviceToken expired, the code got consumed by a retry, the App ID
rejects the origin, or something else. Debugging meant instrumenting every callback and guessing. Make the
verify failure return a structured error code + human message through the callback (and render it in the
modal), and document the OTP/deviceToken expiry and retry semantics. This one is a big part of why I moved
off the user-controlled Web SDK.

<!-- Add new entries above this line as I hit them during implementation. -->
