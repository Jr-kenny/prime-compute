// src/routes/api.v1.wallet.ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { authAgent, json } from "@/lib/agents/http";
import { walletFor } from "@/lib/marketplace/service";
import { getOnchain } from "@/lib/wallet/store";

export const Route = createFileRoute("/api/v1/wallet")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        const { address } = await walletFor(principal);
        let balanceAtomic: string | null = null;
        try {
          balanceAtomic = (await getOnchain().usdcBalance(address)).toString();
        } catch {
          // balance is best-effort; the address is what the agent needs to fund
        }
        return json({ address, balanceAtomic });
      },
    },
  },
});
