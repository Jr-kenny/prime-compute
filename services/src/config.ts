type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

// The broker brain is any OpenAI-compatible endpoint (NVIDIA NIM, Kimchi, etc.).
// Swapping providers is a config change, not a code change.
export function loadConfig(env: Env = process.env) {
  return {
    llm: {
      baseUrl: required(env, "LLM_BASE_URL"),
      apiKey: required(env, "LLM_API_KEY"),
      model: env.LLM_MODEL ?? "meta/llama-3.3-70b-instruct",
    },
  };
}

export type Config = ReturnType<typeof loadConfig>;
