import { test, expect } from "bun:test";
import { SimulatedExecutor } from "./executor";

test("tick returns an incrementing seq per session", async () => {
  const ex = new SimulatedExecutor({ hasGpu: true });
  expect((await ex.tick("s1")).seq).toBe(0);
  expect((await ex.tick("s1")).seq).toBe(1);
  expect((await ex.tick("s1")).seq).toBe(2);
});

test("sessions are independent", async () => {
  const ex = new SimulatedExecutor({ hasGpu: true });
  await ex.tick("a");
  await ex.tick("a");
  expect((await ex.tick("b")).seq).toBe(0);
  expect((await ex.tick("a")).seq).toBe(2);
});

test("a GPU profile reports gpuUtil, a CPU profile reports zero", async () => {
  const gpu = await new SimulatedExecutor({ hasGpu: true }).tick("s");
  const cpu = await new SimulatedExecutor({ hasGpu: false }).tick("s");
  expect(gpu.gpuUtil).toBeGreaterThan(0);
  expect(cpu.gpuUtil).toBe(0);
});

test("telemetry has the expected shape", async () => {
  const t = await new SimulatedExecutor({ hasGpu: true }).tick("s");
  expect(typeof t.cpu).toBe("number");
  expect(typeof t.ramGb).toBe("number");
  expect(typeof t.gpuUtil).toBe("number");
  expect(typeof t.ts).toBe("number");
});

test("release resets a session's seq", async () => {
  const ex = new SimulatedExecutor({ hasGpu: true });
  await ex.tick("s");
  await ex.tick("s");
  await ex.release("s");
  expect((await ex.tick("s")).seq).toBe(0);
});

test("kind identifies the executor", () => {
  expect(new SimulatedExecutor().kind).toBe("simulated");
});
