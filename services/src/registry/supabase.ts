import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Provider, Job, JobDecision, Tick } from "../domain";
import type { Registry, NewProvider, NewJob, JobPatch, ProviderFilter } from "./registry";

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
    pricePerTick: Number(r.price_per_tick),
    computeScore: Number(r.compute_score),
    avgLatencyMs: Number(r.avg_latency_ms),
  };
}

function toJob(raw: unknown): Job {
  const r = raw as Row;
  return {
    id: r.id as string,
    name: r.name as string,
    userId: r.user_id as string,
    spec: { resourceType: r.resource_type as Job["spec"]["resourceType"], region: (r.region as string) ?? null },
    estimatedUsage: r.estimated_usage === null ? null : Number(r.estimated_usage),
    autonomyArmed: r.autonomy_armed as boolean,
    status: r.status as Job["status"],
    providerId: (r.provider_id as string) ?? null,
    totalCost: Number(r.total_cost),
    createdAt: r.created_at as string,
    startedAt: (r.started_at as string) ?? null,
    endedAt: (r.ended_at as string) ?? null,
  };
}

function toTick(raw: unknown): Tick {
  const r = raw as Row;
  return {
    id: r.id as string,
    jobId: r.job_id as string,
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
        online: p.online, stake_amount: p.stakeAmount, price_per_tick: p.pricePerTick,
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

  async createJob(j: NewJob): Promise<Job> {
    const row = await this.one(
      this.db.from("jobs").insert({
        name: j.name, user_id: j.userId,
        resource_type: j.spec.resourceType, region: j.spec.region,
        estimated_usage: j.estimatedUsage ?? null, autonomy_armed: j.autonomyArmed ?? false,
      }).select().single(),
      "createJob",
    );
    return toJob(row);
  }

  async getJob(id: string): Promise<Job | null> {
    const { data, error } = await this.db.from("jobs").select().eq("id", id).maybeSingle();
    if (error) throw new Error(`getJob: ${error.message}`);
    return data ? toJob(data) : null;
  }

  async updateJob(id: string, patch: JobPatch): Promise<Job> {
    const dbPatch: Row = {};
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.providerId !== undefined) dbPatch.provider_id = patch.providerId;
    if (patch.totalCost !== undefined) dbPatch.total_cost = patch.totalCost;
    if (patch.startedAt !== undefined) dbPatch.started_at = patch.startedAt;
    if (patch.endedAt !== undefined) dbPatch.ended_at = patch.endedAt;
    const row = await this.one(
      this.db.from("jobs").update(dbPatch).eq("id", id).select().single(),
      "updateJob",
    );
    return toJob(row);
  }

  async recordDecision(d: Omit<JobDecision, "id" | "createdAt">): Promise<JobDecision> {
    const row = await this.one(
      this.db.from("job_decisions").insert({
        job_id: d.jobId, candidates: d.candidates,
        chosen_provider_id: d.chosenProviderId, rationale: d.rationale,
      }).select().single(),
      "recordDecision",
    );
    const r = row as unknown as Row;
    return {
      id: r.id as string, jobId: r.job_id as string,
      candidates: r.candidates as JobDecision["candidates"],
      chosenProviderId: (r.chosen_provider_id as string) ?? null,
      rationale: r.rationale as string, createdAt: r.created_at as string,
    };
  }

  async recordTick(t: Omit<Tick, "id" | "createdAt">): Promise<Tick> {
    const row = await this.one(
      this.db.from("ticks").insert({
        job_id: t.jobId, provider_id: t.providerId, seq: t.seq, amount: t.amount,
        authorization_ref: t.authorizationRef, settled: t.settled, settlement_ref: t.settlementRef,
      }).select().single(),
      "recordTick",
    );
    return toTick(row);
  }

  async listTicks(jobId: string): Promise<Tick[]> {
    const { data, error } = await this.db.from("ticks").select().eq("job_id", jobId).order("seq");
    if (error) throw new Error(`listTicks: ${error.message}`);
    return (data ?? []).map((r) => toTick(r));
  }

  async jobCost(jobId: string): Promise<number> {
    const { data, error } = await this.db.from("ticks").select("amount").eq("job_id", jobId);
    if (error) throw new Error(`jobCost: ${error.message}`);
    return (data ?? []).reduce((s, r) => s + Number((r as Row).amount), 0);
  }
}
