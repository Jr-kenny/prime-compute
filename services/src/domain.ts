export type ResourceType = "GPU" | "CPU" | "Storage" | "Full Server";
export type RentStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export type Provider = {
  id: string;
  alias: string;
  ownerWallet: string;
  endpointUrl: string;
  resourceType: ResourceType;
  region: string;
  specs: Record<string, unknown>;
  online: boolean;
  stakeAmount: number;
  pricePerCharge: number;
  computeScore: number;
  avgLatencyMs: number;
};

export type RentSpec = {
  resourceType: ResourceType;
  region: string | null;
};

export type Rent = {
  id: string;
  name: string;
  userId: string;
  spec: RentSpec;
  estimatedUsage: number | null;
  autonomyArmed: boolean;
  status: RentStatus;
  providerId: string | null;
  totalCost: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
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
