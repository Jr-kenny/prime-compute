// services/src/worker/verify-remittance.test.ts
import { test, expect } from "bun:test";
import { pad } from "viem";
import { transferredToTreasury, type ReceiptReader } from "./verify-remittance";

const USDC = "0x3600000000000000000000000000000000000000";
const TREASURY = "0x00000000000000000000000000000000000e1e45".toLowerCase() as `0x${string}`;
// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function reader(logs: { address: string; topics: string[]; data: string }[]): ReceiptReader {
  return { getTransactionReceipt: async () => ({ status: "success", logs }) as any };
}

const treasury32 = pad(TREASURY, { size: 32 }); // address left-padded to a bytes32 topic

test("sums USDC Transfer value to the treasury in the tx", async () => {
  const r = reader([
    { address: USDC, topics: [TRANSFER_TOPIC, pad("0x1111111111111111111111111111111111111111", { size: 32 }), treasury32], data: "0x" + (150n).toString(16).padStart(64, "0") },
  ]);
  expect(await transferredToTreasury(r, "0xabc", USDC, TREASURY)).toBe(150n);
});

test("ignores transfers of other tokens or to other recipients", async () => {
  const other32 = pad("0x2222222222222222222222222222222222222222", { size: 32 });
  const r = reader([
    { address: "0x9999999999999999999999999999999999999999", topics: [TRANSFER_TOPIC, other32, treasury32], data: "0x" + (150n).toString(16).padStart(64, "0") }, // wrong token
    { address: USDC, topics: [TRANSFER_TOPIC, treasury32, other32], data: "0x" + (150n).toString(16).padStart(64, "0") }, // wrong direction
  ]);
  expect(await transferredToTreasury(r, "0xabc", USDC, TREASURY)).toBe(0n);
});

test("a reverted tx counts as zero", async () => {
  const r: ReceiptReader = { getTransactionReceipt: async () => ({ status: "reverted", logs: [] }) as any };
  expect(await transferredToTreasury(r, "0xabc", USDC, TREASURY)).toBe(0n);
});
