// src/lib/marketplace/service.ts
import type { Registry, NewProvider } from "@services/registry/registry";
import type { Principal, Rent, Provider, RentSpec } from "@services/domain";
import { canCancel } from "@services/rent-transitions";
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

export async function cancelRentFor(reg: Registry, principal: Principal, rentId: string): Promise<Rent> {
  const rent = await reg.getRent(rentId);
  if (!rent || !ownsRent(principal, rent)) throw new Error("not your rent");
  if (!canCancel(rent)) throw new Error(`cannot cancel a rent with status "${rent.status}"`);
  return reg.updateRent(rentId, { status: "cancelled", endedAt: new Date().toISOString() });
}

export function registerProviderFor(reg: Registry, principal: Principal, input: NewProviderInput): Promise<Provider> {
  return reg.registerProvider({ ...input, ownerWallet: principal.walletAddress });
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
