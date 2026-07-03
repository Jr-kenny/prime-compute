import { describe, test, expect } from "bun:test";
import { rateDisplay } from "./rate";

describe("rateDisplay", () => {
  test("time types show an exact per-day figure", () => {
    const r = rateDisplay("GPU", 0.0000098);
    expect(r.streaming).toBe("$0.0000098 /sec");
    expect(r.human).toBe("$0.85 / day"); // 0.0000098 * 86400 = 0.84672
  });

  test("VPN (per GB) shows a per-100GB example, no invented per-day", () => {
    const r = rateDisplay("VPN", 0.02);
    expect(r.streaming).toBe("$0.0200 /GB");
    expect(r.human).toBe("$2.00 per 100 GB"); // 0.02 * 100
  });

  test("storage (per GB-hour) shows a per-GB-day figure", () => {
    const r = rateDisplay("Storage", 0.02);
    expect(r.streaming).toBe("$0.020000 /GB-hour");
    expect(r.human).toBe("$0.48 / GB-day"); // 0.02 * 24
  });
});
