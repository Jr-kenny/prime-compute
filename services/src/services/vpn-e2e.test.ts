import { describe, test, expect } from "bun:test";
import { InMemoryRegistry } from "../registry/in-memory";
import { makeSimulatedExecutor } from "../provider/executor";
import { meterTick } from "../worker/meter";
import { FakeSettlementAdapter } from "../settlement/fake";
import { defaultTrust } from "../trust/trust";

describe("VPN provide -> rent -> meter -> connect", () => {
  test("bills per GB and hands back a profile", async () => {
    const reg = new InMemoryRegistry();

    // Provision hands the renter a WireGuard profile rather than SSH creds.
    const ex = makeSimulatedExecutor("VPN");
    const connect = await ex.provision("sess", { exitLocation: "NL", protocol: "WireGuard", bandwidthMbps: 1000, region: "EU" });
    expect((connect as { profile: string }).profile).toContain("[Interface]");

    // A registered VPN provider and a running rent against it.
    const provider = await reg.registerProvider({
      alias: "vpn-nl", ownerWallet: "0xseller", endpointUrl: "http://localhost:9", resourceType: "VPN",
      region: "EU-West", specs: { exitLocation: "NL", protocol: "WireGuard", bandwidthMbps: 1000, region: "EU-West" },
      online: true, trust: defaultTrust(), pricePerCharge: 0.02, computeScore: 90, avgLatencyMs: 5,
    });
    const rent = await reg.createRent({
      name: "vpn", owner: { kind: "user", id: "u1", walletAddress: "0x0" },
      spec: { resourceType: "VPN", region: null }, estimatedUsage: 100,
    });
    await reg.updateRent(rent.id, { status: "running", providerId: provider.id, startedAt: new Date().toISOString() });

    // One tick where the provider's /usage reports 2 pending GB units -> 2 fixed-price charges.
    const settlement = new FakeSettlementAdapter({ pricePerChargeAtomic: 20_000n, capAtomic: 10_000_000n });
    const res = await meterTick(rent.id, {
      registry: reg, settlement, tickMs: 0, maxUnits: 100,
      readUsage: async () => 2, perTickCap: 10, nowMs: () => 1,
    });
    expect(res.charged).toBe(true);
    expect((await reg.listCharges(rent.id)).length).toBe(2); // 2 GB -> 2 charges
  });
});
