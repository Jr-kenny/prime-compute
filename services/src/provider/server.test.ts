import { test, expect, afterEach } from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Request, Response, NextFunction } from "express";
import { createProviderApp, priceTimes, type PaymentRequest } from "./server";
import { makeSimulatedExecutor } from "./executor";

test("priceTimes scales a per-unit x402 price to a batch through atomic integers, exactly", () => {
  expect(priceTimes("$0.0001", 1)).toBe("$0.0001");
  expect(priceTimes("$0.0001", 6)).toBe("$0.0006");
  expect(priceTimes("$0.0000060", 60)).toBe("$0.00036"); // no float drift at 6dp
  expect(priceTimes("0.01", 3)).toBe("$0.03"); // dollar sign optional on input
  expect(priceTimes("$1", 2)).toBe("$2");
  expect(() => priceTimes("nonsense", 2)).toThrow(/unparseable/);
});

const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com";
const meta = { alias: "test-node", resourceType: "GPU" as const, region: "US-East", specs: { gpu: "H100" } };

function boot() {
  const app = createProviderApp({
    executor: makeSimulatedExecutor("GPU"),
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
    kind: "simulated-compute",
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
    executor: makeSimulatedExecutor("GPU"), sellerAddress: "0xseller", price: "$0.0001",
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
      executor: makeSimulatedExecutor("GPU"), sellerAddress: "0xseller", price: "$0.0001",
      facilitatorUrl, meta, onPayment: (atomic) => { seen.push(atomic); },
    },
    { verified: true, payer: "0xbuyer", amount: "100", network: "eip155:5042002" },
  );
  expect(res.status).toBe(200);
  expect(seen).toEqual([100n]);
});

const vpnMeta = { alias: "vpn-1", resourceType: "VPN", region: "EU", specs: {} };

function bootVpn() {
  const app = createProviderApp({
    executor: makeSimulatedExecutor("VPN"),
    sellerAddress: "0xseller", price: "$0.01", facilitatorUrl,
    meta: vpnMeta,
    requireOverride: (_req, _res, next) => next(), // bypass the paywall in the test
  });
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  return { server, base: `http://localhost:${port}` };
}

test("serves the descriptor path (/vpn) and reports usage unpaywalled", async () => {
  const { server, base } = bootVpn();
  open = server;
  const hit = await fetch(`${base}/vpn?session=s1`);
  expect(hit.status).toBe(200);
  const usage = await fetch(`${base}/usage?session=s1`);
  expect(usage.status).toBe(200);
  const body = await usage.json();
  expect(body.units).toBeGreaterThanOrEqual(1);
});

test("health reports the service type", async () => {
  const { server, base } = bootVpn();
  open = server;
  const res = await fetch(`${base}/health`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.resourceType).toBe("VPN");
});
