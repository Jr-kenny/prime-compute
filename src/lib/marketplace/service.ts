// src/lib/marketplace/service.ts
import type { Registry, NewProvider } from "@services/registry/registry";
import type { Principal, Rent, Provider, RentSpec } from "@services/domain";
import { canCancel } from "@services/rent-transitions";
import type { NetworkAdapter } from "@services/network/adapter";
import { NoNetworkAdapter } from "@services/network/none";
import { walletProviderFor, liveWalletDeps } from "./wallet";

export type NewRentInput = {
  name: string;
  spec: RentSpec;
  estimatedUsage?: number | null;
  maxSpendAtomic?: number | null;
  expiresAt?: string | null;
};
// Provider input minus the fields the service derives (ownerWallet from the principal).
export type NewProviderInput = Omit<NewProvider, "ownerWallet">;

export function createRentFor(reg: Registry, principal: Principal, input: NewRentInput): Promise<Rent> {
  return reg.createRent({
    name: input.name,
    owner: principal,
    spec: input.spec,
    estimatedUsage: input.estimatedUsage ?? null,
    maxSpendAtomic: input.maxSpendAtomic ?? null,
    expiresAt: input.expiresAt ?? null,
  });
}

export function listRentsFor(reg: Registry, principal: Principal): Promise<Rent[]> {
  return reg.listRents(principal.kind === "agent" ? { agentId: principal.id } : { userId: principal.id });
}

function ownsRent(principal: Principal, rent: Rent): boolean {
  return principal.kind === "agent" ? rent.agentId === principal.id : rent.userId === principal.id;
}

export async function getRentFor(reg: Registry, principal: Principal, rentId: string): Promise<Rent | null> {
  const rent = await reg.getRent(rentId);
  return rent && ownsRent(principal, rent) ? rent : null;
}

export async function cancelRentFor(
  reg: Registry,
  principal: Principal,
  rentId: string,
  network: NetworkAdapter = new NoNetworkAdapter(),
): Promise<Rent> {
  const rent = await reg.getRent(rentId);
  if (!rent || !ownsRent(principal, rent)) throw new Error("not your rent");
  if (!canCancel(rent)) throw new Error(`cannot cancel a rent with status "${rent.status}"`);
  // Stopping a lease that already ran is the normal end of a metered rental (the renter paid
  // for exactly what ran), so it completes. Only a rent stopped before it ever started, when
  // nothing ran and nothing was billed, is a cancellation.
  const stopped = rent.startedAt
    ? await reg.updateRent(rentId, { status: "completed", endedAt: new Date().toISOString(), statusReason: "stopped by renter" })
    : await reg.updateRent(rentId, { status: "cancelled", endedAt: new Date().toISOString() });
  // This is a terminal transition the worker never sees (the renter drove it), so revoke here
  // too. Best-effort: the rent is already stopped, and an ephemeral key expires on its own.
  try {
    await network.revokeRentAccess(rentId);
  } catch (e) {
    console.warn(`network revoke failed for cancelled lease ${rentId} (will expire on its own):`, e);
  }
  return stopped;
}

export async function registerProviderFor(
  reg: Registry,
  principal: Principal,
  input: NewProviderInput,
  network: NetworkAdapter = new NoNetworkAdapter(),
): Promise<Provider> {
  const provider = await reg.registerProvider({ ...input, ownerWallet: principal.walletAddress });
  // Put the box on the overlay so leases against it can grant private access. Best-effort: a
  // down/unconfigured network service must never block a provider from listing.
  try {
    const node = await network.ensureProviderNode(provider.id);
    if (node) console.log(`[network] provider ${provider.id} join key issued`);
  } catch (e) {
    console.warn(`network ensureProviderNode failed for provider ${provider.id}:`, e);
  }
  return provider;
}

export function listMyProvidersFor(reg: Registry, principal: Principal): Promise<Provider[]> {
  return reg.listProviders({ ownerWallet: principal.walletAddress });
}

async function requireOwnProvider(reg: Registry, principal: Principal, providerId: string): Promise<Provider> {
  const provider = await reg.getProvider(providerId);
  if (!provider || provider.ownerWallet.toLowerCase() !== principal.walletAddress.toLowerCase()) {
    throw new Error("not your server");
  }
  return provider;
}

// A lease in any of these states still expects this provider to serve (suspended/paused ones
// can come back); only completed/cancelled/failed leases release the listing.
const ACTIVE_RENT_STATUSES = new Set(["queued", "running", "paused", "suspended"]);

export async function setProviderOnlineFor(reg: Registry, principal: Principal, providerId: string, online: boolean): Promise<void> {
  await requireOwnProvider(reg, principal, providerId);
  await reg.setProviderOnline(providerId, online);
}

export async function delistProviderFor(reg: Registry, principal: Principal, providerId: string): Promise<void> {
  await requireOwnProvider(reg, principal, providerId);
  const rents = await reg.listRents({ providerId });
  const active = rents.filter((r) => ACTIVE_RENT_STATUSES.has(r.status));
  if (active.length > 0) {
    throw new Error(
      `this server still has ${active.length} active lease${active.length === 1 ? "" : "s"}; ` +
      "wait for them to end (or toggle the server offline to stop new matches) before deleting",
    );
  }
  await reg.delistProvider(providerId);
}

export async function walletFor(principal: Principal): Promise<{ address: string }> {
  return walletProviderFor(principal, liveWalletDeps(principal)).getOrCreate();
}
