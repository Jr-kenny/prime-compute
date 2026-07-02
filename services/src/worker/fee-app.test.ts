// services/src/worker/fee-app.test.ts
import { test, expect } from "bun:test";
import { createServer } from "node:http";
import { createFeeApp } from "./fee-app";

// The paywall itself is createGatewayMiddleware (already proven by the provider server
// suite); what's ours to test is the route shape and the dynamic per-request price.
async function serve(app: ReturnType<typeof createFeeApp>) {
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  return { server, base: `http://localhost:${port}` };
}

test("GET /fee/:atomic is paywalled at exactly that atomic amount", async () => {
  const prices: string[] = [];
  const app = createFeeApp({
    treasury: "0xTREASURY",
    facilitatorUrl: "http://facilitator",
    // Test seam: capture what the paywall was asked to charge, then let the request through.
    requireOverride: (price) => { prices.push(price); return (_req, _res, next) => next(); },
  });
  const { server, base } = await serve(app);
  const res = await fetch(`${base}/fee/123`);
  server.close();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, feeAtomic: 123 });
  expect(prices).toEqual(["$0.000123"]);
});

test("rejects a non-numeric or non-positive fee", async () => {
  const app = createFeeApp({ treasury: "0xT", facilitatorUrl: "http://f", requireOverride: () => (_q, _s, n) => n() });
  const { server, base } = await serve(app);
  expect((await fetch(`${base}/fee/abc`)).status).toBe(400);
  expect((await fetch(`${base}/fee/0`)).status).toBe(400);
  server.close();
});
