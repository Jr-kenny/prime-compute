import express, { type Express, type RequestHandler } from "express";
import { createGatewayMiddleware, type PaymentRequest } from "@circle-fin/x402-batching/server";
import type { ComputeExecutor } from "./executor";
import type { ResourceType } from "../domain";

export type { PaymentRequest };

export type ProviderMeta = {
  alias: string;
  resourceType: ResourceType;
  region: string;
  specs: Record<string, unknown>;
};

export type ProviderAppOptions = {
  executor: ComputeExecutor;
  sellerAddress: string;
  price: string; // x402 price string, e.g. "$0.0001" — the listed price renters pay
  facilitatorUrl: string;
  networks?: string[]; // CAIP-2; default Arc testnet
  meta: ProviderMeta;
  onPayment?: (amountAtomic: bigint) => void; // tap for the fee remitter
  requireOverride?: RequestHandler; // test seam; defaults to the real gateway.require(price)
};

export function createProviderApp(opts: ProviderAppOptions): Express {
  const { executor, sellerAddress, price, facilitatorUrl, meta } = opts;
  const networks = opts.networks ?? ["eip155:5042002"]; // Arc testnet

  const app = express();
  const gateway = createGatewayMiddleware({ sellerAddress, networks, facilitatorUrl });
  const require_ = opts.requireOverride ?? gateway.require(price);

  // Unpaywalled: the broker/registry reads identity, specs, and price from here.
  app.get("/health", (_req, res) => {
    res.json({ ok: true, kind: executor.kind, price, ...meta });
  });

  // Paywalled: one x402 micro-payment buys one unit of compute, at the listed price.
  app.get("/compute", require_, async (req, res) => {
    const pay = (req as PaymentRequest).payment;
    if (pay?.amount) {
      try { opts.onPayment?.(BigInt(pay.amount)); } catch { /* the tap must never break compute */ }
    }
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
