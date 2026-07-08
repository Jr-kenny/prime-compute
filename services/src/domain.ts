import type { Tier, TrustProfile } from "./trust/trust";
import { serviceIds } from "./services/registry";

// A caller the service layer acts on behalf of. Two authenticators (requireUser, requireAgent)
// resolve to one of these, so every operation has a single principal-shaped implementation.
export type Principal =
  | { kind: "user"; id: string; walletAddress: string }
  | { kind: "agent"; id: string; walletAddress: string };

// Runtime source of truth for the resource-type enum, derived from the service registry so a new
// service type flows here automatically. Mirrors the widened DB check constraint (0002 migration).
export const RESOURCE_TYPES = serviceIds() as readonly string[];
export type ResourceType = string;
export type RentStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed"
  | "suspended";

export type Provider = {
  id: string;
  alias: string;
  ownerWallet: string;
  endpointUrl: string;
  resourceType: ResourceType;
  region: string;
  specs: Record<string, unknown>;
  online: boolean;
  trust: TrustProfile;
  pricePerCharge: number;
  computeScore: number;
  avgLatencyMs: number;
};

export type RentSpec = {
  resourceType: ResourceType;
  region: string | null;
  requiredTrustTier?: Tier; // default Community (open); the gate applies the default
  // When the renter picked a specific provider ("Rent from X"), we start there and let the
  // broker's migration path take over only if it later degrades. Unset = broker picks by score.
  preferredProviderId?: string | null;
};

export type Rent = {
  id: string;
  name: string;
  userId: string | null;
  agentId: string | null;
  spec: RentSpec;
  estimatedUsage: number | null;
  autonomyArmed: boolean;
  status: RentStatus;
  providerId: string | null;
  totalCost: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  lastChargedAt: string | null; // when the meter last charged this lease (resumability)
  leaseAccessToken: string | null; // shown to the user as the connect credential
  networkHostname: string | null; // the box's private hostname on the overlay (null = none provisioned)
  networkStatus: string | null; // "provisioned" | "unprovisioned" | null; drives the fail-soft retry
  feesSweptAt: string | null; // when outstanding platform fees were collected after the rent ended
  statusReason: string | null; // why a non-happy status happened (e.g. the funding error behind a suspend)
  // Optional caps on a continuous lease (null = no cap). A set cap completes the lease.
  maxSpendAtomic: number | null; // stop after this many atomic USDC charged
  expiresAt: string | null;      // ISO; stop at this wall-clock time
  // Set when a lease is suspended for an empty wallet; drives the grace-then-terminate timer.
  suspendedAt: string | null;
};

export type RentDecision = {
  id: string;
  rentId: string;
  candidates: { providerId: string; rank: number }[];
  chosenProviderId: string | null;
  rationale: string;
  createdAt: string;
};

export type Charge = {
  id: string;
  rentId: string;
  providerId: string;
  seq: number; // the first usage-unit this charge covers (charges are contiguous: next seq = seq + units)
  units: number; // how many usage-units this ONE payment covers (batched nanopayment; legacy rows are 1)
  amount: number; // atomic USDC units (6 decimals), paid to the provider — units * unit price
  feeAmount: number; // atomic USDC for the platform on this charge (renter paid amount + feeAmount)
  feeSettlementRef: string | null; // the fee nano-payment's batch ref; null until it lands
  authorizationRef: string | null;
  settled: boolean;
  settlementRef: string | null;
  createdAt: string;
};
