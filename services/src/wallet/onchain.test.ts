import { expect, test, describe } from "bun:test";
import { makeOnchain } from "./onchain";

const cfg = {
  rpcUrl: "http://localhost:0",
  chainId: 9999,
  explorerUrl: "",
  usdc: "0x0000000000000000000000000000000000000001" as `0x${string}`,
  encKey: "x",
};

describe("onchain USDC", () => {
  test("usdcBalance reads balanceOf for the given address", async () => {
    const calls: unknown[] = [];
    const onchain = makeOnchain(cfg, {
      readContract: async (args) => {
        calls.push(args);
        return 1_500_000n; // 1.5 USDC (6 decimals)
      },
      writeTransfer: async () => "0xhash",
    });
    const bal = await onchain.usdcBalance("0x00000000000000000000000000000000000000aa");
    expect(bal).toBe(1_500_000n);
    expect((calls[0] as { functionName: string }).functionName).toBe("balanceOf");
  });

  test("usdcTransfer rejects an over-balance amount before signing", async () => {
    const onchain = makeOnchain(cfg, {
      readContract: async () => 100n,
      writeTransfer: async () => "0xhash",
    });
    await expect(
      onchain.usdcTransfer(
        { address: "0x00000000000000000000000000000000000000aa", privateKey: ("0x" + "1".repeat(64)) as `0x${string}` },
        "0x00000000000000000000000000000000000000bb",
        200n,
      ),
    ).rejects.toThrow(/insufficient/i);
  });
});
