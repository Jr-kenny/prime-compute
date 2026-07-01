// services/src/worker/index.ts
import { SupabaseRegistry } from "../registry/supabase";
import { SupabaseSpendWalletStore } from "../wallet/supabase-store";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../config";
import { liveBrokerDeps } from "../broker/deps";
import { makeSettlementFactory } from "./settlement-factory";
import { workerPass, type WorkerDeps } from "./loop";
import type { RankStrategy } from "../broker/matching";

const cfg = loadConfig();
if (!cfg.supabase) throw new Error("worker needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
const encKey = process.env.SPEND_WALLET_ENC_KEY;
if (!encKey) throw new Error("worker needs SPEND_WALLET_ENC_KEY");

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? "1000");
const DEFAULT_MAX_UNITS = Number(process.env.WORKER_DEFAULT_MAX_UNITS ?? "600"); // ~10 min at 1/s
const LEASE_CAP_ATOMIC = BigInt(process.env.WORKER_LEASE_CAP_ATOMIC ?? "1000000"); // 1 USDC backstop

const registry = new SupabaseRegistry(cfg.supabase.url, cfg.supabase.serviceRoleKey);
const admin = createClient(cfg.supabase.url, cfg.supabase.serviceRoleKey, { auth: { persistSession: false } });
const store = new SupabaseSpendWalletStore(admin, encKey);
const settlementFor = makeSettlementFactory(store, { capAtomic: LEASE_CAP_ATOMIC, rpcUrl: process.env.ARC_RPC_URL });

// The soul-driven ranker, with the deterministic scorer as the built-in fallback inside decide().
// If LLM_* is unset, fall back to no ranker (matchProviders uses its deterministic default).
let rank: RankStrategy | undefined;
try {
  rank = (await liveBrokerDeps()).rank;
} catch {
  console.warn("[worker] LLM_* not configured; using the deterministic ranker");
}

const deps: WorkerDeps = { registry, settlementFor, rank, tickMs: TICK_MS, defaultMaxUnits: DEFAULT_MAX_UNITS };

let running = false;
async function tick() {
  if (running) return; // never overlap passes
  running = true;
  try {
    await workerPass(deps);
  } catch (e) {
    console.error("[worker] pass failed:", e instanceof Error ? e.message : e);
  } finally {
    running = false;
  }
}
setInterval(tick, TICK_MS);
console.log(`[worker] metering loop started (tick ${TICK_MS}ms)`);

// Render's free tier is a WEB service: expose /health so it stays up and an external pinger can keep
// it warm. The metering loop runs regardless; this is just the liveness surface.
const port = Number(process.env.PORT ?? "8787");
Bun.serve({
  port,
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/health") return new Response("ok", { status: 200 });
    return new Response("metering worker", { status: 200 });
  },
});
console.log(`[worker] health server on :${port}`);
