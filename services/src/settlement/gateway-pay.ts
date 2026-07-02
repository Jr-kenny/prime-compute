// services/src/settlement/gateway-pay.ts
// The x402/Gateway 402 dance, extracted from GatewayClient.pay so any BatchEvmScheme —
// including one whose signer lives at Circle — can drive it. Wire format mirrors
// @circle-fin/x402-batching's client exactly (PAYMENT-REQUIRED / Payment-Signature /
// PAYMENT-RESPONSE, all base64 JSON).

type SchemeLike = { createPaymentPayload(x402Version: number, requirements: unknown): Promise<unknown> };

export type GatewayPayOptions = { chainId: number; fetchImpl?: typeof fetch };
export type GatewayPaid = { amountAtomic: bigint; settlementRef: string; data: unknown; status: number };

type PaymentOption = {
  network: string;
  amount: string;
  extra?: { name?: string; version?: string; verifyingContract?: unknown };
};

export async function gatewayPay(url: string, scheme: SchemeLike, opts: GatewayPayOptions): Promise<GatewayPaid> {
  const fetchImpl = opts.fetchImpl ?? fetch;

  const initial = await fetchImpl(url);
  if (initial.status !== 402) {
    if (initial.ok) return { amountAtomic: 0n, settlementRef: "", data: await initial.json(), status: initial.status };
    throw new Error(`request failed with status ${initial.status}`);
  }

  const requiredHeader = initial.headers.get("PAYMENT-REQUIRED");
  if (!requiredHeader) throw new Error("missing PAYMENT-REQUIRED header in 402 response");
  const paymentRequired = JSON.parse(Buffer.from(requiredHeader, "base64").toString("utf-8"));

  const network = `eip155:${opts.chainId}`;
  const option = ((paymentRequired.accepts ?? []) as PaymentOption[]).find(
    (o) => o.network === network && o.extra?.name === "GatewayWalletBatched" && o.extra?.version === "1" && typeof o.extra?.verifyingContract === "string",
  );
  if (!option) throw new Error(`no Gateway batching option for ${network} in the 402 response`);

  const x402Version = paymentRequired.x402Version ?? 2;
  const paymentPayload = (await scheme.createPaymentPayload(x402Version, option)) as Record<string, unknown>;
  const header = Buffer.from(JSON.stringify({ ...paymentPayload, resource: paymentRequired.resource, accepted: option })).toString("base64");

  const paid = await fetchImpl(url, { headers: { "Payment-Signature": header } });
  if (!paid.ok) {
    const err = (await paid.json().catch(() => ({}))) as { error?: string };
    throw new Error(`payment failed: ${err.error ?? paid.statusText}`);
  }
  const settleHeader = paid.headers.get("PAYMENT-RESPONSE");
  const settle = settleHeader ? (JSON.parse(Buffer.from(settleHeader, "base64").toString("utf-8")) as { transaction?: string }) : undefined;

  return { amountAtomic: BigInt(option.amount), settlementRef: settle?.transaction ?? "", data: await paid.json(), status: paid.status };
}
