# Agent-facing marketplace API

**Goal:** Let autonomous agents (Claude, Codex, and anything that speaks HTTP or MCP) rent compute and
list their own servers on Prime Compute programmatically, with no browser and no human in the loop. An
agent registers itself, funds its own Arc wallet, and from there rents and lists servers exactly the way
the web app's human users do, because both go through one principal-shaped service layer.

The surface is a versioned REST API (`/api/v1/`) that is the canonical machine interface, plus a thin MCP
server that wraps it so MCP clients connect natively. Humans (passkey sessions) and agents (API keys) are
just two client types authenticating into the same operations. The metering worker stays the sole
authority for lease lifecycle and billing; this API only provisions identities and does authenticated
reads/writes.

This builds on the merged per-user spend wallets, the metering worker, and the UI flows. It reuses the
registry, the `wallet/crypto` AES-GCM encryption, and the settlement/worker stack unchanged.

## Principal model

Two authenticators, one principal:

```ts
type Principal =
  | { kind: "user"; id: string; walletAddress: string }
  | { kind: "agent"; id: string; walletAddress: string };
```

- `requireUser(accessToken)` (exists) verifies a Supabase session and returns a `user` principal.
- `requireAgent(apiKey)` (new) hashes the bearer key, matches a live `agent_api_keys` row, stamps
  `last_used_at`, and returns an `agent` principal.

Everything below the auth line takes a `Principal`, so each operation has exactly one implementation. The
existing human server-fns are migrated to call the same service functions (they are thin wrappers today),
so there is no second copy of the business logic.

## Data model

All new tables are service-role only (RLS on, zero client policies), consistent with `spend_wallets`. This
DB is shared with PrimeBot; every new table is namespaced to this app and unreferenced by it.

- `agents` (`id uuid pk`, `label text`, `created_at timestamptz`).
- `agent_wallets` (`agent_id uuid pk references agents(id) on delete cascade`, `address text unique`,
  `enc_private_key text`, `created_at`). Mirrors `spend_wallets`; the wallet is permanent and never
  reassigned. Encrypted with `wallet/crypto` AES-256-GCM under `SPEND_WALLET_ENC_KEY`, same as user wallets.
- `agent_api_keys` (`id uuid pk`, `agent_id uuid references agents(id) on delete cascade`, `key_hash text`,
  `created_at`, `last_used_at timestamptz`, `revoked_at timestamptz`). Keys are stored hashed (SHA-256 of a
  high-entropy random token). An agent can hold several; rotation is issue-new then revoke-old; `revoked_at`
  is an instant kill switch.
- `rents` and `providers`: `user_id` becomes nullable and a nullable `agent_id text` is added, with a check
  constraint that exactly one of the two is set. No generic `owner_type/owner_id` abstraction: with only two
  principal types, explicit columns are clearer, and we generalize only if a third type (orgs, teams) ever
  appears. Migration is additive plus the null-relaxation and check.

Domain and registry changes that follow:

- `Rent` and `Provider` gain `agentId: string | null`; `userId` becomes `string | null`.
- `NewRent`/`NewProvider` take `owner: Principal` instead of a bare `userId`; the registry maps it to the
  right column.
- `RentFilter`/`ProviderFilter` gain `agentId`. The in-memory and Supabase registries and their shared
  contract are updated together.
- The metering worker is untouched: it only reads and advances existing leases and never cares who owns
  them. The added nullable field flows through its reads transparently.

## Service layer (the shared core)

`src/lib/marketplace/` holds principal-parameterized functions, the single business-logic path:

- `createRentFor(principal, { name, spec, estimatedUsage })` -> creates a `queued` rent owned by the
  principal.
- `listRentsFor(principal)`, `getRentFor(principal, rentId)` (ownership-checked, returns null if not owned
  or missing), `cancelRentFor(principal, rentId)`.
- `registerProviderFor(principal, input)`, `listMyProvidersFor(principal)`.
- `walletFor(principal)` -> `{ address, balanceAtomic }`, using the per-principal wallet store.

The wallet store is generalized to load by principal: user wallets from `spend_wallets`, agent wallets from
`agent_wallets`, both through the existing crypto. Provider discovery (`listProviders`) needs no principal.

## REST surface (`/api/v1/`, TanStack Start API routes in the app)

The app already has `getRegistry()`, the wallet crypto, and Supabase server-side, so the API lives in
`src/routes/api/v1/*` and reuses all of it in the same Cloudflare-Worker deploy. Auth is a bearer API key
except for open registration. Requests and responses are strict JSON; errors are structured
(`{ error: { code, message } }`) and never leak internals.

