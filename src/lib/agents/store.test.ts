// src/lib/agents/store.test.ts
import { test, expect } from "bun:test";
import { createAgentWith, type AgentDb, type AgentWallets } from "./store";

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
