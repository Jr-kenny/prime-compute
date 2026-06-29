import { test, expect } from "bun:test";
import { defaultTrust } from "../trust/trust";
import { llmRankStrategy, type RankClient } from "./llm-rank";
import type { Provider, RentSpec } from "../domain";

function p(id: string, over: Partial<Provider> = {}): Provider {
  return {
    id, alias: id, ownerWallet: "0x0", endpointUrl: "http://x", resourceType: "GPU",
    region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001,
    computeScore: 80, avgLatencyMs: 5, ...over,
  };
}

const spec: RentSpec = { resourceType: "GPU", region: null };

test("reorders candidates by the client's returned id order", async () => {
  const client: RankClient = { rankProviderIds: async () => ["c", "a", "b"] };
  const ranked = await llmRankStrategy(client)([p("a"), p("b"), p("c")], spec);
  expect(ranked.map((x) => x.id)).toEqual(["c", "a", "b"]);
});

test("drops ids the model invented and appends candidates it omitted", async () => {
  const client: RankClient = { rankProviderIds: async () => ["b", "ghost"] };
  const ranked = await llmRankStrategy(client)([p("a"), p("b"), p("c")], spec);
  // b first (named), then a and c appended in original order; ghost dropped.
  expect(ranked.map((x) => x.id)).toEqual(["b", "a", "c"]);
});

test("ignores a duplicate id from the model", async () => {
  const client: RankClient = { rankProviderIds: async () => ["a", "a", "b"] };
  const ranked = await llmRankStrategy(client)([p("a"), p("b")], spec);
  expect(ranked.map((x) => x.id)).toEqual(["a", "b"]);
});

test("throws when the model returns nothing usable (so matchProviders falls back)", async () => {
  const client: RankClient = { rankProviderIds: async () => [] };
  await expect(llmRankStrategy(client)([p("a")], spec)).rejects.toThrow();
});

test("propagates a client error (matchProviders catches it for the scorer fallback)", async () => {
  const client: RankClient = { rankProviderIds: async () => { throw new Error("model down"); } };
  await expect(llmRankStrategy(client)([p("a")], spec)).rejects.toThrow(/model down/);
});
