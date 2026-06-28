import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { loadConfig } from "./config";

export function makeKimchi() {
  const cfg = loadConfig();
  const provider = createOpenAICompatible({
    name: "kimchi",
    baseURL: cfg.kimchi.baseUrl,
    apiKey: cfg.kimchi.apiKey,
  });
  return { provider, modelId: cfg.kimchi.model };
}
