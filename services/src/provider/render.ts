// services/src/provider/render.ts
// Seam-ready real compute executor. It implements ServiceExecutor against Render's API so the
// platform can provision real containers later. It is never the default: platform listings run the
// simulator until RENDER_API_KEY is set and the provider factory opts in (Task 5 note). Compute only.
import type { ServiceExecutor, Connect, Telemetry } from "./executor";

export interface RenderApi {
  createService(input: { region: string }): Promise<{ id: string; host: string }>;
  deleteService(id: string): Promise<void>;
}

// Thin real client. Left minimal on purpose; wiring real HTTP calls is a later flip behind the seam.
export function makeRenderApi(apiKey: string): RenderApi {
  const base = "https://api.render.com/v1";
  return {
    async createService({ region }) {
      const res = await fetch(`${base}/services`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ type: "web_service", region }),
      });
      if (!res.ok) throw new Error(`render createService failed: ${res.status}`);
      const j = (await res.json()) as { service?: { id: string } };
      const id = j.service?.id ?? "";
      return { id, host: `${id}.onrender.com` };
    },
    async deleteService(id) {
      await fetch(`${base}/services/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${apiKey}` } });
    },
  };
}

export class RenderExecutor implements ServiceExecutor {
  readonly kind = "render";
  private ids = new Map<string, string>();
  private units = new Map<string, number>();
  constructor(readonly serviceType: string, private api: RenderApi) {}

  async provision(sessionId: string, spec: Record<string, unknown>): Promise<Connect> {
    const svc = await this.api.createService({ region: String(spec.region ?? "oregon") });
    this.ids.set(sessionId, svc.id);
    this.units.set(sessionId, 0);
    return { host: svc.host, user: "prime", token: "ssh-render" };
  }
  async heartbeat(sessionId: string): Promise<Telemetry> {
    const u = (this.units.get(sessionId) ?? 0) + 1;
    this.units.set(sessionId, u);
    return { cpu: 0, ramGb: 0, gpuUtil: 0, seq: u - 1, ts: Date.now() };
  }
  async usage(sessionId: string): Promise<number> {
    return this.units.get(sessionId) ?? 0;
  }
  async release(sessionId: string): Promise<void> {
    const id = this.ids.get(sessionId);
    if (id) await this.api.deleteService(id);
    this.ids.delete(sessionId);
    this.units.delete(sessionId);
  }
}
