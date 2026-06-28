import { test, expect, afterEach } from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createProviderApp } from "./server";
import { SimulatedExecutor } from "./executor";

const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com";

function boot() {
  const app = createProviderApp({
    executor: new SimulatedExecutor({ hasGpu: true }),
    sellerAddress: "0x000000000000000000000000000000000000dEaD",
    price: "$0.0001",
    facilitatorUrl,
    meta: { alias: "test-node", resourceType: "GPU", region: "US-East", specs: { gpu: "H100" } },
  });
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  return { server, base: `http://localhost:${port}` };
}

let open: Server | undefined;
afterEach(() => open?.close());

test("/health returns provider metadata without payment", async () => {
  const { server, base } = boot();
  open = server;
  const res = await fetch(`${base}/health`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({
    ok: true,
    kind: "simulated",
    price: "$0.0001",
    alias: "test-node",
    resourceType: "GPU",
    region: "US-East",
  });
});

test("/compute without payment is rejected with 402", async () => {
  const { server, base } = boot();
  open = server;
  const res = await fetch(`${base}/compute`);
  expect(res.status).toBe(402);
});
