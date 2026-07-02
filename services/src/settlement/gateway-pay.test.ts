// services/src/settlement/gateway-pay.test.ts
import { test, expect } from "bun:test";
import { gatewayPay } from "./gateway-pay";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

const requirement = {
  scheme: "exact", network: "eip155:5042002", asset: "0xusdc", amount: "99",
  payTo: "0xseller", maxTimeoutSeconds: 60,
  extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
};

function fakeScheme() {
  const calls: { x402Version: number; req: unknown }[] = [];
  return {
    calls,
    async createPaymentPayload(x402Version: number, req: unknown) {
      calls.push({ x402Version, req });
      return { x402Version, payload: { signature: "0xsig", authorization: { from: "0xbuyer", to: "0xseller", value: "99", validAfter: "0", validBefore: "9", nonce: "0x11" } } };
    },
  };
}

function fetchScript(...responses: Response[]) {
  let i = 0;
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    return responses[i++] ?? new Response("exhausted", { status: 500 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("pays through the 402 dance and returns amount + settlement ref", async () => {
  const paymentRequired = { x402Version: 2, resource: "http://p/compute", accepts: [requirement] };
  const { impl, calls } = fetchScript(
    new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": b64(paymentRequired) } }),
    new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", "PAYMENT-RESPONSE": b64({ transaction: "settle-uuid" }) } }),
  );
  const scheme = fakeScheme();
  const paid = await gatewayPay("http://p/compute", scheme, { chainId: 5042002, fetchImpl: impl });
  expect(paid.amountAtomic).toBe(99n);
  expect(paid.settlementRef).toBe("settle-uuid");
  expect(paid.status).toBe(200);
  expect(scheme.calls[0]?.req).toEqual(requirement);
  const sigHeader = calls[1]?.headers["Payment-Signature"];
  const decoded = JSON.parse(Buffer.from(sigHeader!, "base64").toString("utf8"));
  expect(decoded.accepted).toEqual(requirement);
  expect(decoded.resource).toBe("http://p/compute");
});

test("a 200 without a paywall is free (amount 0, no signing)", async () => {
  const { impl } = fetchScript(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
  const scheme = fakeScheme();
  const paid = await gatewayPay("http://p/free", scheme, { chainId: 5042002, fetchImpl: impl });
  expect(paid.amountAtomic).toBe(0n);
  expect(scheme.calls.length).toBe(0);
});

test("throws when no Gateway batching option matches the chain", async () => {
  const paymentRequired = { x402Version: 2, resource: "r", accepts: [{ ...requirement, network: "eip155:1" }] };
  const { impl } = fetchScript(new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": b64(paymentRequired) } }));
  await expect(gatewayPay("http://p/compute", fakeScheme(), { chainId: 5042002, fetchImpl: impl })).rejects.toThrow(/batching option/);
});
