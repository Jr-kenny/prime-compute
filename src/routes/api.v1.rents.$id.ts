// src/routes/api.v1.rents.$id.ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { getRegistry } from "@/lib/broker/registry";
import { getRentFor } from "@/lib/marketplace/service";
import { authAgent, json, errorResponse } from "@/lib/agents/http";

export const Route = createFileRoute("/api/v1/rents/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        const rent = await getRentFor(getRegistry(), principal, params.id);
        if (!rent) return errorResponse(404, "not_found", "no such rent");
        const provider = rent.providerId ? await getRegistry().getProvider(rent.providerId) : null;
        const connect = rent.status === "running" && rent.leaseAccessToken && provider
          ? { endpointUrl: provider.endpointUrl, accessToken: rent.leaseAccessToken }
          : null;
        return json({ ...rent, connect });
      },
    },
  },
});
