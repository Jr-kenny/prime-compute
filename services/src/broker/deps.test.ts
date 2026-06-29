import { test, expect } from "bun:test";
import { liveBrokerDeps } from "./deps";
import { defaultTrust } from "../trust/trust";
import type { DecideClient } from "../runtime/decide";
import type { Provider, RentSpec } from "../domain";

const spec: RentSpec = { resourceType: "GPU", region: null };

function p(id: string): Provider {
  return {
    id, alias: id, ownerWallet: "0x0", endpointUrl: "http://x", resourceType: "GPU",
    region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001,
    computeScore: 80, avgLatencyMs: 5,
  };
}

test("liveBrokerDeps wires a soul-driven rank + degradation from one shipped agent + client", async () => {
  // a and b are metric-identical, so the deterministic scorer would keep input order [a, b].
  // The stub instead names b first, so a [b, a] result proves the soul-driven decide path ran.
  const client: DecideClient = {
    propose: async () => [
      { action: "select", target: "b", score: 0.9, rationale: [], userExplanation: "" },
      { action: "select", target: "a", score: 0.8, rationale: [], userExplanation: "" },
    ],
  };

  const { rank, degradation } = await liveBrokerDeps({ client });

  const ranked = await rank([p("a"), p("b")], spec);
  expect(ranked.map((x) => x.id)).toEqual(["b", "a"]);

  // The degradation deps share the very same client and carry the shipped broker agent.
  expect(degradation.client).toBe(client);
  expect(degradation.soul.name).toBeTruthy();
  expect(degradation.policy.schema).toContain("policy");
});
