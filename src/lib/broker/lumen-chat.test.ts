import { test, expect } from "bun:test";
import { shapeChatResult, CHAT_ACTIONS, chatFallback } from "./lumen-chat";
import type { Decision } from "@services/runtime/types";
import type { Provider } from "@services/domain";

function provider(id: string, alias: string): Provider {
  return {
    id,
    alias,
    ownerWallet: "0xowner",
    endpointUrl: "https://node.example/compute",
    resourceType: "GPU",
    region: "US-East",
    specs: { gpu: "H100", vramGb: 80 },
    online: true,
    trust: { tier: "Community", signals: { uptime: 1, successfulRentals: 0, health: "healthy", verification: false } },
    pricePerCharge: 0.0000045,
    computeScore: 98,
    avgLatencyMs: 12,
  };
}

function decision(proposals: Decision["proposals"], usedFallback = false): Decision {
  return { proposals, soulVersion: "1.0.0", policyVersion: "1.0.0", decisionId: "d1", usedFallback };
}

const astral = provider("p1", "node-astral-1");

test("a recommend_provider proposal with a real target returns that provider", () => {
  const d = decision([
    { action: "recommend_provider", target: "p1", score: 0.9, rationale: ["cheapest H100"], userExplanation: "node-astral-1 fits, want me to queue it?" },
  ]);
  const r = shapeChatResult(d, [astral]);
  expect(r.action).toBe("recommend_provider");
  expect(r.reply).toBe("node-astral-1 fits, want me to queue it?");
  expect(r.provider?.id).toBe("p1");
});

test("a recommend_provider with an invented target degrades to a plain answer", () => {
  const d = decision([
    { action: "recommend_provider", target: "ghost", score: 0.9, rationale: [], userExplanation: "Try node-ghost." },
  ]);
  const r = shapeChatResult(d, [astral]);
  expect(r.action).toBe("answer");
  expect(r.provider).toBeUndefined();
  expect(r.reply).toBe("Try node-ghost.");
});

test("a report_status proposal passes through as report_status with no provider", () => {
  const d = decision([
    { action: "report_status", score: 0.8, rationale: [], userExplanation: "You have 2 rents running." },
  ]);
  const r = shapeChatResult(d, [astral]);
  expect(r.action).toBe("report_status");
  expect(r.provider).toBeUndefined();
  expect(r.reply).toBe("You have 2 rents running.");
});

test("an answer proposal passes through as answer", () => {
  const d = decision([
    { action: "answer", score: 0.5, rationale: [], userExplanation: "I can find providers, check your rents, or queue compute." },
  ]);
  const r = shapeChatResult(d, [astral]);
  expect(r.action).toBe("answer");
  expect(r.reply).toBe("I can find providers, check your rents, or queue compute.");
});

test("an empty decision yields a safe default answer", () => {
  const r = shapeChatResult(decision([], true), [astral]);
  expect(r.action).toBe("answer");
  expect(r.reply.length).toBeGreaterThan(0);
});

test("chatFallback returns a single answer proposal", () => {
  const props = chatFallback();
  expect(props).toHaveLength(1);
  expect(props[0]!.action).toBe("answer");
});

// The fallback message must match what actually happened. A slow model and a model that
// answered in prose are not unreachable, and telling the user "can't reach" for those
// sends debugging in the wrong direction (it nearly got the provider swapped out).
test("chatFallback explains a timeout as slowness, not unreachability", () => {
  const msg = chatFallback("timeout")[0]!.userExplanation;
  expect(msg).toContain("taking too long");
  expect(msg).not.toContain("can't reach");
});

test("chatFallback explains an unusable answer honestly", () => {
  for (const reason of ["no_tool_call", "no_proposals"] as const) {
    const msg = chatFallback(reason)[0]!.userExplanation;
    expect(msg).toContain("couldn't use");
    expect(msg).not.toContain("can't reach");
  }
});

test("chatFallback keeps the can't-reach message for real errors and when unconfigured", () => {
  expect(chatFallback("error")[0]!.userExplanation).toContain("can't reach");
  expect(chatFallback()[0]!.userExplanation).toContain("can't reach");
});

test("CHAT_ACTIONS exposes the three chat actions", () => {
  expect(CHAT_ACTIONS.map((a) => a.name).sort()).toEqual(["answer", "recommend_provider", "report_status"]);
});
