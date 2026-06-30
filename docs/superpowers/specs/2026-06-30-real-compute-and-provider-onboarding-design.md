# Real compute and provider onboarding

**Status:** approved (brainstormed 2026-06-30). Next: implementation plan via writing-plans, after spec 1 lands. This is spec 2 of 2; spec 1 is `2026-06-30-live-nano-payments-design.md`.

**One-line contract:** A rented instance is real, isolated compute the user can actually connect to and use from their own terminal, the meter from spec 1 pays for genuine work, and outside users can list their own machines as providers and get paid, not just the seed provider we host.

Spec 1 builds the financial spine: per-user wallets, the always-on meter, real on-chain charges, all paying one seed provider whose compute is still simulated. This spec makes the compute real and opens the supply side. The two are deliberately decoupled: the meter pays a provider endpoint regardless of what is behind it, so the platform choice here never blocks the money work.

---

## The two gaps

1. **No real compute and no way to connect.** The provider executor is `SimulatedExecutor`; it returns telemetry, not a machine. A rented lease has an endpoint but nothing a user can SSH into, run code on, or point an app at. The "rent it, get credentials, leave, use it" flow dead-ends.
2. **No way for providers to add their own resources.** `registerProvider` exists and the registry shape already fits a third party (`endpointUrl`, `ownerWallet`, specs), but there is no agent for a provider to run on their own box, no ownership/health verification, and no onboarding flow. Today supply is whatever we seed.

---

## Part A: real compute behind the provider seam

### The executor interface stays the seam

`services/src/provider/executor.ts` already defines the executor interface that the x402 seller server calls. Real compute is a new executor implementation behind that same interface, so the broker, the meter, and settlement do not change. We swap `SimulatedExecutor` for a `SandboxExecutor` and everything upstream is untouched.

### Backend choice

Three real options, picked when we reach this spec, none of them free but all designed to run arbitrary sandboxed workloads (so "the host does not inspect your workload" is the product, not an evasion of someone's terms):

- **Fly Machines**: real VMs/containers, can hand the user SSH. Closest to the "rent it like a VPS" vision. Most VPS-like, most infra to wire. Pure pay-as-you-go.
- **Cloudflare Sandbox / Containers**: a container per lease behind an HTTPS endpoint + token. CF-native (this app lives in that world; there is a `cloudflare:sandbox-sdk` skill). Great for "run code / call an API," less "SSH into a box." Requires the Workers Paid plan ($5/mo) plus usage-based CPU/memory billing; not free.
- **e2b**: code-interpreter sandboxes, simplest SDK, fastest to seed, small free hobby tier, but ephemeral and more code-exec than server.

Recommendation when we get here: **Fly Machines** if the product wants true "connect and keep using it like a server"; **Cloudflare Sandbox** if we want CF-native per-lease containers and accept the small paid plan. The decision is left open here on purpose and does not affect spec 1.

### Lease provisioning lifecycle

- **On provision (worker, spec 1's provision pass):** the `SandboxExecutor` creates a sandbox/machine for the lease, returns real connection info (host + key/token for SSH, or endpoint + token for an API sandbox). This is stored as the lease's `lease_access_token` / connection record that spec 1 already surfaces on the running-lease detail.
- **During the lease:** the meter charges per tick for the time the sandbox is held, exactly as spec 1 meters, except the provider endpoint now fronts real compute.
- **On stop (completed/cancelled/suspended):** the executor tears the sandbox down so a stopped lease stops costing real infra. Teardown is idempotent and runs on the worker's stop path.

### Isolation and the honest privacy line

Each lease gets its own sandbox/container, isolated from other users and from us. None of these platforms inspect the workload, so users get privacy from each other and from us. What is not achievable without confidential-compute / TEE hardware (which these tiers do not offer) is hiding the workload from the host machine itself; the design states that plainly rather than implying otherwise.

---

## Part B: provider self-onboarding

### Provider agent package

A small package an outside provider runs on their own machine: the existing x402 seller server (`services/src/provider/server.ts`) plus their chosen executor, configured with their wallet and price. This is what makes their box a rentable provider. Packaged so a provider can run it with their key and endpoint and nothing else.

### Claim and verify

`registerProvider` today trusts the caller. Real onboarding adds an ownership handshake:

- The provider proves control of `ownerWallet` (sign a nonce, the same pattern `src/lib/auth` already uses for user identity).
- The platform proves the `endpointUrl` is live and is actually running the agent (a challenge/response against the seller endpoint), before the provider is marked `online` and listed.
- Until both pass, the provider is `pending`, not matchable.

### Health, trust, and de-listing

- The worker already revalidates providers and migrates off degraded ones (`revalidateProvider`, `streamWithMigration`). Onboarding feeds that: real uptime, completion rate, and latency from live leases drive the Compute Score (`services/src/trust`), which is already built from real outcomes rather than a vanity stat.
- A provider that fails health checks or stops serving is de-listed automatically; in-flight leases on it migrate per the existing degradation path.

### Provider-side UI

- A "List your compute" onboarding flow: connect wallet, run the agent, register endpoint + specs + price, pass the verify handshake.
- A provider dashboard: their listed resources, live leases against them, earnings (the other side of the same `charges` ledger), and health/score. This mirrors the consumer dashboard and reuses the tile/sheet pattern.

---

## Schema and interface changes

- `providers`: add a `pending` state alongside `online` so unverified providers are not matchable; store verification metadata.
- Executor interface: confirm it cleanly supports `provision -> connection info -> teardown`; extend if the current shape only models per-charge calls (it is built for x402 per-unit; provisioning/teardown hooks may be additive).
- No change to settlement, the meter, or the wallet work from spec 1.

## Testing

- `SandboxExecutor` against the chosen platform behind the executor interface: provision returns usable connection info, teardown is idempotent, a held sandbox bills and a torn-down one does not.
- Verify handshake: wallet-ownership signature and live-endpoint challenge both required before listing; `pending` providers are not matched.
- Provider health/de-list: a degraded provider drops out and in-flight leases migrate (extends the existing migration tests).
- End-to-end: register an outside provider, rent it, connect to the real sandbox, watch real charges accrue on spec 1's meter, stop, and confirm teardown.

## Scope

**In:** a real sandboxed compute backend behind the executor seam, real connect credentials and lease provisioning/teardown, provider self-onboarding with wallet + endpoint verification, provider health/de-listing tied to Compute Score, and provider-side UI.

**Out:** confidential-compute / TEE guarantees; a marketplace payout/withdrawal flow for providers beyond surfacing earnings from the existing ledger; multi-region orchestration or autoscaling of a single provider. The meter, wallets, and charge ledger all come from spec 1 and are unchanged here.
