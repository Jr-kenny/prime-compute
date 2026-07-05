// src/components/site/streaming-value.ts
// The displayed streaming spend, anchored to the real charged total. We show the real baseline
// (last polled `totalCost`) plus a small forward creep at the nominal rate, so the number feels
// live between polls without ever running away from reality: the lead is capped at
// MAX_LEAD_SECONDS, and each poll re-anchors the baseline. This is why the old ticker drifted:
// it extrapolated from the lease start at the full rate with no anchor to what was actually charged.

export const MAX_LEAD_SECONDS = 5;

export function streamingValue(
  baselineValue: number,
  baselineAtMs: number,
  ratePerSecond: number,
  nowMs: number,
  paused: boolean | undefined,
): number {
  if (paused) return baselineValue;
  const elapsed = Math.max(0, (nowMs - baselineAtMs) / 1000);
  const lead = Math.min(elapsed, MAX_LEAD_SECONDS);
  return baselineValue + lead * ratePerSecond;
}
