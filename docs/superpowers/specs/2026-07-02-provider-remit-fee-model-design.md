# Provider-Remit Fee Model (Settlement v2)

**Date:** 2026-07-02
**Status:** Approved design, awaiting implementation plan
**Supersedes:** the renter-side fee streaming of the Phase 1 fee model
(`2026-07-02-circle-custody-and-platform-fee.md`, Tasks 3-5)

## Why

The Phase 1 fee model has the renter's wallet make two x402 nano-payments per metering
tick: net to the provider, fee to the platform treasury. Economically the renter pays
exactly the listed price either way, but the shape is wrong on principle (user decision
2026-07-02): the platform fee should be taken out of the provider's received payment,
not billed as a separate outflow from the renter's wallet. Three constraints were locked:

1. The renter makes **one** payment per tick.
2. The platform never custodies provider funds.
3. Providers receive their earnings in real time.

On (3), the honest mechanics per Circle's own reference (`circlefin/arc-nanopayments`):
x402 batch settlement credits the **seller's Gateway balance**, not their wallet; wallet
USDC always requires an explicit `GatewayClient.withdraw`. "Real time" therefore means
real-time Gateway balance credit, which is identical in every model considered and
identical to today.

## The model

Provider lists gross (e.g. $0.0002/charge). Renter streams **gross** per tick, one x402
payment, directly to the provider's paywall. The provider's server accrues
`PLATFORM_FEE_BPS` (100 = 1%) of every payment it receives, and remits accrued fees to
the treasury **from its own Gateway earnings**:

```
Renter Gateway balance
        │  one x402 payment per tick (gross)
        ▼
Provider paywall  ──►  Provider Gateway balance
                              │  gateway.withdraw(accruedFee, { recipient: TREASURY })
                              ▼
                        Platform treasury (on-chain USDC, mintTxHash)
```

`GatewayClient.withdraw(amount, { chain, recipient })` pays out from the Gateway balance
to any recipient, signed by the provider's key (verified in arc-nanopayments
`app/api/gateway/withdraw/route.ts`). The fee moves from the earnings pool straight to
the treasury without ever mixing with the provider's wallet funds. This is the most
literal available form of "the fee comes from the payment."

### Remittance cadence

Withdraw is an on-chain transaction (needs gas on Arc; arc-nanopayments pre-checks the
native balance), so remittance is **threshold-based, never per-tick**: remit when accrued
fees reach `FEE_REMIT_THRESHOLD_ATOMIC` (default 10\_000 = $0.01), plus a flush on
graceful shutdown. Accrual state is in-memory only: an unremitted balance lost to a
crash is not lost money, it is an outstanding receivable the platform ledger already
tracks per charge, and the next remittance (or a restart-time query of the provider's
outstanding receivables) covers it.

## Ledger semantics (platform side)

`charges.fee_amount` stays but becomes a **receivable**: the meter computes it as
`floor(paidAtomic * feeBps / 10_000)` of the gross the renter paid. `fee_settlement_ref`
now stamps the remittance tx hash instead of a renter-side fee payment ref.

New platform remittance endpoint (worker-hosted, like the old fee endpoint but unpaid):
`POST /remittances { providerId, txHash, amountAtomic }`. The worker verifies the tx
on-chain via the Arc RPC (USDC `Transfer` to the treasury for that amount, from the
provider's withdraw path) and then stamps `fee_settlement_ref = txHash` on that
provider's **oldest outstanding charges, FIFO**, until the remitted amount is consumed.
Partial coverage of the last charge carries over as provider credit (simplest: only stamp
fully covered charges; the remainder stays outstanding and the next remittance covers
it).

A receivable-aging view (charges where `fee_amount > 0` and `fee_settlement_ref is null`,
grouped by provider, oldest first) makes non-remitting providers visible. Enforcement
beyond visibility stays scoped out, same as Phase 1: a dishonest endpoint yields zero fee
in both the old and new models, and the spec-2 provider verification handshake owns that
problem. The renter-side per-charge price ceiling (spend-policy `maxPerChargeAtomic`)
stays: it protects the renter regardless of fee model.

## Provider template changes

- The paywall demands the **listed price** again. `netPrice` and `platformFeeBps`
  net-pricing logic are removed from `createProviderApp`; `/health` drops `netPrice`.
- New remitter module in the template: taps the payment confirmations the gateway
  middleware already surfaces, accrues `feeBps` of each, and on threshold calls
  `gateway.withdraw(fee, { chain: "arcTestnet", recipient: treasury })`, then POSTs
  `{ providerId, txHash, amountAtomic }` to the platform remittance endpoint. Config:
  `PLATFORM_FEE_BPS`, `PLATFORM_TREASURY_ADDRESS`, `PLATFORM_REMIT_URL`, and
  `PROVIDER_ID` (new: the registered provider id, printed by the seed/registration flow,
  so remittances attribute to the right provider row even when one wallet owns several
  providers).
- A provider that doesn't run the remitter (self-hosted, dishonest or lazy) simply
  accrues visible receivables; nothing renter-facing breaks.

## What this retires

- The meter's per-tick fee payment (`feeBaseUrl` leg in `meterTick`).
- The worker's own x402 fee endpoint (`fee-app.ts`) as a *payment* target; its port can
  host the new remittance endpoint instead.
- The renter-side terminal fee sweep (`sweep.ts`): with no renter-side fee payments there
  is nothing renter-side to sweep. `rents.fees_swept_at` becomes unused (leave the
  column; don't drop).
- Circle wallet custody, the settlement adapters, the worker's payer resolution, and the
  funding path are all untouched: the renter still pays through the same
  `SettlementAdapter`, just once per tick and at gross.

## Hardening path (deferred): on-chain splitter

When real money or hostile providers matter, replace remittance-by-honesty with a
splitter contract: the paywall's `payTo` becomes a contract holding per-recipient
accounting (provider 98%, treasury 2%); provider and treasury withdraw their shares
(pull), or a keeper periodically pushes. ERC-20 transfers cannot trigger recipient code,
so true push-on-receipt is impossible; keeper gas on Arc (USDC) eats margin if run
per-tick. This is documented as the endgame, not built now.

## Testing

- Meter: one payment per tick at gross; `fee_amount` recorded as the bps receivable;
  no second `payForCompute` call (rewrites the Phase 1 meter fee tests).
- Provider template: remitter accrues per confirmed payment, remits at threshold via an
  injected `withdraw` seam, reports to an injected `remit` seam; below-threshold does
  nothing; shutdown flushes.
- Remittance endpoint + stamping: FIFO stamping consumes the remitted amount, partial
  last charge stays outstanding; unverifiable tx (wrong recipient/amount) records nothing.
- Receivable aging: outstanding fees grouped per provider.
- Live proof (gated): roundtrip where a renter streams N gross ticks, the template
  remits once, the treasury balance moves on-chain, and the charges stamp.

## Out of scope

- Enforcement/delisting of providers in arrears (visibility only).
- The splitter contract.
- Mainnet constants.
- Migrating already-recorded Phase 1 charges (their `fee_amount`/`fee_settlement_ref`
  semantics remain valid historical records).
