import { test, expect } from "bun:test";
import { loadConfig } from "./config";

test("loadConfig reads required kimchi vars", () => {
  const cfg = loadConfig({
    KIMCHI_BASE_URL: "https://llm.kimchi.dev/openai/v1",
    KIMCHI_API_KEY: "test-key",
    KIMCHI_MODEL: "kimi-k2.6",
  });
  expect(cfg.kimchi.baseUrl).toBe("https://llm.kimchi.dev/openai/v1");
  expect(cfg.kimchi.apiKey).toBe("test-key");
  expect(cfg.kimchi.model).toBe("kimi-k2.6");
});

test("loadConfig throws a clear error when a required var is missing", () => {
  expect(() => loadConfig({ KIMCHI_BASE_URL: "x" })).toThrow(/KIMCHI_API_KEY/);
});
