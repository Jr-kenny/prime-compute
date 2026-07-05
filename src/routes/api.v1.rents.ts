// src/routes/api.v1.rents.ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { getRegistry } from "@/lib/broker/registry";
import { createRentFor, listRentsFor } from "@/lib/marketplace/service";
import { authAgent, json, errorResponse } from "@/lib/agents/http";
import { parseRentBody } from "@/lib/agents/validate";

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
        let b: unknown;
        try { b = await request.json(); } catch { return errorResponse(400, "bad_request", "invalid JSON body"); }
        const parsed = parseRentBody(b);
        if (!parsed.ok) return errorResponse(400, "bad_request", parsed.message);
        const rent = await createRentFor(getRegistry(), principal, {
          name: parsed.value.name,
          spec: { resourceType: parsed.value.resourceType, region: parsed.value.region },
          estimatedUsage: parsed.value.estimatedUsage,
          maxSpendAtomic: parsed.value.maxSpendUsdc ? Math.round(Number(parsed.value.maxSpendUsdc) * 1_000_000) : null,
          expiresAt: parsed.value.durationMs ? new Date(Date.now() + parsed.value.durationMs).toISOString() : null,
        });
        return json(rent, 201); // queued; the metering worker provisions + meters it
      },
    },
  },
});
