import { test, expect, afterEach } from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Request, Response, NextFunction } from "express";
import { createProviderApp, type PaymentRequest } from "./server";
import { SimulatedExecutor } from "./executor";

const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com";
const meta = { alias: "test-node", resourceType: "GPU" as const, region: "US-East", specs: { gpu: "H100" } };

function boot() {
  const app = createProviderApp({
    executor: new SimulatedExecutor({ hasGpu: true }),
    sellerAddress: "0x000000000000000000000000000000000000dEaD",
    price: "$0.0001",
    facilitatorUrl,
    meta,
  });
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  return { server, base: `http://localhost:${port}` };
}

// Injects a fake verified payment onto req instead of hitting the real facilitator, mirroring
// the shape createGatewayMiddleware's require() attaches.
function fakePayment(payment: PaymentRequest["payment"]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    (req as PaymentRequest).payment = payment;
    next();
  };
}

async function computeWithFakePayment(
  opts: Omit<Parameters<typeof createProviderApp>[0], "requireOverride">,
  payment: PaymentRequest["payment"],
) {
  const app = createProviderApp({ ...opts, requireOverride: fakePayment(payment) });
  const server = app.listen(0);
  try {
    const port = (server.address() as AddressInfo).port;
    return await fetch(`http://localhost:${port}/compute?session=remit-test`);
  } finally {
    server.close();
  }
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

test("/health shows the listed price only; /compute is paywalled at that price", async () => {
  const app = createProviderApp({
    executor: new SimulatedExecutor({ hasGpu: true }), sellerAddress: "0xseller", price: "$0.0001",
    facilitatorUrl, meta,
  });
  const server = app.listen(0);
  open = server;
  const port = (server.address() as AddressInfo).port;
  const res = await fetch(`http://localhost:${port}/health`);
  const body = await res.json();
  expect(body.price).toBe("$0.0001");
  expect(body.netPrice).toBeUndefined();
});

test("onPayment fires with the atomic amount of each confirmed payment", async () => {
  const seen: bigint[] = [];
  const res = await computeWithFakePayment(
    {
      executor: new SimulatedExecutor({ hasGpu: true }), sellerAddress: "0xseller", price: "$0.0001",
      facilitatorUrl, meta, onPayment: (atomic) => { seen.push(atomic); },
    },
    { verified: true, payer: "0xbuyer", amount: "100", network: "eip155:5042002" },
  );
  expect(res.status).toBe(200);
  expect(seen).toEqual([100n]);
});
