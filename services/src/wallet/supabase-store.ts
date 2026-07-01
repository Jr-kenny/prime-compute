import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encryptSecret, decryptSecret } from "./crypto";
import type { SpendWalletStore, SpendWallet, SpendSigner } from "./store";

type StoreOpts = { table?: string; idColumn?: string };

// One wallet per principal id. Defaults to the user spend-wallet table; pass opts to back a
// different principal (e.g. agents). The encrypted key never leaves the server/worker.
export class SupabaseSpendWalletStore implements SpendWalletStore {
  private table: string;
  private idColumn: string;
  constructor(private db: SupabaseClient, private encKey: string, opts: StoreOpts = {}) {
    this.table = opts.table ?? "spend_wallets";
    this.idColumn = opts.idColumn ?? "user_id";
  }

  async getOrCreate(id: string): Promise<SpendWallet> {
    const found = await this.getAddress(id);
    if (found) return { address: found };

    const pk = generatePrivateKey();
    const address = privateKeyToAccount(pk).address;
    const enc_private_key = await encryptSecret(pk, this.encKey);
    const { error } = await this.db
      .from(this.table)
      .insert({ [this.idColumn]: id, address, enc_private_key });
    // A concurrent create may have won the race; re-read rather than fail.
    if (error) {
      const again = await this.getAddress(id);
      if (again) return { address: again };
      throw error;
    }
    return { address };
  }

  async getAddress(id: string): Promise<string | null> {
    const { data, error } = await this.db
      .from(this.table)
      .select("address")
      .eq(this.idColumn, id)
      .maybeSingle();
    if (error) throw error;
    return (data?.address as string | undefined) ?? null;
  }

  async loadSigner(id: string): Promise<SpendSigner | null> {
    const { data, error } = await this.db
      .from(this.table)
      .select("address, enc_private_key")
      .eq(this.idColumn, id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const privateKey = (await decryptSecret(data.enc_private_key as string, this.encKey)) as `0x${string}`;
    return { address: data.address as string, privateKey };
  }
}
