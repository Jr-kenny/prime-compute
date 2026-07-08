import type { NetworkAdapter, RentAccess } from "./adapter";

export type FakeNetworkOptions = { failMint?: boolean; failRevoke?: boolean };

// Deterministic, no network. Records grants/revocations so lifecycle tests can assert
// the worker called it at the right moments.
export class FakeNetworkAdapter implements NetworkAdapter {
  granted = new Map<string, string>(); // rentId -> providerId
  revoked: string[] = [];
  nodes: string[] = []; // providerIds passed to ensureProviderNode

  constructor(private opts: FakeNetworkOptions = {}) {}

  async ensureProviderNode(providerId: string): Promise<{ authKey: string }> {
    this.nodes.push(providerId);
    return { authKey: `tskey-node-${providerId}` };
  }

  async mintRentAccess(input: { rentId: string; providerId: string }): Promise<RentAccess> {
    if (this.opts.failMint) throw new Error("network down");
    this.granted.set(input.rentId, input.providerId);
    return { authKey: `tskey-${input.rentId}`, hostname: `box-${input.providerId}` };
  }

  async revokeRentAccess(rentId: string): Promise<void> {
    if (this.opts.failRevoke) throw new Error("revoke failed");
    this.granted.delete(rentId);
    this.revoked.push(rentId);
  }
}
