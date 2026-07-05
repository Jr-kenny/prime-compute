import { registryContract } from "./contract";
import { SupabaseRegistry } from "./supabase";
import { loadConfig } from "../config";

// This contract test DELETES every row in charges/rents/providers/etc before it runs, so it must
// never touch a real database. It deliberately does NOT use the app's SUPABASE_URL (which normally
// points at production). Instead it requires a separate, throwaway test project via TEST_SUPABASE_URL
// + TEST_SUPABASE_SERVICE_ROLE_KEY. Without those, it skips, so a plain `bun test` can't wipe prod.
const url = process.env.TEST_SUPABASE_URL;
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const prodUrl = loadConfig().supabase?.url;

if (!url || !serviceRoleKey) {
  console.log("[supabase.test] TEST_SUPABASE_URL/TEST_SUPABASE_SERVICE_ROLE_KEY not set; skipping destructive integration contract.");
} else if (prodUrl && url === prodUrl) {
  // Someone pointed the test DB at the app's real DB. Refuse rather than delete live data.
  throw new Error("[supabase.test] TEST_SUPABASE_URL must be a throwaway DB, not the app's SUPABASE_URL. Refusing to run the destructive contract against production.");
} else {
  registryContract("SupabaseRegistry", async () => {
    const reg = new SupabaseRegistry(url, serviceRoleKey);
    // Reset tables so each contract test starts from empty (child rows first).
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
    for (const t of ["charges", "rent_decisions", "settlements", "rents", "providers"]) {
      const { error } = await db.from(t).delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw new Error(`reset ${t}: ${error.message}`);
    }
    return reg;
  });
}
