// services/src/worker/remit.ts
// The platform's fee-collection surface: providers report a remittance tx, the worker
// verifies on-chain what actually reached the treasury, and stamps that amount across
// the provider's oldest outstanding receivables (only fully covered charges stamp; a
// partial remainder stays outstanding for the next remittance).
import type { Registry } from "../registry/registry";
import type { Charge } from "../domain";

export function applyRemittance(outstanding: Charge[], amountAtomic: bigint): { chargeIds: string[]; remainingAtomic: bigint } {
  const chargeIds: string[] = [];
  let remaining = amountAtomic;
  for (const charge of outstanding) {
    const fee = BigInt(charge.feeAmount);
    if (fee > remaining) break;
    remaining -= fee;
    chargeIds.push(charge.id);
  }
  return { chargeIds, remainingAtomic: remaining };
}

export type RemitDeps = {
  registry: Registry;
  verify: (txHash: string) => Promise<bigint>; // on-chain USDC actually received by the treasury
};

export async function handleRemittance(req: Request, deps: RemitDeps): Promise<Response> {
  let body: { providerId?: unknown; txHash?: unknown; amountAtomic?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const providerId = typeof body.providerId === "string" ? body.providerId : "";
  const txHash = typeof body.txHash === "string" && body.txHash.startsWith("0x") ? body.txHash : "";
  const claimed = typeof body.amountAtomic === "string" && /^\d+$/.test(body.amountAtomic) ? BigInt(body.amountAtomic) : -1n;
  if (!providerId || !txHash || claimed < 0n) {
    return Response.json({ error: "providerId, txHash (0x...), and amountAtomic (decimal string) required" }, { status: 400 });
  }

  const verifiedAtomic = await deps.verify(txHash);
  if (verifiedAtomic <= 0n) {
    return Response.json({ error: "no verifiable USDC transfer to the treasury in that tx" }, { status: 422 });
  }

  const outstanding = await deps.registry.listOutstandingFeeCharges(providerId);
  const { chargeIds } = applyRemittance(outstanding, verifiedAtomic);
  for (const id of chargeIds) await deps.registry.markChargeFeeSettled(id, txHash);
  return Response.json({ ok: true, verifiedAtomic: verifiedAtomic.toString(), stamped: chargeIds.length });
}
