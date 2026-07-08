import type { NetworkAdapter } from "./adapter";

// Default when NETWORK_SERVICE_URL is unset: every call is a silent success returning
// nothing, so the app behaves exactly as it did before connectivity existed.
export class NoNetworkAdapter implements NetworkAdapter {
  async ensureProviderNode(): Promise<{ authKey: string } | null> {
    return null;
  }
  async mintRentAccess(): Promise<null> {
    return null;
  }
  async revokeRentAccess(): Promise<void> {
    /* no-op */
  }
}
