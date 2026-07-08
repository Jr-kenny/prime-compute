import { makeNetworkAdapter } from "@services/network/factory";
import type { NetworkAdapter } from "@services/network/adapter";

// Server-only. Builds the connectivity adapter from env, one instance per server process.
// Unset NETWORK_SERVICE_URL yields a no-op, so registration/cancel behave exactly as before
// until an operator points this at their deployed network service.
let network: NetworkAdapter | null = null;

export function getNetwork(): NetworkAdapter {
  network ??= makeNetworkAdapter(process.env);
  return network;
}
