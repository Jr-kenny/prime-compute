// src/lib/marketplace/first-party.ts
// Which listings are our own demo/simulation boxes. Only these get the "Simulation" badge, so a
// renter can tell our demo hardware from real third-party providers. Configurable via
// VITE_FIRST_PARTY_WALLETS (comma-separated), defaulting to the seeded demo owner wallets.
import type { Provider } from "@services/domain";

const DEFAULT_FIRST_PARTY = ["0xa11ce", "0xb0b", "0xc4r0l", "0xd4ve", "0xe1e", "0xf00d"];

export function firstPartyWallets(): Set<string> {
  const raw = (import.meta.env?.VITE_FIRST_PARTY_WALLETS as string | undefined) ?? "";
  const list = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set(list.length ? list : DEFAULT_FIRST_PARTY);
}

export function isFirstParty(p: Pick<Provider, "ownerWallet">, wallets: Set<string> = firstPartyWallets()): boolean {
  return wallets.has(p.ownerWallet.toLowerCase());
}
