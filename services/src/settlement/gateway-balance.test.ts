import { test, expect } from "bun:test";
import { getGatewayBalance } from "./gateway-balance";

test("getGatewayBalance posts the depositor and parses atomic USDC", async () => {
  let sent: { url: string; body: { token: string; sources: { depositor: string; domain: number }[] } } | null = null;
  const fetchImpl = (async (url: string, init: { body: string }) => {
    sent = { url, body: JSON.parse(init.body) };
    return new Response(
      JSON.stringify({ token: "USDC", balances: [{ domain: 26, balance: "0.085110", pendingBatch: "0" }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const bal = await getGatewayBalance("0xABC", { fetchImpl });

  expect(sent!.url).toBe("https://gateway-api-testnet.circle.com/v1/balances");
  expect(sent!.body.sources[0]).toEqual({ depositor: "0xABC", domain: 26 });
  expect(bal.availableAtomic).toBe(85110n);
  expect(bal.formatted).toBe("0.085110");
});

test("getGatewayBalance reads zero when the depositor has no float", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ token: "USDC", balances: [] }), { status: 200 })) as unknown as typeof fetch;

  const bal = await getGatewayBalance("0xNONE", { fetchImpl });

  expect(bal.availableAtomic).toBe(0n);
  expect(bal.formatted).toBe("0");
});

test("getGatewayBalance throws on a non-ok response", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  await expect(getGatewayBalance("0xABC", { fetchImpl })).rejects.toThrow(/gateway balances failed \(500\)/);
});
