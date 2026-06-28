export type Health = { healthy: boolean; reason: string };
export type HealthSample = { ok: boolean; latencyMs?: number };

export class HealthMonitor {
  private consecutiveFailures = 0;
  constructor(private opts: { maxConsecutiveFailures?: number; maxLatencyMs?: number } = {}) {}

  observe(sample: HealthSample): Health {
    const maxFail = this.opts.maxConsecutiveFailures ?? 3;
    const maxLatency = this.opts.maxLatencyMs ?? Number.POSITIVE_INFINITY;

    if (!sample.ok) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= maxFail) {
        return { healthy: false, reason: `${this.consecutiveFailures} consecutive failures` };
      }
      return { healthy: true, reason: "transient failure within tolerance" };
    }

    this.consecutiveFailures = 0;
    if (sample.latencyMs !== undefined && sample.latencyMs > maxLatency) {
      return { healthy: false, reason: `latency ${sample.latencyMs}ms over ${maxLatency}ms` };
    }
    return { healthy: true, reason: "ok" };
  }
}
