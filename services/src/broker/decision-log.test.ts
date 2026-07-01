import { test, expect } from "bun:test";
import { streamWithMigration } from "./migrate";
import { InMemoryRegistry } from "../registry/in-memory";
import { defaultTrust } from "../trust/trust";
import type { SettlementAdapter, PaidCompute, SettlementStatus } from "../settlement/adapter";
import { SpendCapError } from "../settlement/spend-policy";
import type { DecideClient } from "../runtime/decide";
import type { Soul, Policy } from "../runtime/types";
import type { Provider } from "../domain";

const soul: Soul = { schema: "soul/v1", version: "9.9.9", name: "Broker", body: "s" };
const policy: Policy = { schema: "policy/v1", version: "0.0.1", body: "p" };

// A url-keyed fake: payForCompute throws for any url containing a "down" marker, otherwise
// pays and enforces the spend cap. Models a dead provider endpoint with a healthy wallet.
function urlAdapter(downMarkers: string[], pricePerChargeAtomic = 100n, capAtomic = 1_000_000n): SettlementAdapter {
  let spent = 0n;
  let seq = 0;
  const refs = new Set<string>();
  return {
    buyerAddress: "0xBROKER",
    async ensureFunded() { return { deposited: false }; },
    async payForCompute(url: string): Promise<PaidCompute> {
      if (downMarkers.some((d) => url.includes(d))) throw new Error(`x402 failed: ${url} unreachable`);
      if (spent + pricePerChargeAtomic > capAtomic) throw new SpendCapError(`cap ${capAtomic} reached`);
      spent += pricePerChargeAtomic;
      const settlementRef = `ref-${seq++}`;
      refs.add(settlementRef);
      return { amountAtomic: pricePerChargeAtomic, settlementRef, data: { ok: true }, status: 200 };
    },
    async reconcile(ref: string): Promise<SettlementStatus> {
      return { ref, status: refs.has(ref) ? "completed" : "unknown", settled: refs.has(ref) };
    },
  };
}

test("a soul-driven migrate persists a structured decision log", async () => {
  const reg = new InMemoryRegistry();
  const baseP = { ownerWallet: "0x0", resourceType: "GPU" as const, region: "US-East", specs: {}, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, avgLatencyMs: 5 };
  const a = await reg.registerProvider({ ...baseP, alias: "A", endpointUrl: "http://aaa", computeScore: 99 });
  const b = await reg.registerProvider({ ...baseP, alias: "B", endpointUrl: "http://bbb", computeScore: 80 });
  const rent = await reg.createRent({ name: "r", owner: { kind: "user", id: "u1", walletAddress: "0x0" }, spec: { resourceType: "GPU", region: null }, autonomyArmed: true });
  const settlement = urlAdapter(["aaa"]); // A is dead from the first charge

  const client: DecideClient = {
    propose: async () => [{ action: "migrate", target: b.id, score: 0.9, rationale: ["A degraded, B healthy"], userExplanation: "moving to B" }],
  };

  const result = await streamWithMigration(
    rent,
    a as Provider,
    { registry: reg, settlement, degradation: { soul, policy, client } },
    { maxUnits: 3, maxMigrations: 1, holdBudget: { maxRetries: 1, maxDurationMs: 60_000, maxExtraSpend: 10_000n } },
  );

  expect(result.migrations).toBe(1);
  const logs = await reg.listDecisionLogs(rent.id);
  expect(logs.length).toBeGreaterThanOrEqual(1);
  const last = logs.at(-1);
  expect(last?.soulVersion).toBe("9.9.9");
  expect(last?.policyVersion).toBe("0.0.1");
  expect(last?.chosenAction).toEqual({ action: "migrate", target: b.id });
});
