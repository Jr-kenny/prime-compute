import { test, expect } from "bun:test";
import { loadBrokerAgent } from "./agent";

test("loads the shipped broker soul + platform policy", async () => {
  const { soul, policy } = await loadBrokerAgent();
  expect(soul.name).toBe("Broker");
  expect(soul.schema).toBe("soul/v1");
  expect(soul.version).toBeTruthy();
  expect(policy.schema).toBe("policy/v1");
  expect(policy.body).toContain("Never fabricate execution results");
});
