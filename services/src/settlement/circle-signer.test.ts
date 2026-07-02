// services/src/settlement/circle-signer.test.ts
import { test, expect } from "bun:test";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { circleBatchSigner } from "./circle-signer";

// Stub Circle client that signs with a local key — validates the exact JSON we send
// (EIP712Domain present, bigints stringified) by round-tripping it through a real signer.
function stubCircle(account: ReturnType<typeof privateKeyToAccount>) {
  return {
    lastData: "",
    async signTypedData({ data }: { walletId: string; data: string; memo?: string }) {
      this.lastData = data;
      const parsed = JSON.parse(data);
      expect(parsed.types.EIP712Domain).toBeDefined(); // Circle rejects payloads without it
      const { EIP712Domain: _drop, ...types } = parsed.types;
      const signature = await account.signTypedData({
        domain: parsed.domain,
        types,
        primaryType: parsed.primaryType,
        message: {
          ...parsed.message,
          value: BigInt(parsed.message.value),
          validAfter: BigInt(parsed.message.validAfter),
          validBefore: BigInt(parsed.message.validBefore),
        },
      });
      return { data: { signature } };
    },
  };
}

const payParams = (from: `0x${string}`) => ({
  domain: {
    name: "GatewayWalletBatched", version: "1", chainId: 5042002,
    verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as `0x${string}`,
  },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: {
    from, to: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    value: 100n, validAfter: 0n, validBefore: 9999999999n,
    nonce: ("0x" + "11".repeat(32)) as `0x${string}`,
  },
});

test("signature from the Circle path recovers to the wallet address", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const circle = stubCircle(account);
  const signer = circleBatchSigner(circle, "wallet-1", account.address);
  const params = payParams(account.address);
  const signature = await signer.signTypedData(params as never);
  const recovered = await recoverTypedDataAddress({ ...(params as any), signature });
  expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
});

test("bigints in the message are JSON-safe strings on the wire", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const circle = stubCircle(account);
  const signer = circleBatchSigner(circle, "wallet-1", account.address);
  await signer.signTypedData(payParams(account.address) as never);
  const parsed = JSON.parse(circle.lastData);
  expect(parsed.message.value).toBe("100");
  expect(parsed.types.EIP712Domain.map((f: { name: string }) => f.name)).toEqual([
    "name", "version", "chainId", "verifyingContract",
  ]);
});
