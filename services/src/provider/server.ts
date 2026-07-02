import express, { type Express } from "express";
import { createGatewayMiddleware, type PaymentRequest } from "@circle-fin/x402-batching/server";
import type { ComputeExecutor } from "./executor";
import type { ResourceType } from "../domain";

export type ProviderMeta = {
  alias: string;
  resourceType: ResourceType;
  region: string;
  specs: Record<string, unknown>;
};

export type ProviderAppOptions = {
  executor: ComputeExecutor;
  sellerAddress: string;
  price: string; // x402 price string, e.g. "$0.0001" — the LISTED (gross) price renters pay
  platformFeeBps?: number; // marketplace cut in basis points; the paywall demands gross minus this
  facilitatorUrl: string;
  networks?: string[]; // CAIP-2; default Arc testnet
  meta: ProviderMeta;
};

// The marketplace's cut comes out of the provider's price, not on top of it: the listing
// shows gross, the paywall demands net, and the platform streams the difference from the
// renter (whose total spend still equals the listed gross).
export function netPrice(gross: string, feeBps: number): string {
  const grossAtomic = Math.round(parseFloat(gross.replace("$", "")) * 1_000_000);
  const netAtomic = Math.floor((grossAtomic * (10_000 - feeBps)) / 10_000);
  return `$${netAtomic / 1_000_000}`;
}

export function createProviderApp(opts: ProviderAppOptions): Express {
  const { executor, sellerAddress, price, facilitatorUrl, meta } = opts;
  const networks = opts.networks ?? ["eip155:5042002"]; // Arc testnet
  const feeBps = opts.platformFeeBps ?? 0;
  const chargedPrice = feeBps > 0 ? netPrice(price, feeBps) : price;

  const app = express();
  const gateway = createGatewayMiddleware({ sellerAddress, networks, facilitatorUrl });

  // Unpaywalled: the broker/registry reads identity, specs, and price from here.
  app.get("/health", (_req, res) => {
    res.json({ ok: true, kind: executor.kind, price, netPrice: chargedPrice, ...meta });
  });

  // Paywalled: one x402 micro-payment buys one unit of compute (at net of the platform fee).
  app.get("/compute", gateway.require(chargedPrice), async (req, res) => {
    const pay = (req as PaymentRequest).payment;
    const sessionId = (typeof req.query.session === "string" && req.query.session) || "default";
    const telemetry = await executor.compute(sessionId);
    res.json({
      ok: true,
      payment: pay
        ? { payer: pay.payer, amount: pay.amount, transaction: pay.transaction }
        : null,
      telemetry,
    });
  });

  return app;
}
