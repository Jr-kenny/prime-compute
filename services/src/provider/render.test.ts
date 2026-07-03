import { describe, test, expect } from "bun:test";
import { RenderExecutor, type RenderApi } from "./render";

const fakeApi = (): RenderApi => ({
  createService: async () => ({ id: "srv-1", host: "srv-1.onrender.com" }),
  deleteService: async () => {},
});

describe("RenderExecutor", () => {
  test("conforms to ServiceExecutor and provisions a real host", async () => {
    const ex = new RenderExecutor("GPU", fakeApi());
    const connect = await ex.provision("s1", { region: "US-East" });
    expect((connect as { host: string }).host).toBe("srv-1.onrender.com");
    expect(await ex.usage("s1")).toBe(0);
    await ex.heartbeat("s1");
    expect(await ex.usage("s1")).toBe(1);
    await ex.release("s1"); // tears down via api.deleteService
  });
});
