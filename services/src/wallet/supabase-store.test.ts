import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import { SupabaseSpendWalletStore } from "./supabase-store";

// Offline: a minimal fake Supabase client, one in-memory table keyed by the configured id column.
function fakeDb() {
  const tables: Record<string, any[]> = {};
  return {
    _tables: tables,
    from(table: string) {
      tables[table] ??= [];
      const rows = tables[table];
      let col = "", val: unknown;
      const api: any = {
        select(_c = "*") { return api; },
        eq(c: string, v: unknown) { col = c; val = v; return api; },
        async maybeSingle() {
          const r = rows.find((x) => x[col] === val) ?? null;
          return { data: r, error: null };
        },
        async insert(row: any) { rows.push(row); return { error: null }; },
      };
      return api;
    },
  } as any;
}

const FAKE_KEY = "3q2+7wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32-byte base64

test("stores agent wallets in the configured table + id column", async () => {
  const db = fakeDb();
  const store = new SupabaseSpendWalletStore(db, FAKE_KEY, { table: "agent_wallets", idColumn: "agent_id" });
  const { address } = await store.getOrCreate("agent-1");
  expect(address).toMatch(/^0x/);
  expect(db._tables.agent_wallets[0].agent_id).toBe("agent-1");
  const signer = await store.loadSigner("agent-1");
  expect(signer?.address).toBe(address);
  expect(signer?.privateKey).toMatch(/^0x/);
});

test("defaults to spend_wallets / user_id when no opts given", async () => {
  const db = fakeDb();
  const store = new SupabaseSpendWalletStore(db, FAKE_KEY);
  await store.getOrCreate("user-1");
  expect(db._tables.spend_wallets[0].user_id).toBe("user-1");
});

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
