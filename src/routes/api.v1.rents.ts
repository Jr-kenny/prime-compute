// src/routes/api.v1.rents.ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { getRegistry } from "@/lib/broker/registry";
import { createRentFor, listRentsFor } from "@/lib/marketplace/service";
import { authAgent, json, errorResponse } from "@/lib/agents/http";
import type { ResourceType } from "@services/domain";

export const Route = createFileRoute("/api/v1/rents")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        return json(await listRentsFor(getRegistry(), principal));
      },
      POST: async ({ request }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        let b: any;
        try { b = await request.json(); } catch { return errorResponse(400, "bad_request", "invalid JSON body"); }
        if (!b?.name || !b?.resourceType) return errorResponse(400, "bad_request", "name and resourceType are required");
        const rent = await createRentFor(getRegistry(), principal, {
          name: String(b.name),
          spec: { resourceType: b.resourceType as ResourceType, region: b.region ?? null },
          estimatedUsage: typeof b.estimatedUsage === "number" ? b.estimatedUsage : null,
        });
        return json(rent, 201); // queued; the metering worker provisions + meters it
      },
    },
  },
});
