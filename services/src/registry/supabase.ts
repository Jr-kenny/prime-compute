import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Provider, Rent, RentDecision, Charge } from "../domain";
import type { Registry, NewProvider, NewRent, RentPatch, ProviderFilter, RentFilter } from "./registry";
import { defaultTrust, type Tier, type TrustProfile } from "../trust/trust";
import type { DecisionLog, Proposal } from "../runtime/types";

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
    trust: {
      tier: (r.trust_tier as Tier | null) ?? "Community",
      signals: (r.trust_signals as TrustProfile["signals"] | null) ?? defaultTrust().signals,
    },
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
    userId: (r.user_id as string) ?? null,
    agentId: (r.agent_id as string) ?? null,
    spec: {
      resourceType: r.resource_type as Rent["spec"]["resourceType"],
      region: (r.region as string) ?? null,
      requiredTrustTier: (r.required_trust_tier as Tier | null) ?? "Community",
      preferredProviderId: (r.preferred_provider_id as string) ?? null,
    },
    estimatedUsage: r.estimated_usage === null ? null : Number(r.estimated_usage),
    autonomyArmed: r.autonomy_armed as boolean,
    status: r.status as Rent["status"],
    providerId: (r.provider_id as string) ?? null,
    totalCost: Number(r.total_cost),
    createdAt: r.created_at as string,
    startedAt: (r.started_at as string) ?? null,
    endedAt: (r.ended_at as string) ?? null,
    lastChargedAt: (r.last_charged_at as string) ?? null,
    leaseAccessToken: (r.lease_access_token as string) ?? null,
    feesSweptAt: (r.fees_swept_at as string) ?? null,
    statusReason: (r.status_reason as string) ?? null,
    maxSpendAtomic: r.max_spend_atomic === null || r.max_spend_atomic === undefined ? null : Number(r.max_spend_atomic),
    expiresAt: (r.expires_at as string) ?? null,
    suspendedAt: (r.suspended_at as string) ?? null,
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
    feeAmount: Number(r.fee_amount ?? 0),
    feeSettlementRef: (r.fee_settlement_ref as string) ?? null,
    authorizationRef: (r.authorization_ref as string) ?? null,
    settled: r.settled as boolean,
    settlementRef: (r.settlement_ref as string) ?? null,
    createdAt: r.created_at as string,
  };
}

function toDecisionLog(raw: unknown): DecisionLog {
  const r = raw as Row;
  const action = (r.chosen_action as string | null) ?? null;
  const target = (r.chosen_provider_id as string | null) ?? undefined;
  return {
    decisionId: r.decision_id as string,
    soulVersion: (r.soul_version as string) ?? "",
    policyVersion: (r.policy_version as string) ?? "",
    objective: (r.objective as string) ?? "",
    proposals: (r.proposals as Proposal[] | null) ?? [],
    chosenAction: action ? { action, target } : null,
    rejectedReason: (r.rejected_reason as string | null) ?? null,
    usedFallback: (r.used_fallback as boolean | null) ?? false,
    createdAt: r.created_at as string,
  };
}

export class SupabaseRegistry implements Registry {
  private db: SupabaseClient;

