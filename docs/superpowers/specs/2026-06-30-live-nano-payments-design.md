# Live nano-payments: per-user wallets and the always-on metering worker

**Status:** approved (brainstormed 2026-06-30). Next: implementation plan via writing-plans. This is spec 1 of 2; spec 2 is `2026-06-30-real-compute-and-provider-onboarding-design.md`.

**One-line contract:** When a user rents compute, real USDC streams out of that user's own Arc wallet, one nano-charge at a time, metered by an always-on backend service that keeps charging whether or not the user is looking at the site, and the user's live wallet balance is visible on the dashboard and in Lumen and visibly drops as the meter runs.

This is the piece every earlier spec deferred. The Lumen spec said outright: "No real wallet-balance read... a real Arc/Circle balance read is a later, separate piece" and "No new always-on broker process, no on-chain payment streaming from the web app... the `services/` roundtrip scripts remain the only thing that streams real charges." This spec is that later piece.

---

## The gap today

Three things are missing, and they compound:

1. `createRent` ([src/lib/broker/server-fns.ts](../../../src/lib/broker/server-fns.ts)) inserts a `queued` rent row and nothing ever runs it. Rents sit queued forever. Nothing in `src/` calls `runRent`.
2. The "streaming spend" on the dashboard and in the rent sheet is a pure UI animation (`StreamingTicker` extrapolating price by elapsed time). No USDC moves. The whole settlement pipeline (`runRent`, the stream loop, `GatewaySettlementAdapter`) exists and is tested, but only inside the `services/` roundtrip scripts, which run in a long-lived Bun process. The live product has no home for that process.
3. There is no per-user wallet and no balance read anywhere. The passkey Circle Modular Wallet is identity only.

## Why a per-user EOA, and why a separate worker

The passkey smart account cannot be the payer. `GatewayClient` (the thing that makes nano-payments) only accepts a raw `privateKey` and builds an EOA via `privateKeyToAccount`; it has no signer-interface path. `modular-wallets-core` has no Gateway / EIP-3009 surface at all. A passkey smart account signs via WebAuthn in the browser and cannot produce the ECDSA EIP-3009 authorization Gateway settlement needs server-side. This was confirmed against Circle's own samples: [arc-nanopayments](https://github.com/circlefin/arc-nanopayments) uses a raw `BUYER_PRIVATE_KEY` EOA with `GatewayClient`, and [arc-commerce](https://github.com/circlefin/arc-commerce) uses server-side Circle Developer-Controlled Wallets. Neither pays from a passkey smart account. So the payer is a server-held key, the same shape the existing tested adapter already takes.

The meter is a loop: every tick, pay one nano-charge and check whether to stop. A serverless request/response backend has nothing running between requests, so it cannot host that loop. Renting compute is renting an instance: the user rents, gets credentials, leaves, and uses the compute from their own terminal. Billing has to continue after they close the tab. That requires something always alive. So the system splits into two backends.

---

## Architecture: two backends, one source of truth

1. **Web app (serverless, exists today).** UI and server functions. Reads and writes registry rows only. Renting creates a lease row. Pause/cancel flip a status. It reads balances and charges. It never moves money and never holds the meter loop.

2. **Metering worker (new, always-on).** A long-lived process that watches the registry for active leases and, per lease, runs the real meter: provision, then tick, paying one on-chain nano-charge per tick from that user's spend wallet, recording each charge, stopping on cancel / lease end / insufficient balance. This is the tested `runRent` / stream loop, finally hosted permanently.

The two communicate only through the Supabase registry. Supabase is the single source of truth, which is what makes the worker safe to restart: it holds no in-memory state that matters.

---

## Money model: per-user spend wallet

Each user gets a dedicated Arc EOA, generated and custodied server-side, created lazily the first time they need one (first balance view or first rent, whichever comes first). The passkey wallet stays login/identity only. The EOA is "your wallet" shown in the UI, and it is the wallet that streams the nano-payments. Per-user on-chain attribution is automatic because each user literally pays from their own wallet. This drops into the existing `GatewaySettlementAdapter` with a per-user key instead of one shared broker key.

---

## Components

Each component below is a unit with one job, a defined interface, and its own tests.

### 1. Spend-wallet store (`services/src/wallet/`)

New table `spend_wallets`:

```
spend_wallets(
  user_id uuid primary key references auth.users(id) on delete cascade,
  address text not null unique,
  enc_private_key text not null,   -- AES-256-GCM ciphertext, never plaintext, never leaves the server
  created_at timestamptz not null default now()
)
```

