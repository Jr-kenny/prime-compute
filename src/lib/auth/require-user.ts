import { supabaseAdmin } from "../supabase/server";

// Server-only. Every write (and any read of private data) takes a client-supplied accessToken
// and verifies it here rather than trusting a client-claimed userId/ownerWallet. Fails closed if
// the verified user has no wallet_address in their metadata, since wallet_address is the
// identity anchor everywhere else in this app (services/supabase/migrations/0005).
export async function requireUser(accessToken: string): Promise<{ id: string; walletAddress: string }> {
  const { data, error } = await supabaseAdmin().auth.getUser(accessToken);
  if (error || !data.user) throw new Error("invalid or expired session");

  const walletAddress = data.user.user_metadata?.wallet_address as string | undefined;
  if (!walletAddress) throw new Error("authenticated user has no wallet_address in metadata");

  return { id: data.user.id, walletAddress };
}
