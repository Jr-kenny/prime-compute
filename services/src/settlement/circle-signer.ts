// services/src/settlement/circle-signer.ts
import type { BatchEvmSigner } from "@circle-fin/x402-batching";

// The API slice the signer needs from the Circle developer-controlled wallets client.
export type CircleSignerApi = {
  signTypedData(input: { walletId: string; data: string; memo?: string }): Promise<{ data?: { signature?: string } }>;
};

// Canonical EIP712Domain field order; only fields actually present in the domain are declared.
const DOMAIN_FIELDS: { name: string; type: string }[] = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
  { name: "salt", type: "bytes32" },
];

const jsonSafe = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

// A BatchEvmSigner whose key lives at Circle. Two dialect fixes vs the viem-style params
// BatchEvmScheme passes in (both probe-proven 2026-07-02): Circle's validator requires
// EIP712Domain declared in `types`, and the JSON body can't carry bigints.
export function circleBatchSigner(client: CircleSignerApi, walletId: string, address: string): BatchEvmSigner {
  return {
    address: address as `0x${string}`,
    async signTypedData(params) {
      const domainType = DOMAIN_FIELDS.filter((f) => (params.domain as Record<string, unknown>)[f.name] !== undefined);
      const data = JSON.stringify(
        { domain: params.domain, types: { EIP712Domain: domainType, ...params.types }, primaryType: params.primaryType, message: params.message },
        jsonSafe,
      );
      const res = await client.signTypedData({ walletId, data, memo: "prime-compute x402 charge" });
      const signature = res.data?.signature;
      if (!signature) throw new Error(`Circle signTypedData returned no signature: ${JSON.stringify(res.data)}`);
      return signature as `0x${string}`;
    },
  };
}
