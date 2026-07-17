import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Rent } from "@services/domain";

type RealtimeRentRow = {
  id?: string;
  status?: Rent["status"];
  provider_id?: string | null;
  total_cost?: number | string;
  started_at?: string | null;
  ended_at?: string | null;
  last_charged_at?: string | null;
  status_reason?: string | null;
  suspended_at?: string | null;
  network_hostname?: string | null;
  network_status?: string | null;
};

function patchRent(rent: Rent, row: RealtimeRentRow): Rent {
  if (row.id !== rent.id) return rent;
  return {
    ...rent,
    status: row.status ?? rent.status,
    providerId: row.provider_id !== undefined ? row.provider_id : rent.providerId,
    totalCost: row.total_cost !== undefined ? Number(row.total_cost) : rent.totalCost,
    startedAt: row.started_at !== undefined ? row.started_at : rent.startedAt,
    endedAt: row.ended_at !== undefined ? row.ended_at : rent.endedAt,
    lastChargedAt: row.last_charged_at !== undefined ? row.last_charged_at : rent.lastChargedAt,
    statusReason: row.status_reason !== undefined ? row.status_reason : rent.statusReason,
    suspendedAt: row.suspended_at !== undefined ? row.suspended_at : rent.suspendedAt,
    networkHostname: row.network_hostname !== undefined ? row.network_hostname : rent.networkHostname,
    networkStatus: row.network_status !== undefined ? row.network_status : rent.networkStatus,
  };
}

// Push, not poll: RLS ("rents_owner_select") limits the stream to the user's rows. A metered rent
// updates once per second, so invalidating the server query for every event turned each nanopayment
// into another auth request + full rent-list response. UPDATE payloads are already the canonical DB
// values: patch the cached rent directly. INSERT/DELETE remain rare and trigger a full reconciliation.
export function useRealtimeRents(userId: string | undefined, accessToken: string | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId || !accessToken) return;
    const channel = supabaseBrowser
      .channel(`rents:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rents", filter: `user_id=eq.${userId}` },
        (payload) => {
          const key = ["rents", "mine", accessToken] as const;
          if (payload.eventType === "UPDATE") {
            const row = payload.new as RealtimeRentRow;
            queryClient.setQueryData<Rent[]>(key, (rents) => rents?.map((rent) => patchRent(rent, row)));
            return;
          }
          queryClient.invalidateQueries({ queryKey: key });
        },
      )
      .subscribe();
    return () => {
      supabaseBrowser.removeChannel(channel);
    };
  }, [userId, accessToken, queryClient]);
}
