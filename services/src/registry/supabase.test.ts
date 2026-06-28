import { registryContract } from "./contract";
import { SupabaseRegistry } from "./supabase";
import { loadConfig } from "../config";

const cfg = loadConfig();

if (!cfg.supabase) {
  // No Supabase configured — skip the integration contract (unit suite stays green).
  console.log("[supabase.test] SUPABASE_* not set; skipping integration contract.");
} else {
  const { url, serviceRoleKey } = cfg.supabase;
  registryContract("SupabaseRegistry", async () => {
    const reg = new SupabaseRegistry(url, serviceRoleKey);
    // Reset tables so each contract test starts from empty (child rows first).
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
    for (const t of ["ticks", "job_decisions", "settlements", "jobs", "providers"]) {
      const { error } = await db.from(t).delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw new Error(`reset ${t}: ${error.message}`);
    }
    return reg;
  });
}
