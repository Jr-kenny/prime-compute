import { createFileRoute } from "@tanstack/react-router";
import { authGuard } from "../lib/auth/guard";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Server } from "lucide-react";
import { AppShell } from "@/components/site/AppShell";
import { OperationalTile } from "@/components/site/OperationalTile";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ComputeScoreRing } from "@/components/site/ComputeScoreRing";
import { StreamingTicker } from "@/components/site/StreamingTicker";
import { useSession } from "@/lib/auth/session";
import { listMyProviders, listProviderRents } from "@/lib/broker/server-fns";
import type { Provider, Rent } from "@services/domain";

export const Route = createFileRoute("/provider")({
  beforeLoad: authGuard,
  head: () => ({
    meta: [
      { title: "Provider Dashboard — Prime Compute" },
      { name: "description", content: "Manage your servers, rents, and earnings as a Prime Compute provider." },
    ],
  }),
  component: ProviderDash,
});

function ProviderDash() {
  const { session, walletAddress } = useSession();
  const accessToken = session?.access_token;
  const [onlineByServer, setOnlineByServer] = useState<Record<string, boolean>>({});
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  const { data: myServers = [] } = useQuery({
    queryKey: ["providers", "mine", accessToken],
    queryFn: () => listMyProviders({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken,
  });

  const serverIds = myServers.map((s) => s.id);
  const { data: rentsByProvider = {} } = useQuery({
    queryKey: ["rents", "forProviders", serverIds],
    queryFn: async () => {
      const lists = await Promise.all(
        serverIds.map((id) => listProviderRents({ data: { providerId: id } })),
      );
      return Object.fromEntries(serverIds.map((id, i) => [id, lists[i]]));
    },
    enabled: serverIds.length > 0,
  });

  const allRents = Object.values(rentsByProvider).flat();
  const totalEarned = allRents.reduce((s, r) => s + r.totalCost, 0);
  const isOnline = (s: Provider) => onlineByServer[s.id] ?? s.online;
  const selectedServer = myServers.find((s) => s.id === selectedServerId) ?? null;

  return (
    <>
      <AppShell>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
          <div className="text-[11px] uppercase tracking-wider text-glow">Provider</div>
          <h1 className="mt-1 text-3xl md:text-4xl font-bold">Server operations</h1>

          <Tabs defaultValue="servers" className="mt-8">
            <TabsList className="bg-surface border border-border">
              <TabsTrigger value="servers">My servers</TabsTrigger>
              <TabsTrigger value="earnings">Earnings</TabsTrigger>
              <TabsTrigger value="rents">Rents</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="servers" className="mt-6 grid gap-4 lg:grid-cols-2">
              {myServers.map((s) => (
                <OperationalTile
                  key={s.id}
                  title={s.alias}
                  subtitle={`${s.region} · ${(s.specs.gpu as string | undefined) ?? (s.specs.cpuCores ? `${s.specs.cpuCores} cores` : "—")}`}
                  icon={Server}
                  statusLabel={isOnline(s) ? "online" : "offline"}
                  statusTone={isOnline(s) ? "success" : "destructive"}
                  pulse={isOnline(s)}
                  onClick={() => setSelectedServerId(s.id)}
                />
              ))}
              {myServers.length === 0 && (
                <div className="col-span-full glass-card p-10 text-center text-muted-foreground">
                  No servers registered to this wallet yet.
                </div>
              )}
            </TabsContent>

            <TabsContent value="earnings" className="mt-6 grid gap-6 lg:grid-cols-3">
              <div className="glass-card p-6 lg:col-span-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Total earned</div>
                <div className="mt-2 text-3xl font-bold text-foreground">${totalEarned.toFixed(4)}</div>
                <div className="mt-1 text-xs text-muted-foreground">across {allRents.length} rent{allRents.length === 1 ? "" : "s"}</div>
              </div>
            </TabsContent>

            <TabsContent value="rents" className="mt-6 glass-card p-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-xs uppercase tracking-wider text-muted-foreground text-left"><th className="py-2">Rent</th><th>Duration</th><th>Earned</th><th>Status</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {allRents.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2">{r.name}</td>
                      <td>{r.startedAt && r.endedAt ? `${Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000)}m` : "—"}</td>
                      <td>${r.totalCost.toFixed(4)}</td>
                      <td className="text-muted-foreground">{r.status}</td>
                    </tr>
                  ))}
                  {allRents.length === 0 && (
                    <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No rents yet.</td></tr>
                  )}
                </tbody>
              </table>
            </TabsContent>

            <TabsContent value="settings" className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="glass-card p-6 space-y-4">
                <h3 className="font-semibold">Auto-accept</h3>
                <div className="flex items-center justify-between"><Label>Accept matched rents automatically</Label><Switch defaultChecked /></div>
                <div className="flex items-center justify-between"><Label>Allow rent migration in</Label><Switch defaultChecked /></div>
              </div>
              <div className="glass-card p-6 space-y-4">
                <h3 className="font-semibold">Payout wallet</h3>
                <Input readOnly value={walletAddress ?? "—"} className="font-mono bg-card border-border" />
                <Label>Minimum payout</Label>
                <Input defaultValue="50" className="bg-card border-border" />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </AppShell>

      <ServerDetailSheet
        server={selectedServer}
        rents={selectedServer ? rentsByProvider[selectedServer.id] ?? [] : []}
        online={selectedServer ? isOnline(selectedServer) : false}
        onOnlineChange={(v) =>
          selectedServer && setOnlineByServer((m) => ({ ...m, [selectedServer.id]: v }))
        }
        onClose={() => setSelectedServerId(null)}
      />
    </>
  );
}

