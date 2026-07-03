# Multi-service marketplace: compute, storage, VPN, worker

**Goal:** Turn Prime Compute from a compute-only marketplace into one that hosts many service types
(GPU, CPU, Full Server, Storage, VPN, Worker) through a single extensible model, generalize the
provider executor so real provisioning can slot in behind the same seam (with a seam-ready
`RenderExecutor` for platform-supplied compute), and add per-type metering so time-based and
volume-based services both settle correctly over the existing x402 streaming rail.

**Approach:** A service-type descriptor registry is the single source of truth. Every consumer
(domain enum, API validation, register form, marketplace filters, MCP, and the metering worker)
reads from it, so adding a service type is one descriptor instead of scattered branches.

## Architecture overview

```
services/src/services/registry.ts   <- new: the descriptor registry (source of truth)
services/src/domain.ts              <- RESOURCE_TYPES derived from the registry
services/src/provider/executor.ts   <- ComputeExecutor -> ServiceExecutor, per-type simulators
services/src/provider/render.ts     <- new: RenderExecutor (compute, seam-ready, off by default)
services/src/worker/                 <- metering charges on unit-accrual (time | volume)
src/routes/register.tsx             <- spec fields rendered from descriptor.specSchema
src/routes/marketplace.index.tsx    <- filters from registry categories
src/lib/agents/validate.ts          <- validates listings against descriptor.specSchema
mcp/src/index.ts                    <- resourceType enum + register_server specs from registry
supabase/migrations/                 <- additive: widen resourceType check, add units_charged
```

## 1. The descriptor registry

New module `services/src/services/registry.ts`. One descriptor per service type:

```ts
type MeteringKind = "time" | "volume";
type ServiceCategory = "compute" | "storage" | "network" | "worker";

interface ServiceTypeDescriptor {
  id: string;                 // "GPU" | "CPU" | "Full Server" | "Storage" | "VPN" | "Worker"
  label: string;
  category: ServiceCategory;
  metering: MeteringKind;     // how units accrue (section 3)
  unit: string;               // "second" | "GB-hour" | "GB"
  specSchema: z.ZodType;      // provider's listing fields for this type
  telemetry: z.ZodType;       // heartbeat shape the executor emits
  connect: z.ZodType;         // what a running rent hands the renter
  defaultExecutorKind: string; // which executor the platform template runs for this type
}

export const SERVICE_REGISTRY: Record<string, ServiceTypeDescriptor> = { /* ... */ };
```

`services/src/domain.ts` changes `RESOURCE_TYPES` to `Object.keys(SERVICE_REGISTRY)` so the enum and
every downstream validation follow the registry. `ResourceType` stays a string-literal union derived
the same way.

The six descriptors:

| id | category | metering | unit | spec fields | connect payload |
|---|---|---|---|---|---|
| GPU | compute | time | second | gpu, vramGb, cpuCores, ramGb, region | ssh (host/user/token) |
| CPU | compute | time | second | cpuCores, ramGb, region | ssh |
| Full Server | compute | time | second | gpu?, cpuCores, ramGb, diskGb, region | ssh |
| Storage | storage | volume | GB-hour | capacityGb, region, redundancy? | bucket url + creds |
| VPN | network | volume | GB | exitLocation, protocol, bandwidthMbps, dataCapGb? | profile (WireGuard/OVPN text) |
| Worker | worker | time | second | cpuCores, ramGb, concurrency, runtime | job endpoint + token |

Each descriptor's `telemetry` schema names the cumulative-units field the metering worker reads
(elapsed seconds for time types, `gbHours` for storage, `bytesTransferred` for VPN).

## 2. Executor generalization + Render seam

`ComputeExecutor` in `services/src/provider/executor.ts` generalizes to `ServiceExecutor`:

```ts
interface ServiceExecutor {
  readonly kind: string;
  readonly serviceType: string;
  provision(sessionId: string, spec: Record<string, unknown>): Promise<Connect>;
  heartbeat(sessionId: string): Promise<Telemetry>; // includes cumulative accrued units
  release(sessionId: string): Promise<void>;
}
```

`SimulatedExecutor` becomes descriptor-driven: for a given service type it emits that type's
telemetry shape. Compute keeps the CPU/RAM/GPU wobble; VPN grows a cumulative `bytesTransferred`;
storage reports the provisioned capacity so the worker can accrue GB-hours; worker reports jobs run.
The synthetic-load helper stays, parameterized by the descriptor.

