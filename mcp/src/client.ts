// mcp/src/client.ts
type Fetch = typeof fetch;

// Thin typed wrapper over the REST API. No business logic; every method is one HTTP call.
export class PrimeClient {
  constructor(private baseUrl: string, private apiKey: string, private fetchImpl: Fetch = fetch) {}

  private async call(path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.apiKey}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
    return json;
  }

  discoverProviders() { return this.call("/api/v1/providers", "GET"); }
  rentCompute(input: { name: string; resourceType: string; region?: string; estimatedUsage?: number; maxSpendUsdc?: string; durationMs?: number }) {
    return this.call("/api/v1/rents", "POST", input);
  }
  rentStatus(id: string) { return this.call(`/api/v1/rents/${id}`, "GET"); }
  registerServer(input: { alias: string; endpointUrl: string; resourceType: string; region: string; pricePerCharge: number; specs?: Record<string, unknown> }) {
    return this.call("/api/v1/providers", "POST", input);
  }
  walletBalance() { return this.call("/api/v1/wallet", "GET"); }
  withdraw(toAddress: string, amount: string) { return this.call("/api/v1/wallet", "POST", { toAddress, amount }); }
  reclaim() { return this.call("/api/v1/wallet/reclaim", "POST", {}); }
}