- RLS: no client policy. Service-role only. The encrypted key is never selectable by a browser client and never returned over the wire.
- `getOrCreateSpendWallet(userId)`: returns `{ address }`, generating a fresh EOA (`generatePrivateKey` from `viem/accounts`) on first call and persisting the encrypted key. Idempotent.
- `loadSigner(userId)`: server/worker-only. Decrypts and returns the viem account / raw key for the settlement adapter. Never exposed to a route the browser can reach.
- Encryption: AES-256-GCM with a key from `SPEND_WALLET_ENC_KEY` (server-only env, 32 bytes). One module (`crypto.ts`) owns encrypt/decrypt with their own unit tests (round-trip, tamper detection, wrong-key failure).

### 2. Balance read (`getSpendWalletBalance` server fn)

Input `{ accessToken }`, verified via `requireUser`. Returns `{ address, usdcAtomic, usdcFormatted, gatewayAvailableAtomic }`.

- Reads the EOA's USDC balance on Arc. `GatewayClient.getUsdcBalance(address)` and `getBalances(address)` both accept an explicit address, so a single read-only client (built with any key) can read any user's balance. We read the user's spend-wallet address.
- "Gateway available" is the portion already deposited into Circle Gateway and ready to stream; "USDC" is the EOA's spendable balance. Both shown.
- Polled by the UI (React Query, short interval) so it visibly drops as the meter runs.

### 3. Deposit

No new chain write. Funding the wallet means sending USDC to the EOA address. The UI shows the address, a QR code, and a link to the Circle testnet faucet. When a lease needs Gateway balance, the worker calls `ensureFunded`, which moves EOA USDC into Gateway automatically. The user only ever deals with "put USDC in my wallet."

### 4. Withdraw (`withdrawFromSpendWallet` server fn)

Input `{ accessToken, toAddress, amount }`, verified via `requireUser`. Loads the signer, signs an ERC-20 USDC `transfer` from the EOA to `toAddress` on Arc, returns the tx hash. Guards: amount must be a positive value within the current EOA balance; `toAddress` must be a valid address; never withdraws Gateway-locked funds without surfacing that they are locked. So money is never trapped in the custodial wallet.

### 5. Wallet UI

- **Dashboard header / billing tab:** live balance card (USDC + Gateway available), spend-wallet address with copy.
- **Lumen:** a real balance line in place of the removed fake one.
- **New Wallet surface** (a route or a sheet, following the existing tile/sheet pattern): balance, address + QR, deposit panel (address + faucet link), withdraw form, and spend history.
- **Spend history:** a transactions list built from the per-rent `charges` already recorded in the registry, grouped by rent, showing settled vs pending.
- **Low-balance warning:** wire the "Low balance" notification already stubbed in the dashboard settings. The UI warns when the balance would not cover a chosen runway; the worker also flags it (see suspended state).

### 6. Metering worker (`services/src/worker/`)

A standalone Bun entrypoint (`worker.ts`) hosting a small HTTP server (so Render treats it as a web service) and the meter loop.

- **`GET /health`:** returns 200 with a heartbeat. An external pinger (cron-job.org / UptimeRobot, free) hits it every ~10 min so Render's free web service does not spin down.
- **Provision pass:** find `queued` leases. For each: `matchProviders` (using `liveBrokerDeps`, which falls back to the deterministic ranker if the model is down), `revalidateProvider` guard, `recordDecision`, build the per-user settlement adapter, `ensureFunded` from the user's spend wallet for the lease's safety bound, flip to `running`, set `startedAt`. A lease that cannot be funded goes to `suspended`, not `failed`.
- **Meter pass:** for each `running` lease, on each ~1s tick, `payForCompute(provider.endpointUrl)` through the per-user adapter, `recordCharge`, advance `seq`, bump `totalCost`, and stamp `last_charged_at`. This reuses `runRent` / `streamWithMigration` for the matching, migration-on-degrade, and health logic already tested; the worker is the long-lived host those functions were written for.
- **Stop conditions:** the web app flipped the lease to `paused`/`cancelled` (honored on the next tick); `estimatedUsage` / lease cap reached (`completed`); the spend cap or on-chain balance cannot cover the next charge (`suspended`, with a flag the UI surfaces so the user can top up and resume).
- **Resumability:** the worker holds no durable state. On boot it re-scans `running` leases and resumes metering them. `last_charged_at` plus the monotonic `charges.seq` make a restart neither double-charge nor skip: the worker only charges when `now - last_charged_at >= tick`, and `recordCharge` is keyed on `(rentId, seq)`. If Render bounces the service, billing self-heals on the next boot.

### 7. Per-user settlement adapter

