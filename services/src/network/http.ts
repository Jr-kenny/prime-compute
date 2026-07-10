import type { NetworkAdapter, RentAccess } from "./adapter";

export type HttpNetworkOptions = {
  baseUrl: string;
  secret: string;
  timeoutMs?: number; // default 3000; lease-open hot path must not hang
  fetchImpl?: typeof fetch; // seam for tests
};

// Talks to the operator-deployed network service. Holds no VPN credential itself — only
// the base URL and the shared secret. Throws on any non-OK response so callers decide
// whether to fail soft (lease open) or retry (lease close).
export class HttpNetworkAdapter implements NetworkAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  constructor(private opts: HttpNetworkOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 3000;
  }

  private headers() {
    return { "content-type": "application/json", "x-network-secret": this.opts.secret };
  }

  private async call(path: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
        ...init,
        headers: this.headers(),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
  }

  async ensureProviderNode(providerId: string): Promise<{ authKey: string }> {
    const res = await this.call("/provider-node", { method: "POST", body: JSON.stringify({ providerId }) });
    if (!res.ok) throw new Error(`provider-node ${res.status}`);
    return (await res.json()) as { authKey: string };
  }

  async mintRentAccess(input: { rentId: string; providerId: string }): Promise<RentAccess> {
    const res = await this.call("/rent-access", { method: "POST", body: JSON.stringify(input) });
    if (!res.ok) throw new Error(`rent-access ${res.status}`);
    return (await res.json()) as RentAccess;
  }

  async revokeRentAccess(rentId: string): Promise<void> {
    const res = await this.call(`/rent-access/${rentId}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`revoke ${res.status}`);
  }
}
