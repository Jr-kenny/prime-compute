// src/lib/auth/mint-session.ts
import { supabaseAdmin } from "../supabase/server";

// Find-or-create the Supabase user by wallet (C2) and mint a real session. The profile is
// created atomically by the DB trigger from user_metadata (C4); we never insert profiles here.
// circle_user_id is operational metadata stamped after the fact (also backfills profiles that
// existed before Identity v2).
export async function mintSessionForWallet(input: {
  address: string;   // already lower-cased by the caller
  walletId: string;
  circleUserId?: string;
}): Promise<{ access_token: string; refresh_token: string }> {
  const db = supabaseAdmin();
  const email = `${input.address}@wallet.prime`;

  const { data: existing } = await db.from("profiles").select("id").eq("wallet_address", input.address).maybeSingle();
  if (!existing) {
    const { error } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { wallet_address: input.address, wallet_id: input.walletId },
    });
    if (error && !/already.*registered/i.test(error.message)) throw error;
  }

  if (input.circleUserId) {
    const { error } = await db.from("profiles")
      .update({ circle_user_id: input.circleUserId })
      .eq("wallet_address", input.address);
    if (error) throw error;
  }

  // Mint a real Supabase session (access + refresh) without hand-rolling JWTs: generate a
  // magiclink token via admin, then exchange it for a session. No email is sent.
  const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !link?.properties?.email_otp) throw linkErr ?? new Error("no otp");
  const { data: session, error: otpErr } = await db.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  if (otpErr || !session.session) throw otpErr ?? new Error("no session");

  return {
    access_token: session.session.access_token,
    refresh_token: session.session.refresh_token,
  };
}
