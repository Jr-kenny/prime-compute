import type { Tier, TrustProfile } from "./trust/trust";

// A caller the service layer acts on behalf of. Two authenticators (requireUser, requireAgent)
// resolve to one of these, so every operation has a single principal-shaped implementation.
export type Principal =
  | { kind: "user"; id: string; walletAddress: string }
  | { kind: "agent"; id: string; walletAddress: string };

export type ResourceType = "GPU" | "CPU" | "Storage" | "Full Server";
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
  seq: number;
  amount: number; // atomic USDC units (6 decimals)
  authorizationRef: string | null;
  settled: boolean;
  settlementRef: string | null;
  createdAt: string;
};
