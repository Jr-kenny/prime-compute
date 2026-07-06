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
  maxUnitsPerCharge?: number; // ceiling on `units=N` batching (default 60); blast-radius bound
};

// "$0.0001" x 6 -> "$0.0006": scale a per-unit x402 price string to a whole batch through
// integers, rounding to USDC's 6-dp atomic grid ONCE, after the multiply. Listings price
// finer than an atomic unit ($0.0000045/sec is 4.5 atomic), so rounding per unit first
// would make the batch price disagree with the payer's ceiling and refuse honest batches.
export function priceTimes(price: string, units: number): string {
  const m = price.trim().match(/^\$?(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`unparseable x402 price: ${price}`);
  const frac = m[2] ?? "";
  const scaled = BigInt(m[1]! + frac) * BigInt(units); // integer at 10^-frac.length dollars
  const shift = frac.length > 6 ? 10n ** BigInt(frac.length - 6) : 1n;
  const up = frac.length < 6 ? 10n ** BigInt(6 - frac.length) : 1n;
  const atomic = (scaled * up + shift / 2n) / shift; // round half up on the atomic grid
  const s = atomic.toString().padStart(7, "0");
  const out = s.slice(-6).replace(/0+$/, "");
  return `$${s.slice(0, -6)}${out ? "." + out : ""}`;
}

export function createProviderApp(opts: ProviderAppOptions): Express {
  const { executor, sellerAddress, price, facilitatorUrl, meta } = opts;
  const networks = opts.networks ?? ["eip155:5042002"]; // Arc testnet
  const d = descriptorFor(meta.resourceType);

  const app = express();
  const gateway = createGatewayMiddleware({ sellerAddress, networks, facilitatorUrl });

  // Batched nanopayments: `units=N` prices the request at N whole units in ONE x402 payment
  // (the payment is still a single off-chain authorization Circle batches at settlement; we
  // just let it carry N seconds/GBs of value). One paywall middleware per distinct batch
  // size, built lazily and cached. N is clamped so a hostile query can't mint a giant price.
  const maxUnits = Math.max(1, opts.maxUnitsPerCharge ?? 60);
  const requireCache = new Map<number, RequestHandler>();
  const requireFor = (units: number): RequestHandler => {
    if (opts.requireOverride) return opts.requireOverride;
    let mw = requireCache.get(units);
    if (!mw) {
      mw = gateway.require(priceTimes(price, units)) as RequestHandler;
      requireCache.set(units, mw);
    }
    return mw;
  };
  const unitsOf = (q: unknown): number => {
    const n = typeof q === "string" ? parseInt(q, 10) : 1;
    return Number.isFinite(n) && n >= 1 ? Math.min(n, maxUnits) : 1;
  };

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

  // Paywalled: one x402 micro-payment buys `units` whole units (default 1) at the listed
  // per-unit price. The path is the descriptor's, so a compute provider serves /compute, a
  // VPN provider /vpn, etc.
  app.get(d.path, (req, res, next) => requireFor(unitsOf(req.query.units))(req, res, next), async (req, res) => {
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
