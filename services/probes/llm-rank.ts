import { makeRankClient } from "../src/broker/llm-rank";
import type { Provider } from "../src/domain";

// Gated: needs LLM_BASE_URL / LLM_API_KEY. Proves the real model emits a usable
// ranking through the tool call; if it cannot, the broker uses scoring.ts instead.
const sample: Provider[] = [
  { id: "alpha", alias: "alpha", ownerWallet: "0x0", endpointUrl: "http://a", resourceType: "GPU", region: "US-East", specs: {}, online: true, stakeAmount: 100, pricePerCharge: 0.000006, computeScore: 70, avgLatencyMs: 9 },
  { id: "bravo", alias: "bravo", ownerWallet: "0x0", endpointUrl: "http://b", resourceType: "GPU", region: "EU-West", specs: {}, online: true, stakeAmount: 100, pricePerCharge: 0.000004, computeScore: 92, avgLatencyMs: 4 },
  { id: "charlie", alias: "charlie", ownerWallet: "0x0", endpointUrl: "http://c", resourceType: "GPU", region: "US-East", specs: {}, online: true, stakeAmount: 100, pricePerCharge: 0.000009, computeScore: 60, avgLatencyMs: 14 },
];

try {
  const client = makeRankClient();
  const order = await client.rankProviderIds(sample, { resourceType: "GPU", region: null });
  console.log("model ranking (best first):", order);
  const known = new Set(sample.map((p) => p.id));
  const usable = order.filter((id) => known.has(id));
  if (usable.length > 0) {
    console.log("\n✅ live LLM ranking works; broker will use it (scorer stays the fallback).");
  } else {
    console.log("\n⚠️  model returned no known ids; broker falls back to the deterministic scorer.");
  }
} catch (err) {
  console.error("\n❌ ranker probe failed:", err instanceof Error ? err.message : err);
  console.error("Broker still works via the deterministic scorer. Set LLM_BASE_URL/LLM_API_KEY to test the model path.");
  process.exitCode = 1;
}
