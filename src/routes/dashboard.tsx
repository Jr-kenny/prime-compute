import { createFileRoute, useRouter } from "@tanstack/react-router";
import { authGuard } from "../lib/auth/guard";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Square, Copy, Cpu } from "lucide-react";
import { AppShell } from "@/components/site/AppShell";
import { OperationalTile } from "@/components/site/OperationalTile";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StreamingTicker, ElapsedTimer } from "@/components/site/StreamingTicker";
import { WalletBalance } from "@/components/site/WalletBalance";
import { useSession } from "@/lib/auth/session";
import { listMyRents, listProviders, pauseRent, resumeRent, cancelRent } from "@/lib/broker/server-fns";
import { canPause, canResume, canCancel } from "@services/rent-transitions";
import type { Provider, Rent, RentStatus } from "@services/domain";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: authGuard,
  head: () => ({
    meta: [
      { title: "Consumer Dashboard — Prime Compute" },
      { name: "description", content: "Monitor your active rents, history, and streaming spend." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { session } = useSession();
  const accessToken = session?.access_token;
  const [selectedRentId, setSelectedRentId] = useState<string | null>(null);

  const { data: rents = [] } = useQuery({
    queryKey: ["rents", "mine", accessToken],
    queryFn: () => listMyRents({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken,
  });
  const { data: providers = [] } = useQuery({
    queryKey: ["providers"],
    queryFn: () => listProviders(),
  });
  const providersById = Object.fromEntries(providers.map((p) => [p.id, p]));

  const activeRents = rents.filter((r) => r.status === "running" || r.status === "queued" || r.status === "paused");
  const historyRents = rents.filter((r) => r.status === "completed" || r.status === "cancelled" || r.status === "failed");
  const runningRents = rents.filter((r) => r.status === "running");
  const streamingRate = runningRents.reduce(
    (acc, r) => acc + (r.providerId ? (providersById[r.providerId]?.pricePerCharge ?? 0) : 0),
    0,
  );
  const totalSpent = rents.reduce((s, r) => s + r.totalCost, 0);
  const selectedRent = rents.find((r) => r.id === selectedRentId) ?? null;

  return (
    <>
      <AppShell>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
          <div className="text-[11px] uppercase tracking-wider text-glow">Consumer</div>
          <h1 className="mt-1 text-3xl md:text-4xl font-bold">Dashboard</h1>

          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success pulse-ring" />
              {runningRents.length} rents running
            </span>
            <span>
              streaming <span className="text-glow font-mono">${streamingRate.toFixed(7)}/sec</span>
            </span>
            <WalletBalance />
          </div>

          <Tabs defaultValue="active" className="mt-8">
            <TabsList className="bg-surface border border-border">
              <TabsTrigger value="active">Active rents</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="billing">Billing</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="active" className="mt-6 grid gap-4 lg:grid-cols-2">
              {activeRents.map((r) => (
                <OperationalTile
                  key={r.id}
                  title={r.name}
                  subtitle={`on ${r.providerId ? providersById[r.providerId]?.alias ?? "unmatched" : "unmatched"}`}
                  icon={Cpu}
                  statusLabel={r.status}
                  statusTone={r.status === "running" ? "success" : r.status === "paused" ? "warning" : "neutral"}
                  pulse={r.status === "running"}
                  onClick={() => setSelectedRentId(r.id)}
                />
              ))}
              {activeRents.length === 0 && (
                <div className="col-span-full glass-card p-10 text-center text-muted-foreground">
                  No active rents. Head to the marketplace to rent some compute.
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-6 glass-card p-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-muted-foreground text-left">
                    <th className="py-2">Rent</th>
                    <th>Provider</th>
                    <th>Duration</th>
                    <th>Cost</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {historyRents.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2">{r.name}</td>
                      <td className="text-muted-foreground">{r.providerId ? providersById[r.providerId]?.alias ?? "—" : "—"}</td>
                      <td>{r.startedAt && r.endedAt ? `${Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000)}m` : "—"}</td>
                      <td>${r.totalCost.toFixed(4)}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td className="text-muted-foreground text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {historyRents.length === 0 && (
                    <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No completed rents yet.</td></tr>
                  )}
                </tbody>
              </table>
            </TabsContent>

            <TabsContent value="billing" className="mt-6 grid gap-6 lg:grid-cols-3">
              <div className="glass-card p-6 lg:col-span-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Total spent</div>
                <div className="mt-2 text-3xl font-bold text-foreground">${totalSpent.toFixed(4)}</div>
                <div className="mt-1 text-xs text-muted-foreground">across {rents.length} rent{rents.length === 1 ? "" : "s"}</div>
              </div>
            </TabsContent>

            <TabsContent value="settings" className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="glass-card p-6 space-y-4">
                <h3 className="font-semibold">Notifications</h3>
                {["Rent completed", "Rent failed", "Low balance", "Migration events"].map((l) => (
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
        </div>
      </AppShell>

      <RentDetailSheet
        rent={selectedRent}
        provider={selectedRent?.providerId ? providersById[selectedRent.providerId] : undefined}
        onClose={() => setSelectedRentId(null)}
      />
    </>
  );
}

function RentDetailSheet({
  rent,
  provider,
  onClose,
}: {
  rent: Rent | null;
  provider: Provider | undefined;
  onClose: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [mutating, setMutating] = useState(false);
  const startedAtMs = rent?.startedAt ? new Date(rent.startedAt).getTime() : Date.now();

  async function mutate(fn: typeof pauseRent) {
    if (!rent || !session) {
      router.navigate({ to: "/onboarding", search: { redirect: router.state.location.pathname } });
      return;
    }
    setMutating(true);
    try {
      await fn({ data: { accessToken: session.access_token, rentId: rent.id } });
      await queryClient.invalidateQueries({ queryKey: ["rents", "mine"] });
    } finally {
      setMutating(false);
    }
  }

  return (
    <Sheet open={!!rent} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="bg-surface border-border">
        <SheetHeader>
          <SheetTitle>{rent?.name ?? "Rent"}</SheetTitle>
        </SheetHeader>
        {rent && (
          <div className="mt-6 space-y-5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">on {provider?.alias ?? "unmatched"}</span>
              <StatusBadge status={rent.status} />
            </div>
            <div className="glass-card p-4 flex items-end justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Streaming spend
                </div>
                <StreamingTicker
                  ratePerSecond={provider?.pricePerCharge ?? 0}
                  startedAt={startedAtMs}
                  paused={rent.status !== "running"}
                  className="text-2xl font-semibold text-foreground"
                />
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Elapsed</div>
                <div className="text-sm text-foreground">
                  <ElapsedTimer startedAt={startedAtMs} paused={rent.status !== "running"} />
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {canPause(rent) && (
                <Button variant="ghost" className="flex-1 border border-border" disabled={mutating} onClick={() => mutate(pauseRent)}>
                  <Pause className="h-4 w-4" /> Pause
                </Button>
              )}
              {canResume(rent) && (
                <Button variant="ghost" className="flex-1 border border-border" disabled={mutating} onClick={() => mutate(resumeRent)}>
                  <Pause className="h-4 w-4" /> Resume
                </Button>
              )}
              {canCancel(rent) && (
                <Button
                  variant="ghost"
                  className="flex-1 border border-destructive/30 text-destructive hover:bg-destructive/10"
                  disabled={mutating}
                  onClick={() => mutate(cancelRent)}
                >
                  <Square className="h-4 w-4" /> Stop
                </Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
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
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${map[status]}`}
    >
      {status}
    </span>
  );
}
