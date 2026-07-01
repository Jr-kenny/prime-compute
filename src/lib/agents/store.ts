// src/lib/agents/store.ts
import { supabaseAdmin } from "../supabase/server";
import { SupabaseSpendWalletStore } from "@services/wallet/supabase-store";
import type { Principal } from "@services/domain";
import { generateApiKey, hashApiKey } from "./keys";

function agentWalletStore() {
  const encKey = process.env.SPEND_WALLET_ENC_KEY;
  if (!encKey) throw new Error("SPEND_WALLET_ENC_KEY required");
  return new SupabaseSpendWalletStore(supabaseAdmin(), encKey, { table: "agent_wallets", idColumn: "agent_id" });
}

// Open self-serve registration: create the agent, provision its permanent wallet, issue the first
// key. The plaintext key is returned exactly once; only its hash is stored.
export async function createAgent(label?: string): Promise<{ agentId: string; apiKey: string; walletAddress: string }> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("agents").insert({ label: label ?? null }).select("id").single();
  if (error) throw error;
  const agentId = data.id as string;

  const { address } = await agentWalletStore().getOrCreate(agentId);

  const apiKey = generateApiKey();
  const { error: keyErr } = await db.from("agent_api_keys").insert({ agent_id: agentId, key_hash: await hashApiKey(apiKey) });
  if (keyErr) throw keyErr;

  return { agentId, apiKey, walletAddress: address };
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
