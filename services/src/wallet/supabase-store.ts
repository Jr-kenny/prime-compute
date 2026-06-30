import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encryptSecret, decryptSecret } from "./crypto";
import type { SpendWalletStore, SpendWallet, SpendSigner } from "./store";

export class SupabaseSpendWalletStore implements SpendWalletStore {
  constructor(private db: SupabaseClient, private encKey: string) {}

  async getOrCreate(userId: string): Promise<SpendWallet> {
    const found = await this.getAddress(userId);
    if (found) return { address: found };

    const pk = generatePrivateKey();
    const address = privateKeyToAccount(pk).address;
    const enc_private_key = await encryptSecret(pk, this.encKey);
    const { error } = await this.db
      .from("spend_wallets")
      .insert({ user_id: userId, address, enc_private_key });
    // A concurrent create may have won the race; re-read rather than fail.
    if (error) {
      const again = await this.getAddress(userId);
      if (again) return { address: again };
      throw error;
    }
    return { address };
  }

  async getAddress(userId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from("spend_wallets")
      .select("address")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return (data?.address as string | undefined) ?? null;
  }

  async loadSigner(userId: string): Promise<SpendSigner | null> {
    const { data, error } = await this.db
      .from("spend_wallets")
      .select("address, enc_private_key")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const privateKey = (await decryptSecret(data.enc_private_key as string, this.encKey)) as `0x${string}`;
    return { address: data.address as string, privateKey };
  }
}
