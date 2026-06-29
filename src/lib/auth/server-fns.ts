import { createServerFn } from "@tanstack/react-start";
import { getNonce, verifyAndMintSession } from "./bridge";

// Server-only endpoints. The handlers run on the server (service-role key, nonce secret, and
// Arc RPC live in process.env there); the client gets RPC stubs, not the bridge code.
export const requestNonce = createServerFn({ method: "POST" })
  .validator((d: { address: string }) => d)
  .handler(async ({ data }) => getNonce(data.address));

export const verifySession = createServerFn({ method: "POST" })
  .validator((d: { address: string; walletId: string; nonce: string; signature: string }) => d)
  .handler(async ({ data }) => verifyAndMintSession(data));
