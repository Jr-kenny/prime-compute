import { test, expect } from "bun:test";
import { registerAgent, resolveCredentials } from "./credentials";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;
}

test("registerAgent posts to the open endpoint and returns the identity", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return { ok: true, status: 201, json: async () => ({ agentId: "a1", apiKey: "pc_key", walletAddress: "0xabc" }) };
  }) as unknown as typeof fetch;

  const creds = await registerAgent("https://api.example", fetchImpl, "mcp@test");
  expect(creds).toEqual({ agentId: "a1", apiKey: "pc_key", walletAddress: "0xabc" });
  expect(calls[0]?.url).toBe("https://api.example/api/v1/agents");
  expect(calls[0]?.body).toEqual({ label: "mcp@test" });
});

test("registerAgent throws on a non-2xx", async () => {
  await expect(registerAgent("https://api.example", fakeFetch(500, { error: "down" }))).rejects.toThrow(/registration failed \(500\)/);
});

test("registerAgent throws when the shape is wrong", async () => {
  await expect(registerAgent("https://api.example", fakeFetch(201, { nope: true }))).rejects.toThrow(/unexpected shape/);
});

test("an explicit env key short-circuits to source=env, no registration", async () => {
  let registered = false;
  const fetchImpl = (async () => { registered = true; return { ok: true, status: 201, json: async () => ({}) }; }) as unknown as typeof fetch;
  const creds = await resolveCredentials("https://api.example", { fetchImpl, envKey: "pc_env" });
  expect(creds.source).toBe("env");
  expect(creds.apiKey).toBe("pc_env");
  expect(registered).toBe(false);
});
