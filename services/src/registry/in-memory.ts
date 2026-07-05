import type { Provider, Rent, RentDecision, Charge } from "../domain";
import type { Registry, NewProvider, NewRent, RentPatch, ProviderFilter, RentFilter } from "./registry";
import type { DecisionLog } from "../runtime/types";

export class InMemoryRegistry implements Registry {
  private providers = new Map<string, Provider>();
  private rents = new Map<string, Rent>();
  private decisions: RentDecision[] = [];
  private decisionLogs: { rentId: string; log: DecisionLog }[] = [];
  private charges: Charge[] = [];

  async registerProvider(p: NewProvider): Promise<Provider> {
    const provider: Provider = { id: crypto.randomUUID(), ...p, computeScore: p.computeScore ?? 80 };
    this.providers.set(provider.id, provider);
    return provider;
  }

  async listProviders(filter?: ProviderFilter): Promise<Provider[]> {
    let out = [...this.providers.values()];
    if (filter?.resourceType) out = out.filter((p) => p.resourceType === filter.resourceType);
    if (filter?.onlineOnly) out = out.filter((p) => p.online);
    if (filter?.ownerWallet) out = out.filter((p) => p.ownerWallet === filter.ownerWallet);
    return out;
  }

  async getProvider(id: string): Promise<Provider | null> {
    return this.providers.get(id) ?? null;
  }

  async setProviderOnline(id: string, online: boolean): Promise<void> {
    const p = this.providers.get(id);
    if (p) this.providers.set(id, { ...p, online });
  }

  async bumpComputeScore(id: string, delta: number): Promise<Provider> {
    const p = this.providers.get(id);
    if (!p) throw new Error(`provider not found: ${id}`);
    const next = { ...p, computeScore: p.computeScore + delta };
    this.providers.set(id, next);
    return next;
  }

  async createRent(r: NewRent): Promise<Rent> {
    const rent: Rent = {
      id: crypto.randomUUID(),
      name: r.name,
      userId: r.owner.kind === "user" ? r.owner.id : null,
      agentId: r.owner.kind === "agent" ? r.owner.id : null,
      spec: r.spec,
      estimatedUsage: r.estimatedUsage ?? null,
      autonomyArmed: r.autonomyArmed ?? false,
      status: "queued",
      providerId: null,
      totalCost: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
      lastChargedAt: null,
      leaseAccessToken: null,
      feesSweptAt: null,
      statusReason: null,
      maxSpendAtomic: r.maxSpendAtomic ?? null,
      expiresAt: r.expiresAt ?? null,
      suspendedAt: null,
    };
    this.rents.set(rent.id, rent);
    return rent;
  }

  async getRent(id: string): Promise<Rent | null> {
    return this.rents.get(id) ?? null;
  }

  async listRents(filter?: RentFilter): Promise<Rent[]> {
    let out = [...this.rents.values()];
    if (filter?.userId) out = out.filter((r) => r.userId === filter.userId);
    if (filter?.agentId) out = out.filter((r) => r.agentId === filter.agentId);
    if (filter?.providerId) out = out.filter((r) => r.providerId === filter.providerId);
    if (filter?.status) out = out.filter((r) => r.status === filter.status);
    return out;
  }

  async updateRent(id: string, patch: RentPatch): Promise<Rent> {
    const r = this.rents.get(id);
    if (!r) throw new Error(`rent not found: ${id}`);
    const next = { ...r, ...patch };
    this.rents.set(id, next);
    return next;
  }

  async recordDecision(d: Omit<RentDecision, "id" | "createdAt">): Promise<RentDecision> {
    const decision: RentDecision = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...d };
    this.decisions.push(decision);
    return decision;
  }

  async recordDecisionLog(rentId: string, log: DecisionLog): Promise<DecisionLog> {
    this.decisionLogs.push({ rentId, log });
    return log;
  }

  async listDecisionLogs(rentId: string): Promise<DecisionLog[]> {
    return this.decisionLogs.filter((d) => d.rentId === rentId).map((d) => d.log);
  }

  async recordCharge(t: Omit<Charge, "id" | "createdAt">): Promise<Charge> {
    const charge: Charge = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...t };
    this.charges.push(charge);
    return charge;
  }

  async markChargeSettled(chargeId: string): Promise<void> {
    const c = this.charges.find((x) => x.id === chargeId);
    if (c) c.settled = true;
  }

  async markChargeFeeSettled(chargeId: string, ref: string): Promise<void> {
    const c = this.charges.find((x) => x.id === chargeId);
    if (c) c.feeSettlementRef = ref;
  }

  async listCharges(rentId: string): Promise<Charge[]> {
    return this.charges.filter((t) => t.rentId === rentId).sort((a, b) => a.seq - b.seq);
  }

  async listOutstandingFeeCharges(providerId: string): Promise<Charge[]> {
    return this.charges.filter((c) => c.providerId === providerId && c.feeAmount > 0 && !c.feeSettlementRef);
  }

  async rentCost(rentId: string): Promise<number> {
    return this.charges.filter((t) => t.rentId === rentId).reduce((s, t) => s + t.amount, 0);
  }
}
