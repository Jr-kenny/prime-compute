# Deploying the metering worker

The worker (`services/src/worker/index.ts`) is the always-on half of Prime Compute: it streams
real USDC charges for active leases whether or not anyone's browser is open. The web app (a
Cloudflare Worker) only reads/writes the registry; this process moves the money.

## Render (free tier)

Render's free tier is web-services only and spins down after ~15 min idle, so the worker ships a
`/health` endpoint and must be kept warm:

1. New Web Service, root `services/`, build `bun install`, start `bun run worker`.
2. Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SPEND_WALLET_ENC_KEY` (same value as the web
   app), `ARC_RPC_URL` (your Canteen endpoint), `ARC_CHAIN_ID`, `USDC_ADDRESS`, the `LLM_*` set
   (optional; deterministic ranker if absent), and `WORKER_*`/`PORT`.
3. Keep it warm: point an external pinger (cron-job.org / UptimeRobot, free) at
   `https://<service>/health` every ~10 min.

## Circle custody

With Circle-custodied wallets flipped on, the worker env additionally needs `CIRCLE_API_KEY`,
`CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_SET_ID`, `PLATFORM_TREASURY_ADDRESS`, and `USDC_ADDRESS`.
The web app needs the same set plus `WALLET_BACKEND=circle` so new users and agents are
provisioned Circle wallets (no private key ever touches our database). Keep
`SPEND_WALLET_ENC_KEY` in both runtimes until every legacy raw-key wallet is drained: the worker
resolves payers circle-first per lease and falls back to the enc-key store, so both backends
coexist during the transition.

Platform fees are provider-remitted: the renter pays the listed price, and each provider
remits its accrued fee from Gateway earnings to `PLATFORM_TREASURY_ADDRESS`, reporting
the tx to `POST /remittances` on the worker's public port. The worker verifies the
transfer on-chain (needs `ARC_RPC_URL` + `USDC_ADDRESS`) before stamping receivables, so
the endpoint needs no auth. `WORKER_FEE_PORT` is gone; nothing listens there anymore.

It is fully resumable: on restart it re-scans `running` leases and continues. `last_charged_at` plus
the persisted charge `seq` mean a restart never double-charges or skips, so the spin-down/restart
behaviour of the free tier is non-fatal.
