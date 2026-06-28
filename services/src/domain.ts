export type ResourceType = "GPU" | "CPU" | "Storage" | "Full Server";
export type JobStatus =
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
  pricePerTick: number;
  computeScore: number;
  avgLatencyMs: number;
};

export type JobSpec = {
  resourceType: ResourceType;
  region: string | null;
};

export type Job = {
  id: string;
  name: string;
  userId: string;
  spec: JobSpec;
  estimatedUsage: number | null;
  autonomyArmed: boolean;
  status: JobStatus;
  providerId: string | null;
  totalCost: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
};

export type JobDecision = {
  id: string;
  jobId: string;
  candidates: { providerId: string; rank: number }[];
  chosenProviderId: string | null;
  rationale: string;
  createdAt: string;
};

export type Tick = {
  id: string;
  jobId: string;
  providerId: string;
  seq: number;
  amount: number; // atomic USDC units (6 decimals)
  authorizationRef: string | null;
  settled: boolean;
  settlementRef: string | null;
  createdAt: string;
};
