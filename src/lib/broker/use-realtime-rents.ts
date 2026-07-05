import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";

// Push, not poll: subscribe to the user's own rents and refetch the canonical list the instant one
// changes (a charge lands, status flips). We refetch through the existing server-fn rather than map
// the raw DB row on the client, so the numbers stay exactly what the backend reports, no estimate.
// RLS ("rents_owner_select") means the browser only ever sees this user's rows.
export function useRealtimeRents(userId: string | undefined, accessToken: string | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId || !accessToken) return;
    const channel = supabaseBrowser
      .channel(`rents:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rents", filter: `user_id=eq.${userId}` },
        () => queryClient.invalidateQueries({ queryKey: ["rents", "mine", accessToken] }),
      )
      .subscribe();
    return () => {
      supabaseBrowser.removeChannel(channel);
    };
  }, [userId, accessToken, queryClient]);
}
