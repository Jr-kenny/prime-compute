import { describe, test, expect } from "bun:test";
import { serviceIds } from "../../services/src/services/registry";

describe("mcp service enum", () => {
  test("registry exposes VPN and Worker for the MCP tools", () => {
    expect(serviceIds()).toContain("VPN");
    expect(serviceIds()).toContain("Worker");
  });
});
