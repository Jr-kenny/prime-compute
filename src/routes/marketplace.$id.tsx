import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, MapPin, Star } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { ComputeScoreRing } from "@/components/site/ComputeScoreRing";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { findProvider, uptime30d, benchmarkData, historicalJobs, reviews } from "@/lib/mock-data";

export const Route = createFileRoute("/marketplace/$id")({
  loader: ({ params }) => {
    const p = findProvider(params.id);
    if (!p) throw notFound();
    return { p };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.p.alias} — Prime Compute` },
      { name: "description", content: `${loaderData?.p.alias} provider details: hardware, benchmarks, uptime, and pricing.` },
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
  const { p } = Route.useLoaderData();
  const [tab, setTab] = useState("overview");
  const history = historicalJobs.slice(0, 20);

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
                  <MapPin className="h-3.5 w-3.5" /> {p.region} · {p.resourceType} · joined {p.joinedDays}d ago
                </div>
              </div>
            </div>
            <Button size="lg" className="bg-primary text-primary-foreground" disabled={!p.online}>Deploy a job</Button>
          </div>

          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Rate" value={`$${p.pricePerSecond.toFixed(7)}/s`} />
            <Stat label="Uptime" value={`${p.uptime.toFixed(2)}%`} />
            <Stat label="Jobs completed" value={p.jobsCompleted.toLocaleString()} />
            <Stat label="Avg latency" value={`${p.avgLatencyMs.toFixed(1)}ms`} />
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="mt-8">
          <TabsList className="bg-surface border border-border">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="benchmarks">Benchmarks</TabsTrigger>
            <TabsTrigger value="history">Job history</TabsTrigger>
            <TabsTrigger value="reviews">Reviews</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6 grid lg:grid-cols-2 gap-6">
            <div className="glass-card p-6">
              <h3 className="font-semibold mb-4">Hardware</h3>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {[
                    ["GPU", p.gpu ?? "—"],
                    ["VRAM", p.vramGb ? `${p.vramGb} GB` : "—"],
                    ["CPU cores", `${p.cpuCores}`],
                    ["RAM", `${p.ramGb} GB`],
                    ["Storage", `${p.storageGb} GB SSD`],
                    ["Region", p.region],
                  ].map(([k, v]) => (
                    <tr key={k}><td className="py-2 text-muted-foreground">{k}</td><td className="py-2 text-right text-foreground">{v}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="glass-card p-6">
              <h3 className="font-semibold mb-4">Uptime · 30 days</h3>
              <div className="h-56">
                <ResponsiveContainer>
                  <LineChart data={uptime30d}>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                    <XAxis dataKey="day" stroke="var(--color-muted-foreground)" fontSize={10} />
                    <YAxis domain={[98, 100]} stroke="var(--color-muted-foreground)" fontSize={10} />
                    <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
                    <Line type="monotone" dataKey="uptime" stroke="var(--color-glow)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="benchmarks" className="mt-6 glass-card p-6">
            <h3 className="font-semibold mb-4">This provider vs network average</h3>
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={benchmarkData}>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                  <XAxis dataKey="metric" stroke="var(--color-muted-foreground)" fontSize={11} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
                  <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
                  <Legend />
                  <Bar dataKey="provider" fill="var(--color-glow)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="network" fill="var(--color-border)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-6 glass-card p-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-muted-foreground text-left">
                  <th className="py-2">Job ID</th><th>Duration</th><th>Cost</th><th>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map((j) => (
                  <tr key={j.id}>
                    <td className="py-2 font-mono text-xs">{j.id}</td>
                    <td>{Math.round(j.durationMs / 60000)}m</td>
                    <td>${j.totalCost.toFixed(4)}</td>
                    <td><StatusBadge status={j.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>

          <TabsContent value="reviews" className="mt-6 grid md:grid-cols-2 gap-4">
            {reviews.map((r) => (
              <div key={r.id} className="glass-card p-5">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{r.author}</div>
                  <div className="flex items-center text-warning">
                    {Array.from({ length: r.rating }).map((_, i) => (<Star key={i} className="h-3.5 w-3.5 fill-warning" />))}
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{r.text}</p>
                <div className="mt-2 text-[10px] text-muted-foreground">{r.daysAgo}d ago</div>
              </div>
            ))}
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-success/15 text-success border-success/30",
    cancelled: "bg-warning/15 text-warning border-warning/30",
    failed: "bg-destructive/15 text-destructive border-destructive/30",
    running: "bg-primary/15 text-glow border-primary/30",
    paused: "bg-muted/40 text-muted-foreground border-border",
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${map[status] ?? map.completed}`}>{status}</span>;
}