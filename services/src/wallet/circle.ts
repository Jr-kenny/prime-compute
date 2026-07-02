// services/src/wallet/circle.ts
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CircleClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

export function makeCircleClient(env: Record<string, string | undefined> = process.env): CircleClient {
  const apiKey = env.CIRCLE_API_KEY;
  const entitySecret = env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) throw new Error("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET required");
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

export type OwnerKind = "user" | "agent" | "platform";
export type CircleWallet = { walletId: string; address: string };

// The API slice the store needs; the real client satisfies it, tests stub it.
export type CircleWalletsApi = {
  createWallets(input: { walletSetId: string; blockchains: any[]; accountType: "EOA"; count: number }): Promise<any>;
};

// One Circle wallet per principal, mapped in circle_wallets. accountType EOA is
// load-bearing: EIP-3009 needs an ECDSA signature recovering to the funds-holding address.
export class CircleWalletStore {
  constructor(private db: SupabaseClient, private circle: CircleWalletsApi, private walletSetId: string) {}

  async get(kind: OwnerKind, id: string): Promise<CircleWallet | null> {
    const { data, error } = await this.db.from("circle_wallets").select("wallet_id, address")
      .eq("owner_kind", kind).eq("owner_id", id).maybeSingle();
    if (error) throw error;
    return data ? { walletId: data.wallet_id as string, address: data.address as string } : null;
  }

  async getOrCreate(kind: OwnerKind, id: string): Promise<CircleWallet> {
    const found = await this.get(kind, id);
    if (found) return found;
    const res: any = await this.circle.createWallets({
      walletSetId: this.walletSetId, blockchains: ["ARC-TESTNET"], accountType: "EOA", count: 1,
    });
    const w = res.data?.wallets?.[0];
    if (!w) throw new Error(`createWallets returned no wallet: ${JSON.stringify(res.data)}`);
    const { error } = await this.db.from("circle_wallets").insert({
      owner_kind: kind, owner_id: id, wallet_id: w.id, address: w.address,
    });
    if (error) {
      const again = await this.get(kind, id); // lost a race; the existing row wins
      if (again) return again;
      throw error;
    }
    return { walletId: w.id as string, address: w.address as string };
  }
}
