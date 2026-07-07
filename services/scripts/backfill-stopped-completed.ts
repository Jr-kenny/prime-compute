// services/scripts/backfill-stopped-completed.ts
// One-off backfill for the stop-semantics change (commit ffb25e4): rents that were stopped
// after they started were historically stamped 'cancelled'; under the new rule they are
// 'completed' (metered rental: the renter paid for what ran). Rents cancelled before they
// ever started keep 'cancelled'. Prints the affected rows, applies the update, verifies.
// Run: cd services && bun run scripts/backfill-stopped-completed.ts
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

const cfg = loadConfig();
if (!cfg.supabase) throw new Error("need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in services/.env");

const db = createClient(cfg.supabase.url, cfg.supabase.serviceRoleKey);

const { data: before, error: selErr } = await db
  .from("rents")
  .select("id, name, status, started_at, total_cost")
  .eq("status", "cancelled")
  .not("started_at", "is", null);
if (selErr) throw selErr;

console.log(`rents to reclassify (cancelled but had started): ${before?.length ?? 0}`);
for (const r of before ?? []) {
  console.log(`  ${r.name}  started ${r.started_at}  cost ${r.total_cost} atomic ($${(r.total_cost / 1_000_000).toFixed(6)})`);
}

if (!before?.length) {
  console.log("nothing to do");
  process.exit(0);
}

const { error: updErr } = await db
  .from("rents")
  .update({ status: "completed", status_reason: "stopped by renter" })
  .eq("status", "cancelled")
  .not("started_at", "is", null);
if (updErr) throw updErr;

const { count, error: verErr } = await db
  .from("rents")
  .select("id", { count: "exact", head: true })
  .eq("status", "cancelled")
  .not("started_at", "is", null);
if (verErr) throw verErr;

console.log(`done: ${before.length} rents reclassified as completed; ${count ?? 0} started-but-cancelled rows remain`);
