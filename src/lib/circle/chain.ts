import { defineChain } from "viem";

// Arc testnet, the chain our Circle Modular Wallet identity lives on (same chain as the broker's
// payments). The Circle modular transport routes RPC; this chain object supplies id + metadata.
export const arcTestnet = defineChain({
  id: Number(import.meta.env.VITE_ARC_CHAIN_ID),
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [import.meta.env.VITE_ARC_RPC_URL as string] } },
});
