// src/lib/agents/store.ts
import { supabaseAdmin } from "../supabase/server";
import { SupabaseSpendWalletStore } from "@services/wallet/supabase-store";
import type { Principal } from "@services/domain";
import { generateApiKey, hashApiKey } from "./keys";
import { walletProviderFor, liveWalletDeps } from "../marketplace/wallet";

function agentWalletStore() {
  const encKey = process.env.SPEND_WALLET_ENC_KEY;
  if (!encKey) throw new Error("SPEND_WALLET_ENC_KEY required");
  return new SupabaseSpendWalletStore(supabaseAdmin(), encKey, { table: "agent_wallets", idColumn: "agent_id" });
}

// AgentWallets routed through the backend switch: the agent id exists only after the
// insert, so the principal is built per call rather than closed over up front.
function backendAgentWallets(): AgentWallets {
  return {
    getOrCreate: (id) => {
      const principal: Principal = { kind: "agent", id, walletAddress: "" };
      return walletProviderFor(principal, liveWalletDeps(principal)).getOrCreate();
    },
  };
}

// The slices of Supabase and the wallet store that agent creation touches; injectable so
// the rollback path is unit-testable without a live DB.
export type AgentDb = ReturnType<typeof supabaseAdmin>;
export type AgentWallets = { getOrCreate(id: string): Promise<{ address: string }> };

// Open self-serve registration: create the agent, issue the first key, provision its
// permanent wallet. The plaintext key is returned exactly once; only its hash is stored.
// Any failure after the agent row exists deletes it (FK cascade removes the key and wallet
// rows), so a half-created agent never lingers on this open endpoint.
export async function createAgentWith(
  db: AgentDb,
  wallets: AgentWallets,
  label?: string,
): Promise<{ agentId: string; apiKey: string; walletAddress: string }> {
  const { data, error } = await db.from("agents").insert({ label: label ?? null }).select("id").single();
  if (error) throw error;
  const agentId = data.id as string;

  try {
    const apiKey = generateApiKey();
    const { error: keyErr } = await db.from("agent_api_keys").insert({ agent_id: agentId, key_hash: await hashApiKey(apiKey) });
    if (keyErr) throw keyErr;

    const { address } = await wallets.getOrCreate(agentId);
    return { agentId, apiKey, walletAddress: address };
  } catch (e) {
    await db.from("agents").delete().eq("id", agentId);
    throw e;
  }
}

export function createAgent(label?: string): Promise<{ agentId: string; apiKey: string; walletAddress: string }> {
  return createAgentWith(supabaseAdmin(), backendAgentWallets(), label);
}

// Resolve a bearer key to an agent Principal, or null. Stamps last_used_at for anomaly detection.
export async function requireAgent(apiKey: string): Promise<Principal | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_api_keys")
    .select("id, agent_id, revoked_at")
    .eq("key_hash", await hashApiKey(apiKey))
    .maybeSingle();
  if (error) throw error;
  if (!data || data.revoked_at) return null;

  const walletAddress = await agentWalletStore().getAddress(data.agent_id as string);
  if (!walletAddress) return null; // wallet must exist for a real agent
  await db.from("agent_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { kind: "agent", id: data.agent_id as string, walletAddress };
}
