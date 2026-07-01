// services/src/worker/settlement-factory.ts
import type { Rent } from "../domain";
import type { SettlementAdapter } from "../settlement/adapter";
import { GatewaySettlementAdapter } from "../settlement/gateway";
import type { SpendSigner } from "../wallet/store";

export type SettlementFactory = (rent: Rent, maxUnits: number) => Promise<SettlementAdapter>;

// Resolves the payer signer for a lease. The worker injects one that picks the right wallet by
// owner: agent leases pay from agent_wallets, user leases from spend_wallets.
export type LoadSigner = (rent: Rent) => Promise<SpendSigner | null>;

type Options = {
  capAtomic: bigint;          // per-lease money backstop (the worker also bounds by unit count)
  rpcUrl?: string;            // Arc RPC (point at the Canteen endpoint)
  // Seam so the unit test doesn't construct a real GatewayClient.
  build?: (signer: SpendSigner, capAtomic: bigint, rpcUrl?: string) => SettlementAdapter;
};

// Builds (once per lease) a settlement adapter that pays from THAT lease owner's spend wallet. The
// decrypted key only lives inside this adapter; it never leaves the worker.
export function makeSettlementFactory(loadSigner: LoadSigner, opts: Options): SettlementFactory {
  const cache = new Map<string, SettlementAdapter>();
  const build =
    opts.build ??
    ((signer, capAtomic, rpcUrl) =>
      new GatewaySettlementAdapter({ privateKey: signer.privateKey, capAtomic, chain: "arcTestnet", rpcUrl }));

  return async (rent, _maxUnits) => {
    const existing = cache.get(rent.id);
    if (existing) return existing;
    const signer = await loadSigner(rent);
    if (!signer) throw new Error(`no spend wallet for lease ${rent.id}`);
    const adapter = build(signer, opts.capAtomic, opts.rpcUrl);
    cache.set(rent.id, adapter);
    return adapter;
  };
}
