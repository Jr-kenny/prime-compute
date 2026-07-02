// src/lib/agents/validate.ts
// Input validation for the agent-facing REST API. The DB has check constraints for some of
// this, but letting bad input reach Postgres turns agent typos into opaque 500s; these
// return the 400 message the agent needs to self-correct.
import { RESOURCE_TYPES, type ResourceType } from "@services/domain";

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function fail(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

function isResourceType(v: unknown): v is ResourceType {
  return typeof v === "string" && (RESOURCE_TYPES as readonly string[]).includes(v);
}

const resourceTypeMsg = `resourceType must be one of: ${RESOURCE_TYPES.join(", ")}`;

export type RentBody = {
  name: string;
  resourceType: ResourceType;
  region: string | null;
  estimatedUsage: number | null;
};

export function parseRentBody(b: unknown): Parsed<RentBody> {
  const o = (b ?? {}) as Record<string, unknown>;
  if (typeof o.name !== "string" || !o.name.trim()) return fail("name is required");
  if (!isResourceType(o.resourceType)) return fail(resourceTypeMsg);
  if (o.region !== undefined && o.region !== null && typeof o.region !== "string") return fail("region must be a string");
  if (o.estimatedUsage !== undefined && o.estimatedUsage !== null && !Number.isFinite(o.estimatedUsage)) {
    return fail("estimatedUsage must be a number");
  }
  return {
    ok: true,
    value: {
      name: o.name.trim().slice(0, 200),
      resourceType: o.resourceType,
      region: (o.region as string | undefined) ?? null,
      estimatedUsage: typeof o.estimatedUsage === "number" ? o.estimatedUsage : null,
    },
  };
}

export type ProviderBody = {
  alias: string;
  endpointUrl: string;
  resourceType: ResourceType;
  region: string;
  specs: Record<string, unknown>;
  online: boolean;
  pricePerCharge: number;
  avgLatencyMs: number;
};

export function parseProviderBody(b: unknown, opts?: EndpointOpts): Parsed<ProviderBody> {
  const o = (b ?? {}) as Record<string, unknown>;
  if (typeof o.alias !== "string" || !o.alias.trim()) return fail("alias is required");
  if (typeof o.endpointUrl !== "string") return fail("endpointUrl is required");
  const endpointErr = checkEndpointUrl(o.endpointUrl, opts);
  if (endpointErr) return fail(endpointErr);
  if (!isResourceType(o.resourceType)) return fail(resourceTypeMsg);
  if (typeof o.region !== "string" || !o.region.trim()) return fail("region is required");
  if (typeof o.pricePerCharge !== "number" || !Number.isFinite(o.pricePerCharge) || o.pricePerCharge <= 0) {
    return fail("pricePerCharge must be a positive number");
  }
  if (o.avgLatencyMs !== undefined && (!Number.isFinite(o.avgLatencyMs) || (o.avgLatencyMs as number) < 0)) {
    return fail("avgLatencyMs must be a non-negative number");
  }
  return {
    ok: true,
    value: {
      alias: o.alias.trim().slice(0, 120),
      endpointUrl: o.endpointUrl,
      resourceType: o.resourceType,
      region: o.region.trim(),
      specs: (o.specs && typeof o.specs === "object" ? o.specs : {}) as Record<string, unknown>,
      online: o.online === undefined ? true : Boolean(o.online),
      pricePerCharge: o.pricePerCharge,
      avgLatencyMs: typeof o.avgLatencyMs === "number" ? o.avgLatencyMs : 0,
    },
  };
}

export type EndpointOpts = { allowPrivate?: boolean };

// The metering worker fetches this URL to pay for compute, so an unchecked value is a
// server-side request to wherever the registrant points it. Loopback/private/metadata hosts
// are refused unless explicitly allowed (local demos set ALLOW_PRIVATE_PROVIDER_ENDPOINTS;
// seeds bypass REST and are unaffected). Returns null when valid, else the 400 message.
export function checkEndpointUrl(raw: string, opts: EndpointOpts = {}): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "endpointUrl must be an absolute URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "endpointUrl must use http or https";
  if (url.username || url.password) return "endpointUrl must not embed credentials";

  const allowPrivate = opts.allowPrivate ?? process.env.ALLOW_PRIVATE_PROVIDER_ENDPOINTS === "true";
  if (allowPrivate) return null;

  const host = url.hostname.toLowerCase();
  const privateHost =
    host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" ||
    host === "[::1]" || host === "::1" ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (privateHost) return "endpointUrl must be publicly reachable (loopback/private hosts are not allowed)";
  return null;
}
