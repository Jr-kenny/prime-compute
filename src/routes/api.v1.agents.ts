// src/routes/api.v1.agents.ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { createAgent } from "@/lib/agents/store";
import { json, errorResponse } from "@/lib/agents/http";

export const Route = createFileRoute("/api/v1/agents")({
  server: {
    handlers: {
      // Open self-serve registration. Returns { agentId, apiKey, walletAddress }; apiKey shown once.
      POST: async ({ request }) => {
        let label: string | undefined;
        try {
          const body = request.headers.get("content-type")?.includes("application/json") ? await request.json() : {};
          if (typeof body?.label === "string") label = body.label.slice(0, 120);
        } catch {
          return errorResponse(400, "bad_request", "invalid JSON body");
        }
        const agent = await createAgent(label);
        return json(agent, 201);
      },
    },
  },
});
