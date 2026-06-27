export type Region = "US-East" | "US-West" | "EU-West" | "EU-Central" | "Asia-Pacific" | "South-America";
export type ResourceType = "GPU" | "CPU" | "Storage" | "Full Server";
export type JobStatus = "running" | "completed" | "cancelled" | "failed" | "paused";

export type Provider = {
  id: string;
  alias: string;
  region: Region;
  online: boolean;
  resourceType: ResourceType;
  gpu?: string;
  vramGb?: number;
  cpuCores: number;
  ramGb: number;
  storageGb: number;
  pricePerSecond: number;
  computeScore: number;
  uptime: number;
  jobsCompleted: number;
  avgLatencyMs: number;
  joinedDays: number;
};

export type Job = {
  id: string;
  name: string;
  providerId: string;
  providerAlias: string;
  startedAt: number;
  durationMs: number;
  ratePerSecond: number;
  totalCost: number;
  status: JobStatus;
  cpuUsage: number;
  ramUsage: number;
};

export type Review = {
  id: string;
  author: string;
  rating: number;
  text: string;
  daysAgo: number;
};

const regions: Region[] = ["US-East", "US-West", "EU-West", "EU-Central", "Asia-Pacific", "South-America"];
const gpus = ["NVIDIA H100", "NVIDIA A100", "NVIDIA RTX 4090", "NVIDIA L40S", "AMD MI300X", "NVIDIA RTX 3090"];

export const providers: Provider[] = Array.from({ length: 12 }).map((_, i) => {
  const isGpu = i % 3 !== 2;
  return {
    id: `prv_${(i + 1).toString().padStart(3, "0")}`,
    alias: `node-${["astral", "orion", "nebula", "pulsar", "quasar", "vega", "lyra", "cygnus", "atlas", "helix", "nova", "ember"][i]}-${i + 1}`,
    region: regions[i % regions.length],
    online: i % 7 !== 4,
    resourceType: isGpu ? "GPU" : i % 6 === 5 ? "Storage" : "CPU",
    gpu: isGpu ? gpus[i % gpus.length] : undefined,
    vramGb: isGpu ? [80, 40, 24, 48, 192, 24][i % 6] : undefined,
    cpuCores: [16, 32, 64, 128, 24, 48][i % 6],
    ramGb: [64, 128, 256, 512, 96, 192][i % 6],
    storageGb: [1000, 2000, 4000, 8000, 1500, 3000][i % 6],
    pricePerSecond: Number((0.0000045 + (i % 6) * 0.0000022).toFixed(7)),
    computeScore: [98, 94, 87, 91, 76, 99, 82, 95, 88, 73, 96, 90][i],
    uptime: 99.2 + (i % 8) * 0.09,
    jobsCompleted: 1200 + i * 437,
    avgLatencyMs: 4 + (i % 6) * 1.5,
    joinedDays: 30 + i * 18,
  };
});

export const activeJobs: Job[] = [
  {
    id: "job_4827",
    name: "llama-3-fine-tune",
    providerId: providers[0].id,
    providerAlias: providers[0].alias,
    startedAt: Date.now() - 1000 * 60 * 14,
    durationMs: 1000 * 60 * 60,
    ratePerSecond: providers[0].pricePerSecond,
    totalCost: 0,
    status: "running",
    cpuUsage: 78,
    ramUsage: 62,
  },
  {
    id: "job_4831",
    name: "stable-diffusion-batch",
    providerId: providers[3].id,
    providerAlias: providers[3].alias,
    startedAt: Date.now() - 1000 * 60 * 3,
    durationMs: 1000 * 60 * 25,
    ratePerSecond: providers[3].pricePerSecond,
    totalCost: 0,
    status: "running",
    cpuUsage: 41,
    ramUsage: 33,
  },
  {
    id: "job_4835",
    name: "rag-embedding-pipeline",
    providerId: providers[6].id,
    providerAlias: providers[6].alias,
    startedAt: Date.now() - 1000 * 60 * 8,
    durationMs: 1000 * 60 * 45,
    ratePerSecond: providers[6].pricePerSecond,
    totalCost: 0,
    status: "running",
    cpuUsage: 88,
    ramUsage: 71,
  },
];

export const historicalJobs: Job[] = Array.from({ length: 20 }).map((_, i) => {
  const p = providers[i % providers.length];
  const dur = (5 + (i % 9) * 7) * 60 * 1000;
  return {
    id: `job_${4000 + i}`,
    name: ["data-prep", "vector-index", "video-encode", "model-eval", "batch-infer", "render-frame"][i % 6] + "-" + (i + 1),
    providerId: p.id,
    providerAlias: p.alias,
    startedAt: Date.now() - 1000 * 60 * 60 * 24 * (i + 1),
    durationMs: dur,
    ratePerSecond: p.pricePerSecond,
    totalCost: Number(((dur / 1000) * p.pricePerSecond).toFixed(4)),
    status: (["completed", "completed", "completed", "cancelled", "failed", "completed"] as JobStatus[])[i % 6],
    cpuUsage: 50,
    ramUsage: 50,
  };
});

export const earnings30d = Array.from({ length: 30 }).map((_, i) => ({
  day: `D${i + 1}`,
  earnings: Number((20 + Math.sin(i / 3) * 8 + (i % 5) * 4 + Math.random() * 6).toFixed(2)),
}));

export const spending30d = Array.from({ length: 30 }).map((_, i) => ({
  day: `D${i + 1}`,
  spent: Number((8 + Math.cos(i / 4) * 4 + (i % 6) * 2 + Math.random() * 3).toFixed(2)),
}));

export const reviews: Review[] = [
  { id: "r1", author: "@miko.eth", rating: 5, text: "Rock-solid uptime. Migrated mid-job once without me even noticing.", daysAgo: 3 },
  { id: "r2", author: "@datafox", rating: 4, text: "Specs match exactly what's advertised. Latency from EU-West is consistent.", daysAgo: 9 },
  { id: "r3", author: "@gpu_chad", rating: 5, text: "Cheapest H100 I've found with a real Compute Score above 95.", daysAgo: 14 },
  { id: "r4", author: "@mlnomad", rating: 4, text: "One short blip last week, refunded automatically. No complaints.", daysAgo: 21 },
  { id: "r5", author: "@kairos.lab", rating: 5, text: "Streaming settlement is genuinely instant. Stopped a job and the meter froze.", daysAgo: 28 },
];

export const uptime30d = Array.from({ length: 30 }).map((_, i) => ({
  day: `D${i + 1}`,
  uptime: Number((99 + Math.random() * 1).toFixed(2)),
}));

export const benchmarkData = [
  { metric: "Compute", provider: 94, network: 72 },
  { metric: "Memory BW", provider: 88, network: 70 },
  { metric: "Disk IO", provider: 82, network: 68 },
  { metric: "Network", provider: 96, network: 74 },
  { metric: "Latency", provider: 91, network: 65 },
];

export function findProvider(id: string) {
  return providers.find((p) => p.id === id);
}