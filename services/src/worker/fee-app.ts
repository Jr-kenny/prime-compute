// services/src/worker/fee-app.ts
import express, { type Express, type RequestHandler } from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";

export type FeeAppOptions = {
  treasury: string;       // sellerAddress: where the fee nano-payments settle
  facilitatorUrl: string;
  networks?: string[];    // CAIP-2; default Arc testnet
  // Test seam: swap the real paywall for a stub that records the demanded price.
  requireOverride?: (price: string) => RequestHandler;
};

// The platform's revenue endpoint: paying `/fee/:atomic` IS the fee. The amount rides in
// the path so one route serves every provider price; the x402 payment goes to the treasury
// through the exact same Gateway batching rail the providers use.
export function createFeeApp(opts: FeeAppOptions): Express {
  const networks = opts.networks ?? ["eip155:5042002"]; // Arc testnet
  const gateway = createGatewayMiddleware({ sellerAddress: opts.treasury, networks, facilitatorUrl: opts.facilitatorUrl });
  const require = opts.requireOverride ?? ((price: string) => gateway.require(price));

  const app = express();
  app.get("/fee/:atomic", (req, res, next) => {
    const atomic = Number(req.params.atomic);
    if (!Number.isInteger(atomic) || atomic <= 0) {
      res.status(400).json({ error: "fee must be a positive integer of atomic USDC units" });
      return;
    }
    require(`$${atomic / 1_000_000}`)(req, res, (err?: unknown) => {
      if (err) return next(err);
      res.json({ ok: true, feeAtomic: atomic });
    });
  });
  return app;
}
