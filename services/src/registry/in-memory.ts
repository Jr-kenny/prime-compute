import type { Provider, Job, JobDecision, Tick } from "../domain";
import type { Registry, NewProvider, NewJob, JobPatch, ProviderFilter } from "./registry";

export class InMemoryRegistry implements Registry {
  private providers = new Map<string, Provider>();
  private jobs = new Map<string, Job>();
  private decisions: JobDecision[] = [];
  private ticks: Tick[] = [];

  async registerProvider(p: NewProvider): Promise<Provider> {
    const provider: Provider = { id: crypto.randomUUID(), ...p, computeScore: p.computeScore ?? 80 };
    this.providers.set(provider.id, provider);
    return provider;
  }

  async listProviders(filter?: ProviderFilter): Promise<Provider[]> {
    let out = [...this.providers.values()];
    if (filter?.resourceType) out = out.filter((p) => p.resourceType === filter.resourceType);
    if (filter?.onlineOnly) out = out.filter((p) => p.online);
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

  async createJob(j: NewJob): Promise<Job> {
    const job: Job = {
      id: crypto.randomUUID(),
      name: j.name,
      userId: j.userId,
      spec: j.spec,
      estimatedUsage: j.estimatedUsage ?? null,
      autonomyArmed: j.autonomyArmed ?? false,
      status: "queued",
      providerId: null,
      totalCost: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async getJob(id: string): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }

  async updateJob(id: string, patch: JobPatch): Promise<Job> {
    const j = this.jobs.get(id);
    if (!j) throw new Error(`job not found: ${id}`);
    const next = { ...j, ...patch };
    this.jobs.set(id, next);
    return next;
  }

  async recordDecision(d: Omit<JobDecision, "id" | "createdAt">): Promise<JobDecision> {
    const decision: JobDecision = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...d };
    this.decisions.push(decision);
    return decision;
  }

  async recordTick(t: Omit<Tick, "id" | "createdAt">): Promise<Tick> {
    const tick: Tick = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...t };
    this.ticks.push(tick);
    return tick;
  }

  async listTicks(jobId: string): Promise<Tick[]> {
    return this.ticks.filter((t) => t.jobId === jobId).sort((a, b) => a.seq - b.seq);
  }

  async jobCost(jobId: string): Promise<number> {
    return this.ticks.filter((t) => t.jobId === jobId).reduce((s, t) => s + t.amount, 0);
  }
}
