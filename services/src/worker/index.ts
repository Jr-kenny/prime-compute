// services/src/worker/index.ts
import { SupabaseRegistry } from "../registry/supabase";
import { SupabaseSpendWalletStore } from "../wallet/supabase-store";
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../config";
import { liveBrokerDeps } from "../broker/deps";
import { makeSettlementFactory, type Payer } from "./settlement-factory";
import { workerPass, type WorkerDeps } from "./loop";
import { makeNetworkAdapter } from "../network/factory";
import { LeaseHealthTracker } from "./lease-health";
import type { RankStrategy } from "../broker/matching";
import type { DegradationDeps } from "../broker/degradation";
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
// Continuous rental: the Gateway float is a rolling buffer refilled from the EOA in chunks, and a
// lease left suspended for balance is terminated after the grace window.
const TOPUP_UNITS = Number(process.env.WORKER_TOPUP_UNITS ?? "300"); // buffer size (deposit chunk)
const SUSPEND_GRACE_MS = Number(process.env.WORKER_SUSPEND_GRACE_MS ?? String(60 * 60 * 1000)); // 1h
// Throughput: the fleet's payment rate is bounded by concurrency / pay-latency. Each metered
// second is one x402 round trip (~1-2s), so 10 lanes tops out near 5-10 payments/sec TOTAL and
// a fleet of 30 per-second leases visibly lags its own meter. 40 lanes covers that fleet at
// real-time cadence; PER_TICK_CAP bounds how many catch-up seconds one lease can bill per pass.
// It must beat the worst-case pass latency in seconds or a lagging lease falls behind forever
// (at 10, a lease visited every 18s billed 10 and the deficit grew without bound), and it must
// not exceed the provider's maxUnitsPerCharge clamp (60) or the recorded units outrun the payment.
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? "40"); // running leases metered at once
const PER_TICK_CAP = Number(process.env.WORKER_PER_TICK_CAP ?? "60"); // max catch-up units per lease per pass

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

// Private connectivity is opt-in: unset NETWORK_SERVICE_URL yields a no-op adapter and leases
// keep getting a plain token exactly as before. When configured, the worker mints VPN access at
// lease open and revokes it at close, all fail-soft so it can never gate the money path.
const network = makeNetworkAdapter({
  NETWORK_SERVICE_URL: process.env.NETWORK_SERVICE_URL,
  NETWORK_SERVICE_SECRET: process.env.NETWORK_SERVICE_SECRET,
});
if (process.env.NETWORK_SERVICE_URL) console.log("[worker] private connectivity enabled via network service");

// The soul-driven ranker AND degradation responder, both reasoning from the shipped soul with the
// deterministic scorer / migrate-to-best as the built-in fallback inside decide(). If LLM_* is
// unset we run without either: deterministic ranking, and a degraded provider just retries (no
// autonomous hand-off) rather than migrating.
let rank: RankStrategy | undefined;
let degradation: DegradationDeps | undefined;
try {
  const brokerDeps = await liveBrokerDeps();
  rank = brokerDeps.rank;
  degradation = brokerDeps.degradation;
} catch {
  console.warn("[worker] LLM_* not configured; deterministic ranker and no autonomous migration");
}

// Ephemeral per-lease health tracking that drives hand-off on degradation. Only meaningful with the
// degradation deps wired; its failure streaks live in memory across ticks and reset on restart.
const health = degradation
  ? new LeaseHealthTracker({
      healthOpts: {
        maxConsecutiveFailures: Number(process.env.WORKER_HEALTH_MAX_FAILURES ?? "3"),
        maxLatencyMs: process.env.WORKER_HEALTH_MAX_LATENCY_MS ? Number(process.env.WORKER_HEALTH_MAX_LATENCY_MS) : undefined,
      },
      holdBudget: {
        maxRetries: Number(process.env.WORKER_HOLD_MAX_RETRIES ?? "3"),
        maxDurationMs: Number(process.env.WORKER_HOLD_MAX_MS ?? "30000"),
        maxExtraSpend: BigInt(process.env.WORKER_HOLD_MAX_SPEND_ATOMIC ?? "200000"),
      },
    })
  : undefined;

const deps: WorkerDeps = {
  registry, settlementFor, rank, tickMs: TICK_MS, defaultMaxUnits: DEFAULT_MAX_UNITS,
  feeBps: Number(process.env.PLATFORM_FEE_BPS ?? "0"),
  perTickCap: PER_TICK_CAP,
  health, degradation, maxMigrations: Number(process.env.WORKER_MAX_MIGRATIONS ?? "3"),
  topupUnits: TOPUP_UNITS, suspendGraceMs: SUSPEND_GRACE_MS, concurrency: CONCURRENCY,
  network,
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

// The box OOM-cycles every few hours and Render's free tier exposes no memory graph, so the
// worker narrates its own footprint: one greppable line a minute is enough to see the growth
// curve in the logs and catch the next death with numbers attached.
setInterval(() => {
  const m = process.memoryUsage();
  const mb = (n: number) => Math.round(n / 1048576);
  console.log(`[mem] rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}MB heapTotal=${mb(m.heapTotal)}MB external=${mb(m.external)}MB`);
}, 60_000);

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