`GatewaySettlementAdapter` already takes `{ privateKey, capAtomic, chain }`. The worker builds one per lease (or per user) from `loadSigner(userId)`, with `chain: "arcTestnet"` and a per-lease `capAtomic` derived from `estimatedUsage` and the provider price. No change to the adapter's deterministic spend guard; we just feed it the user's key instead of the shared broker key.

### 8. Lease lifecycle fix and real status

- Status flow becomes `queued -> running -> (paused <-> running) -> completed | cancelled | failed | suspended`. `suspended` is new (balance stall, recoverable). `rent-transitions.ts` gains `suspended` handling and a resume-from-suspended path; its existing `canPause/canResume/canCancel` guard the UI as today.
- The dashboard's streaming number reads real recorded charges (`rentCost` / `listCharges`) instead of UI extrapolation. The `StreamingTicker` stays only as visual smoothing between polls of the real number, never as the source of truth.
- **Connect credentials:** the running-lease detail surfaces the provider's `endpointUrl` and a per-lease access token, so "rent, then use it elsewhere" is not a dead end. The endpoint here is the seed provider we host (see Seed provider below). Real provisioning and SSH come in spec 2.

### 9. Seed provider

So the meter pays something real, we host one first-party provider: the existing x402 seller (`services/src/provider/server.ts` + executor) deployed on infra we own, registered in the registry like any provider (`endpointUrl`, `ownerWallet`, specs). It returns a real, connectable endpoint and takes real x402 payment. It stays simulated compute for now; spec 2 swaps in a real sandbox behind the same interface.

---

## Schema changes

- New `spend_wallets` table (above).
- `rents`: add `last_charged_at timestamptz`, `lease_access_token text`, and add `suspended` to the status check.
- `charges`: unchanged (already keyed for idempotent per-seq recording).
- New migration file under `services/supabase/migrations/`, following the existing numbered pattern.

## Security

- Private keys are AES-256-GCM encrypted at rest under `SPEND_WALLET_ENC_KEY`; plaintext keys exist only transiently in the worker/server when signing.
- The encrypted key column has no client RLS policy and is never returned by any server function. `withdraw` and balance reads return only addresses, amounts, and tx hashes.
- Per-lease spend cap via the adapter's existing `checkSpend` guard, plus the on-chain balance stop. A runaway meter cannot drain past the cap or past the wallet.
- These are testnet custodial keys; the encryption and the no-export rule are the floor, and the design note is that production custody would move to a KMS/HSM or Circle Developer-Controlled Wallets (which would need a signer-interface adapter Gateway does not offer today).

## Environment

- New: `SPEND_WALLET_ENC_KEY` (server + worker).
- Worker reuses: `ARC_RPC_URL`, `ARC_CHAIN_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the `LLM_*` set for ranking (with deterministic fallback). The shared `BROKER_WALLET_PRIVATE_KEY` is no longer the payer; it may remain only for the seed provider's own funding if needed.

## Hosting and ops

- Worker runs as a Render free **web service** (free tier covers web services, not background workers), kept awake by an external pinger every ~10 min against `/health`.
- Caveats designed around: free web services spin down on inactivity and the account has a monthly instance-hour cap, and Render can restart/redeploy. The worker's resumability (re-scan `running` leases on boot, idempotent per-seq charges) is what makes those caveats non-fatal.

---

## Testing

- `crypto.ts`: encrypt/decrypt round-trip, tamper detection, wrong-key failure.
- `spend_wallets` store: get-or-create idempotency, no-plaintext-leak.
- Balance read and withdraw: guard rejection (over-balance, bad address), happy path against a fake chain client.
- Worker meter: provision a `queued` lease, tick produces real recorded charges (against `FakeSettlementAdapter` + `InMemoryRegistry`), honors pause/cancel, suspends on insufficient balance, and on simulated restart resumes without double-charging or skipping a seq.
- Lifecycle: `rent-transitions` with the new `suspended` state.
- Extend `services/scripts/integration-roundtrip.ts` to fund and pay from a per-user spend wallet end to end on Arc testnet.

## Scope

**In:** per-user spend wallets (create/balance/deposit/withdraw), the always-on metering worker, real per-lease nano-charges, the `queued -> running -> done` lifecycle fix including `suspended`, the wallet UI, connect credentials surfaced on a running lease, and one seed provider.

**Out (spec 2):** a real sandboxed compute backend (CF Sandbox / e2b / Fly), provider self-onboarding so outside users list their own machines, and real SSH/API provisioning. The financial spine here does not depend on which compute platform we pick later; the meter pays a real endpoint regardless of what is behind it.
