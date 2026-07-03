// src/lib/agents/withdraw.ts
// Withdraw USDC from an agent's custodied wallet, symmetric to the user's withdrawFromSpendWallet.
// Circle-controlled wallets go through Circle's createTransaction; legacy raw wallets are signed
// locally. All I/O is injected so the logic is unit-tested without network or Supabase.
import type { Principal } from "@services/domain";

export type WithdrawDeps = {
  findCircleWalletId: (agentId: string) => Promise<string | null>;
  circleTransfer: (walletId: string, toAddress: string, amount: string) => Promise<string>; // -> tx id
  rawSigner: (agentId: string) => Promise<((toAddress: string, atomic: bigint) => Promise<string>) | null>;
};

export function parseUsdc(s: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(s.trim())) throw new Error("invalid amount");
  const [whole, frac = ""] = s.trim().split(".");
  return BigInt(whole + frac.padEnd(6, "0"));
}

export async function withdrawAgentFunds(
  principal: Principal,
  toAddress: string,
  amount: string,
  deps: WithdrawDeps,
): Promise<{ txHash: string }> {
  if (principal.kind !== "agent") throw new Error("agent principal required");
  if (!/^0x[0-9a-fA-F]{40}$/.test(toAddress)) throw new Error("invalid destination address");
  const atomic = parseUsdc(amount);
  if (atomic <= 0n) throw new Error("amount must be positive");

  const circleId = await deps.findCircleWalletId(principal.id);
  if (circleId) return { txHash: await deps.circleTransfer(circleId, toAddress, amount) };

  const signer = await deps.rawSigner(principal.id);
  if (!signer) throw new Error("no wallet for agent");
  return { txHash: await signer(toAddress, atomic) };
}
