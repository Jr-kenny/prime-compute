import { loadConfig } from "../src/config";
import { defaultTrust } from "../src/trust/trust";
import { InMemoryRegistry } from "../src/registry/in-memory";
import { SupabaseRegistry } from "../src/registry/supabase";
import type { Registry, NewProvider } from "../src/registry/registry";

const seeds: NewProvider[] = [
  { alias: "node-astral-1", ownerWallet: "0xA11ce", endpointUrl: "http://localhost:4001", resourceType: "GPU", region: "US-East", specs: { gpu: "NVIDIA H100", vramGb: 80 }, online: true, trust: defaultTrust(), pricePerCharge: 0.000006, computeScore: 98, avgLatencyMs: 4 },
  { alias: "node-orion-2", ownerWallet: "0xB0b", endpointUrl: "http://localhost:4002", resourceType: "GPU", region: "EU-West", specs: { gpu: "NVIDIA A100", vramGb: 40 }, online: true, trust: defaultTrust(), pricePerCharge: 0.0000045, computeScore: 94, avgLatencyMs: 6 },
  { alias: "node-nebula-3", ownerWallet: "0xC4r0l", endpointUrl: "http://localhost:4003", resourceType: "CPU", region: "US-West", specs: { cpuCores: 64, ramGb: 256 }, online: true, trust: defaultTrust(), pricePerCharge: 0.0000022, computeScore: 87, avgLatencyMs: 5 },
  { alias: "node-pulsar-4", ownerWallet: "0xD4ve", endpointUrl: "http://localhost:4004", resourceType: "GPU", region: "Asia-Pacific", specs: { gpu: "NVIDIA L40S", vramGb: 48 }, online: false, trust: defaultTrust(), pricePerCharge: 0.0000051, computeScore: 76, avgLatencyMs: 9 },
  { alias: "vpn-nl-1", ownerWallet: "0xE1e", endpointUrl: "http://localhost:4005", resourceType: "VPN", region: "EU-West", specs: { exitLocation: "NL", protocol: "WireGuard", bandwidthMbps: 1000, region: "EU-West" }, online: true, trust: defaultTrust(), pricePerCharge: 0.02, computeScore: 91, avgLatencyMs: 7 },
  { alias: "worker-1", ownerWallet: "0xF00d", endpointUrl: "http://localhost:4006", resourceType: "Worker", region: "US-East", specs: { cpuCores: 8, ramGb: 16, concurrency: 4, runtime: "node20", region: "US-East" }, online: true, trust: defaultTrust(), pricePerCharge: 0.0001, computeScore: 88, avgLatencyMs: 5 },
];

async function makeRegistry(): Promise<{ reg: Registry; live: boolean }> {
  const cfg = loadConfig();
  if (cfg.supabase) return { reg: new SupabaseRegistry(cfg.supabase.url, cfg.supabase.serviceRoleKey), live: true };
  return { reg: new InMemoryRegistry(), live: false };
}

const { reg, live } = await makeRegistry();
for (const s of seeds) {
  const p = await reg.registerProvider(s);
  console.log(`${live ? "inserted" : "(dry-run)"} ${p.alias} -> ${p.id}`);
}
console.log(live ? "\n✅ seeded providers into Supabase." : "\n(dry run — set SUPABASE_* to insert for real)");