`RenderExecutor` (new, `services/src/provider/render.ts`, compute only) implements `ServiceExecutor`
against Render's API: `provision` spins a container and returns a real ssh/endpoint connect,
`heartbeat` polls it, `release` tears it down. It is guarded behind `RENDER_API_KEY` and is never the
default: platform-supplied listings keep `SimulatedExecutor` for now, so turning real provisioning on
is a config flip, not a rewrite. Users always register their own `endpointUrl`, so their listings are
real by definition; only the platform's own seed/template listings are simulated.

## 3. Metering on unit-accrual

Settlement stays one code path and does not branch on service type. Each executor emits its own
**cumulative units accrued** in its telemetry, and the worker always charges
`pricePerCharge × (unitsNow − unitsAlreadyCharged)`. The executor owns how units are computed, so the
worker never needs a per-type switch:

- **time** (compute, worker): the executor reports elapsed seconds since provision.
- **storage** (capacity × time): the executor reports cumulative GB-hours (provisionedGb × elapsed).
- **VPN** (transfer): the executor reports cumulative GB transferred.

The descriptor's `metering` and `unit` are labels for pricing and display ("per second", "per GB"),
not something the worker branches on. The metering worker persists cumulative units charged per rent;
on restart it charges for `unitsReported − unitsCharged`, preserving the existing "never double-charge
or skip" guarantee for volume services exactly as it holds for time today. `pricePerCharge` on the
provider is reinterpreted as price-per-unit, where the unit is defined by the type's descriptor (no
column rename).

## 4. VPN end to end

Descriptor as in the table: category `network`, metering `volume` (GB), spec
`{ exitLocation, protocol: "WireGuard" | "OpenVPN", bandwidthMbps, dataCapGb?, pricePerGb }`,
telemetry `{ bytesTransferred (cumulative), seq, ts }`, connect `{ profile: string }`. The simulated
VPN executor grows `bytesTransferred` per heartbeat and returns a well-formed but fake WireGuard
profile; a real user VPN reports actual transfer from its own endpoint. The dashboard and
`rent_status` show a downloadable profile for a running VPN rent instead of SSH credentials.

## 5. UI / API / MCP surface

- `src/routes/register.tsx`: the listing form renders fields from `descriptor.specSchema` instead of
  hardcoded GPU/Full-Server conditionals, so a new service type shows the right fields automatically.
- `src/routes/marketplace.index.tsx`: filter chips come from registry ids/categories.
- `src/lib/agents/validate.ts`: a provider registration validates its `specs` against the type's
  `specSchema`.
- `mcp/src/index.ts`: the `resourceType` enum and `register_server` spec come from the registry;
  `rent_status` returns the type-appropriate connect payload.

## Persistence and migration

An additive Supabase migration:

- Widen the `resourceType` CHECK constraint (from `0001_init.sql`) to also allow `VPN` and `Worker`
  (`Storage` and `Full Server` are already allowed).
- Add a `units_charged` numeric column on the rent/lease so volume metering is idempotent on restart.

Per-type spec fields live in the existing `specs` JSON column, so no schema change is needed for
them. Existing rows are compute types the registry already covers. Storage's metering changes from
its current treatment to GB-hours; this is called out as a behavior change, and any seeded storage
providers are re-priced accordingly.

## Testing

- Registry completeness: every descriptor has a spec, telemetry, connect schema, metering kind, and
  executor kind.
- Metering math per kind (time, storage capacity×time, VPN transfer) with restart idempotency: after
  a simulated restart the total charged equals `price × unitsReported`, never more.
- Per-type simulator telemetry validates against its descriptor's telemetry schema.
- `RenderExecutor` conforms to `ServiceExecutor` (mocked Render API, since it is off by default).
- VPN end to end: provide → rent → meter on transfer → download profile, on the in-memory registry.
- Existing compute contract tests keep passing unchanged (the generalization is behavior-preserving
  for compute).

## Out of scope

- Real Render provisioning being on by default (seam only; flip later).
- Real WireGuard/OpenVPN tunnel infrastructure (simulated executor for platform listings; users
  bring their own real endpoints).
- Any change to the identity, wallet, or Circle settlement rails beyond the unit-accrual charge math.

## Decisions (resolved during brainstorming)

- Service types at launch: GPU, CPU, Full Server, Storage, VPN, Worker.
- Model shape: descriptor registry (single source of truth) over discriminated unions or loose JSON.
- Platform provisioning: `RenderExecutor` seam-ready but simulated by default; users are real.
- Metering: per-type units on one accrual path (`price × unit delta`).
