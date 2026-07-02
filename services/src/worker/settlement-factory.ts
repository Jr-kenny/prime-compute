// services/src/worker/settlement-factory.ts
import type { Rent } from "../domain";
import type { SettlementAdapter } from "../settlement/adapter";
import { GatewaySettlementAdapter } from "../settlement/gateway";
import { CircleGatewaySettlementAdapter } from "../settlement/circle-gateway";
import { makeCircleClient } from "../wallet/circle";
import type { SpendSigner } from "../wallet/store";

export type SettlementFactory = (rent: Rent, maxUnits: number) => Promise<SettlementAdapter>;

// A lease's payer: legacy raw-key wallets keep working while new wallets live at Circle.
export type Payer =
  | { kind: "raw"; signer: SpendSigner }
  | { kind: "circle"; walletId: string; address: string };
export type LoadPayer = (rent: Rent) => Promise<Payer | null>;

type Options = {
  capAtomic: bigint;          // per-lease money backstop (the worker also bounds by unit count)
  rpcUrl?: string;            // Arc RPC (point at the Canteen endpoint)
  usdcAddress?: string;       // required for the circle path (deposit target token)
  // Seams so unit tests construct neither a GatewayClient nor a Circle client.
  build?: (signer: SpendSigner, capAtomic: bigint, rpcUrl?: string) => SettlementAdapter;
  buildCircle?: (payer: { walletId: string; address: string }, capAtomic: bigint) => SettlementAdapter;
};

// Builds (once per lease) a settlement adapter that pays from THAT lease owner's wallet.
// Raw payers decrypt inside the adapter and never leave the worker; circle payers hold no
// key material anywhere — Circle signs per charge.
export function makeSettlementFactory(loadPayer: LoadPayer, opts: Options): SettlementFactory {
  const cache = new Map<string, SettlementAdapter>();
  const build =
    opts.build ??
    ((signer, capAtomic, rpcUrl) =>
      new GatewaySettlementAdapter({ privateKey: signer.privateKey, capAtomic, chain: "arcTestnet", rpcUrl }));
  const buildCircle =
    opts.buildCircle ??
    ((payer, capAtomic) => {
      if (!opts.usdcAddress) throw new Error("usdcAddress required for circle-custodied payers");
      return new CircleGatewaySettlementAdapter({
        client: makeCircleClient(), walletId: payer.walletId, address: payer.address,
        capAtomic, usdcAddress: opts.usdcAddress,
      });
    });

  return async (rent, _maxUnits) => {
    const existing = cache.get(rent.id);
    if (existing) return existing;
    const payer = await loadPayer(rent);
    if (!payer) throw new Error(`no spend wallet for lease ${rent.id}`);
    const adapter =
      payer.kind === "circle" ? buildCircle(payer, opts.capAtomic) : build(payer.signer, opts.capAtomic, opts.rpcUrl);
    cache.set(rent.id, adapter);
    return adapter;
  };
}
