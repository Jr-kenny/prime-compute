// services/src/settlement/circle-gateway.test.ts
import { test, expect } from "bun:test";
import { CircleGatewaySettlementAdapter, type CircleGatewayOptions } from "./circle-gateway";
import { SpendCapError } from "./spend-policy";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const requirement = {
  scheme: "exact", network: "eip155:5042002", asset: "0xusdc", amount: "99", payTo: "0x000000000000000000000000000000000000dEaD",
  maxTimeoutSeconds: 60, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
};

// A Circle client stub: signs anything, executes contracts, reports transactions complete.
function stubCircle() {
  const executions: { abiFunctionSignature: string; abiParameters: string[]; contractAddress: string }[] = [];
  return {
    executions,
    async signTypedData() { return { data: { signature: ("0x" + "ab".repeat(65)) as string } }; },
    async createContractExecutionTransaction(input: { abiFunctionSignature: string; abiParameters: string[]; contractAddress: string }) {
      executions.push(input);
      return { data: { id: `tx-${executions.length}` } };
    },
    async getTransaction() { return { data: { transaction: { state: "COMPLETE", txHash: "0xhash" } } }; },
  };
}

function paywalledFetch() {
  return (async (url: string, init?: { headers?: Record<string, string> }) => {
    if (String(url).includes("gateway-api")) {
      return new Response(JSON.stringify({ balances: [{ balance: "0" }] }), { status: 200 }); // gateway empty
    }
    if (!init?.headers?.["Payment-Signature"]) {
      return new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": b64({ x402Version: 2, resource: String(url), accepts: [requirement] }) } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "PAYMENT-RESPONSE": b64({ transaction: "settle-1" }) } });
  }) as unknown as typeof fetch;
}

const opts = (over: Partial<CircleGatewayOptions> = {}): CircleGatewayOptions => ({
  client: stubCircle(), walletId: "w1", address: "0x5aD0cCd42FE945AFF0C7e64e268f3E82788C2c16",
  capAtomic: 10_000n, usdcAddress: "0xusdc", fetchImpl: paywalledFetch(), ...over,
});

test("payForCompute pays the 402 and tracks spend against the cap", async () => {
  const adapter = new CircleGatewaySettlementAdapter(opts());
  const paid = await adapter.payForCompute("http://p/compute");
  expect(paid.amountAtomic).toBe(99n);
  expect(paid.settlementRef).toBe("settle-1");
});

test("payForCompute throws SpendCapError beyond the cap", async () => {
  const adapter = new CircleGatewaySettlementAdapter(opts({ capAtomic: 50n }));
  await expect(adapter.payForCompute("http://p/compute")).rejects.toThrow(SpendCapError);
});

test("ensureFunded approves + deposits the shortfall via Circle contract execution", async () => {
  const client = stubCircle();
  const adapter = new CircleGatewaySettlementAdapter(opts({ client }));
  const r = await adapter.ensureFunded(500n);
  expect(r.deposited).toBe(true);
  expect(client.executions.length).toBe(2);
  expect(client.executions[0]?.abiFunctionSignature).toBe("approve(address,uint256)");
  expect(client.executions[0]?.abiParameters).toEqual(["0x0077777d7EBA4688BDeF3E311b846F25870A19B9", "500"]);
  expect(client.executions[0]?.contractAddress).toBe("0xusdc");
  expect(client.executions[1]?.abiFunctionSignature).toBe("deposit(address,uint256)");
  expect(client.executions[1]?.abiParameters).toEqual(["0xusdc", "500"]);
  expect(client.executions[1]?.contractAddress).toBe("0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
});

test("ensureFunded is a no-op when the gateway balance covers the minimum", async () => {
  const client = stubCircle();
  const richFetch = (async (url: string) => {
    if (String(url).includes("gateway-api")) return new Response(JSON.stringify({ balances: [{ balance: "1" }] }), { status: 200 }); // 1 USDC
    throw new Error("unexpected");
  }) as unknown as typeof fetch;
  const adapter = new CircleGatewaySettlementAdapter(opts({ client, fetchImpl: richFetch }));
  const r = await adapter.ensureFunded(500n);
  expect(r.deposited).toBe(false);
  expect(client.executions.length).toBe(0);
});
