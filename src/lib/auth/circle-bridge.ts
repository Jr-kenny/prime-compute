// src/lib/auth/circle-bridge.ts
// Identity v2 bridge: Circle's userToken replaces the signed nonce. Circle authenticated
// the human (email OTP + PIN); we verify the token server-side, anchor on the wallet
// address (C1-C5 unchanged), and mint the same Supabase session as before. Deps are
// injected so the bridge is unit-testable without Circle or Supabase.
export type CircleBridgeDeps = {
  status(userToken: string): Promise<{ circleUserId: string; pinStatus: string } | null>;
  arcWallet(userToken: string): Promise<{ walletId: string; address: string } | null>;
  createArcWalletChallenge(userToken: string): Promise<string>;
  mint(input: { address: string; walletId: string; circleUserId: string }): Promise<{ access_token: string; refresh_token: string }>;
};

export type CircleGateResult =
  | { kind: "challenge"; challengeId: string }   // first login: run PIN setup + wallet creation, then call again
  | { kind: "session"; access_token: string; refresh_token: string };

export async function circleGateLogin(deps: CircleBridgeDeps, userToken: string): Promise<CircleGateResult> {
  const user = await deps.status(userToken);
  if (!user) throw new Error("Circle login rejected: invalid or expired user token");

  const wallet = await deps.arcWallet(userToken);
  if (!wallet) {
    return { kind: "challenge", challengeId: await deps.createArcWalletChallenge(userToken) };
  }

  const session = await deps.mint({ address: wallet.address, walletId: wallet.walletId, circleUserId: user.circleUserId });
  return { kind: "session", ...session };
}
