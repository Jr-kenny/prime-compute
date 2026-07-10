import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { loadConfig } from "./config";

// Broker brain: an OpenAI-compatible chat-completions endpoint. Provider is set
// purely by config (LLM_BASE_URL/LLM_API_KEY/LLM_MODEL) — NVIDIA NIM, Kimchi, etc.
// `model` overrides the default (the chat path passes the faster chatModel).
export function makeModel(model?: string) {
  const cfg = loadConfig();
  const provider = createOpenAICompatible({
    name: "llm",
    baseURL: cfg.llm.baseUrl,
    apiKey: cfg.llm.apiKey,
  });
  return { provider, modelId: model ?? cfg.llm.model };
}
