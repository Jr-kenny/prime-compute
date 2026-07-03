# Marketplace clarity and wallet completeness

**Status:** approved design, ready for planning.

## Why

The marketplace works but leaves people guessing in a handful of places. Renters can't see a
human-readable rate (only the streaming per-second/per-unit figure), the landing page carries
fabricated stats and testimonials, the in-app docs describe an older single-service product, the
in-app logo doesn't match the lantern brand, `/register` strands you with no navigation, the wallet
is hard to find on the dashboard, autonomous agents have no way to withdraw funds they overfunded,
and the provider dashboard implies a payout flow that doesn't exist. On top of that there's no real
guide teaching a provider how to list a real service or a renter how to actually use one.

This is one polish pass that closes those gaps. No new subsystems, no schema migrations beyond what
the wallet work already supports.

## Wallet model (the ground truth this builds on)

Three distinct wallets exist, and the confusion this spec clears up comes from conflating them:

1. **Identity wallet** - the external wallet a person connects via RainbowKit + wagmi and proves with
   SIWE. `walletAddress` rides in `user_metadata.wallet_address`. Self-custodied; we never hold its key.
2. **Spend wallet** - a Circle developer-controlled wallet (`WALLET_BACKEND=circle`) the platform
   custodies per principal. Users fund it and pay rents from it; the existing `withdrawFromSpendWallet`
   handles the Circle `createTransaction` path. Agents get the same machinery in `agent_wallets`.
3. **Provider seller wallet** - when someone lists a server they run their own x402 seller at the
   `endpointUrl` they registered; payments land in that server's own address off-platform. The platform
   never holds provider earnings and there is no `provider_wallets` table. `ownerWallet` is set to the
   provider's identity wallet for attribution only.

Consequences that drive the design: providers self-custody, so there is nothing for the platform to
"pay out" (informational only). Agents hold a real custodied balance with no exit, so they need a
withdraw endpoint symmetric to the user one.

## The nine changes

### 1. Human-readable rate ($/day and per-unit)

A pure module `src/lib/pricing/rate.ts` turns a provider's `pricePerCharge` plus its service descriptor
into a display string, keyed off the descriptor's `metering` and `unit`:

- **time** (GPU, CPU, Full Server, Worker): unit is per second, so `$/day = pricePerCharge * 86400`.
  Show `$X.XX / day` alongside the existing per-second streaming figure.
- **VPN** (per GB): no fixed daily cost without assuming usage, so show `$X / GB` with a concrete
  example line `≈ $Y per 100 GB` (pricePerCharge * 100). No invented per-day number.
- **Storage** (per GB-hour): show `$X / GB-day` = `pricePerCharge * 24`, since a day of holding a GB is
  a real, honest figure.

The function is fully unit-tested (one case per metering kind, exact arithmetic). It is rendered on:
- `ProviderCard` (marketplace grid),
- the marketplace detail page (`marketplace.$id.tsx`),
- the `RentSheet` summary,
- and the register form's pricing step as a live "≈ $X / day" (or per-unit example) readout that
  recomputes as the provider types the per-second/per-unit price. The streaming rate stays; this is
  additive so a human can reason about cost.

### 2. Landing page: remove the false claims

In `src/routes/index.tsx`, delete the fabricated stats block (`12,847` providers online, `99.97%`
uptime SLA, `8ms` broker match time, `2.4M` rents completed) and both fake named testimonials (Kartik
Aggarwal / Bilt, Daniel Lobaton / G2X). Replace the section with honest content: a short "how it works"
strip (list a server -> broker matches -> stream USDC per unit) and real capabilities (six service
types, agent-native API, streaming settlement on Arc). Keep `$0.00001` minimum rate only if it is
actually the floor; otherwise drop it. No invented numbers anywhere.

### 3. In-app docs rewrite

Rewrite the six sections in `src/routes/docs.tsx` to match the real product:
- **Getting started** - connect wallet, fund the spend wallet, rent or list.
- **How pricing works** - per-unit streaming + the $/day and per-unit-example rendering from change 1;
  what a "charge" is; count-based budget.
- **The AI broker** - soul-driven matching over real listings.
- **Streaming payments** - x402 per-unit settlement on Arc, spend wallet, per-unit metering.
- **Service types** - the six types, their unit and connect payload (SSH creds, WireGuard profile,
  storage creds, worker submit URL).
- **API reference** - the real `/api/v1` REST surface and the MCP tools (see change 9).

### 4. In-app logo matches the favicon

