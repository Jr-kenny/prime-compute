import { baseSepolia } from "viem/chains";

// The chain the Circle Modular Wallet identity lives on. Phase 0 only creates the wallet and
// signs a challenge, so any Circle-supported chain works; this is the single place to change it.
// (arcTestnet returned "Cannot find the entity config" for this app, so we use baseSepolia, the
// canonical Circle example chain, while we sort out Arc enablement.)
export const walletChain = baseSepolia;
export const walletChainSegment = "baseSepolia";
