// Trust is a pluggable profile, not a hardcoded stake check. The runtime reasons only
// over `tier` (a deterministic gate); the broker soul reasons over `signals`. How a
// provider reaches a tier (verification, collateral, SLA) is not the runtime's concern.

export const TIERS = ["Community", "Verified", "Bonded", "Enterprise"] as const;
export type Tier = (typeof TIERS)[number];

export const DEFAULT_TIER: Tier = "Community";

export interface TrustProfile {
  tier: Tier;
  signals: {
    uptime: number;            // observed reliability (0..1)
    successfulRentals: number; // history
    health: "healthy" | "degraded";
    verification: boolean;     // identity / hardware verified
    collateral?: { amount: number; asset: "USDC" }; // optional economic bond (a Bonded signal)
  };
}

// The whole trust gate: does a provider's tier meet (or exceed) what a rent requires?
export function meetsTier(have: Tier, need: Tier): boolean {
  return TIERS.indexOf(have) >= TIERS.indexOf(need);
}

// A neutral Community profile. Used wherever a Provider is constructed without a richer
// profile (seeds, tests, the default a registry assigns). Returns a fresh object so
// callers can mutate signals without aliasing.
export function defaultTrust(tier: Tier = DEFAULT_TIER): TrustProfile {
  return { tier, signals: { uptime: 1, successfulRentals: 0, health: "healthy", verification: false } };
}
