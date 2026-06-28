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
  price: string; // x402 price string, e.g. "$0.0001"
  facilitatorUrl: string;
  networks?: string[]; // CAIP-2; default Arc testnet
  meta: ProviderMeta;
};

export function createProviderApp(opts: ProviderAppOptions): Express {
  const { executor, sellerAddress, price, facilitatorUrl, meta } = opts;
  const networks = opts.networks ?? ["eip155:5042002"]; // Arc testnet

  const app = express();
  const gateway = createGatewayMiddleware({ sellerAddress, networks, facilitatorUrl });

  // Unpaywalled: the broker/registry reads identity, specs, and price from here.
  app.get("/health", (_req, res) => {
    res.json({ ok: true, kind: executor.kind, price, ...meta });
  });

  // Paywalled: one x402 micro-payment buys one compute tick.
  app.get("/tick", gateway.require(price), async (req, res) => {
    const pay = (req as PaymentRequest).payment;
    const sessionId = (typeof req.query.session === "string" && req.query.session) || "default";
    const telemetry = await executor.tick(sessionId);
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
