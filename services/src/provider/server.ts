import express, { type Express, type RequestHandler } from "express";
import { createGatewayMiddleware, type PaymentRequest } from "@circle-fin/x402-batching/server";
import type { ServiceExecutor } from "./executor";
import { descriptorFor, type ServiceCategory } from "../services/registry";

export type { PaymentRequest };

export type ProviderMeta = {
  alias: string;
  resourceType: string;
  region: string;
  specs: Record<string, unknown>;
};

export type ProviderAppOptions = {
  executor: ServiceExecutor;
  sellerAddress: string;
  price: string; // x402 price string, e.g. "$0.0001" — the listed per-unit price renters pay
  facilitatorUrl: string;
  networks?: string[]; // CAIP-2; default Arc testnet
  meta: ProviderMeta;
  onPayment?: (amountAtomic: bigint) => void; // tap for the fee remitter
  requireOverride?: RequestHandler; // test seam; defaults to the real gateway.require(price)
};

export function createProviderApp(opts: ProviderAppOptions): Express {
  const { executor, sellerAddress, price, facilitatorUrl, meta } = opts;
  const networks = opts.networks ?? ["eip155:5042002"]; // Arc testnet
  const d = descriptorFor(meta.resourceType);

  const app = express();
  const gateway = createGatewayMiddleware({ sellerAddress, networks, facilitatorUrl });
  const require_ = opts.requireOverride ?? gateway.require(price);

  // Unpaywalled: the broker/registry reads identity, specs, and price from here.
  app.get("/health", (_req, res) => {
    res.json({ ok: true, kind: executor.kind, price, ...meta });
  });

  // Unpaywalled per-session usage read: the worker consults this to know how many whole units are
  // pending before it makes any paid hit, so an idle session is never charged.
  app.get("/usage", async (req, res) => {
    const sessionId = (typeof req.query.session === "string" && req.query.session) || "default";
    res.json({ units: await executor.usage(sessionId) });
  });

  // Paywalled: one x402 micro-payment buys one unit at the listed per-unit price. The path is the
  // descriptor's, so a compute provider serves /compute, a VPN provider /vpn, etc.
  app.get(d.path, require_, async (req, res) => {
    const pay = (req as PaymentRequest).payment;
    if (pay?.amount) {
      try { opts.onPayment?.(BigInt(pay.amount)); } catch { /* the tap must never break service */ }
    }
    const sessionId = (typeof req.query.session === "string" && req.query.session) || "default";
    const telemetry = await executor.heartbeat(sessionId);
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

export type { ServiceCategory };