  constructor(client: SupabaseClient);
  constructor(url: string, serviceRoleKey: string);
  constructor(clientOrUrl: SupabaseClient | string, serviceRoleKey?: string) {
    this.db = typeof clientOrUrl === "string"
      ? createClient(clientOrUrl, serviceRoleKey!, { auth: { persistSession: false } })
      : clientOrUrl;
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
        online: p.online, trust_tier: p.trust.tier, trust_signals: p.trust.signals,
        price_per_charge: p.pricePerCharge,
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
    if (filter?.ownerWallet) q = q.eq("owner_wallet", filter.ownerWallet);
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
        name: r.name,
        user_id: r.owner.kind === "user" ? r.owner.id : null,
        agent_id: r.owner.kind === "agent" ? r.owner.id : null,
        resource_type: r.spec.resourceType, region: r.spec.region,
        required_trust_tier: r.spec.requiredTrustTier ?? "Community",
        preferred_provider_id: r.spec.preferredProviderId ?? null,
        estimated_usage: r.estimatedUsage ?? null, autonomy_armed: r.autonomyArmed ?? false,
        max_spend_atomic: r.maxSpendAtomic ?? null, expires_at: r.expiresAt ?? null,
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

  async listRents(filter?: RentFilter): Promise<Rent[]> {
    let q = this.db.from("rents").select();
    if (filter?.userId) q = q.eq("user_id", filter.userId);
    if (filter?.agentId) q = q.eq("agent_id", filter.agentId);
    if (filter?.providerId) q = q.eq("provider_id", filter.providerId);
    if (filter?.status) q = q.eq("status", filter.status);
    const { data, error } = await q;
    if (error) throw new Error(`listRents: ${error.message}`);
    return (data ?? []).map((r) => toRent(r));
  }

  async updateRent(id: string, patch: RentPatch): Promise<Rent> {
    const dbPatch: Row = {};
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.providerId !== undefined) dbPatch.provider_id = patch.providerId;
    if (patch.totalCost !== undefined) dbPatch.total_cost = patch.totalCost;
    if (patch.startedAt !== undefined) dbPatch.started_at = patch.startedAt;
    if (patch.endedAt !== undefined) dbPatch.ended_at = patch.endedAt;
    if (patch.lastChargedAt !== undefined) dbPatch.last_charged_at = patch.lastChargedAt;
    if (patch.leaseAccessToken !== undefined) dbPatch.lease_access_token = patch.leaseAccessToken;
    if (patch.feesSweptAt !== undefined) dbPatch.fees_swept_at = patch.feesSweptAt;
    if (patch.statusReason !== undefined) dbPatch.status_reason = patch.statusReason;
    if (patch.maxSpendAtomic !== undefined) dbPatch.max_spend_atomic = patch.maxSpendAtomic;
    if (patch.expiresAt !== undefined) dbPatch.expires_at = patch.expiresAt;
    if (patch.suspendedAt !== undefined) dbPatch.suspended_at = patch.suspendedAt;
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

  async recordDecisionLog(rentId: string, log: DecisionLog): Promise<DecisionLog> {
    // Derive the legacy provider-choice columns from the structured log so a single table
    // serves both audits: candidates = the ranked targets, chosen = the chosen action's target.
    const candidates = log.proposals
      .map((p, i) => ({ providerId: p.target, rank: i }))
      .filter((c): c is { providerId: string; rank: number } => typeof c.providerId === "string");
    const chosen = log.proposals.find(
      (p) => p.action === log.chosenAction?.action && p.target === log.chosenAction?.target,
    );
    const rationale = chosen?.userExplanation ?? log.rejectedReason ?? "";
    await this.one(
      this.db.from("rent_decisions").insert({
        rent_id: rentId,
        candidates,
        chosen_provider_id: log.chosenAction?.target ?? null,
        rationale,
        decision_id: log.decisionId,
        soul_version: log.soulVersion,
        policy_version: log.policyVersion,
        objective: log.objective,
        proposals: log.proposals,
        chosen_action: log.chosenAction?.action ?? null,
        rejected_reason: log.rejectedReason,
        used_fallback: log.usedFallback,
      }).select().single(),
      "recordDecisionLog",
    );
    return log;
  }

  async listDecisionLogs(rentId: string): Promise<DecisionLog[]> {
    const { data, error } = await this.db
      .from("rent_decisions")
      .select()
      .eq("rent_id", rentId)
      .not("decision_id", "is", null)
      .order("created_at");
    if (error) throw new Error(`listDecisionLogs: ${error.message}`);
    return (data ?? []).map((r) => toDecisionLog(r));
  }

  async recordCharge(t: Omit<Charge, "id" | "createdAt">): Promise<Charge> {
    const row = await this.one(
      this.db.from("charges").insert({
        rent_id: t.rentId, provider_id: t.providerId, seq: t.seq, amount: t.amount,
        fee_amount: t.feeAmount, fee_settlement_ref: t.feeSettlementRef,
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

  // PostgREST caps any single response at 1000 rows, and a continuously-metered lease
  // accumulates far more charges than that (one per second crosses 1000 in ~17 minutes).
  // Unpaged reads silently truncated there, which froze seq, the spend-cap math, and the
  // float top-up boundary all at once. So: counts come from a head-count query (exact
  // regardless of the row cap), and full reads walk the table in pages.
  private static readonly CHARGE_PAGE = 1000;

  private async chargePages<T>(
    ctx: string,
    query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  ): Promise<T[]> {
    const page = SupabaseRegistry.CHARGE_PAGE;
    const out: T[] = [];
    for (let from = 0; ; from += page) {
      const { data, error } = await query(from, from + page - 1);
      if (error) throw new Error(`${ctx}: ${error.message}`);
      out.push(...(data ?? []));
      if (!data || data.length < page) return out;
    }
  }

  async listCharges(rentId: string): Promise<Charge[]> {
    const rows = await this.chargePages("listCharges", (from, to) =>
      this.db.from("charges").select().eq("rent_id", rentId).order("seq").range(from, to),
    );
    return rows.map((r) => toCharge(r));
  }

  async countCharges(rentId: string): Promise<number> {
    const { count, error } = await this.db
      .from("charges")
      .select("id", { count: "exact", head: true })
      .eq("rent_id", rentId);
    if (error) throw new Error(`countCharges: ${error.message}`);
    return count ?? 0;
  }

  async listOutstandingFeeCharges(providerId: string): Promise<Charge[]> {
    const rows = await this.chargePages("listOutstandingFeeCharges", (from, to) =>
      this.db.from("charges").select("*")
        .eq("provider_id", providerId).gt("fee_amount", 0).is("fee_settlement_ref", null)
        .order("created_at", { ascending: true }).range(from, to),
    );
    return rows.map((r) => toCharge(r));
  }

  async rentCost(rentId: string): Promise<number> {
    const rows = await this.chargePages("rentCost", (from, to) =>
      this.db.from("charges").select("amount").eq("rent_id", rentId).order("seq").range(from, to),
    );
    return rows.reduce((s, r) => s + Number((r as Row).amount), 0);
  }

  async markChargeFeeSettled(chargeId: string, ref: string): Promise<void> {
    const { error } = await this.db.from("charges").update({ fee_settlement_ref: ref }).eq("id", chargeId);
    if (error) throw new Error(`markChargeFeeSettled: ${error.message}`);
  }
}
