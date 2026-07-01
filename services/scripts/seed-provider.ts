// services/scripts/seed-provider.ts
// Register one first-party provider so the meter pays a real endpoint. Run the x402 seller
// (bun run provider) somewhere reachable and pass its public URL as PROVIDER_ENDPOINT_URL.
import { SupabaseRegistry } from "../src/registry/supabase";
import { defaultTrust } from "../src/trust/trust";
import { loadConfig } from "../src/config";

const cfg = loadConfig();
if (!cfg.supabase) throw new Error("need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
const endpointUrl = process.env.PROVIDER_ENDPOINT_URL;
const ownerWallet = process.env.PROVIDER_OWNER_WALLET;
if (!endpointUrl || !ownerWallet) throw new Error("set PROVIDER_ENDPOINT_URL and PROVIDER_OWNER_WALLET");

const reg = new SupabaseRegistry(cfg.supabase.url, cfg.supabase.serviceRoleKey);
const provider = await reg.registerProvider({
  alias: process.env.PROVIDER_ALIAS ?? "seed-gpu-1",
  ownerWallet,
  endpointUrl,
  resourceType: "GPU",
  region: process.env.PROVIDER_REGION ?? "US-East",
  specs: { gpu: "H100", vramGb: 80 },
  online: true,
  trust: defaultTrust("Verified"),
  pricePerCharge: Number(process.env.PROVIDER_PRICE_PER_CHARGE ?? "0.0001"),
  computeScore: 95,
  avgLatencyMs: 6,
});
console.log("registered seed provider:", provider.id, provider.alias, "->", provider.endpointUrl);
