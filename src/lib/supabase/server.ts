import { createClient } from "@supabase/supabase-js";

// Server-only client: service-role key. NEVER import this into a browser bundle. Used by the
// bridge server function for find-or-create and session minting.
export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required server-side");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
