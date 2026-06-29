import { createPublicClient, http, type Address, type Hex } from "viem";

// viem's verifyMessage transparently handles EOA (ecrecover), deployed smart accounts (ERC-1271),
// and counterfactual smart accounts (ERC-6492) when given a public client, which is exactly the
// Circle Modular Wallet case (smart account, possibly not yet deployed). One call covers all three.
const publicClient = createPublicClient({ transport: http(process.env.ARC_RPC_URL) });

export async function verifyWalletOwnership(args: {
  address: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  return publicClient.verifyMessage({
    address: args.address as Address,
    message: args.message,
    signature: args.signature as Hex,
  });
}
