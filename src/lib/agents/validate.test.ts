// src/lib/agents/validate.test.ts
import { test, expect } from "bun:test";
import { parseRentBody, parseProviderBody, checkEndpointUrl } from "./validate";

test("parseRentBody accepts a valid body and normalizes optionals", () => {
  const r = parseRentBody({ name: "job", resourceType: "GPU" });
  if (!r.ok) throw new Error(r.message);
  expect(r.value).toEqual({ name: "job", resourceType: "GPU", region: null, estimatedUsage: null });
});

test("parseRentBody rejects an unknown resourceType with the valid values in the message", () => {
  const r = parseRentBody({ name: "job", resourceType: "gpu" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toContain("GPU");
});

test("parseRentBody rejects a missing name and non-string region", () => {
  expect(parseRentBody({ resourceType: "GPU" }).ok).toBe(false);
  expect(parseRentBody({ name: "j", resourceType: "GPU", region: 5 }).ok).toBe(false);
});

test("parseProviderBody accepts a valid body", () => {
  const r = parseProviderBody({
    alias: "a1", endpointUrl: "https://gpu.example.com", resourceType: "CPU",
    region: "US-East", pricePerCharge: 0.000004,
    specs: { cpuCores: 4, ramGb: 8, region: "US-East" },
  });
  if (!r.ok) throw new Error(r.message);
  expect(r.value.resourceType).toBe("CPU");
  expect(r.value.avgLatencyMs).toBe(0);
  expect(r.value.online).toBe(true);
});

test("parseProviderBody accepts a valid VPN listing", () => {
  const base = { alias: "n", endpointUrl: "https://p.example.com", region: "EU", pricePerCharge: 0.01 };
  const r = parseProviderBody({ ...base, resourceType: "VPN",
    specs: { exitLocation: "NL", protocol: "WireGuard", bandwidthMbps: 1000, region: "EU" } }, { allowPrivate: true });
  expect(r.ok).toBe(true);
});

test("parseProviderBody rejects a VPN listing missing exitLocation", () => {
  const base = { alias: "n", endpointUrl: "https://p.example.com", region: "EU", pricePerCharge: 0.01 };
  const r = parseProviderBody({ ...base, resourceType: "VPN",
    specs: { protocol: "WireGuard", bandwidthMbps: 1000, region: "EU" } }, { allowPrivate: true });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toMatch(/exitLocation|specs/i);
});

test("parseProviderBody rejects a non-positive or non-finite price", () => {
  const base = { alias: "a", endpointUrl: "https://x.example.com", resourceType: "GPU", region: "US" };
  expect(parseProviderBody({ ...base, pricePerCharge: 0 }).ok).toBe(false);
  expect(parseProviderBody({ ...base, pricePerCharge: -1 }).ok).toBe(false);
  expect(parseProviderBody({ ...base, pricePerCharge: NaN }).ok).toBe(false);
});

test("checkEndpointUrl requires an absolute http(s) URL without credentials", () => {
  expect(checkEndpointUrl("https://gpu.example.com")).toBeNull();
  expect(checkEndpointUrl("not a url")).toContain("URL");
  expect(checkEndpointUrl("ftp://x.example.com")).toContain("http");
  expect(checkEndpointUrl("https://user:pw@x.example.com")).toContain("credentials");
});

test("checkEndpointUrl blocks loopback/private/metadata hosts by default", () => {
  for (const bad of [
    "http://localhost:4001", "http://127.0.0.1", "http://[::1]:8080",
    "http://10.0.0.5", "http://192.168.1.10", "http://172.20.3.4",
    "http://169.254.169.254", "http://0.0.0.0",
  ]) {
    expect(checkEndpointUrl(bad)).not.toBeNull();
  }
});

test("checkEndpointUrl allows private hosts when the dev escape hatch is set", () => {
  expect(checkEndpointUrl("http://localhost:4001", { allowPrivate: true })).toBeNull();
});
