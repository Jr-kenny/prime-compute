// src/routes/api.v1.wallet.reclaim.ts  ->  POST /api/v1/wallet/reclaim
// Reclaims an agent's full Gateway float (minus the fee buffer) back to its own agent wallet.
// Backend resolution mirrors the withdraw route: circle_wallets owner_kind='agent' -> the Circle
// burn-intent + mint dance; else the raw agent signer -> the SDK reclaim. Runs the tested reclaimFor.
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { authAgent, json } from "@/lib/agents/http";
import { walletFor } from "@/lib/marketplace/service";
import { reclaimFor } from "@/lib/wallet/reclaim";

export const Route = createFileRoute("/api/v1/wallet/reclaim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        const { address } = await walletFor(principal);
        const feeBufferAtomic = BigInt(process.env.RECLAIM_FEE_BUFFER_ATOMIC ?? "5000");
        const { getGatewayBalance } = await import("@services/settlement/gateway-balance");
        const readFloat = async () => (await getGatewayBalance(address)).availableAtomic;
        try {
          const { supabaseAdmin } = await import("@/lib/supabase/server");
          const { data: cw } = await supabaseAdmin()
            .from("circle_wallets").select("wallet_id")
            .eq("owner_kind", "agent").eq("owner_id", principal.id).maybeSingle();

          if (cw) {
            const { makeCircleClient } = await import("@services/wallet/circle");
            const { circleBatchSigner } = await import("@services/settlement/circle-signer");
            const { gatewayWithdraw } = await import("@services/settlement/gateway-withdraw");
            const { mintViaCircle } = await import("@services/settlement/circle-gateway");
            const client = makeCircleClient();
            const walletId = cw.wallet_id as string;
            const signer = circleBatchSigner(client, walletId, address);
            const res = await reclaimFor({
              address, feeBufferAtomic, readFloat,
              circle: {
                withdraw: (amount, recipient) =>
                  gatewayWithdraw(amount, { signer, recipient, maxFeeAtomic: feeBufferAtomic, mint: (att, sig) => mintViaCircle(client, walletId, att, sig) }).then((r) => r.mintTxHash),
              },
            });
            return json(res);
          }

          const { walletStoreFor } = await import("@/lib/marketplace/wallet");
          const signer = await walletStoreFor(principal).loadSigner(principal.id);
          if (!signer) return json({ error: "no wallet for agent" }, 400);
          const { rawGatewayReclaim } = await import("@services/settlement/raw-reclaim");
          const res = await reclaimFor({
            address, feeBufferAtomic, readFloat,
            raw: {
              withdraw: (amount, recipient) => rawGatewayReclaim(signer.privateKey, amount, recipient as `0x${string}`, { rpcUrl: process.env.ARC_RPC_URL }),
            },
          });
          return json(res);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "reclaim failed" }, 400);
        }
      },
    },
  },
});
