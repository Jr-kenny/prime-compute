// src/routes/api.v1.providers.ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { getRegistry } from "@/lib/broker/registry";
import { getNetwork } from "@/lib/broker/network";
import { registerProviderFor } from "@/lib/marketplace/service";
import { authAgent, json, errorResponse } from "@/lib/agents/http";
import { parseProviderBody } from "@/lib/agents/validate";
import { defaultTrust } from "@services/trust/trust";

export const Route = createFileRoute("/api/v1/providers")({
  server: {
    handlers: {
      GET: async () => json(await getRegistry().listProviders()),
      POST: async ({ request }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        let b: unknown;
        try { b = await request.json(); } catch { return errorResponse(400, "bad_request", "invalid JSON body"); }
        const parsed = parseProviderBody(b);
        if (!parsed.ok) return errorResponse(400, "bad_request", parsed.message);
        const provider = await registerProviderFor(getRegistry(), principal, {
          ...parsed.value,
          trust: defaultTrust(),
        }, getNetwork());
        return json(provider, 201);
      },
    },
  },
});
