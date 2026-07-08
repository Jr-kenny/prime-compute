import type { NetworkAdapter } from "./adapter";

// Default when NETWORK_SERVICE_URL is unset: every call is a silent success returning
// nothing, so the app behaves exactly as it did before connectivity existed.
export class NoNetworkAdapter implements NetworkAdapter {
  async ensureProviderNode(_providerId: string): Promise<{ authKey: string } | null> {
    return null;
  }
  async mintRentAccess(_input: { rentId: string; providerId: string }): Promise<null> {
    return null;
  }
  async revokeRentAccess(_rentId: string): Promise<void> {
    /* no-op */
  }
}