A small `src/components/site/LanternMark.tsx` (or reuse an existing mascot component) renders the
lantern from `public/favicon.svg` as inline SVG at a nav-appropriate size. Replace the `Boxes` lucide
icon in `Sidebar.tsx` (two spots), `AppShell.tsx` mobile bar, and `Footer.tsx` with it. One mark,
brand-consistent everywhere.

### 5. Register page navigation

`/register` uses `PageShell`, which has no navbar, so there's no way back into the app. Add a slim top
bar to the register page with the lantern mark (links home) and a back-to-marketplace / go-to-dashboard
link, so a provider isn't stranded after or during listing.

### 6. Wallet discoverability

Add a persistent "Wallet" entry to the sidebar nav (`Sidebar.tsx` `navLinks`) that opens the existing
`WalletSheet`. Keep the dashboard balance chip as-is. The sheet already has balance/address/deposit/
withdraw/history, so this is purely making it reachable from a fixed, obvious place instead of only a
small chip that's easy to miss.

### 7. Agent withdraw endpoint (+ MCP tool)

Add a `POST` handler to `src/routes/api.v1.wallet.ts`: body `{ toAddress, amount }`, `authAgent` the
request, then withdraw from the agent's custodied wallet. It mirrors `withdrawFromSpendWallet`: query
`circle_wallets` for `owner_kind='agent', owner_id=<agent id>` and use Circle `createTransaction` when a
Circle wallet exists, else fall back to the raw signer via the agent's `SupabaseSpendWalletStore`
(`agent_wallets`). Reuse the same address/amount validation (0x40-hex address, positive USDC decimal).
Return `{ txHash }`. Add a `withdraw_funds` tool to the MCP server (`mcp/src/index.ts`) over the same
endpoint via `PrimeClient`, and document it. The withdraw logic that isn't HTTP-shaped goes in a small
service function so it can be unit-tested with injected deps.

### 8. Provider dashboard honesty

In `src/routes/provider.tsx`: reword the "Payout wallet" block to state plainly that provider earnings
are paid directly on-chain to the provider's own seller address (self-custody) and the platform never
holds them; show the attribution address (the registered `ownerWallet`) with that framing. Remove the
fake "Minimum payout" input (there is no payout system to have a minimum for). "Total earned" stays as
an informational sum of `rent.totalCost`, labelled as billed-to-renters volume, not a withdrawable
balance.

### 9. Real listing + renting guides, and a simulation badge on our own listings

Two audiences, real-world content:

- **Guides (in docs + contextual):** professional, real-world walkthroughs, written as if the compute
  is real (because for third-party providers it is - no mention of our simulation here):
  - *How to list a service* - run your x402 seller behind your `endpointUrl` (the provider server
    template), pick a per-unit price, register via the UI or `POST /api/v1/providers`, keep it online.
    Surfaced in the docs and as an info/notes panel on the `/register` page, and in the agent API docs
    for the endpoint/MCP path.
  - *How to rent and use a service* - rent via UI or `POST /api/v1/rents`, fund the spend wallet, then
    actually use what you get: SSH into compute with the returned creds, load the WireGuard profile for
    VPN, mount storage creds, POST to a worker submit URL. This is the "how to drive a real car" guide,
    not "click ride on our simulator."
- **Simulation badge (our listings only):** on the marketplace, badge listings that are ours (first-
  party/seed) with a small "Simulation" tag so a renter can tell our demo boxes from real third-party
  hardware. Identify ours by `ownerWallet` matching a configured platform wallet (e.g.
  `PLATFORM_TREASURY_ADDRESS` and/or the seed owner wallets); a pure helper `isFirstParty(provider)`
  decides, unit-tested. Only our listings get the badge; real providers get none.

## Testing

- `rate.ts`: unit tests, one per metering kind, exact arithmetic (time $/day, VPN per-GB + per-100GB,
  storage $/GB-day).
- `isFirstParty`: unit tests (matches configured platform wallet -> true; a random wallet -> false).
- Agent withdraw service function: unit tests with injected Circle/raw deps (Circle path returns the
  Circle tx id; raw path signs a transfer; bad address/amount rejected); an authed 401-without-key check
  on the route.
- Everything else (landing, docs, logo, register nav, wallet sidebar entry, provider copy) is UI/content
  and verified in the browser preview: no console errors, the rate renders, the wallet opens from the
  sidebar, `/register` can navigate back, our seed listing shows the Simulation badge and a real one
  doesn't.

## Out of scope

No provider-side custodied earnings wallet (providers self-custody by design). No new DB migration
(agent withdraw reuses the existing `agent_wallets` / `circle_wallets`). No changes to the metering or
settlement engine. No rate-limiting/abuse hardening (documented future work, unchanged).
