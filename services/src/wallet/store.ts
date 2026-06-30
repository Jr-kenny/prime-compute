import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encryptSecret, decryptSecret } from "./crypto";

export type SpendWallet = { address: string };
export type SpendSigner = { address: string; privateKey: `0x${string}` };

// One wallet per user. The encrypted private key never leaves the server/worker.
export interface SpendWalletStore {
  getOrCreate(userId: string): Promise<SpendWallet>;
  getAddress(userId: string): Promise<string | null>;
  loadSigner(userId: string): Promise<SpendSigner | null>; // server/worker-only
}

type Row = { address: string; encPrivateKey: string };

export class InMemorySpendWalletStore implements SpendWalletStore {
  private rows = new Map<string, Row>();
  constructor(private encKey: string) {}

  async getOrCreate(userId: string): Promise<SpendWallet> {
    const existing = this.rows.get(userId);
    if (existing) return { address: existing.address };
    const pk = generatePrivateKey();
    const address = privateKeyToAccount(pk).address;
    this.rows.set(userId, { address, encPrivateKey: await encryptSecret(pk, this.encKey) });
    return { address };
  }

  async getAddress(userId: string): Promise<string | null> {
    return this.rows.get(userId)?.address ?? null;
  }

  async loadSigner(userId: string): Promise<SpendSigner | null> {
    const row = this.rows.get(userId);
    if (!row) return null;
    const privateKey = (await decryptSecret(row.encPrivateKey, this.encKey)) as `0x${string}`;
    return { address: row.address, privateKey };
  }
}
