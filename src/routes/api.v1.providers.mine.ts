// src/routes/api.v1.providers.mine.ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { getRegistry } from "@/lib/broker/registry";
import { listMyProvidersFor } from "@/lib/marketplace/service";
import { authAgent, json } from "@/lib/agents/http";

export const Route = createFileRoute("/api/v1/providers/mine")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        return json(await listMyProvidersFor(getRegistry(), principal));
      },
    },
  },
});
