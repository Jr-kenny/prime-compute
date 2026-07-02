// src/lib/marketplace/wallet.ts
import { supabaseAdmin } from "../supabase/server";
import { SupabaseSpendWalletStore } from "@services/wallet/supabase-store";
import { CircleWalletStore, makeCircleClient, type OwnerKind } from "@services/wallet/circle";
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

export type WalletBackendDeps = {
  backend: "circle" | "raw";
  circle: Pick<CircleWalletStore, "getOrCreate">;
  legacy: { getOrCreate(id: string): Promise<{ address: string }> };
};

// One seam for "give this principal a wallet": Circle-custodied when the backend says so,
// the legacy enc-key store otherwise. Existing wallets are never migrated out from under
// their owner — the worker resolves circle-first per lease, so both coexist.
export function walletProviderFor(principal: Principal, deps: WalletBackendDeps) {
  const kind: OwnerKind = principal.kind;
  return {
    getOrCreate: async (): Promise<{ address: string }> =>
      deps.backend === "circle" ? deps.circle.getOrCreate(kind, principal.id) : deps.legacy.getOrCreate(principal.id),
  };
}

export function liveWalletDeps(principal: Principal): WalletBackendDeps {
  const backend = (process.env.WALLET_BACKEND === "circle" ? "circle" : "raw") as "circle" | "raw";
  const setId = process.env.CIRCLE_WALLET_SET_ID;
  if (backend === "circle" && !setId) throw new Error("WALLET_BACKEND=circle needs CIRCLE_WALLET_SET_ID");
  return {
    backend,
    circle: backend === "circle" ? new CircleWalletStore(supabaseAdmin(), makeCircleClient() as any, setId!) : (null as any),
    legacy: walletStoreFor(principal),
  };
}
