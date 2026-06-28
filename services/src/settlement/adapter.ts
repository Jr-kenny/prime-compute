export type PaidCompute = {
  amountAtomic: bigint; // what was charged for this unit
  settlementRef: string; // batch transfer id (reconcile against this); never a tx hash yet
  data: unknown; // the provider's response body (telemetry etc.)
  status: number; // HTTP status from the provider
};

export type SettlementStatus = {
  ref: string;
  status: string; // raw provider/Gateway status (e.g. received|batched|confirmed|completed|failed)
  settled: boolean; // true once the batch has landed on-chain
};

// The only place real USDC moves, behind one interface so the stream engine never
// touches the wallet or the SDK directly.
export interface SettlementAdapter {
  readonly buyerAddress: string;
  /** Ensure the Gateway balance can cover at least `minAtomic`; deposits if short. */
  ensureFunded(minAtomic: bigint): Promise<{ deposited: boolean; depositTxHash?: string }>;
  /** Pay one charge for one unit of compute. Throws SpendCapError if the guard aborts. */
  payForCompute(url: string): Promise<PaidCompute>;
  /** Check whether a settlement ref has landed on-chain. */
  reconcile(settlementRef: string): Promise<SettlementStatus>;
}
