// src/lib/auth/siwe-fns.ts
// Identity v3 server-fns: issue the SIWE nonce, verify the signed message, mint the session.
import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, http } from "viem";
import { issueLoginNonce, siweLogin } from "./siwe";
import { mintSessionForWallet } from "./mint-session";

export const getLoginNonce = createServerFn({ method: "POST" })
  .validator((d: { address: string }) => d)
  .handler(async ({ data }) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(data.address)) throw new Error("invalid address");
    return { nonce: issueLoginNonce(data.address) };
  });

export const completeSiweLogin = createServerFn({ method: "POST" })
  .validator((d: { message: string; signature: string }) => d)
  .handler(async ({ data }) => {
    // verifySiweMessage on a public client handles EOAs and ERC-6492 smart accounts alike.
    const client = createPublicClient({ transport: http(process.env.ARC_RPC_URL) });
    return siweLogin(
      {
        verify: ({ message, signature }) => client.verifySiweMessage({ message, signature }),
        mint: (input) => mintSessionForWallet(input),
      },
      data,
    );
  });
