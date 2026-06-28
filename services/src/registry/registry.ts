import type {
  Provider,
  Rent,
  RentDecision,
  Charge,
  RentSpec,
  ResourceType,
} from "../domain";

export type NewProvider = Omit<Provider, "id" | "computeScore"> & {
  computeScore?: number;
};

export type NewRent = {
  name: string;
  userId: string;
  spec: RentSpec;
  estimatedUsage?: number | null;
  autonomyArmed?: boolean;
};

export type RentPatch = Partial<
  Pick<Rent, "status" | "providerId" | "totalCost" | "startedAt" | "endedAt">
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

  createRent(r: NewRent): Promise<Rent>;
  getRent(id: string): Promise<Rent | null>;
  updateRent(id: string, patch: RentPatch): Promise<Rent>;

  recordDecision(d: Omit<RentDecision, "id" | "createdAt">): Promise<RentDecision>;
  recordCharge(t: Omit<Charge, "id" | "createdAt">): Promise<Charge>;
  markChargeSettled(chargeId: string): Promise<void>;
  listCharges(rentId: string): Promise<Charge[]>;
  rentCost(rentId: string): Promise<number>;
}
