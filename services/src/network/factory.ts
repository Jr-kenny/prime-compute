import type { NetworkAdapter } from "./adapter";
import { NoNetworkAdapter } from "./none";
import { HttpNetworkAdapter } from "./http";

type NetworkEnv = { NETWORK_SERVICE_URL?: string; NETWORK_SERVICE_SECRET?: string };

// Connectivity is opt-in: no URL means the app runs exactly as before (no-op). A URL with
// no secret is a misconfiguration we surface loudly rather than silently degrade.
export function makeNetworkAdapter(env: NetworkEnv): NetworkAdapter {
  if (!env.NETWORK_SERVICE_URL) return new NoNetworkAdapter();
  if (!env.NETWORK_SERVICE_SECRET)
    throw new Error("NETWORK_SERVICE_SECRET is required when NETWORK_SERVICE_URL is set");
  return new HttpNetworkAdapter({ baseUrl: env.NETWORK_SERVICE_URL, secret: env.NETWORK_SERVICE_SECRET });
}
