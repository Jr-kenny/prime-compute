import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import confetti from "canvas-confetti";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { supabaseBrowser } from "@/lib/supabase/client";
import { createRent, getMyRent } from "@/lib/broker/server-fns";
import { rentPhase } from "@/lib/broker/rent-phase";
import { rateDisplay } from "@/lib/pricing/rate";
import type { Provider, Rent } from "@services/domain";

export function RentSheet({ provider, onClose }: { provider: Provider | null; onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(15);
  const [submitting, setSubmitting] = useState(false);
  const [rentId, setRentId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const budget = provider ? (duration * 60 * provider.pricePerCharge).toFixed(4) : "0";
  const gpu = provider?.specs.gpu as string | undefined;
  const vramGb = provider?.specs.vramGb as number | undefined;
  const cpuCores = provider?.specs.cpuCores as number | undefined;
  const ramGb = provider?.specs.ramGb as number | undefined;

  const { data: liveRent } = useQuery({
    queryKey: ["rent", rentId],
    queryFn: () => getMyRent({ data: { accessToken: accessToken!, rentId: rentId! } }),
    enabled: !!rentId && !!accessToken,
    // Self-stopping: poll while active, stop on terminal, back off before the first payload.
    refetchInterval: (query) => {
      const rent = query.state.data as Rent | null | undefined;
      if (!rent) return 5000;
      switch (rent.status) {
        case "queued":
        case "running":
        case "suspended":
          return 3000;
        default:
          return false;
      }
    },
  });

  function reset() {
    onClose();
    setRentId(null);
    setName("");
    setAccessToken(null);
  }

  async function submit() {
    const { data } = await supabaseBrowser.auth.getSession();
    if (!data.session || !provider) {
      router.navigate({ to: "/onboarding", search: { redirect: router.state.location.pathname } });
      return;
    }
    setSubmitting(true);
    try {
      const created = await createRent({
        data: {
          accessToken: data.session.access_token,
          name,
          spec: { resourceType: provider.resourceType, region: provider.region, preferredProviderId: provider.id },
          estimatedUsage: duration * 60,
        },
      });
      queryClient.setQueryData(["rent", created.id], created); // render instantly, don't wait a poll
      setAccessToken(data.session.access_token);
      setRentId(created.id);
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.4 } });
    } finally {
      setSubmitting(false);
    }
  }

  const phase = liveRent ? rentPhase(liveRent, provider ?? undefined) : null;

  return (
    <Sheet open={!!provider} onOpenChange={(o) => { if (!o) reset(); }}>
      <SheetContent className="bg-surface border-border">
        <SheetHeader>
          <SheetTitle>Rent{provider ? ` from ${provider.alias}` : ""}</SheetTitle>
        </SheetHeader>

        {provider && !rentId && (
          <div className="mt-6 space-y-5">
            <div>
              <Label>Rent name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. llama-fine-tune"
                className="mt-2 bg-card border-border"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Stat label="GPU" value={gpu ?? "—"} />
              <Stat label="VRAM" value={vramGb ? `${vramGb} GB` : "—"} />
              <Stat label="CPU" value={cpuCores ? `${cpuCores} cores` : "—"} />
              <Stat label="RAM" value={ramGb ? `${ramGb} GB` : "—"} />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label>Estimated duration</Label>
                <span className="text-sm text-foreground">{duration} min</span>
              </div>
              <Slider
                className="mt-3"
                value={[duration]}
                min={1}
                max={240}
                step={1}
                onValueChange={(v) => setDuration(v[0])}
              />
            </div>
            <div className="glass-card p-4">
              <div className="text-xs text-muted-foreground">Estimated max budget</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">${budget}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                at {rateDisplay(provider.resourceType, provider.pricePerCharge).streaming} ({rateDisplay(provider.resourceType, provider.pricePerCharge).human}) · metered per unit, only pay for what runs
              </div>
            </div>
            <SheetFooter>
              <Button
                onClick={submit}
                disabled={submitting || !name}
                className="w-full bg-primary text-primary-foreground"
              >
                {submitting ? `Starting on ${provider.alias}…` : "Submit rent"}
              </Button>
            </SheetFooter>
          </div>
        )}

        {rentId && (
          <div className="mt-6 space-y-5">
            <div className="glass-card p-4 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</div>
              <div className="text-lg font-semibold text-foreground">{phase?.title ?? "Loading…"}</div>
              <p className="text-sm text-muted-foreground">{phase?.description ?? "Fetching your lease…"}</p>
            </div>

            {phase?.canConnect && liveRent && (
              <div className="glass-card p-4 space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Connect</div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Endpoint</span>
                    <span className="font-mono truncate">{provider?.endpointUrl ?? "—"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Access token</span>
                    <span className="font-mono truncate">{liveRent.leaseAccessToken}</span>
                  </div>
                </div>
              </div>
            )}

            {phase?.phase === "running" && !phase.canConnect && (
              <div className="glass-card p-4 text-xs text-muted-foreground">
                Cannot connect · provider unavailable
              </div>
            )}

            {liveRent && (
              <div className="text-xs text-muted-foreground">
                Charged so far{" "}
                <span className="font-mono text-foreground">${(liveRent.totalCost / 1_000_000).toFixed(6)}</span>
              </div>
            )}

            <Button onClick={reset} variant="ghost" className="w-full border border-border">
              Close
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card/60 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground truncate">{value}</div>
    </div>
  );
}
