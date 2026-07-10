import { test, expect } from "bun:test";
import { makeNetworkAdapter } from "./factory";
import { NoNetworkAdapter } from "./none";
import { HttpNetworkAdapter } from "./http";

test("returns no-op when NETWORK_SERVICE_URL is unset", () => {
  expect(makeNetworkAdapter({})).toBeInstanceOf(NoNetworkAdapter);
});

test("returns HTTP adapter when url + secret are set", () => {
  const net = makeNetworkAdapter({ NETWORK_SERVICE_URL: "http://net.local", NETWORK_SERVICE_SECRET: "s" });
  expect(net).toBeInstanceOf(HttpNetworkAdapter);
});

test("throws when url set but secret missing (misconfig, not silent)", () => {
  expect(() => makeNetworkAdapter({ NETWORK_SERVICE_URL: "http://net.local" })).toThrow("NETWORK_SERVICE_SECRET");
});
