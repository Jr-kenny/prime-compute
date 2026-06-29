import { test, expect } from "bun:test";
import { rankDecideStrategy } from "./rank-decide";
import { defaultTrust } from "../trust/trust";
import type { DecideClient } from "../runtime/decide";
import type { Soul, Policy, Proposal } from "../runtime/types";
import type { Provider, RentSpec } from "../domain";

const soul: Soul = { schema: "soul/v1", version: "1.0.0", name: "Broker", body: "s" };
const policy: Policy = { schema: "policy/v1", version: "1.0.0", body: "p" };
const spec: RentSpec = { resourceType: "GPU", region: null };

function p(id: string, over: Partial<Provider> = {}): Provider {
  return {
    id, alias: id, ownerWallet: "0x0", endpointUrl: "http://x", resourceType: "GPU",
    region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001,
    computeScore: 80, avgLatencyMs: 5, ...over,
  };
}

const selects = (...ids: (string | undefined)[]): Proposal[] =>
  ids.map((id, i) => ({ action: "select", target: id, score: 1 - i / 10, rationale: ["r"], userExplanation: "e" }));
const stub = (proposals: Proposal[]): DecideClient => ({ propose: async () => proposals });

test("reorders providers by the proposal target order", async () => {
  const client = stub(selects("c", "a", "b"));
  const ranked = await rankDecideStrategy({ soul, policy, client })([p("a"), p("b"), p("c")], spec);
  expect(ranked.map((x) => x.id)).toEqual(["c", "a", "b"]);
});

test("drops invented target ids and appends omitted candidates in original order", async () => {
  const client = stub(selects("b", "ghost"));
  const ranked = await rankDecideStrategy({ soul, policy, client })([p("a"), p("b"), p("c")], spec);
  expect(ranked.map((x) => x.id)).toEqual(["b", "a", "c"]); // b named; a,c appended; ghost dropped
});

test("ignores duplicate and target-less proposals", async () => {
  const client = stub([...selects("a", "a"), { action: "select", score: 0.1, rationale: [], userExplanation: "" }]);
  const ranked = await rankDecideStrategy({ soul, policy, client })([p("a"), p("b")], spec);
  expect(ranked.map((x) => x.id)).toEqual(["a", "b"]);
});

test("a dead model falls back to the deterministic scorer order (no throw)", async () => {
  const client: DecideClient = { propose: async () => { throw new Error("model down"); } };
  // b is cheaper + higher score than a, so scoreProviders ranks b first.
  const ranked = await rankDecideStrategy({ soul, policy, client })(
    [p("a", { pricePerCharge: 0.0002, computeScore: 70 }), p("b", { pricePerCharge: 0.0001, computeScore: 92 })],
    spec,
  );
  expect(ranked[0]?.id).toBe("b");
});
