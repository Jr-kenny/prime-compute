import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "../supabase/client";

// The current application session, sourced from Supabase. The wallet address (the identity
// anchor) rides in user_metadata, set when the user was provisioned.
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabaseBrowser.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return {
    session,
    loading,
    user: session?.user ?? null,
    walletAddress: (session?.user?.user_metadata?.wallet_address as string | undefined) ?? null,
    signOut: () => supabaseBrowser.auth.signOut(),
  };
}
