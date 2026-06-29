export type RetryBudget = {
  maxRetries: number;
  maxDurationMs: number;
  maxExtraSpend: bigint;
};

export type LeashDecision = { ok: true } | { ok: false; reason: string };

// The hold backstop as a retry budget, not a count: a hold is approved only while ALL
// three budgets (retries, wall-clock window, extra spend) remain. Deterministic; the
// `now` injection makes the duration bound testable.
export class RetryLeash {
  private retries = 0;
  private spent = 0n;
  private readonly start: number;

  constructor(private budget: RetryBudget, private now: () => number = Date.now) {
    this.start = now();
  }

  tryConsume(extraSpend: bigint): LeashDecision {
    if (this.retries + 1 > this.budget.maxRetries) {
      return { ok: false, reason: `hold denied: out of retries (${this.budget.maxRetries})` };
    }
    if (this.now() - this.start > this.budget.maxDurationMs) {
      return { ok: false, reason: `hold denied: duration window ${this.budget.maxDurationMs}ms passed` };
    }
    if (this.spent + extraSpend > this.budget.maxExtraSpend) {
      return { ok: false, reason: `hold denied: extra spend would exceed ${this.budget.maxExtraSpend}` };
    }
    this.retries++;
    this.spent += extraSpend;
    return { ok: true };
  }
}
