export type Telemetry = {
  cpu: number; // % utilization
  ramGb: number; // GB in use
  gpuUtil: number; // % (0 for CPU-only providers)
  seq: number; // compute counter for this session
  ts: number; // epoch ms
};

// The seam that makes the provider real later: slice 1 ships SimulatedExecutor;
// Phase 2 adds RailwayExecutor / RenderExecutor with the same interface, so the
// paywalled money path never changes.
export interface ComputeExecutor {
  readonly kind: string;
  /** One unit of compute for a session; returns a telemetry heartbeat. */
  compute(sessionId: string): Promise<Telemetry>;
  /** Release any resources held for a session. */
  release(sessionId: string): Promise<void>;
}

export class SimulatedExecutor implements ComputeExecutor {
  readonly kind = "simulated";
  private sessions = new Map<string, number>(); // sessionId -> next seq

  constructor(private profile: { hasGpu: boolean } = { hasGpu: true }) {}

  async compute(sessionId: string): Promise<Telemetry> {
    const seq = this.sessions.get(sessionId) ?? 0;
    this.sessions.set(sessionId, seq + 1);
    // Synthetic load that wobbles per compute so the live meter looks alive.
    const wobble = (base: number, span: number) =>
      Math.round((base + span * (0.5 + 0.5 * Math.sin(seq / 3))) * 10) / 10;
    return {
      cpu: wobble(35, 30),
      ramGb: wobble(6, 4),
      gpuUtil: this.profile.hasGpu ? wobble(60, 35) : 0,
      seq,
      ts: Date.now(),
    };
  }

  async release(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
