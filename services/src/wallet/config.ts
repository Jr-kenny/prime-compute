type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

// Arc chain + USDC + encryption key, read once. Spend wallets live on Arc (settlement
// already runs there); the passkey identity wallet's baseSepolia chain is unrelated.
export function loadWalletConfig(env: Env = process.env) {
  return {
    rpcUrl: required(env, "ARC_RPC_URL"),
    chainId: Number(required(env, "ARC_CHAIN_ID")),
    explorerUrl: env.ARC_EXPLORER_URL ?? "",
    usdc: required(env, "USDC_ADDRESS") as `0x${string}`,
    encKey: required(env, "SPEND_WALLET_ENC_KEY"),
  };
}

export type WalletConfig = ReturnType<typeof loadWalletConfig>;
