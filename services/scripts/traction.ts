// services/scripts/traction.ts
// Daily traction snapshot for the Canteen submission. Read-only: calls the traction_summary()
// DB function and prints the numbers plus a paste-ready line for `arc-canteen update traction`.
// Run: cd services && bun run traction
import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "../src/config";

const cfg = loadConfig();
if (!cfg.supabase) throw new Error("need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in services/.env");

const db = createClient(cfg.supabase.url, cfg.supabase.serviceRoleKey);
const { data, error } = await db.rpc("traction_summary");
if (error) throw error;

const t = data as {
  as_of: string;
  volume_usdc: number;
  nanopayments: number;
  gateway_transfers: number;
  rents_total: number;
  rents_active: number;
  rents_completed: number;
  users: number;
  agents: number;
  providers_online: number;
  first_charge: string | null;
  last_charge: string | null;
};

const vol = Number(t.volume_usdc).toFixed(6);

console.log(`
Prime Compute — traction as of ${t.as_of}

  Volume streamed    ${vol} USDC
  Nanopayments       ${t.nanopayments.toLocaleString()}   (Circle Gateway transfers on Arc, not L1 tx hashes)
  Rents              ${t.rents_total} total · ${t.rents_active} active · ${t.rents_completed} completed
  Users / agents     ${t.users} users · ${t.agents} agents
  Providers online   ${t.providers_online}
  First charge       ${t.first_charge ?? "—"}
  Last charge        ${t.last_charge ?? "—"}

Paste-ready for arc-canteen update traction:
  volume_usdc=${vol} nanopayments=${t.nanopayments} users=${t.users} agents=${t.agents} providers_online=${t.providers_online}
`);
