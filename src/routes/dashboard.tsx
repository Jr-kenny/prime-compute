import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Pause, Square, Copy, Plus } from "lucide-react";
import {
  WorkspaceShell,
  WorkspaceSection,
  WorkspaceItem,
  JobItem,
  WalletCard,
} from "@/components/site/WorkspaceShell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { StreamingTicker, ElapsedTimer } from "@/components/site/StreamingTicker";
import { activeJobs, historicalJobs, spending30d, type JobStatus } from "@/lib/mock-data";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Consumer Dashboard — Prime Compute" },
      { name: "description", content: "Monitor your active jobs, history, and streaming spend." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const runningJobs = activeJobs.filter((j) => j.status === "running");
  return (
    <WorkspaceShell
      path="/dashboard"
      sidebar={
        <>
          <WorkspaceSection label="Workspace">
            <WorkspaceItem label="Canvas" />
            <WorkspaceItem label="Providers" />
            <WorkspaceItem label="Jobs" active />
            <WorkspaceItem label="Wallet" />
          </WorkspaceSection>
          <WorkspaceSection label="Active jobs">
            {runningJobs.slice(0, 3).map((j) => (
              <JobItem key={j.id} name={j.name} provider={shortProvider(j.providerAlias)} />
            ))}
          </WorkspaceSection>
          <WalletCard balance="$1,284.93" note="USDC streaming wallet" />
        </>
      }
      status={
        <>
          <span>{runningJobs.length} jobs running</span>
          <span className="text-glow">
            streaming ${runningJobs.reduce((acc, j) => acc + j.ratePerSecond, 0).toFixed(7)}/sec
          </span>
          <span>wallet $1,284.93</span>
          <span>8ms broker match</span>
        </>
      }
    >
      <div className="text-[11px] uppercase tracking-wider text-glow">Consumer</div>
      <h1 className="mt-1 text-3xl md:text-4xl font-bold">Dashboard</h1>

      <Tabs defaultValue="active" className="mt-8">
        <TabsList className="bg-surface border border-border">
          <TabsTrigger value="active">Active jobs</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-6 grid gap-4 lg:grid-cols-2">
          {activeJobs.map((j) => (
            <ActiveJobCard key={j.id} job={j} />
          ))}
        </TabsContent>

        <TabsContent value="history" className="mt-6 glass-card p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-muted-foreground text-left">
                <th className="py-2">Job</th>
                <th>Provider</th>
                <th>Duration</th>
                <th>Cost</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {historicalJobs.map((j) => (
                <tr key={j.id}>
                  <td className="py-2">{j.name}</td>
                  <td className="text-muted-foreground">{j.providerAlias}</td>
                  <td>{Math.round(j.durationMs / 60000)}m</td>
                  <td>${j.totalCost.toFixed(4)}</td>
                  <td>
                    <StatusBadge status={j.status} />
                  </td>
                  <td className="text-muted-foreground text-xs">
                    {new Date(j.startedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TabsContent>

        <TabsContent value="billing" className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="glass-card p-6">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Balance</div>
            <div className="mt-2 text-3xl font-bold text-gradient-blue">$1,284.93</div>
            <div className="mt-1 text-xs text-muted-foreground">USDC streaming wallet</div>
            <Button className="mt-5 w-full bg-primary text-primary-foreground">
              <Plus className="h-4 w-4" /> Add funds
            </Button>
          </div>
          <div className="glass-card p-6 lg:col-span-2">
            <h3 className="font-semibold mb-4">Spend · 30 days</h3>
            <div className="h-56">
              <ResponsiveContainer>
                <AreaChart data={spending30d}>
                  <defs>
                    <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-glow)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--color-glow)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                  <XAxis dataKey="day" stroke="var(--color-muted-foreground)" fontSize={10} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={10} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="spent"
                    stroke="var(--color-glow)"
                    fill="url(#sg)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="glass-card p-6 lg:col-span-3">
            <h3 className="font-semibold mb-4">Recent transactions</h3>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {historicalJobs.slice(0, 6).map((j) => (
                  <tr key={j.id}>
                    <td className="py-2 text-muted-foreground text-xs font-mono">{j.id}</td>
                    <td>{j.name}</td>
                    <td className="text-right">- ${j.totalCost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="glass-card p-6 space-y-4">
            <h3 className="font-semibold">Notifications</h3>
            {["Job completed", "Job failed", "Low balance", "Migration events"].map((l) => (
              <div key={l} className="flex items-center justify-between">
                <Label>{l}</Label>
                <Switch defaultChecked />
              </div>
            ))}
          </div>
          <div className="glass-card p-6 space-y-4">
            <h3 className="font-semibold">API key</h3>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value="pc_live_••••••••••••••sk29x"
                className="font-mono bg-card border-border"
              />
              <Button variant="ghost" size="icon" className="border border-border">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <Label>Default payment</Label>
            <Input readOnly value="USDC · 0x4F…91Ae" className="font-mono bg-card border-border" />
          </div>
        </TabsContent>
      </Tabs>
    </WorkspaceShell>
  );
}

function ActiveJobCard({ job }: { job: (typeof activeJobs)[number] }) {
  const [paused, setPaused] = useState(false);
  return (
    <div className="glass-card glow-hover p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-medium">{job.name}</div>
          <div className="text-xs text-muted-foreground">on {job.providerAlias}</div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-success">
          <span className={`h-1.5 w-1.5 rounded-full bg-success ${paused ? "" : "pulse-ring"}`} />
          {paused ? "paused" : "running"}
        </span>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Streaming spend
          </div>
          <StreamingTicker
            ratePerSecond={job.ratePerSecond}
            startedAt={job.startedAt}
            paused={paused}
            className="text-2xl font-semibold text-gradient-blue"
          />
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Elapsed</div>
          <div className="text-sm text-foreground">
            <ElapsedTimer startedAt={job.startedAt} paused={paused} />
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <UsageBar label="CPU" value={job.cpuUsage} />
        <UsageBar label="RAM" value={job.ramUsage} />
      </div>
      <div className="mt-5 flex gap-2">
        <Button
          variant="ghost"
          className="flex-1 border border-border"
          onClick={() => setPaused((v) => !v)}
        >
          <Pause className="h-4 w-4" /> {paused ? "Resume" : "Pause"}
        </Button>
        <Button
          variant="ghost"
          className="flex-1 border border-destructive/30 text-destructive hover:bg-destructive/10"
        >
          <Square className="h-4 w-4" /> Stop
        </Button>
      </div>
    </div>
  );
}

function UsageBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-border overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-accent to-glow"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, string> = {
    completed: "bg-success/15 text-success border-success/30",
    cancelled: "bg-warning/15 text-warning border-warning/30",
    failed: "bg-destructive/15 text-destructive border-destructive/30",
    running: "bg-primary/15 text-glow border-primary/30",
    paused: "bg-muted/40 text-muted-foreground border-border",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${map[status]}`}
    >
      {status}
    </span>
  );
}

function shortProvider(alias: string): string {
  // Take the first two dash-separated parts. If fewer than 2 parts exist,
  // return the whole alias. Matches the visual rhythm of "node-alpha-7" → "node-alpha".
  const parts = alias.split("-");
  return parts.length >= 2 ? parts.slice(0, 2).join("-") : alias;
}
