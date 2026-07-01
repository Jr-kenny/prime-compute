// src/lib/marketplace/wallet.ts
import { supabaseAdmin } from "../supabase/server";
import { SupabaseSpendWalletStore } from "@services/wallet/supabase-store";
import type { SpendWalletStore } from "@services/wallet/store";
import type { Principal } from "@services/domain";

// The right wallet store for a principal: users in spend_wallets, agents in agent_wallets.
export function walletStoreFor(principal: Principal): SpendWalletStore {
  const encKey = process.env.SPEND_WALLET_ENC_KEY;
  if (!encKey) throw new Error("SPEND_WALLET_ENC_KEY required");
  return principal.kind === "agent"
    ? new SupabaseSpendWalletStore(supabaseAdmin(), encKey, { table: "agent_wallets", idColumn: "agent_id" })
    : new SupabaseSpendWalletStore(supabaseAdmin(), encKey);
}
