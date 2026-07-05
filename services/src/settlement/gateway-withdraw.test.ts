import { test, expect } from "bun:test";
import { gatewayWithdraw } from "./gateway-withdraw";
import type { BatchEvmSigner } from "@circle-fin/x402-batching";

type Signed = { primaryType: string; message: { spec: { value: bigint; destinationRecipient: string; sourceDepositor: string } } };

function stubSigner(record: (p: Signed) => void): BatchEvmSigner {
  return {
    address: "0xPAYER" as `0x${string}`,
    signTypedData: (async (p: Signed) => {
      record(p);
      return "0xsig" as `0x${string}`;
    }) as unknown as BatchEvmSigner["signTypedData"],
  };
}

test("gatewayWithdraw signs a BurnIntent, posts it, and mints the attestation", async () => {
  const calls: { signed?: Signed; transfer?: { url: string; body: { burnIntent: unknown; signature: string }[] }; mint?: { attestation: string; sig: string } } = {};
  const fetchImpl = (async (url: string, init: { body: string }) => {
    calls.transfer = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ attestation: "0xatt", signature: "0xgwsig" }), { status: 200 });
  }) as unknown as typeof fetch;
  const signer = stubSigner((p) => (calls.signed = p));
  const mint = async (attestation: string, sig: string) => {
    calls.mint = { attestation, sig };
    return "0xMINTTX";
  };

  const res = await gatewayWithdraw(100n, { signer, recipient: "0xRECIP", maxFeeAtomic: 5000n, fetchImpl, mint });

  // signed the right burn intent
  expect(calls.signed!.primaryType).toBe("BurnIntent");
  expect(calls.signed!.message.spec.value).toBe(100n);
  expect(calls.signed!.message.spec.destinationRecipient).toHaveLength(66); // padded bytes32 of 0xRECIP
  expect(calls.signed!.message.spec.sourceDepositor).toHaveLength(66); // padded bytes32 of the signer address
  // posted the intent + signature
  expect(calls.transfer!.url).toContain("/transfer");
  expect(Array.isArray(calls.transfer!.body)).toBe(true);
  expect(calls.transfer!.body[0]!.signature).toBe("0xsig");
  // handed the attestation to the mint executor and returned its tx
  expect(calls.mint).toEqual({ attestation: "0xatt", sig: "0xgwsig" });
  expect(res.mintTxHash).toBe("0xMINTTX");
  expect(res.amountAtomic).toBe(100n);
});

test("gatewayWithdraw throws when /transfer returns no attestation", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ error: "insufficient balance" }), { status: 400 })) as unknown as typeof fetch;
  const signer = stubSigner(() => {});
  let minted = false;
  await expect(
    gatewayWithdraw(100n, { signer, recipient: "0xP", maxFeeAtomic: 5000n, fetchImpl, mint: async () => ((minted = true), "x") }),
  ).rejects.toThrow(/transfer failed/);
  expect(minted).toBe(false); // never mint without an attestation
});
