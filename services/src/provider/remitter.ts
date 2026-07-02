// Accrues the platform's cut of every payment this provider receives and remits it to
// the treasury from the provider's own Gateway earnings. Accrual is in-memory only: an
// unremitted balance lost to a crash is not lost money — it stays an outstanding
// receivable in the platform ledger and ages there until a later remittance covers it.

export type FeeRemitterOptions = {
  feeBps: number;            // platform fee in basis points (100 = 1%)
  thresholdAtomic: bigint;   // remit when accrued fees reach this (withdraws cost gas)
  withdraw: (amountAtomic: bigint) => Promise<{ txHash: string }>; // Gateway withdraw to the treasury
  report: (r: { txHash: string; amountAtomic: bigint }) => Promise<void>; // tell the platform
};

export type FeeRemitter = {
  onPayment(paymentAtomic: bigint): Promise<void>;
  flush(): Promise<void>;
  accrued(): bigint;
};

export function createFeeRemitter(opts: FeeRemitterOptions): FeeRemitter {
  let accrued = 0n;
  // Withdrawn but not yet acknowledged by the platform: money already moved, so these are
  // only retried as reports, never re-withdrawn.
  const pendingReports: { txHash: string; amountAtomic: bigint }[] = [];
  let flushing = false;

  async function drainReports(): Promise<void> {
    while (pendingReports.length > 0) {
      const next = pendingReports[0]!;
      await opts.report(next); // throws -> stays queued for the next flush
      pendingReports.shift();
    }
  }

  async function flush(): Promise<void> {
    if (flushing) return; // never overlap withdrawals
    flushing = true;
    try {
      try {
        await drainReports();
      } catch (e) {
        console.warn("[remitter] report retry failed:", e instanceof Error ? e.message : e);
      }
      if (accrued <= 0n) return;
      const amountAtomic = accrued;
      accrued = 0n;
      let txHash: string;
      try {
        ({ txHash } = await opts.withdraw(amountAtomic));
      } catch (e) {
        accrued += amountAtomic; // nothing moved; retry later
        console.warn("[remitter] withdraw failed:", e instanceof Error ? e.message : e);
        return;
      }
      try {
        await opts.report({ txHash, amountAtomic });
      } catch (e) {
        pendingReports.push({ txHash, amountAtomic }); // money moved; only the report retries
        console.warn("[remitter] report failed (queued for retry):", e instanceof Error ? e.message : e);
      }
    } finally {
      flushing = false;
    }
  }

  return {
    accrued: () => accrued,
    flush,
    async onPayment(paymentAtomic: bigint): Promise<void> {
      if (opts.feeBps <= 0) return;
      accrued += (paymentAtomic * BigInt(opts.feeBps)) / 10_000n;
      if (accrued >= opts.thresholdAtomic) await flush();
    },
  };
}
