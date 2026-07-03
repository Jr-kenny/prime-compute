// src/lib/pricing/rate.ts
// Turns a provider's per-charge price + its service descriptor into display strings. Time types get
// an exact $/day (price * 86400). Volume types can't have an honest fixed per-day without assuming
// usage, so VPN shows a per-100GB example and storage shows $/GB-day (per-GB-hour * 24).
import { descriptorFor } from "@services/services/registry";

export type RateDisplay = {
  streaming: string; // the raw metered rate, e.g. "$0.0000098 /sec"
  human: string;     // a human-reasonable figure, e.g. "$0.85 / day"
  unit: string;      // the descriptor unit
};

const usd = (n: number, dp = 2) => `$${n.toFixed(dp)}`;

export function rateDisplay(resourceType: string, pricePerCharge: number): RateDisplay {
  const d = descriptorFor(resourceType);
  if (d.metering === "time") {
    return { streaming: `$${pricePerCharge.toFixed(7)} /sec`, human: `${usd(pricePerCharge * 86400)} / day`, unit: d.unit };
  }
  if (d.unit === "GB") {
    return { streaming: `$${pricePerCharge.toFixed(4)} /GB`, human: `${usd(pricePerCharge * 100)} per 100 GB`, unit: d.unit };
  }
  return { streaming: `$${pricePerCharge.toFixed(6)} /GB-hour`, human: `${usd(pricePerCharge * 24)} / GB-day`, unit: d.unit };
}
