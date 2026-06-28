import { test, expect } from "bun:test";
import { HealthMonitor } from "./health";

test("stays healthy on a good sample", () => {
  const h = new HealthMonitor();
  expect(h.observe({ ok: true }).healthy).toBe(true);
});

test("goes unhealthy after N consecutive failures", () => {
  const h = new HealthMonitor({ maxConsecutiveFailures: 3 });
  expect(h.observe({ ok: false }).healthy).toBe(true); // 1
  expect(h.observe({ ok: false }).healthy).toBe(true); // 2
  expect(h.observe({ ok: false }).healthy).toBe(false); // 3 -> trips
});

test("a success resets the failure streak", () => {
  const h = new HealthMonitor({ maxConsecutiveFailures: 2 });
  h.observe({ ok: false });
  expect(h.observe({ ok: true }).healthy).toBe(true);
  expect(h.observe({ ok: false }).healthy).toBe(true); // streak was reset, so 1 not 2
});

test("trips on latency over the threshold", () => {
  const h = new HealthMonitor({ maxLatencyMs: 100 });
  expect(h.observe({ ok: true, latencyMs: 250 }).healthy).toBe(false);
});
