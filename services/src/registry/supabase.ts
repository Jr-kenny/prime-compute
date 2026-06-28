import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Provider, Rent, RentDecision, Charge } from "../domain";
import type { Registry, NewProvider, NewRent, RentPatch, ProviderFilter } from "./registry";

type Row = Record<string, unknown>;

// The untyped Supabase client resolves query `data` to a very loose type, so the
// mappers take `unknown` and narrow once, keeping the call sites cast-free.
function toProvider(raw: unknown): Provider {
  const r = raw as Row;
  return {
    id: r.id as string,
    alias: r.alias as string,
    ownerWallet: r.owner_wallet as string,
    endpointUrl: r.endpoint_url as string,
    resourceType: r.resource_type as Provider["resourceType"],
    region: r.region as string,
    specs: (r.specs as Record<string, unknown>) ?? {},
    online: r.online as boolean,
    stakeAmount: Number(r.stake_amount),
    pricePerCharge: Number(r.price_per_charge),
    computeScore: Number(r.compute_score),
    avgLatencyMs: Number(r.avg_latency_ms),
  };
}

function toRent(raw: unknown): Rent {
  const r = raw as Row;
  return {
    id: r.id as string,
    name: r.name as string,
    userId: r.user_id as string,
    spec: { resourceType: r.resource_type as Rent["spec"]["resourceType"], region: (r.region as string) ?? null },
    estimatedUsage: r.estimated_usage === null ? null : Number(r.estimated_usage),
    autonomyArmed: r.autonomy_armed as boolean,
    status: r.status as Rent["status"],
    providerId: (r.provider_id as string) ?? null,
    totalCost: Number(r.total_cost),
    createdAt: r.created_at as string,
    startedAt: (r.started_at as string) ?? null,
    endedAt: (r.ended_at as string) ?? null,
  };
}

function toCharge(raw: unknown): Charge {
  const r = raw as Row;
  return {
    id: r.id as string,
    rentId: r.rent_id as string,
    providerId: r.provider_id as string,
    seq: Number(r.seq),
    amount: Number(r.amount),
    authorizationRef: (r.authorization_ref as string) ?? null,
    settled: r.settled as boolean,
    settlementRef: (r.settlement_ref as string) ?? null,
    createdAt: r.created_at as string,
  };
}

