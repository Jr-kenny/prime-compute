import { describe, test, expect } from "bun:test";
import { SERVICE_REGISTRY, serviceIds, descriptorFor, type MeteringKind } from "./registry";

describe("service registry", () => {
  test("covers the six launch service types", () => {
    expect(serviceIds().sort()).toEqual(
      ["CPU", "Full Server", "GPU", "Storage", "VPN", "Worker"].sort(),
    );
  });

  test("every descriptor is complete", () => {
    for (const id of serviceIds()) {
      const d = descriptorFor(id);
      expect(d.id).toBe(id);
      expect(d.label.length).toBeGreaterThan(0);
      expect(["compute", "storage", "network", "worker"]).toContain(d.category);
      expect((["time", "volume"] as MeteringKind[])).toContain(d.metering);
      expect(d.unit.length).toBeGreaterThan(0);
      expect(d.path.startsWith("/")).toBe(true);
      // schemas parse a minimal valid object without throwing on shape
      expect(typeof d.specSchema.safeParse).toBe("function");
      expect(typeof d.telemetry.safeParse).toBe("function");
      expect(typeof d.connect.safeParse).toBe("function");
    }
  });

  test("VPN is volume-metered on the network path with a profile connect", () => {
    const vpn = descriptorFor("VPN");
    expect(vpn.category).toBe("network");
    expect(vpn.metering).toBe("volume");
    expect(vpn.unit).toBe("GB");
    expect(vpn.path).toBe("/vpn");
    expect(vpn.connect.safeParse({ profile: "[Interface]\n..." }).success).toBe(true);
  });

  test("descriptorFor throws on an unknown id", () => {
    expect(() => descriptorFor("QUANTUM")).toThrow(/unknown service type/);
  });
});
