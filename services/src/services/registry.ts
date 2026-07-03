// services/src/services/registry.ts
// The single source of truth for what service types the marketplace hosts. Every consumer
// (domain enum, API validation, provider server, metering worker, register form, marketplace
// filters, MCP) reads from here, so adding a service type is one descriptor, not scattered branches.
import { z } from "zod";

export type MeteringKind = "time" | "volume";
export type ServiceCategory = "compute" | "storage" | "network" | "worker";

export interface ServiceTypeDescriptor {
  id: string;
  label: string;
  category: ServiceCategory;
  metering: MeteringKind; // display/pricing label; the endpoint owns accrual (see the worker)
  unit: string;           // "second" | "GB-hour" | "GB"
  path: string;           // paywalled service path on the provider, e.g. "/compute" | "/vpn"
  specSchema: z.ZodType;  // provider listing fields for this type
  telemetry: z.ZodType;   // heartbeat shape the executor emits
  connect: z.ZodType;     // what a running rent hands the renter
  defaultExecutorKind: string;
}

const region = z.string().min(1);
const sshConnect = z.object({ host: z.string(), user: z.string(), token: z.string() });
const computeTelemetry = z.object({
  cpu: z.number(), ramGb: z.number(), gpuUtil: z.number(), seq: z.number(), ts: z.number(),
});

export const SERVICE_REGISTRY: Record<string, ServiceTypeDescriptor> = {
  GPU: {
    id: "GPU", label: "GPU", category: "compute", metering: "time", unit: "second", path: "/compute",
    specSchema: z.object({ gpu: z.string(), vramGb: z.number(), cpuCores: z.number(), ramGb: z.number(), region }),
    telemetry: computeTelemetry, connect: sshConnect, defaultExecutorKind: "simulated-compute",
  },
  CPU: {
    id: "CPU", label: "CPU", category: "compute", metering: "time", unit: "second", path: "/compute",
    specSchema: z.object({ cpuCores: z.number(), ramGb: z.number(), region }),
    telemetry: computeTelemetry, connect: sshConnect, defaultExecutorKind: "simulated-compute",
  },
  "Full Server": {
    id: "Full Server", label: "Full Server", category: "compute", metering: "time", unit: "second", path: "/compute",
    specSchema: z.object({ gpu: z.string().optional(), cpuCores: z.number(), ramGb: z.number(), diskGb: z.number(), region }),
    telemetry: computeTelemetry, connect: sshConnect, defaultExecutorKind: "simulated-compute",
  },
  Storage: {
    id: "Storage", label: "Storage", category: "storage", metering: "volume", unit: "GB-hour", path: "/storage",
    specSchema: z.object({ capacityGb: z.number(), region, redundancy: z.string().optional() }),
    telemetry: z.object({ usedGb: z.number(), unitsAccrued: z.number(), seq: z.number(), ts: z.number() }),
    connect: z.object({ bucketUrl: z.string(), accessKey: z.string(), secretKey: z.string() }),
    defaultExecutorKind: "simulated-storage",
  },
  VPN: {
    id: "VPN", label: "VPN", category: "network", metering: "volume", unit: "GB", path: "/vpn",
    specSchema: z.object({
      exitLocation: z.string(), protocol: z.enum(["WireGuard", "OpenVPN"]),
      bandwidthMbps: z.number(), dataCapGb: z.number().optional(), region,
    }),
    telemetry: z.object({ bytesTransferred: z.number(), unitsAccrued: z.number(), seq: z.number(), ts: z.number() }),
    connect: z.object({ profile: z.string() }),
    defaultExecutorKind: "simulated-vpn",
  },
  Worker: {
    id: "Worker", label: "Worker", category: "worker", metering: "time", unit: "second", path: "/worker",
    specSchema: z.object({ cpuCores: z.number(), ramGb: z.number(), concurrency: z.number(), runtime: z.string(), region }),
    telemetry: z.object({ cpu: z.number(), ramGb: z.number(), jobsRun: z.number(), seq: z.number(), ts: z.number() }),
    connect: z.object({ submitUrl: z.string(), token: z.string() }),
    defaultExecutorKind: "simulated-worker",
  },
};

export function serviceIds(): string[] {
  return Object.keys(SERVICE_REGISTRY);
}

export function descriptorFor(id: string): ServiceTypeDescriptor {
  const d = SERVICE_REGISTRY[id];
  if (!d) throw new Error(`unknown service type: ${id}`);
  return d;
}
