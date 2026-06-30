import { createPublicClient, createWalletClient, http, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcChain } from "../arc";
import type { WalletConfig } from "./config";
import type { SpendSigner } from "./store";

// The chain calls are injected so the unit test runs without a network. In production
// makeOnchain(cfg) builds the real viem-backed seam.
export type ChainIO = {
  readContract: (args: {
    address: `0x${string}`;
    abi: typeof erc20Abi;
    functionName: "balanceOf";
    args: [`0x${string}`];
  }) => Promise<bigint>;
  writeTransfer: (signer: SpendSigner, to: `0x${string}`, amount: bigint) => Promise<`0x${string}`>;
};

export function makeOnchain(cfg: WalletConfig, io: ChainIO = realChainIO(cfg)) {
  return {
    async usdcBalance(address: string): Promise<bigint> {
      return io.readContract({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      });
    },
    async usdcTransfer(signer: SpendSigner, to: string, amount: bigint): Promise<`0x${string}`> {
      if (amount <= 0n) throw new Error("amount must be positive");
      const bal = await io.readContract({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [signer.address as `0x${string}`],
      });
      if (amount > bal) throw new Error("insufficient balance");
      return io.writeTransfer(signer, to as `0x${string}`, amount);
    },
  };
}

function realChainIO(cfg: WalletConfig): ChainIO {
  const chain = arcChain(cfg.chainId, cfg.rpcUrl, cfg.explorerUrl);
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  return {
    readContract: (args) => publicClient.readContract(args) as Promise<bigint>,
    writeTransfer: (signer, to, amount) => {
      const wallet = createWalletClient({
        account: privateKeyToAccount(signer.privateKey),
        chain,
        transport: http(cfg.rpcUrl),
      });
      return wallet.writeContract({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "transfer",
        args: [to, amount],
      });
    },
  };
}