export class SupabaseRegistry implements Registry {
  private db: SupabaseClient;
  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  private async one<T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>, ctx: string): Promise<T> {
    const { data, error } = await q;
    if (error) throw new Error(`${ctx}: ${error.message}`);
    if (data === null) throw new Error(`${ctx}: no row returned`);
    return data;
  }

  async registerProvider(p: NewProvider): Promise<Provider> {
    const row = await this.one(
      this.db.from("providers").insert({
        alias: p.alias, owner_wallet: p.ownerWallet, endpoint_url: p.endpointUrl,
        resource_type: p.resourceType, region: p.region, specs: p.specs,
        online: p.online, stake_amount: p.stakeAmount, price_per_charge: p.pricePerCharge,
        compute_score: p.computeScore ?? 80, avg_latency_ms: p.avgLatencyMs,
      }).select().single(),
      "registerProvider",
    );
    return toProvider(row);
  }

  async listProviders(filter?: ProviderFilter): Promise<Provider[]> {
    let q = this.db.from("providers").select();
    if (filter?.resourceType) q = q.eq("resource_type", filter.resourceType);
    if (filter?.onlineOnly) q = q.eq("online", true);
    const { data, error } = await q;
    if (error) throw new Error(`listProviders: ${error.message}`);
    return (data ?? []).map((r) => toProvider(r));
  }

  async getProvider(id: string): Promise<Provider | null> {
    const { data, error } = await this.db.from("providers").select().eq("id", id).maybeSingle();
    if (error) throw new Error(`getProvider: ${error.message}`);
    return data ? toProvider(data) : null;
  }

  async setProviderOnline(id: string, online: boolean): Promise<void> {
    const { error } = await this.db.from("providers").update({ online }).eq("id", id);
    if (error) throw new Error(`setProviderOnline: ${error.message}`);
  }

  async bumpComputeScore(id: string, delta: number): Promise<Provider> {
    const current = await this.getProvider(id);
    if (!current) throw new Error(`provider not found: ${id}`);
    const row = await this.one(
      this.db.from("providers").update({ compute_score: current.computeScore + delta }).eq("id", id).select().single(),
      "bumpComputeScore",
    );
    return toProvider(row);
  }

  async createRent(r: NewRent): Promise<Rent> {
    const row = await this.one(
      this.db.from("rents").insert({
        name: r.name, user_id: r.userId,
        resource_type: r.spec.resourceType, region: r.spec.region,
        estimated_usage: r.estimatedUsage ?? null, autonomy_armed: r.autonomyArmed ?? false,
      }).select().single(),
      "createRent",
    );
    return toRent(row);
  }

  async getRent(id: string): Promise<Rent | null> {
    const { data, error } = await this.db.from("rents").select().eq("id", id).maybeSingle();
    if (error) throw new Error(`getRent: ${error.message}`);
    return data ? toRent(data) : null;
  }

  async updateRent(id: string, patch: RentPatch): Promise<Rent> {
    const dbPatch: Row = {};
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.providerId !== undefined) dbPatch.provider_id = patch.providerId;
    if (patch.totalCost !== undefined) dbPatch.total_cost = patch.totalCost;
    if (patch.startedAt !== undefined) dbPatch.started_at = patch.startedAt;
    if (patch.endedAt !== undefined) dbPatch.ended_at = patch.endedAt;
    const row = await this.one(
      this.db.from("rents").update(dbPatch).eq("id", id).select().single(),
      "updateRent",
    );
    return toRent(row);
  }

  async recordDecision(d: Omit<RentDecision, "id" | "createdAt">): Promise<RentDecision> {
    const row = await this.one(
      this.db.from("rent_decisions").insert({
        rent_id: d.rentId, candidates: d.candidates,
        chosen_provider_id: d.chosenProviderId, rationale: d.rationale,
      }).select().single(),
      "recordDecision",
    );
    const r = row as unknown as Row;
    return {
      id: r.id as string, rentId: r.rent_id as string,
      candidates: r.candidates as RentDecision["candidates"],
      chosenProviderId: (r.chosen_provider_id as string) ?? null,
      rationale: r.rationale as string, createdAt: r.created_at as string,
    };
  }

  async recordCharge(t: Omit<Charge, "id" | "createdAt">): Promise<Charge> {
    const row = await this.one(
      this.db.from("charges").insert({
        rent_id: t.rentId, provider_id: t.providerId, seq: t.seq, amount: t.amount,
        authorization_ref: t.authorizationRef, settled: t.settled, settlement_ref: t.settlementRef,
      }).select().single(),
      "recordCharge",
    );
    return toCharge(row);
  }

  async markChargeSettled(chargeId: string): Promise<void> {
    const { error } = await this.db.from("charges").update({ settled: true }).eq("id", chargeId);
    if (error) throw new Error(`markChargeSettled: ${error.message}`);
  }

  async listCharges(rentId: string): Promise<Charge[]> {
    const { data, error } = await this.db.from("charges").select().eq("rent_id", rentId).order("seq");
    if (error) throw new Error(`listCharges: ${error.message}`);
    return (data ?? []).map((r) => toCharge(r));
  }

  async rentCost(rentId: string): Promise<number> {
    const { data, error } = await this.db.from("charges").select("amount").eq("rent_id", rentId);
    if (error) throw new Error(`rentCost: ${error.message}`);
    return (data ?? []).reduce((s, r) => s + Number((r as Row).amount), 0);
  }
}
