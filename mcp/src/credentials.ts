// mcp/src/credentials.ts
// An agent needs an identity (its API key = the handle to its own Arc wallet) to act. This resolves
// that identity with NO human in the loop: an explicit env key wins, else a previously saved
// identity is reused, else the agent self-registers against the open registration endpoint and
// persists the result so the SAME wallet comes back on every restart. A wallet that holds funds
// must never be ephemeral, which is exactly why the key is persisted rather than minted per run.
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";

const CREDS_DIR = join(homedir(), ".prime-compute");
const CREDS_FILE = join(CREDS_DIR, "credentials.json");

export type AgentCreds = { agentId: string; apiKey: string; walletAddress: string };
export type ResolvedCreds = AgentCreds & { source: "env" | "file" | "registered" };

// Identities are keyed by deployment: a different PRIME_API_URL is a different marketplace and so a
// different agent + wallet, never a cross-wired key.
type Store = Record<string, AgentCreds>;

export function credentialsPath(): string {
  return CREDS_FILE;
}

async function readStore(): Promise<Store> {
  try {
    return JSON.parse(await readFile(CREDS_FILE, "utf8")) as Store;
  } catch {
    return {}; // missing or unreadable file = no saved identities yet
  }
}

async function writeStore(store: Store): Promise<void> {
  await mkdir(CREDS_DIR, { recursive: true });
  await writeFile(CREDS_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
  await chmod(CREDS_FILE, 0o600).catch(() => {}); // the key is a wallet credential: owner-only
}

// Register a brand-new agent. The endpoint is open and unauthenticated by design, which is what lets
// an agent bootstrap itself; it returns the agent id, its one-time API key, and its Arc wallet.
export async function registerAgent(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  label = `mcp@${hostname()}`,
): Promise<AgentCreds> {
  const res = await fetchImpl(`${baseUrl}/api/v1/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label }),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<AgentCreds>;
  if (!res.ok) throw new Error(`registration failed (${res.status}): ${JSON.stringify(json)}`);
  if (!json.agentId || !json.apiKey) throw new Error(`registration returned an unexpected shape: ${JSON.stringify(json)}`);
  return { agentId: json.agentId, apiKey: json.apiKey, walletAddress: json.walletAddress ?? "" };
}

export async function resolveCredentials(
  baseUrl: string,
  opts: { fetchImpl?: typeof fetch; envKey?: string | undefined } = {},
): Promise<ResolvedCreds> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const envKey = "envKey" in opts ? opts.envKey : process.env.PRIME_API_KEY;

  // 1. Explicit key pins a known agent (operator override); the address comes live from wallet_balance.
  if (envKey) return { agentId: "(from PRIME_API_KEY)", apiKey: envKey, walletAddress: "", source: "env" };

  // 2. Reuse the identity we saved for this deployment last time.
  const store = await readStore();
  const saved = store[baseUrl];
  if (saved?.apiKey) return { ...saved, source: "file" };

  // 3. Nothing yet: self-register and persist so this same wallet returns on the next run.
  const fresh = await registerAgent(baseUrl, fetchImpl);
  store[baseUrl] = fresh;
  await writeStore(store).catch(() => {}); // a read-only FS still lets this session run in-memory
  return { ...fresh, source: "registered" };
}
