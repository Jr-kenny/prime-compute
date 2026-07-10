import { test, expect } from "bun:test";
import { HttpNetworkAdapter } from "./http";

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  return ((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as unknown as typeof fetch;
}

test("mintRentAccess posts with secret header and parses body", async () => {
  let seenHeader: string | undefined;
  const net = new HttpNetworkAdapter({
    baseUrl: "http://net.local",
    secret: "s3cret",
    fetchImpl: stubFetch((url, init) => {
      expect(url).toBe("http://net.local/rent-access");
      expect(init?.method).toBe("POST");
      seenHeader = (init?.headers as Record<string, string>)["x-network-secret"];
      return new Response(JSON.stringify({ authKey: "tskey-abc", hostname: "box-1" }), { status: 200 });
    }),
  });
  const access = await net.mintRentAccess({ rentId: "r1", providerId: "p1" });
  expect(seenHeader).toBe("s3cret");
  expect(access).toEqual({ authKey: "tskey-abc", hostname: "box-1" });
});

test("mintRentAccess throws on non-200 so the caller can fail soft", async () => {
  const net = new HttpNetworkAdapter({
    baseUrl: "http://net.local",
    secret: "s",
    fetchImpl: stubFetch(() => new Response("nope", { status: 503 })),
  });
  await expect(net.mintRentAccess({ rentId: "r1", providerId: "p1" })).rejects.toThrow("503");
});

test("revokeRentAccess DELETEs the rent path and swallows 404 as success", async () => {
  const net = new HttpNetworkAdapter({
    baseUrl: "http://net.local",
    secret: "s",
    fetchImpl: stubFetch((url, init) => {
      expect(url).toBe("http://net.local/rent-access/r1");
      expect(init?.method).toBe("DELETE");
      return new Response("", { status: 404 });
    }),
  });
  await net.revokeRentAccess("r1"); // 404 = already gone, not an error
});
