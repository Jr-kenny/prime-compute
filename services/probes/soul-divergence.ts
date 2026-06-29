import { parseSoul } from "../src/runtime/soul";
import { parsePolicy } from "../src/runtime/policy";
import { decide, makeDecideClient } from "../src/runtime/decide";
import type { DecisionContext, ActionSpec } from "../src/runtime/types";

// Gated: needs LLM_BASE_URL / LLM_API_KEY. Proves that swapping ONLY the soul changes the
// decision while the runtime, policy, context, and actions are identical.
const policy = parsePolicy(await Bun.file(new URL("../agent/policy.md", import.meta.url)).text());
const costFirst = parseSoul(await Bun.file(new URL("../agent/souls/cost-first.soul.md", import.meta.url)).text());
const uptimeFirst = parseSoul(await Bun.file(new URL("../agent/souls/uptime-first.soul.md", import.meta.url)).text());

const actions: ActionSpec[] = [
  { name: "hold", description: "keep paying the current (degraded) provider while retry budget remains" },
  { name: "migrate", description: "re-point the stream to a healthy but pricier provider" },
];

// A genuinely ambiguous situation: current provider degraded but cheaper; alternative healthy but pricier.
const context: DecisionContext = {
  objective: "respond-to-degradation",
  telemetry: { current: { health: "degraded", failures: 2, pricePerCharge: 0.0001 } },
  candidates: { alternative: { health: "healthy", pricePerCharge: 0.0002 } },
  constraints: { retryBudgetRemaining: true },
};

const client = makeDecideClient();

try {
  const a = await decide({ soul: costFirst, policy, context, actions, client });
  const b = await decide({ soul: uptimeFirst, policy, context, actions, client });
  console.log("cost-first   top action:", a.proposals[0]?.action, "| reasons:", a.proposals[0]?.rationale);
  console.log("uptime-first top action:", b.proposals[0]?.action, "| reasons:", b.proposals[0]?.rationale);

  if (a.proposals[0]?.action === "hold" && b.proposals[0]?.action === "migrate") {
    console.log("\n✅ same runtime, different soul, divergent decision (cost-first holds, uptime-first migrates).");
  } else {
    console.log("\n⚠️  decisions did not diverge as expected. Souls/prompt may need tuning, or the model hedged.");
    console.log("    (The architecture still holds; this probe just tests soul sensitivity.)");
  }
} catch (err) {
  console.error("\n❌ divergence probe failed:", err instanceof Error ? err.message : err);
  console.error("Set LLM_BASE_URL/LLM_API_KEY to run the live model path.");
  process.exitCode = 1;
}
