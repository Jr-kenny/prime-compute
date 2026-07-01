// src/lib/agents/http.ts
import { requireAgent } from "./store";
import type { Principal } from "@services/domain";

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function errorResponse(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

// Resolve the bearer key to an agent principal, or an error Response the caller returns directly.
export async function authAgent(req: Request): Promise<Principal | Response> {
  const key = bearer(req);
  if (!key) return errorResponse(401, "unauthorized", "missing bearer API key");
  const principal = await requireAgent(key);
  if (!principal) return errorResponse(401, "unauthorized", "invalid or revoked API key");
  return principal;
}
