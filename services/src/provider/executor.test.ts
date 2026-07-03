import { describe, test, expect } from "bun:test";
import { SimulatedExecutor, makeSimulatedExecutor } from "./executor";

test("compute returns an incrementing seq per session", async () => {
  const ex = new SimulatedExecutor({ hasGpu: true });
  expect((await ex.compute("s1")).seq).toBe(0);
  expect((await ex.compute("s1")).seq).toBe(1);
  expect((await ex.compute("s1")).seq).toBe(2);
});

test("sessions are independent", async () => {
  const ex = new SimulatedExecutor({ hasGpu: true });
  await ex.compute("a");
  await ex.compute("a");
  expect((await ex.compute("b")).seq).toBe(0);
  expect((await ex.compute("a")).seq).toBe(2);
});

test("a GPU profile reports gpuUtil, a CPU profile reports zero", async () => {
  const gpu = await new SimulatedExecutor({ hasGpu: true }).compute("s");
  const cpu = await new SimulatedExecutor({ hasGpu: false }).compute("s");
  expect(gpu.gpuUtil).toBeGreaterThan(0);
  expect(cpu.gpuUtil).toBe(0);
});

test("telemetry has the expected shape", async () => {
  const t = await new SimulatedExecutor({ hasGpu: true }).compute("s");
  expect(typeof t.cpu).toBe("number");
  expect(typeof t.ramGb).toBe("number");
  expect(typeof t.gpuUtil).toBe("number");
  expect(typeof t.ts).toBe("number");
});

test("release resets a session's seq", async () => {
  const ex = new SimulatedExecutor({ hasGpu: true });
  await ex.compute("s");
  await ex.compute("s");
  await ex.release("s");
  expect((await ex.compute("s")).seq).toBe(0);
});

test("kind identifies the executor", () => {
  expect(new SimulatedExecutor().kind).toBe("simulated");
});

describe("simulated executors", () => {
  test("compute accrues one unit per heartbeat", async () => {
    const ex = makeSimulatedExecutor("GPU");
    await ex.provision("s1", { region: "US-East" });
    await ex.heartbeat("s1");
    await ex.heartbeat("s1");
    expect(await ex.usage("s1")).toBe(2); // 2 seconds -> 2 units
  });

  test("vpn accrues GB units as bytes transferred grow", async () => {
    const ex = makeSimulatedExecutor("VPN");
    await ex.provision("s1", { exitLocation: "NL", protocol: "WireGuard", bandwidthMbps: 1000, region: "EU" });
    // each heartbeat simulates ~1 GB of transfer
    await ex.heartbeat("s1");
    await ex.heartbeat("s1");
    await ex.heartbeat("s1");
    expect(await ex.usage("s1")).toBe(3); // 3 GB -> 3 units
  });

  test("vpn provision returns a wireguard profile", async () => {
    const ex = makeSimulatedExecutor("VPN");
    const connect = await ex.provision("s1", { exitLocation: "NL", protocol: "WireGuard", bandwidthMbps: 1000, region: "EU" });
    expect((connect as { profile: string }).profile).toContain("[Interface]");
  });

  test("release forgets a session", async () => {
    const ex = makeSimulatedExecutor("GPU");
    await ex.provision("s1", { region: "US-East" });
    await ex.heartbeat("s1");
    await ex.release("s1");
    expect(await ex.usage("s1")).toBe(0);
  });
});
