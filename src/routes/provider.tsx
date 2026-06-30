import { createFileRoute } from "@tanstack/react-router";
import { authGuard } from "../lib/auth/guard";
import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { AppShell } from "@/components/site/AppShell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ComputeScoreRing } from "@/components/site/ComputeScoreRing";
import { StreamingTicker } from "@/components/site/StreamingTicker";
import { providers, earnings30d, historicalJobs } from "@/lib/mock-data";

export const Route = createFileRoute("/provider")({
  beforeLoad: authGuard,
  head: () => ({
    meta: [
      { title: "Provider Dashboard — Prime Compute" },
      { name: "description", content: "Manage your servers, jobs, and earnings as a Prime Compute provider." },
    ],
  }),
  component: ProviderDash,
});

function ProviderDash() {
  const myServers = providers.slice(0, 2);
  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
        <div className="text-[11px] uppercase tracking-wider text-glow">Provider</div>
        <h1 className="mt-1 text-3xl md:text-4xl font-bold">Server operations</h1>

        <Tabs defaultValue="servers" className="mt-8">
          <TabsList className="bg-surface border border-border">
            <TabsTrigger value="servers">My servers</TabsTrigger>
            <TabsTrigger value="earnings">Earnings</TabsTrigger>
            <TabsTrigger value="jobs">Jobs</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="servers" className="mt-6 grid gap-4 lg:grid-cols-2">
            {myServers.map((s, i) => <ServerCard key={s.id} server={s} hasJob={i === 0} />)}
          </TabsContent>

          <TabsContent value="earnings" className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="glass-card p-6">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Lifetime</div>
              <div className="mt-2 text-3xl font-bold text-gradient-blue">$24,182.40</div>
              <div className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">This month</div>
              <div className="mt-1 text-xl font-semibold">$1,847.20</div>
            </div>
            <div className="glass-card p-6 lg:col-span-2">
              <h3 className="font-semibold mb-4">Daily earnings · 30d</h3>
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={earnings30d}>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                    <XAxis dataKey="day" stroke="var(--color-muted-foreground)" fontSize={10} />
                    <YAxis stroke="var(--color-muted-foreground)" fontSize={10} />
                    <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
                    <Bar dataKey="earnings" fill="var(--color-glow)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="glass-card p-6 lg:col-span-3 overflow-x-auto">
              <h3 className="font-semibold mb-4">Payouts</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-xs uppercase tracking-wider text-muted-foreground text-left"><th className="py-2">Date</th><th>Amount</th><th>Tx</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {[420, 380, 510, 290].map((amt, i) => (
                    <tr key={i}>
                      <td className="py-2 text-muted-foreground">{new Date(Date.now() - i * 86400000 * 7).toLocaleDateString()}</td>
                      <td>${amt.toFixed(2)}</td>
                      <td className="font-mono text-xs text-muted-foreground">0x{Math.random().toString(16).slice(2, 10)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="jobs" className="mt-6 glass-card p-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs uppercase tracking-wider text-muted-foreground text-left"><th className="py-2">Job</th><th>Duration</th><th>Earned</th><th>Status</th></tr></thead>
              <tbody className="divide-y divide-border">
                {historicalJobs.slice(0, 12).map((j) => (
                  <tr key={j.id}>
                    <td className="py-2">{j.name}</td>
                    <td>{Math.round(j.durationMs / 60000)}m</td>
                    <td>${j.totalCost.toFixed(4)}</td>
                    <td className="text-muted-foreground">{j.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>

          <TabsContent value="settings" className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="glass-card p-6 space-y-4">
              <h3 className="font-semibold">Auto-accept</h3>
              <div className="flex items-center justify-between"><Label>Accept matched jobs automatically</Label><Switch defaultChecked /></div>
              <div className="flex items-center justify-between"><Label>Allow job migration in</Label><Switch defaultChecked /></div>
            </div>
            <div className="glass-card p-6 space-y-4">
              <h3 className="font-semibold">Payout wallet</h3>
              <Input readOnly value="0x91Ae…4F22" className="font-mono bg-card border-border" />
              <Label>Minimum payout</Label>
              <Input defaultValue="50" className="bg-card border-border" />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function ServerCard({ server, hasJob }: { server: (typeof providers)[number]; hasJob: boolean }) {
  const [online, setOnline] = useState(server.online);
  return (
    <div className="glass-card glow-hover p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-medium">{server.alias}</div>
          <div className="text-xs text-muted-foreground">{server.region} · {server.gpu ?? `${server.cpuCores} cores`}</div>
        </div>
        <div className="flex items-center gap-3">
          <ComputeScoreRing score={server.computeScore} size={40} />
          <Switch checked={online} onCheckedChange={setOnline} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        <div><div className="text-foreground">{server.cpuCores}</div>cores</div>
        <div><div className="text-foreground">{server.ramGb}GB</div>ram</div>
        <div><div className="text-foreground">{server.storageGb}GB</div>ssd</div>
      </div>
      {hasJob && online ? (
        <div className="mt-4 rounded-lg border border-border bg-surface/60 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">consumer @0x4F…91Ae</span>
            <span className="inline-flex items-center gap-1 text-success"><span className="h-1.5 w-1.5 rounded-full bg-success pulse-ring" />running</span>
          </div>
          <div className="mt-2 flex items-end justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Earning</div>
              <StreamingTicker ratePerSecond={server.pricePerSecond} startedAt={Date.now() - 1000 * 540} className="text-lg font-semibold text-gradient-blue" />
            </div>
            <div className="text-xs text-muted-foreground">${server.pricePerSecond.toFixed(7)}/s</div>
          </div>
        </div>
      ) : (
        <div className="mt-4 text-xs text-muted-foreground">{online ? "Waiting for matched jobs…" : "Server offline. Toggle to start accepting jobs."}</div>
      )}
      <div className="mt-4 text-xs text-muted-foreground">Earnings today · <span className="text-foreground">$64.12</span></div>
    </div>
  );
}