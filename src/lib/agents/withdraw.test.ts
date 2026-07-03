import { describe, test, expect } from "bun:test";
import { withdrawAgentFunds, parseUsdc, type WithdrawDeps } from "./withdraw";
import type { Principal } from "@services/domain";

const agent: Principal = { kind: "agent", id: "a1", walletAddress: "0x1111111111111111111111111111111111111111" };
const to = "0x2222222222222222222222222222222222222222";

function deps(over: Partial<WithdrawDeps> = {}): WithdrawDeps {
  return {
    findCircleWalletId: async () => null,
    circleTransfer: async () => "circle-tx",
    rawSigner: async () => async () => "raw-tx",
    ...over,
  };
}

describe("withdrawAgentFunds", () => {
  test("uses the Circle path when the agent has a Circle wallet", async () => {
    const r = await withdrawAgentFunds(agent, to, "1.5", deps({ findCircleWalletId: async () => "cw-1" }));
    expect(r.txHash).toBe("circle-tx");
  });

  test("falls back to the raw signer when there is no Circle wallet", async () => {
    const r = await withdrawAgentFunds(agent, to, "1.5", deps());
    expect(r.txHash).toBe("raw-tx");
  });

  test("rejects a bad destination address", async () => {
    await expect(withdrawAgentFunds(agent, "nope", "1", deps())).rejects.toThrow(/destination address/);
  });

  test("rejects a non-positive amount", async () => {
    await expect(withdrawAgentFunds(agent, to, "0", deps())).rejects.toThrow(/positive/);
  });

  test("rejects a non-agent principal", async () => {
    const user: Principal = { kind: "user", id: "u1", walletAddress: "0x0" };
    await expect(withdrawAgentFunds(user, to, "1", deps())).rejects.toThrow(/agent/);
  });

  test("parseUsdc handles decimals to 6 places", () => {
    expect(parseUsdc("1.5")).toBe(1_500_000n);
    expect(() => parseUsdc("1.1234567")).toThrow();
  });
});
