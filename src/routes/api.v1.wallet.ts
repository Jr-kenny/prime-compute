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

      // Withdraw USDC from the agent's custodied wallet to an external address. Mirrors the user's
      // withdrawFromSpendWallet: Circle wallets go through createTransaction, raw wallets sign locally.
      POST: async ({ request }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        let body: { toAddress?: unknown; amount?: unknown };
        try { body = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
        if (typeof body.toAddress !== "string" || typeof body.amount !== "string") {
          return json({ error: "toAddress and amount are required strings" }, 400);
        }
        const { withdrawAgentFunds } = await import("@/lib/agents/withdraw");
        const { supabaseAdmin } = await import("@/lib/supabase/server");
        const { walletStoreFor } = await import("@/lib/marketplace/wallet");
        try {
          const result = await withdrawAgentFunds(principal, body.toAddress, body.amount, {
            findCircleWalletId: async (agentId) => {
              const { data } = await supabaseAdmin()
                .from("circle_wallets").select("wallet_id")
                .eq("owner_kind", "agent").eq("owner_id", agentId).maybeSingle();
              return (data?.wallet_id as string | undefined) ?? null;
            },
            circleTransfer: async (walletId, toAddress, amount) => {
              const { makeCircleClient } = await import("@services/wallet/circle");
              const res: any = await makeCircleClient().createTransaction({
                walletId, tokenAddress: process.env.USDC_ADDRESS!, blockchain: "ARC-TESTNET" as any,
                destinationAddress: toAddress, amount: [amount], fee: { type: "level", config: { feeLevel: "MEDIUM" } },
              });
              return res.data?.id as string;
            },
            rawSigner: async (agentId) => {
              const signer = await walletStoreFor(principal).loadSigner(agentId);
              if (!signer) return null;
              return (toAddress, atomic) => getOnchain().usdcTransfer(signer, toAddress, atomic);
            },
          });
          return json(result);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "withdraw failed" }, 400);
        }
      },
    },
  },
});
