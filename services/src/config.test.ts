import { test, expect } from "bun:test";
import { loadConfig } from "./config";

test("loadConfig reads required llm vars", () => {
  const cfg = loadConfig({
    LLM_BASE_URL: "https://integrate.api.nvidia.com/v1",
    LLM_API_KEY: "test-key",
    LLM_MODEL: "meta/llama-3.3-70b-instruct",
  });
  expect(cfg.llm.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
  expect(cfg.llm.apiKey).toBe("test-key");
  expect(cfg.llm.model).toBe("meta/llama-3.3-70b-instruct");
});

test("loadConfig throws a clear error when a required var is missing", () => {
  expect(() => loadConfig({ LLM_BASE_URL: "x" })).toThrow(/LLM_API_KEY/);
});

test("supabase config is null when its vars are absent", () => {
  const cfg = loadConfig({ LLM_BASE_URL: "x", LLM_API_KEY: "y" });
  expect(cfg.supabase).toBeNull();
});

test("supabase config is populated when both vars are present", () => {
  const cfg = loadConfig({
    LLM_BASE_URL: "x",
    LLM_API_KEY: "y",
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  expect(cfg.supabase).toEqual({ url: "https://proj.supabase.co", serviceRoleKey: "service-key" });
});
