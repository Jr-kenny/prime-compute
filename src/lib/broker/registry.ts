import { supabaseAdmin } from "../supabase/server";
import { SupabaseRegistry } from "@services/registry/supabase";

// Server-only. Reuses the same service-role client the auth bridge already uses
// (src/lib/supabase/server.ts), one registry instance per server process.
let registry: SupabaseRegistry | null = null;

export function getRegistry(): SupabaseRegistry {
  registry ??= new SupabaseRegistry(supabaseAdmin());
  return registry;
}
