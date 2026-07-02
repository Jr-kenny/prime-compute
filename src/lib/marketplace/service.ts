// src/lib/marketplace/service.ts
import type { Registry, NewProvider } from "@services/registry/registry";
import type { Principal, Rent, Provider, RentSpec } from "@services/domain";
import { canCancel } from "@services/rent-transitions";
import { walletProviderFor, liveWalletDeps } from "./wallet";

export type NewRentInput = { name: string; spec: RentSpec; estimatedUsage?: number | null };
// Provider input minus the fields the service derives (ownerWallet from the principal).
export type NewProviderInput = Omit<NewProvider, "ownerWallet">;

export function createRentFor(reg: Registry, principal: Principal, input: NewRentInput): Promise<Rent> {
  return reg.createRent({ name: input.name, owner: principal, spec: input.spec, estimatedUsage: input.estimatedUsage ?? null });
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

export async function walletFor(principal: Principal): Promise<{ address: string }> {
  return walletProviderFor(principal, liveWalletDeps(principal)).getOrCreate();
}
