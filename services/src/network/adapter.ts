// The only place private-network access is provisioned, behind one interface so the
// worker never talks to a VPN control plane directly. An operator-deployed service
// implements the wire side; the app just calls these three methods (or a no-op).
export type RentAccess = {
  authKey: string; // the credential the renter runs `tailscale up --authkey=` with
  hostname: string; // the box's private hostname to connect to
};

export interface NetworkAdapter {
  /** Put a provider box on the network at registration. Returns an auth key for the box,
   * or null when no network is configured. */
  ensureProviderNode(providerId: string): Promise<{ authKey: string } | null>;
  /** Grant this renter access to exactly this provider for this lease. Returns null when
   * no network is configured (caller falls back to a plain token). */
  mintRentAccess(input: { rentId: string; providerId: string }): Promise<RentAccess | null>;
  /** Revoke a lease's access. Idempotent; safe on a lease that never got access. */
  revokeRentAccess(rentId: string): Promise<void>;
}
