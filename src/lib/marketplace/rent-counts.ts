// src/lib/marketplace/rent-counts.ts
// How many rents each provider has served. A rent only carries a providerId once it's been
// matched, so tallying non-null providerIds is an honest "times this service was used" count.

export function tallyRentsByProvider(rents: { providerId?: string | null }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rents) {
    if (r.providerId) counts[r.providerId] = (counts[r.providerId] ?? 0) + 1;
  }
  return counts;
}
