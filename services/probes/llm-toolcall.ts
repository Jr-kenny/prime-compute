import { generateText, tool } from "ai";
import { z } from "zod";
import { makeModel } from "../src/llm";

const { provider, modelId } = makeModel();

const result = await generateText({
  model: provider(modelId),
  // Force a tool-shaped task so we can see whether the model emits a tool call.
  prompt:
    "You are a compute broker. Pick the cheapest provider for a GPU job. " +
    "Candidates: A ($0.000006/s, score 70), B ($0.000004/s, score 92). " +
    "Call pick_provider with your choice.",
  tools: {
    pick_provider: tool({
      description: "Select the provider to run the job on.",
      parameters: z.object({
        provider_id: z.enum(["A", "B"]),
        reason: z.string(),
      }),
      // No execute — we only want to observe the tool call.
    }),
  },
  maxSteps: 1,
});

console.log("model:", modelId);
console.log("toolCalls:", JSON.stringify(result.toolCalls, null, 2));
console.log("finishReason:", result.finishReason);
console.log("text:", result.text);

if (result.toolCalls.length > 0) {
  console.log("\n✅ TOOL CALLING WORKS through this provider.");
} else {
  console.log(
    "\n❌ No tool call emitted. Broker must use the deterministic scorer (scoring.ts).",
  );
}
