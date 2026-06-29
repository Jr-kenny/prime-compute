import { test, expect } from "bun:test";
import { parseSoul } from "./soul";
import { parsePolicy } from "./policy";

test("the shipped policy.md parses and is policy/v1", async () => {
  const src = await Bun.file(new URL("../../agent/policy.md", import.meta.url)).text();
  const policy = parsePolicy(src);
  expect(policy.schema).toBe("policy/v1");
  expect(policy.version).toBeTruthy();
  expect(policy.body).toContain("Never fabricate execution results");
});

test("the shipped broker.soul.md parses and is soul/v1 named Broker", async () => {
  const src = await Bun.file(new URL("../../agent/broker.soul.md", import.meta.url)).text();
  const soul = parseSoul(src);
  expect(soul.schema).toBe("soul/v1");
  expect(soul.name).toBe("Broker");
  expect(soul.body).toContain("# Identity");
  expect(soul.body).toContain("# Authoring Rules");
});
