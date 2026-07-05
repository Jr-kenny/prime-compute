// src/components/site/streaming-value.test.ts
import { test, expect } from "bun:test";
import { streamingValue, MAX_LEAD_SECONDS } from "./streaming-value";

const base = 0.001; // real charged so far, USDC
const at = 1_000_000; // baseline observed at t=1_000_000ms
const rate = 0.0001; // USDC/sec nominal

test("starts at the real baseline when no time has passed", () => {
  expect(streamingValue(base, at, rate, at, false)).toBeCloseTo(base, 9);
});

test("creeps forward from the real baseline at the nominal rate", () => {
  expect(streamingValue(base, at, rate, at + 2000, false)).toBeCloseTo(base + rate * 2, 9);
});

test("paused holds at the real baseline", () => {
  expect(streamingValue(base, at, rate, at + 60_000, true)).toBeCloseTo(base, 9);
});

test("lead is bounded so a lagging or stalled meter can never run away", () => {
  // 10 minutes later, but the extrapolation is capped at MAX_LEAD_SECONDS of spend.
  const capped = base + rate * MAX_LEAD_SECONDS;
  expect(streamingValue(base, at, rate, at + 600_000, false)).toBeCloseTo(capped, 9);
});

test("never goes below the real baseline even if the clock is behind", () => {
  expect(streamingValue(base, at, rate, at - 5000, false)).toBe(base);
});
