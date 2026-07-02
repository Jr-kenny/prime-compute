import type {
  Provider,
  Rent,
  RentDecision,
  Charge,
  RentSpec,
  ResourceType,
  RentStatus,
  Principal,
} from "../domain";
import type { DecisionLog } from "../runtime/types";

export type NewProvider = Omit<Provider, "id" | "computeScore"> & {
  computeScore?: number;
};

export type NewRent = {
  name: string;
  owner: Principal;
  spec: RentSpec;
  estimatedUsage?: number | null;
  autonomyArmed?: boolean;
};

export type RentPatch = Partial<
  Pick<Rent, "status" | "providerId" | "totalCost" | "startedAt" | "endedAt" | "lastChargedAt" | "leaseAccessToken" | "feesSweptAt">
>;

export type ProviderFilter = {
  resourceType?: ResourceType;
  onlineOnly?: boolean;
  ownerWallet?: string;
};

export type RentFilter = {
  userId?: string;
  agentId?: string;
  providerId?: string;
  status?: RentStatus;
};

export interface Registry {
  registerProvider(p: NewProvider): Promise<Provider>;
  listProviders(filter?: ProviderFilter): Promise<Provider[]>;
  getProvider(id: string): Promise<Provider | null>;
  setProviderOnline(id: string, online: boolean): Promise<void>;
  bumpComputeScore(id: string, delta: number): Promise<Provider>;

  createRent(r: NewRent): Promise<Rent>;
  getRent(id: string): Promise<Rent | null>;
  listRents(filter?: RentFilter): Promise<Rent[]>;
  updateRent(id: string, patch: RentPatch): Promise<Rent>;

  recordDecision(d: Omit<RentDecision, "id" | "createdAt">): Promise<RentDecision>;
  recordDecisionLog(rentId: string, log: DecisionLog): Promise<DecisionLog>;
  listDecisionLogs(rentId: string): Promise<DecisionLog[]>;
  recordCharge(t: Omit<Charge, "id" | "createdAt">): Promise<Charge>;
  markChargeSettled(chargeId: string): Promise<void>;
  /** Stamp the fee nano-payment's settlement ref on a charge (fee streamed live or swept). */
  markChargeFeeSettled(chargeId: string, ref: string): Promise<void>;
  listCharges(rentId: string): Promise<Charge[]>;
  /** Fee receivables: this provider's charges with fee_amount > 0 and no remittance stamp, oldest first. */
  listOutstandingFeeCharges(providerId: string): Promise<Charge[]>;
  rentCost(rentId: string): Promise<number>;
}
