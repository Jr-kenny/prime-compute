import { test, expect } from "bun:test";
import { NoNetworkAdapter } from "./none";

test("no-op adapter returns null and never throws", async () => {
  const net = new NoNetworkAdapter();
  expect(await net.ensureProviderNode("p1")).toBeNull();
  expect(await net.mintRentAccess({ rentId: "r1", providerId: "p1" })).toBeNull();
  await net.revokeRentAccess("r1"); // must not throw
});
