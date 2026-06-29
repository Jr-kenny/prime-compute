import { createPublicClient, http, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";

// viem's verifyMessage transparently handles EOA (ecrecover), deployed smart accounts (ERC-1271),
// and counterfactual smart accounts (ERC-6492) when given a public client, which is exactly the
// Circle Modular Wallet case (smart account, possibly not yet deployed). One call covers all three.
// The chain MUST match the chain the wallet was created on (see src/lib/circle/chain.ts).
const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

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
