// src/lib/agents/store.test.ts
import { test, expect } from "bun:test";
import { createAgentWith, resolveAgentAddress, type AgentDb, type AgentWallets } from "./store";

// Minimal fakes: just enough of the Supabase chain that createAgentWith touches, plus a
// wallet store whose behavior each test controls.
function fakeDb(opts: { keyInsertError?: Error } = {}) {
  const agents: Record<string, unknown>[] = [];
  const keys: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  const db = {
    from(table: string) {
      if (table === "agents") {
        return {
          insert(row: Record<string, unknown>) {
            return {
              select: () => ({
                single: async () => {
                  const withId = { id: crypto.randomUUID(), ...row };
                  agents.push(withId);
                  return { data: withId, error: null };
                },
              }),
            };
          },
          delete: () => ({
            eq: async (_col: string, id: string) => {
              deleted.push(id);
              return { error: null };
            },
          }),
        };
      }
      if (table === "agent_api_keys") {
        return {
          insert: async (row: Record<string, unknown>) => {
            if (opts.keyInsertError) return { error: opts.keyInsertError };
            keys.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as AgentDb;
  return { db, agents, keys, deleted };
}

const okWallets: AgentWallets = { getOrCreate: async () => ({ address: "0xabc" }) };

test("createAgentWith returns id, one-time key, and wallet address", async () => {
  const { db, keys } = fakeDb();
  const out = await createAgentWith(db, okWallets, "my agent");
  expect(out.agentId).toBeTruthy();
  expect(out.apiKey.startsWith("pc_")).toBe(true);
  expect(out.walletAddress).toBe("0xabc");
  expect(keys.length).toBe(1);
});

test("a failed key insert removes the agent row instead of orphaning it", async () => {
  const { db, deleted } = fakeDb({ keyInsertError: new Error("key insert down") });
  await expect(createAgentWith(db, okWallets)).rejects.toThrow("key insert down");
  expect(deleted.length).toBe(1);
});

test("a failed wallet provision removes the agent row instead of orphaning it", async () => {
  const { db, deleted } = fakeDb();
  const badWallets: AgentWallets = { getOrCreate: async () => { throw new Error("wallet down"); } };
  await expect(createAgentWith(db, badWallets)).rejects.toThrow("wallet down");
  expect(deleted.length).toBe(1);
});

// Address resolution behind API-key auth: circle_wallets first (agents provisioned under
// WALLET_BACKEND=circle have no agent_wallets row), then the legacy enc-key store.
function circleDb(rows: { owner_kind: string; owner_id: string; address: string }[]) {
  return {
    from(table: string) {
      if (table !== "circle_wallets") throw new Error(`unexpected table ${table}`);
      const filters: [string, unknown][] = [];
      const api = {
        select: () => api,
        eq(c: string, v: unknown) { filters.push([c, v]); return api; },
        maybeSingle: async () => ({
          data: rows.find((r) => filters.every(([c, v]) => (r as any)[c] === v)) ?? null,
          error: null,
        }),
      };
      return api;
    },
  } as unknown as AgentDb;
}

test("a circle-provisioned agent resolves its address from circle_wallets", async () => {
  const db = circleDb([{ owner_kind: "agent", owner_id: "a1", address: "0xcircle" }]);
  const legacy = { getAddress: async () => { throw new Error("legacy must not be needed"); } };
  expect(await resolveAgentAddress(db, legacy, "a1")).toBe("0xcircle");
});

test("a legacy agent still resolves through the enc-key store", async () => {
  const db = circleDb([]);
  const legacy = { getAddress: async (id: string) => `0xlegacy-${id}` };
  expect(await resolveAgentAddress(db, legacy, "a2")).toBe("0xlegacy-a2");
});

test("no wallet in either backend resolves to null", async () => {
  const db = circleDb([]);
  const legacy = { getAddress: async () => null };
  expect(await resolveAgentAddress(db, legacy, "a3")).toBeNull();
});
