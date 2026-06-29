import { test, expect } from "bun:test";
import { assemblePrompt } from "./prompt";
import type { Soul, Policy, DecisionContext, ActionSpec } from "./types";

const policy: Policy = { schema: "policy/v1", version: "1.0.0", body: "POLICY-BODY-MARK" };
const soul: Soul = { schema: "soul/v1", version: "1.0.0", name: "Broker", body: "SOUL-BODY-MARK" };
const context: DecisionContext = { objective: "respond-to-degradation", telemetry: { health: "degraded" } };
const actions: ActionSpec[] = [
  { name: "migrate", description: "move to another provider" },
  { name: "hold", description: "keep the current provider" },
];

test("system prompt puts policy before soul, and lists the actions", () => {
  const { system, user } = assemblePrompt(soul, policy, context, actions);
  expect(system.indexOf("POLICY-BODY-MARK")).toBeLessThan(system.indexOf("SOUL-BODY-MARK"));
  expect(system).toContain("migrate");
  expect(system).toContain("hold");
  // context goes in the user turn, not the system turn
  expect(user).toContain("respond-to-degradation");
  expect(user).toContain("degraded");
});
