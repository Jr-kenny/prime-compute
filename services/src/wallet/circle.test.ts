// services/src/wallet/circle.test.ts
import { test, expect } from "bun:test";
import { CircleWalletStore, type CircleWalletsApi } from "./circle";

// Minimal fakes: the Circle API slice the store touches, and a supabase table.
function fakeCircle(): CircleWalletsApi & { created: number } {
  const api = {
    created: 0,
    async createWallets() {
      api.created += 1;
      return { data: { wallets: [{ id: `w-${api.created}`, address: `0xaddr${api.created}` }] } } as any;
    },
  };
  return api;
}

function fakeDb() {
  const rows: any[] = [];
  return {
    _rows: rows,
    from() {
      const filters: [string, unknown][] = [];
      const api: any = {
        select() { return api; },
        eq(c: string, v: unknown) { filters.push([c, v]); return api; },
        async maybeSingle() {
          const r = rows.find((x) => filters.every(([c, v]) => x[c] === v)) ?? null;
          return { data: r, error: null };
        },
        async insert(row: any) { rows.push(row); return { error: null }; },
      };
      return api;
    },
  } as any;
}

test("getOrCreate creates once and returns the same wallet after", async () => {
  const circle = fakeCircle();
  const store = new CircleWalletStore(fakeDb(), circle, "wallet-set-1");
  const a = await store.getOrCreate("user", "u1");
  const b = await store.getOrCreate("user", "u1");
  expect(a.address).toBe("0xaddr1");
  expect(a.walletId).toBe("w-1");
  expect(b.address).toBe("0xaddr1");
  expect(circle.created).toBe(1);
});

test("get returns null for an unknown principal", async () => {
  const store = new CircleWalletStore(fakeDb(), fakeCircle(), "ws");
  expect(await store.get("agent", "nope")).toBeNull();
});
