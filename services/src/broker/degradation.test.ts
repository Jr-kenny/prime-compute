import { test, expect } from "bun:test";
import { defaultTrust } from "../trust/trust";
import { decideMigrateOrHold } from "./degradation";
import { RetryLeash } from "../runtime/budget";
import type { DecideClient } from "../runtime/decide";
import type { Soul, Policy, Proposal } from "../runtime/types";
import type { Provider, RentSpec } from "../domain";

const soul: Soul = { schema: "soul/v1", version: "1.0.0", name: "Broker", body: "s" };
const policy: Policy = { schema: "policy/v1", version: "1.0.0", body: "p" };
const spec: RentSpec = { resourceType: "GPU", region: null };

function provider(id: string): Provider {
  return {
    id, alias: id, ownerWallet: "0x0", endpointUrl: `http://${id}`, resourceType: "GPU",
    region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001,
    computeScore: 90, avgLatencyMs: 5,
  };
}
const stubClient = (proposals: Proposal[]): DecideClient => ({ propose: async () => proposals });

const args = (over: Partial<Parameters<typeof decideMigrateOrHold>[1]> = {}) => ({
  current: provider("A"),
  reason: "3 consecutive failures",
  candidates: [provider("B"), provider("C")],
  spec,
  leash: new RetryLeash({ maxRetries: 2, maxDurationMs: 60_000, maxExtraSpend: 10_000n }),
  nextChargeAtomic: 100n,
  ...over,
});

test("migrate with a named target picks that provider", async () => {
  const client = stubClient([{ action: "migrate", target: "C", score: 0.9, rationale: ["named C"], userExplanation: "moving to C" }]);
  const choice = await decideMigrateOrHold({ soul, policy, client }, args());
  expect(choice.action).toBe("migrate");
  if (choice.action === "migrate") expect(choice.target.id).toBe("C");
});

test("hold is taken when the retry budget allows it", async () => {
  const client = stubClient([{ action: "hold", score: 0.9, rationale: ["transient"], userExplanation: "holding" }]);
  const choice = await decideMigrateOrHold({ soul, policy, client }, args());
  expect(choice.action).toBe("hold");
});

test("a hold past the retry budget falls through to fallback", async () => {
  const client = stubClient([{ action: "hold", score: 0.9, rationale: ["transient"], userExplanation: "holding" }]);
  const leash = new RetryLeash({ maxRetries: 0, maxDurationMs: 60_000, maxExtraSpend: 10_000n }); // no holds left
  const choice = await decideMigrateOrHold({ soul, policy, client }, args({ leash }));
  expect(choice.action).toBe("fallback");
});

test("an invalid migrate target is rejected; a valid lower-ranked hold is taken instead", async () => {
  const client = stubClient([
    { action: "migrate", target: "ghost", score: 0.9, rationale: ["bad target"], userExplanation: "move" },
    { action: "hold", score: 0.5, rationale: ["fallback"], userExplanation: "hold instead" },
  ]);
  const choice = await decideMigrateOrHold({ soul, policy, client }, args());
  expect(choice.action).toBe("hold");
});

test("a dead model falls back to a deterministic migrate to the first candidate", async () => {
  const client: DecideClient = { propose: async () => { throw new Error("model down"); } };
  const choice = await decideMigrateOrHold({ soul, policy, client }, args());
  expect(choice.action).toBe("migrate");
  if (choice.action === "migrate") expect(choice.target.id).toBe("B"); // first candidate
});

test("no candidates and an exhausted hold budget yields fallback", async () => {
  const client = stubClient([{ action: "hold", score: 0.9, rationale: [], userExplanation: "" }]);
  const leash = new RetryLeash({ maxRetries: 0, maxDurationMs: 60_000, maxExtraSpend: 10_000n });
  const choice = await decideMigrateOrHold({ soul, policy, client }, args({ candidates: [], leash }));
  expect(choice.action).toBe("fallback");
});
