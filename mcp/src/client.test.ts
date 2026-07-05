// mcp/src/client.test.ts
import { test, expect } from "bun:test";
import { PrimeClient } from "./client";

function stubFetch(calls: any[]) {
  return async (url: string, init?: any) => {
    calls.push({ url, method: init?.method ?? "GET", auth: init?.headers?.authorization, body: init?.body });
    return new Response(JSON.stringify({ ok: true, url }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

test("rentCompute POSTs to /api/v1/rents with the bearer key", async () => {
  const calls: any[] = [];
  const c = new PrimeClient("http://api", "pc_key", stubFetch(calls) as any);
  await c.rentCompute({ name: "j", resourceType: "GPU" });
  expect(calls[0].url).toBe("http://api/api/v1/rents");
  expect(calls[0].method).toBe("POST");
  expect(calls[0].auth).toBe("Bearer pc_key");
  expect(JSON.parse(calls[0].body)).toEqual({ name: "j", resourceType: "GPU" });
});

test("walletBalance GETs /api/v1/wallet", async () => {
  const calls: any[] = [];
  const c = new PrimeClient("http://api", "pc_key", stubFetch(calls) as any);
  await c.walletBalance();
  expect(calls[0].url).toBe("http://api/api/v1/wallet");
  expect(calls[0].method).toBe("GET");
});

test("reclaim POSTs /api/v1/wallet/reclaim with the bearer key", async () => {
  const calls: any[] = [];
  const c = new PrimeClient("http://api", "pc_key", stubFetch(calls) as any);
  await c.reclaim();
  expect(calls[0].url).toBe("http://api/api/v1/wallet/reclaim");
  expect(calls[0].method).toBe("POST");
  expect(calls[0].auth).toBe("Bearer pc_key");
});
