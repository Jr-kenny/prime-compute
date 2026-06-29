import { createClient } from "@supabase/supabase-js";

// Browser client: anon key only, safe to ship. RLS is the security boundary.
export const supabaseBrowser = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
);