- `POST /api/v1/agents` - open registration. Creates an agent, provisions its `agent_wallets` row, issues
  the first API key, and returns `{ agentId, apiKey, walletAddress }`. The `apiKey` plaintext is shown once
  and only its hash is stored.
- `GET /api/v1/wallet` - the agent's `{ address, balanceAtomic }`, so it knows when to fund. Funding is
  sending USDC to `address` on Arc (no endpoint needed).
- `GET /api/v1/providers` - discover the marketplace (optionally filtered by resourceType/region).
- `POST /api/v1/providers` - list a server (alias, endpointUrl, resourceType, region, specs, pricePerCharge)
  owned by the agent, `ownerWallet` = the agent's wallet.
- `GET /api/v1/providers/mine` - the agent's own servers.
- `POST /api/v1/rents` - rent (creates a `queued` lease); the worker provisions and meters it.
- `GET /api/v1/rents` and `GET /api/v1/rents/:id` - the agent's rents; a running lease returns its connect
  credentials (`endpointUrl` + `leaseAccessToken`) and real charged cost.
- `POST /api/v1/rents/:id/cancel` - stop a rent (validated by `canCancel`).

## MCP server (thin adapter)

A standalone in-repo package (`mcp/` or `services/src/mcp/`) using the MCP SDK. An agent runs it locally
with `PRIME_API_KEY` and the API base URL in env. Each tool is a one-to-one call to a REST endpoint with no
business logic:

- `discover_providers` -> `GET /providers`
- `rent_compute` -> `POST /rents`
- `rent_status` -> `GET /rents/:id`
- `register_server` -> `POST /providers`
- `wallet_balance` -> `GET /wallet`

Registration (`POST /agents`) is deliberately out of the MCP surface: an agent needs its key before it can
run the MCP server, so registration is a one-time REST call (or a small CLI helper), not an MCP tool.

## Why this is safe to open without approvals

The only defense that matters right now is inherent to the architecture and costs nothing to keep: an agent
can only ever spend its own funded Arc wallet, bounded by the metering worker's per-lease spend cap, and a
balance stall just suspends the lease. Registration and reads are cheap and harmless. So an abuser can only
burn its own USDC; there is no shared cost to attack. That is what makes open, self-serve registration fine
at this stage.

## Testing

- Registry contract (both in-memory and live Supabase): agent-owned rents and providers round-trip; the
  exactly-one-owner check holds; filters by `agentId` work.
- `requireAgent`: key hashing, match, `last_used_at` stamp, `revoked_at` rejection, unknown-key rejection.
- Service layer over a fake registry: each `*For(principal, ...)` function for both principal kinds, and the
  ownership guard on `getRentFor`/`cancelRentFor`.
- REST routes: auth required (401 without a key), happy path for register/rent/list, structured errors.
- MCP tools against a stubbed REST client: each tool maps to the right call and shapes the result.
- On-chain agent-wallet funding and a real metered agent rent are a live handoff (needs a funded Arc wallet),
  same pattern as the existing roundtrip scripts.

## Future hardening (documented, not built in v1)

Switch these on the day this touches real money or opens to the untrusted public. None require re-architecting;
they layer onto the same auth and service seams:

- Rate limiting: per-IP cap on `POST /api/v1/agents`, per-key token bucket on authed endpoints. v1-simple via
  a Supabase-backed sliding-window counter; higher throughput via Cloudflare native rate limiting or Durable
  Objects.
- Per-agent quotas (fail-closed): max active rents, max registered providers, max live API keys.
- Provider-listing anti-abuse beyond the inherent economics: the endpoint-verification handshake (spec 2)
  proves a listed server actually serves compute before it can rank.
- Key-anomaly detection off `last_used_at`, optional per-key scopes, and agent-level suspension.

## Out of scope

- Real sandboxed compute behind provider endpoints and provider self-onboarding verification (spec 2).
- Any human-facing UI for agents (registration is API-only, fully machine-to-machine).
- Migrating the web app's read paths to the REST API: the shared service layer already removes the
  duplication; a wholesale server-fn-to-REST migration is not needed and is not attempted here.

## Build order (for the plan)

1. Agent identity: `agents`/`agent_wallets`/`agent_api_keys` tables + migration, `requireAgent`, the agent
   wallet store, `POST /api/v1/agents`.
2. Registry ownership: nullable `user_id` + `agent_id` on rents/providers, domain/registry/contract updates,
   the principal service layer, and migrating the existing human server-fns onto it.
3. REST v1: the remaining `/api/v1` endpoints over the service layer.
4. MCP server: the thin wrapper package.
