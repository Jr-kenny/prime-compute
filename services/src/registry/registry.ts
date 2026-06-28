import type {
  Provider,
  Job,
  JobDecision,
  Tick,
  JobSpec,
  ResourceType,
} from "../domain";

export type NewProvider = Omit<Provider, "id" | "computeScore"> & {
  computeScore?: number;
};

export type NewJob = {
  name: string;
  userId: string;
  spec: JobSpec;
  estimatedUsage?: number | null;
  autonomyArmed?: boolean;
};

export type JobPatch = Partial<
  Pick<Job, "status" | "providerId" | "totalCost" | "startedAt" | "endedAt">
>;

export type ProviderFilter = {
  resourceType?: ResourceType;
  onlineOnly?: boolean;
};

export interface Registry {
  registerProvider(p: NewProvider): Promise<Provider>;
  listProviders(filter?: ProviderFilter): Promise<Provider[]>;
  getProvider(id: string): Promise<Provider | null>;
  setProviderOnline(id: string, online: boolean): Promise<void>;
  bumpComputeScore(id: string, delta: number): Promise<Provider>;

  createJob(j: NewJob): Promise<Job>;
  getJob(id: string): Promise<Job | null>;
  updateJob(id: string, patch: JobPatch): Promise<Job>;

  recordDecision(d: Omit<JobDecision, "id" | "createdAt">): Promise<JobDecision>;
  recordTick(t: Omit<Tick, "id" | "createdAt">): Promise<Tick>;
  listTicks(jobId: string): Promise<Tick[]>;
  jobCost(jobId: string): Promise<number>;
}
