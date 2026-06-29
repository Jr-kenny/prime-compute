import {
  toPasskeyTransport,
  toWebAuthnCredential,
  toModularTransport,
  toCircleSmartAccount,
  WebAuthnMode,
} from "@circle-fin/modular-wallets-core";
import { createPublicClient } from "viem";
import { toWebAuthnAccount } from "viem/account-abstraction";
import { arcTestnet } from "./chain";

const clientKey = import.meta.env.VITE_CIRCLE_CLIENT_KEY as string;
const clientUrl = import.meta.env.VITE_CIRCLE_CLIENT_URL as string;

// What the onboarding flow needs from a Circle Modular Wallet: its address, and a way to sign a
// challenge so the backend can prove control. The Modular Wallet identifies by address; the web
// SDK exposes no separate wallet id, so walletId is empty (the profiles column stays unused).
export type WalletHandle = {
  address: string;
  walletId: string;
  signMessage: (message: string) => Promise<string>;
};

async function build(mode: WebAuthnMode, username: string): Promise<WalletHandle> {
  const passkeyTransport = toPasskeyTransport(clientUrl, clientKey);
  const credential = await toWebAuthnCredential({ transport: passkeyTransport, mode, username });

  const modularTransport = toModularTransport(`${clientUrl}/arcTestnet`, clientKey);
  const client = createPublicClient({ chain: arcTestnet, transport: modularTransport });
  const account = await toCircleSmartAccount({ client, owner: toWebAuthnAccount({ credential }) });

  return {
    address: account.address,
    walletId: "",
    signMessage: (message: string) => account.signMessage({ message }),
  };
}

// First-time users register a passkey + create the wallet; returning users log in with the
// existing passkey, which restores the same wallet (same address).
export const registerWallet = (username: string) => build(WebAuthnMode.Register, username);
export const loginWallet = (username = "prime-compute") => build(WebAuthnMode.Login, username);
