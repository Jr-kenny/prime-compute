// services/src/worker/index.ts
import { SupabaseRegistry } from "../registry/supabase";
import { SupabaseSpendWalletStore } from "../wallet/supabase-store";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../config";
import { liveBrokerDeps } from "../broker/deps";
import { makeSettlementFactory, type Payer } from "./settlement-factory";
import { workerPass, type WorkerDeps } from "./loop";
import type { RankStrategy } from "../broker/matching";
import { CircleWalletStore, makeCircleClient } from "../wallet/circle";
import { handleRemittance } from "./remit";
import { transferredToTreasury, makeReceiptReader } from "./verify-remittance";
import type { Rent } from "../domain";

const cfg = loadConfig();
if (!cfg.supabase) throw new Error("worker needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
const encKey = process.env.SPEND_WALLET_ENC_KEY;
if (!encKey) throw new Error("worker needs SPEND_WALLET_ENC_KEY");

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? "1000");
const DEFAULT_MAX_UNITS = Number(process.env.WORKER_DEFAULT_MAX_UNITS ?? "600"); // ~10 min at 1/s
const LEASE_CAP_ATOMIC = BigInt(process.env.WORKER_LEASE_CAP_ATOMIC ?? "1000000"); // 1 USDC backstop

const registry = new SupabaseRegistry(cfg.supabase.url, cfg.supabase.serviceRoleKey);
const admin = createClient(cfg.supabase.url, cfg.supabase.serviceRoleKey, { auth: { persistSession: false } });
// A lease pays from its owner's wallet: agent leases from agent_wallets, user leases from spend_wallets.
const userStore = new SupabaseSpendWalletStore(admin, encKey);
const agentStore = new SupabaseSpendWalletStore(admin, encKey, { table: "agent_wallets", idColumn: "agent_id" });

// Circle-custodied wallets win when the principal has one; legacy enc-key wallets keep
// paying for everyone provisioned before the switch. Zero keys for anything new.
const circleSetId = process.env.CIRCLE_WALLET_SET_ID;
const circleStore = circleSetId ? new CircleWalletStore(admin, makeCircleClient(), circleSetId) : null;

const loadPayer = async (rent: Rent): Promise<Payer | null> => {
  const kind = rent.agentId ? ("agent" as const) : ("user" as const);
  const ownerId = rent.agentId ?? rent.userId!;
  if (circleStore) {
    const cw = await circleStore.get(kind, ownerId);
    if (cw) return { kind: "circle", walletId: cw.walletId, address: cw.address };
  }
  const signer = rent.agentId ? await agentStore.loadSigner(rent.agentId) : await userStore.loadSigner(rent.userId!);
  return signer ? { kind: "raw", signer } : null;
};

const settlementFor = makeSettlementFactory(loadPayer, {
  capAtomic: LEASE_CAP_ATOMIC, rpcUrl: process.env.ARC_RPC_URL, usdcAddress: process.env.USDC_ADDRESS,
});

// The soul-driven ranker, with the deterministic scorer as the built-in fallback inside decide().
// If LLM_* is unset, fall back to no ranker (matchProviders uses its deterministic default).
let rank: RankStrategy | undefined;
try {
  rank = (await liveBrokerDeps()).rank;
} catch {
  console.warn("[worker] LLM_* not configured; using the deterministic ranker");
}

const deps: WorkerDeps = {
  registry, settlementFor, rank, tickMs: TICK_MS, defaultMaxUnits: DEFAULT_MAX_UNITS,
  feeBps: Number(process.env.PLATFORM_FEE_BPS ?? "0"),
};

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
const treasury = process.env.PLATFORM_TREASURY_ADDRESS;
const usdc = process.env.USDC_ADDRESS;
const rpcUrl = process.env.ARC_RPC_URL;
const remitReady = Boolean(treasury && usdc && rpcUrl);
const reader = remitReady ? makeReceiptReader(rpcUrl!) : null;
if (!remitReady) console.warn("[worker] remittance endpoint disabled (needs PLATFORM_TREASURY_ADDRESS, USDC_ADDRESS, ARC_RPC_URL)");

Bun.serve({
  port,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/health") return new Response("ok", { status: 200 });
    // Providers report fee remittances here; this must be publicly reachable (Render
    // exposes only $PORT, which is why it rides the health server, not its own port).
    if (pathname === "/remittances" && req.method === "POST" && remitReady) {
      return handleRemittance(req, {
        registry,
        verify: (txHash) => transferredToTreasury(reader!, txHash, usdc!, treasury!),
      });
    }
    return new Response("metering worker", { status: 200 });
  },
});
console.log(`[worker] health + remittance server on :${port}`);
