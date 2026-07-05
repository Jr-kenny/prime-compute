// Reclaim the full available Gateway float (minus a fee buffer) to the wallet's own address. The
// backend is chosen by which executor is supplied: circle for Circle-custodied wallets, raw for
// raw-key. Everything is injected so this stays a pure, offline-testable decision: read the float,
// leave the fee behind, no-op when there's nothing worth reclaiming, otherwise hand off to the
// executor. Returns a null txHash + "0" when the float is at/below the fee (reclaiming would cost
// more than it returns, exactly the case the live probe surfaced).
export type ReclaimDeps = {
  address: string;
  feeBufferAtomic: bigint; // leave this behind to cover the withdraw fee
  readFloat: () => Promise<bigint>; // available Gateway float, atomic
  circle?: { withdraw: (amountAtomic: bigint, recipient: string) => Promise<string> };
  raw?: { withdraw: (amountAtomic: bigint, recipient: string) => Promise<string> };
};

export type ReclaimResult = { txHash: string | null; amountAtomic: string };

export async function reclaimFor(deps: ReclaimDeps): Promise<ReclaimResult> {
  const available = await deps.readFloat();
  if (available <= deps.feeBufferAtomic) return { txHash: null, amountAtomic: "0" };
  const amount = available - deps.feeBufferAtomic;
  const withdraw = deps.circle?.withdraw ?? deps.raw?.withdraw;
  if (!withdraw) throw new Error("no reclaim backend available for this wallet");
  const txHash = await withdraw(amount, deps.address);
  return { txHash, amountAtomic: amount.toString() };
}
