import { test, expect } from "bun:test";
import { FakeNetworkAdapter } from "./fake";

test("fake mints and revokes, recording calls", async () => {
  const net = new FakeNetworkAdapter();
  const access = await net.mintRentAccess({ rentId: "r1", providerId: "p1" });
  expect(access?.authKey).toBe("tskey-r1");
  expect(access?.hostname).toBe("box-p1");
  expect(net.granted.has("r1")).toBe(true);

  await net.revokeRentAccess("r1");
  expect(net.granted.has("r1")).toBe(false);
  expect(net.revoked).toContain("r1");
});

test("fake can be told to fail mint (fail-soft coverage)", async () => {
  const net = new FakeNetworkAdapter({ failMint: true });
  await expect(net.mintRentAccess({ rentId: "r1", providerId: "p1" })).rejects.toThrow("network down");
});
