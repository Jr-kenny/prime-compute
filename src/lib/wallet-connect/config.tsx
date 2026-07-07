// src/lib/wallet-connect/config.tsx
// wagmi + RainbowKit setup on the custom Arc testnet chain. This is the ONLY place the
// chain is defined; everything browser-side (connect, fund transfer, balance reads)
// hangs off this config.
import { defineChain } from "viem";
import { getDefaultConfig, RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import "@rainbow-me/rainbowkit/styles.css";

// The public Arc testnet explorer. Wired into the chain (so RainbowKit's account modal gets
// "view on explorer" for free) and exported for direct links anywhere an address shows.
export const arcExplorerUrl =
  (import.meta.env.VITE_ARC_EXPLORER_URL as string | undefined) ?? "https://testnet.arcscan.app";

export const explorerAddressUrl = (address: string) => `${arcExplorerUrl}/address/${address}`;

export const arcTestnet = defineChain({
  id: Number(import.meta.env.VITE_ARC_CHAIN_ID ?? 5042002),
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_ARC_RPC_URL as string] } },
  blockExplorers: { default: { name: "Arc Explorer", url: arcExplorerUrl } },
  testnet: true,
});

export const usdcAddress = import.meta.env.VITE_USDC_ADDRESS as `0x${string}`;

export const wagmiConfig = getDefaultConfig({
  appName: "Prime Compute",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string,
  chains: [arcTestnet],
  ssr: true,
});

export function WalletProviders({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <RainbowKitProvider theme={darkTheme({ accentColor: "#3b82f6" })} modalSize="compact">
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
}
