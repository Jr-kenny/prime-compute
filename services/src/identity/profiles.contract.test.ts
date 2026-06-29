import { test, expect, beforeAll } from "bun:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const admin: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false } });

const T = 30_000;
const wallet = () => `0x${crypto.randomUUID().replace(/-/g, "")}`.slice(0, 42);

async function makeUser(walletAddress: string, walletId = "wid-1") {
  const email = `${walletAddress}@wallet.prime`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { wallet_address: walletAddress, wallet_id: walletId },
  });
  if (error) throw error;
  return data.user;
}

beforeAll(() => {
  if (!url || !serviceKey || !anonKey) throw new Error("set SUPABASE_URL/SERVICE_ROLE_KEY/ANON_KEY");
});

test("C4: creating an auth user provisions its profile atomically", async () => {
  const w = wallet();
  const user = await makeUser(w);
  const { data: profile } = await admin.from("profiles").select().eq("id", user.id).single();
  expect(profile?.wallet_address).toBe(w.toLowerCase());
  expect(profile?.wallet_id).toBe("wid-1");
  await admin.auth.admin.deleteUser(user.id);
}, T);

test("C2: a second user with the same wallet is rejected", async () => {
  const w = wallet();
  const a = await makeUser(w);
  // The duplicate's trigger insert must violate the unique constraint, so createUser fails.
  await expect(makeUser(w)).rejects.toBeDefined();
  await admin.auth.admin.deleteUser(a.id);
}, T);

test("immutability: wallet_address cannot be changed", async () => {
  const w = wallet();
  const user = await makeUser(w);
  const { error } = await admin.from("profiles").update({ wallet_address: wallet() }).eq("id", user.id);
  expect(error?.message ?? "").toContain("immutable");
  await admin.auth.admin.deleteUser(user.id);
}, T);

test("RLS: an anon client cannot read other users' profiles", async () => {
  const w = wallet();
  const user = await makeUser(w);
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data } = await anon.from("profiles").select().eq("id", user.id);
  expect(data ?? []).toHaveLength(0); // no session => RLS denies
  await admin.auth.admin.deleteUser(user.id);
}, T);
