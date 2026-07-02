// services/src/worker/verify-remittance.ts
// On-chain proof that a reported remittance actually paid the treasury: read the tx
// receipt and sum USDC Transfer events whose recipient is the treasury. We credit what
// the chain says moved, not what the report claims.
import { createPublicClient, http } from "viem";

export type ReceiptReader = {
  getTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ status: string; logs: { address: string; topics: string[]; data: string }[] }>;
};

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const topicIsAddress = (topic: string | undefined, address: string) =>
  !!topic && topic.length === 66 && `0x${topic.slice(26).toLowerCase()}` === address.toLowerCase();

export async function transferredToTreasury(
  reader: ReceiptReader,
  txHash: string,
  usdcAddress: string,
  treasury: string,
): Promise<bigint> {
  let receipt;
  try {
    receipt = await reader.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch {
    return 0n; // unknown tx = nothing verifiable
  }
  if (receipt.status !== "success") return 0n;
  let total = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdcAddress.toLowerCase()) continue;
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (!topicIsAddress(log.topics[2], treasury)) continue;
    total += BigInt(log.data);
  }
  return total;
}

export function makeReceiptReader(rpcUrl: string): ReceiptReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return { getTransactionReceipt: (args) => client.getTransactionReceipt(args) as any };
}
