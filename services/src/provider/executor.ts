// services/src/provider/executor.ts
// The provider-side seam. Slice 1 ships simulators; a RenderExecutor (Task 4) implements the same
// interface for real compute. The paywalled money path never changes; only what runs behind it does.
import { descriptorFor } from "../services/registry";

export type Connect = Record<string, unknown>;
export type Telemetry = Record<string, unknown> & { seq: number; ts: number };

export interface ServiceExecutor {
  readonly kind: string;
  readonly serviceType: string;
  provision(sessionId: string, spec: Record<string, unknown>): Promise<Connect>;
  heartbeat(sessionId: string): Promise<Telemetry>;
  usage(sessionId: string): Promise<number>; // cumulative accrued whole units for this session
  release(sessionId: string): Promise<void>;
}

type Session = { seq: number; units: number; bytes: number; spec: Record<string, unknown> };

const wobble = (base: number, span: number, seq: number) =>
  Math.round((base + span * (0.5 + 0.5 * Math.sin(seq / 3))) * 10) / 10;

function wireguardProfile(spec: Record<string, unknown>): string {
  return `[Interface]\n# Prime Compute VPN (${String(spec.exitLocation ?? "??")})\nPrivateKey = <redacted>\nAddress = 10.7.0.2/32\n\n[Peer]\nEndpoint = ${String(spec.exitLocation ?? "exit")}.vpn.prime:51820\nAllowedIPs = 0.0.0.0/0\n`;
}

// One simulator, parameterized by the descriptor's category, so the six types share one code path.
export function makeSimulatedExecutor(serviceType: string): ServiceExecutor {
  const d = descriptorFor(serviceType);
  const sessions = new Map<string, Session>();

  return {
    kind: d.defaultExecutorKind,
    serviceType,
    async provision(sessionId, spec) {
      sessions.set(sessionId, { seq: 0, units: 0, bytes: 0, spec });
      if (d.category === "network") return { profile: wireguardProfile(spec) };
      if (d.category === "storage") return { bucketUrl: `s3://prime/${sessionId}`, accessKey: "AK-sim", secretKey: "SK-sim" };
      if (d.category === "worker") return { submitUrl: `https://worker.prime/${sessionId}`, token: "wk-sim" };
      return { host: `${sessionId}.compute.prime`, user: "prime", token: "ssh-sim" };
    },
    async heartbeat(sessionId) {
      const s = sessions.get(sessionId) ?? { seq: 0, units: 0, bytes: 0, spec: {} };
      sessions.set(sessionId, s);
      const seq = s.seq++;
      if (d.category === "network") {
        s.bytes += 1_000_000_000; // ~1 GB per heartbeat in the simulation
        s.units = Math.floor(s.bytes / 1_000_000_000);
        return { bytesTransferred: s.bytes, unitsAccrued: s.units, seq, ts: Date.now() };
      }
      if (d.category === "storage") {
        const capacityGb = Number(s.spec.capacityGb ?? 100);
        s.units += 1; // one GB-hour tick in the simulation
        return { usedGb: capacityGb, unitsAccrued: s.units, seq, ts: Date.now() };
      }
      if (d.category === "worker") {
        s.units += 1;
        return { cpu: wobble(30, 25, seq), ramGb: wobble(4, 3, seq), jobsRun: s.units, seq, ts: Date.now() };
      }
      s.units += 1; // one second per heartbeat
      const hasGpu = serviceType === "GPU" || serviceType === "Full Server";
      return { cpu: wobble(35, 30, seq), ramGb: wobble(6, 4, seq), gpuUtil: hasGpu ? wobble(60, 35, seq) : 0, seq, ts: Date.now() };
    },
    async usage(sessionId) {
      return sessions.get(sessionId)?.units ?? 0;
    },
    async release(sessionId) {
      sessions.delete(sessionId);
    },
  };
}

// --- Legacy compute-only seam, kept until the provider server migrates to ServiceExecutor (Task 5).
export type ComputeTelemetry = {
  cpu: number; // % utilization
  ramGb: number; // GB in use
  gpuUtil: number; // % (0 for CPU-only providers)
  seq: number; // compute counter for this session
  ts: number; // epoch ms
};

export interface ComputeExecutor {
  readonly kind: string;
  /** One unit of compute for a session; returns a telemetry heartbeat. */
  compute(sessionId: string): Promise<ComputeTelemetry>;
  /** Release any resources held for a session. */
  release(sessionId: string): Promise<void>;
}

export class SimulatedExecutor implements ComputeExecutor {
  readonly kind = "simulated";
  private sessions = new Map<string, number>(); // sessionId -> next seq

  constructor(private profile: { hasGpu: boolean } = { hasGpu: true }) {}

  async compute(sessionId: string): Promise<ComputeTelemetry> {
    const seq = this.sessions.get(sessionId) ?? 0;
    this.sessions.set(sessionId, seq + 1);
    // Synthetic load that wobbles per compute so the live meter looks alive.
    const w = (base: number, span: number) =>
      Math.round((base + span * (0.5 + 0.5 * Math.sin(seq / 3))) * 10) / 10;
    return {
      cpu: w(35, 30),
      ramGb: w(6, 4),
      gpuUtil: this.profile.hasGpu ? w(60, 35) : 0,
      seq,
      ts: Date.now(),
    };
  }

  async release(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
