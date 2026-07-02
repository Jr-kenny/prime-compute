import { issueNonce, verifyNonce, nonceMessage } from "./nonce";
import { verifyWalletOwnership } from "./verify-ownership";
import { mintSessionForWallet } from "./mint-session";

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

  return mintSessionForWallet({ address, walletId: input.walletId });
}
