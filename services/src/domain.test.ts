import { describe, test, expect } from "bun:test";
import { RESOURCE_TYPES } from "./domain";

describe("domain resource types", () => {
  test("includes the new service types", () => {
    expect(RESOURCE_TYPES).toContain("VPN");
    expect(RESOURCE_TYPES).toContain("Worker");
    expect(RESOURCE_TYPES).toContain("GPU");
  });
});
