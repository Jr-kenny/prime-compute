import { supabaseAdmin } from "../supabase/server";
import { SupabaseSpendWalletStore } from "@services/wallet/supabase-store";
import { loadWalletConfig } from "@services/wallet/config";
import { makeOnchain } from "@services/wallet/onchain";

let store: SupabaseSpendWalletStore | null = null;

export function getSpendWalletStore(): SupabaseSpendWalletStore {
  const cfg = loadWalletConfig();
  store ??= new SupabaseSpendWalletStore(supabaseAdmin(), cfg.encKey);
  return store;
}

export function getOnchain() {
  return makeOnchain(loadWalletConfig());
}
