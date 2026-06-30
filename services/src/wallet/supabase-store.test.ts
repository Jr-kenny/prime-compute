import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import { SupabaseSpendWalletStore } from "./supabase-store";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const encKey = process.env.SPEND_WALLET_ENC_KEY;
const gated = url && key && encKey ? describe : describe.skip;

gated("SupabaseSpendWalletStore (live)", () => {
  const admin = createClient(url!, key!, { auth: { persistSession: false } });
  const store = new SupabaseSpendWalletStore(admin, encKey!);
  // spend_wallets.user_id references auth.users, so we need a real throwaway user.
  let userId = "";

  beforeAll(async () => {
    const email = `wallet-test-${crypto.randomUUID()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw error ?? new Error("could not create test user");
    userId = data.user.id;
  });

  afterAll(async () => {
    await admin.from("spend_wallets").delete().eq("user_id", userId);
    if (userId) await admin.auth.admin.deleteUser(userId); // cascades the wallet row too
  });

  test("creates once, reads back the same address, loads the matching signer", async () => {
    const a = await store.getOrCreate(userId);
    const b = await store.getOrCreate(userId);
    expect(b.address).toBe(a.address);
    expect(await store.getAddress(userId)).toBe(a.address);
    const signer = await store.loadSigner(userId);
    expect(signer?.address.toLowerCase()).toBe(a.address.toLowerCase());
  });
});
