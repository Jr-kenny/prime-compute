// src/lib/agents/http.test.ts
import { test, expect } from "bun:test";
import { bearer, json, errorResponse } from "./http";

test("bearer extracts the token or null", () => {
  expect(bearer(new Request("http://x", { headers: { authorization: "Bearer pc_abc" } }))).toBe("pc_abc");
  expect(bearer(new Request("http://x"))).toBeNull();
  expect(bearer(new Request("http://x", { headers: { authorization: "Basic zzz" } }))).toBeNull();
});

test("json + errorResponse shape the body and status", async () => {
  const ok = json({ a: 1 }, 201);
  expect(ok.status).toBe(201);
  expect(await ok.json()).toEqual({ a: 1 });

  const err = errorResponse(404, "not_found", "no such rent");
  expect(err.status).toBe(404);
  expect(await err.json()).toEqual({ error: { code: "not_found", message: "no such rent" } });
});
