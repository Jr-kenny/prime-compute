// src/routes/api.v1.providers.ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { getRegistry } from "@/lib/broker/registry";
import { registerProviderFor } from "@/lib/marketplace/service";
import { authAgent, json, errorResponse } from "@/lib/agents/http";
import { defaultTrust } from "@services/trust/trust";
import type { ResourceType } from "@services/domain";

export const Route = createFileRoute("/api/v1/providers")({
  server: {
    handlers: {
      GET: async () => json(await getRegistry().listProviders()),
      POST: async ({ request }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        let b: any;
        try { b = await request.json(); } catch { return errorResponse(400, "bad_request", "invalid JSON body"); }
        if (!b?.alias || !b?.endpointUrl || !b?.resourceType || !b?.region || typeof b?.pricePerCharge !== "number") {
          return errorResponse(400, "bad_request", "alias, endpointUrl, resourceType, region, pricePerCharge are required");
        }
        const provider = await registerProviderFor(getRegistry(), principal, {
          alias: String(b.alias), endpointUrl: String(b.endpointUrl),
          resourceType: b.resourceType as ResourceType, region: String(b.region),
          specs: (b.specs ?? {}) as Record<string, unknown>, online: b.online ?? true,
          trust: defaultTrust(), pricePerCharge: b.pricePerCharge, avgLatencyMs: b.avgLatencyMs ?? 0,
        });
        return json(provider, 201);
      },
    },
  },
});
