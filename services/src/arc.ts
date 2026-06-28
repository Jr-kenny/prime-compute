import { createPublicClient, http, defineChain } from "viem";

export function arcChain(chainId: number, rpcUrl: string, explorerUrl: string) {
  return defineChain({
    id: chainId,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Arc Explorer", url: explorerUrl } },
    testnet: true,
  });
}

export function arcPublicClient(chainId: number, rpcUrl: string, explorerUrl: string) {
  return createPublicClient({
    chain: arcChain(chainId, rpcUrl, explorerUrl),
    transport: http(rpcUrl),
  });
}
