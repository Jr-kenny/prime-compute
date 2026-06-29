import { supabaseAdmin } from "../supabase/server";
import { issueNonce, verifyNonce, nonceMessage } from "./nonce";
import { verifyWalletOwnership } from "./verify-ownership";

// Step 1 of the ceremony: hand the client a challenge bound to its wallet address.
export async function getNonce(address: string): Promise<{ nonce: string; message: string }> {
  const nonce = issueNonce(address);
  return { nonce, message: nonceMessage(nonce) };
}

// Step 2: verify the signed challenge, find-or-create the user by wallet, mint a real session.
export async function verifyAndMintSession(input: {
  address: string;
  walletId: string;
  nonce: string;
  signature: string;
}): Promise<{ access_token: string; refresh_token: string }> {
  const address = input.address.toLowerCase();

  if (!verifyNonce(input.nonce, address).ok) throw new Error("invalid or expired nonce");
  const owns = await verifyWalletOwnership({
    address,
    message: nonceMessage(input.nonce),
    signature: input.signature,
  });
  if (!owns) throw new Error("signature does not prove wallet ownership");

  const db = supabaseAdmin();
  const email = `${address}@wallet.prime`;

  // Find-or-create by wallet (C2). The profile is created atomically by the DB trigger from the
  // user_metadata we set here (C4); we never write profiles directly here.
  const { data: existing } = await db.from("profiles").select("id").eq("wallet_address", address).maybeSingle();
  if (!existing) {
    const { error } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { wallet_address: address, wallet_id: input.walletId },
    });
    if (error && !/already.*registered/i.test(error.message)) throw error;
  }

  // Mint a real Supabase session (access + refresh) without hand-rolling JWTs: generate a
  // magiclink token via admin, then exchange it for a session. No email is sent. (The exact
  // verifyOtp `type` is confirmed against supabase-js during the Task 7 acceptance round-trip.)
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