function ServerDetailSheet({
  server,
  rents,
  online,
  onOnlineChange,
  onClose,
}: {
  server: Provider | null;
  rents: Rent[];
  online: boolean;
  onOnlineChange: (v: boolean) => void;
  onClose: () => void;
}) {
  const runningRent = rents.find((r) => r.status === "running");
  const cpuCores = server?.specs.cpuCores as number | undefined;
  const ramGb = server?.specs.ramGb as number | undefined;
  const storageGb = server?.specs.storageGb as number | undefined;
  const gpu = server?.specs.gpu as string | undefined;

  return (
    <Sheet open={!!server} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="bg-surface border-border">
        <SheetHeader>
          <SheetTitle>{server?.alias ?? "Server"}</SheetTitle>
        </SheetHeader>
        {server && (
          <div className="mt-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ComputeScoreRing score={server.computeScore} size={40} />
                <span className="text-xs text-muted-foreground">{server.region}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{online ? "Online" : "Offline"}</span>
                <Switch checked={online} onCheckedChange={onOnlineChange} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <div><div className="text-foreground">{cpuCores ?? "—"}</div>cores</div>
              <div><div className="text-foreground">{ramGb ? `${ramGb}GB` : "—"}</div>ram</div>
              <div><div className="text-foreground">{storageGb ? `${storageGb}GB` : "—"}</div>ssd</div>
            </div>
            {gpu && <div className="text-xs text-foreground">{gpu}</div>}
            {runningRent && online ? (
              <div className="rounded-lg border border-border bg-surface/60 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{runningRent.name}</span>
                  <span className="inline-flex items-center gap-1 text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success pulse-ring" />
                    running
                  </span>
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Earning
                    </div>
                    <StreamingTicker
                      ratePerSecond={server.pricePerCharge}
                      startedAt={runningRent.startedAt ? new Date(runningRent.startedAt).getTime() : Date.now()}
                      className="text-lg font-semibold text-foreground"
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">${server.pricePerCharge.toFixed(7)}/s</div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                {online ? "Waiting for matched rents…" : "Server offline. Toggle to start accepting rents."}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
