// src/routes/api.v1.rents.$id.cancel.ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { getRegistry } from "@/lib/broker/registry";
import { cancelRentFor } from "@/lib/marketplace/service";
import { authAgent, json, errorResponse } from "@/lib/agents/http";

export const Route = createFileRoute("/api/v1/rents/$id/cancel")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        try {
          return json(await cancelRentFor(getRegistry(), principal, params.id));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "cancel failed";
          return errorResponse(msg === "not your rent" ? 404 : 409, "cannot_cancel", msg);
        }
      },
    },
  },
});
