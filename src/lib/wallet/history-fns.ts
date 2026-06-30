import { createServerFn } from "@tanstack/react-start";
import { requireUser } from "../auth/require-user";
import { getRegistry } from "../broker/registry";

// Flat list of the user's nano-charges, newest first, for the wallet history view.
export const listMySpend = createServerFn({ method: "GET" })
  .validator((d: { accessToken: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    const registry = getRegistry();
    const rents = await registry.listRents({ userId: user.id });
    const rows: { rentName: string; amountAtomic: number; settled: boolean; createdAt: string }[] = [];
    for (const r of rents) {
      const charges = await registry.listCharges(r.id);
      for (const c of charges) {
        rows.push({ rentName: r.name, amountAtomic: c.amount, settled: c.settled, createdAt: c.createdAt });
      }
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows;
  });
