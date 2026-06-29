import { parseSoul } from "../src/runtime/soul";
import { parsePolicy } from "../src/runtime/policy";
import { makeDecideClient } from "../src/runtime/decide";
import { rankDecideStrategy } from "../src/broker/rank-decide";
import { defaultTrust } from "../src/trust/trust";
import type { Provider, RentSpec } from "../src/domain";

// Gated: needs LLM_BASE_URL / LLM_API_KEY. Proves that swapping ONLY the soul changes the
// ranking while the runtime, policy, context, and candidates are identical.
const policy = parsePolicy(await Bun.file(new URL("../agent/policy.md", import.meta.url)).text());
const costFirst = parseSoul(await Bun.file(new URL("../agent/souls/cost-first.soul.md", import.meta.url)).text());
const uptimeFirst = parseSoul(await Bun.file(new URL("../agent/souls/uptime-first.soul.md", import.meta.url)).text());

function p(id: string, over: Partial<Provider>): Provider {
  return {
    id, alias: id, ownerWallet: "0x0", endpointUrl: `http://${id}`, resourceType: "GPU",
    region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001,
    computeScore: 80, avgLatencyMs: 5, ...over,
  };
}

// "cheap" is the cheapest but lowest score/uptime; "solid" is pricier but best score.
const providers: Provider[] = [
  p("cheap", { pricePerCharge: 0.00003, computeScore: 60, avgLatencyMs: 12 }),
  p("solid", { pricePerCharge: 0.00009, computeScore: 95, avgLatencyMs: 4, trust: defaultTrust("Bonded") }),
];
const spec: RentSpec = { resourceType: "GPU", region: null };

const client = makeDecideClient();

try {
  const a = await rankDecideStrategy({ soul: costFirst, policy, client })(providers, spec);
  const b = await rankDecideStrategy({ soul: uptimeFirst, policy, client })(providers, spec);
  console.log("cost-first   ranking:", a.map((x) => x.id).join(" > "));
  console.log("uptime-first ranking:", b.map((x) => x.id).join(" > "));
  if (a[0]?.id === "cheap" && b[0]?.id === "solid") {
    console.log("\n✅ same runtime, different soul, divergent ranking (cost-first picks cheap, uptime-first picks solid).");
  } else {
    console.log("\n⚠️  rankings did not diverge as expected; souls/prompt may need tuning or the model hedged.");
    console.log("    (The architecture still holds; this probe just tests soul sensitivity of ranking.)");
  }
} catch (err) {
  console.error("\n❌ rank-soul probe failed:", err instanceof Error ? err.message : err);
  console.error("Broker still ranks via the deterministic scorer. Set LLM_BASE_URL/LLM_API_KEY to test the model path.");
  process.exitCode = 1;
}
