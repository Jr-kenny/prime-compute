import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, MapPin } from "lucide-react";
import { ComputeScoreRing } from "@/components/site/ComputeScoreRing";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { RentStatus } from "@services/domain";
import { getProviderById, listProviderRents } from "@/lib/broker/server-fns";

export const Route = createFileRoute("/marketplace/$id")({
  loader: async ({ params }) => {
    const p = await getProviderById({ data: { id: params.id } });
    if (!p) throw notFound();
    const rents = await listProviderRents({ data: { providerId: p.id } });
    return { p, rents };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.p.alias} — Prime Compute` },
      { name: "description", content: `${loaderData?.p.alias} provider details: hardware, job history, and pricing.` },
    ],
  }),
  component: ProviderDetail,
  notFoundComponent: () => (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="text-3xl font-bold">Provider not found</h1>
      <Button asChild className="mt-6"><Link to="/marketplace">Back to marketplace</Link></Button>
    </div>
  ),
  errorComponent: () => (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">Couldn't load this provider</h1>
    </div>
  ),
});

function ProviderDetail() {
  const { p, rents } = Route.useLoaderData();
  const [tab, setTab] = useState("overview");
  const gpu = p.specs.gpu as string | undefined;
  const vramGb = p.specs.vramGb as number | undefined;
  const cpuCores = p.specs.cpuCores as number | undefined;
  const ramGb = p.specs.ramGb as number | undefined;
  const storageGb = p.specs.storageGb as number | undefined;
  const uptimePct = Math.min(100, Math.max(0, p.trust.signals.uptime * 100));

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 pb-32 md:pb-12">
      <Link to="/marketplace" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to marketplace
      </Link>

      <div className="mt-6 glass-card p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            <ComputeScoreRing score={p.computeScore} size={72} />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl md:text-3xl font-bold">{p.alias}</h1>
                <Badge className={p.online ? "bg-success/15 text-success border border-success/30" : "bg-destructive/15 text-destructive"}>
                  {p.online ? "online" : "offline"}
                </Badge>
              </div>
              <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> {p.region} · {p.resourceType}
              </div>
            </div>
          </div>
          <Button size="lg" className="bg-primary text-primary-foreground" disabled={!p.online}>Rent</Button>
        </div>

        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Rate" value={`$${p.pricePerCharge.toFixed(7)}/s`} />
          <Stat label="Uptime" value={`${uptimePct.toFixed(2)}%`} />
          <Stat label="Jobs completed" value={p.trust.signals.successfulRentals.toLocaleString()} />
          <Stat label="Avg latency" value={`${p.avgLatencyMs.toFixed(1)}ms`} />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-8">
        <TabsList className="bg-surface border border-border">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="history">Job history</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 glass-card p-6">
          <h3 className="font-semibold mb-4">Hardware</h3>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {[
                ["GPU", gpu ?? "—"],
                ["VRAM", vramGb ? `${vramGb} GB` : "—"],
                ["CPU cores", cpuCores ? `${cpuCores}` : "—"],
                ["RAM", ramGb ? `${ramGb} GB` : "—"],
                ["Storage", storageGb ? `${storageGb} GB SSD` : "—"],
                ["Region", p.region],
              ].map(([k, v]) => (
                <tr key={k}><td className="py-2 text-muted-foreground">{k}</td><td className="py-2 text-right text-foreground">{v}</td></tr>
              ))}
            </tbody>
          </table>
        </TabsContent>

        <TabsContent value="history" className="mt-6 glass-card p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-muted-foreground text-left">
                <th className="py-2">Rent</th><th>Duration</th><th>Cost</th><th>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rents.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 font-mono text-xs">{r.name}</td>
                  <td>{r.startedAt && r.endedAt ? `${Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000)}m` : "—"}</td>
                  <td>${r.totalCost.toFixed(4)}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
              {rents.length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No rents yet.</td></tr>
              )}
            </tbody>
          </table>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface/60 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-foreground">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: RentStatus }) {
  const map: Record<RentStatus, string> = {
    completed: "bg-success/15 text-success border-success/30",
    cancelled: "bg-warning/15 text-warning border-warning/30",
    failed: "bg-destructive/15 text-destructive border-destructive/30",
    running: "bg-primary/15 text-glow border-primary/30",
    paused: "bg-muted/40 text-muted-foreground border-border",
    queued: "bg-muted/40 text-muted-foreground border-border",
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${map[status]}`}>{status}</span>;
}
