type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export function loadConfig(env: Env = process.env) {
  return {
    kimchi: {
      baseUrl: required(env, "KIMCHI_BASE_URL"),
      apiKey: required(env, "KIMCHI_API_KEY"),
      model: env.KIMCHI_MODEL ?? "kimi-k2.6",
    },
  };
}

export type Config = ReturnType<typeof loadConfig>;
