// Reads a wallet's deposited Gateway float via Circle's public balances endpoint. It's
// unauthenticated and works for any address on either wallet backend (raw-key or Circle-custodied),
// so both the settlement adapters and the app/agent layers can share one reader. Atomic bigint so
// callers never do float math on money. This is the same call circle-gateway.ts makes privately;
// extracted here so there's one source of truth for "how much float does this address have".
const GATEWAY_API = "https://gateway-api-testnet.circle.com/v1";
const ARC_GATEWAY_DOMAIN = 26;

export type GatewayBalance = { availableAtomic: bigint; formatted: string };

export async function getGatewayBalance(
  address: string,
  opts: { api?: string; fetchImpl?: typeof fetch } = {},
): Promise<GatewayBalance> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const api = opts.api ?? GATEWAY_API;
  const res = await fetchImpl(`${api}/balances`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "USDC", sources: [{ depositor: address, domain: ARC_GATEWAY_DOMAIN }] }),
  });
  if (!res.ok) throw new Error(`gateway balances failed (${res.status})`);
  const data = (await res.json()) as { balances?: { balance?: string }[] };
  const formatted = data.balances?.[0]?.balance ?? "0";
  return { availableAtomic: BigInt(Math.round(Number(formatted) * 1_000_000)), formatted };
}
