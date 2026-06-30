import { Link } from "@tanstack/react-router";
import { Cpu, MemoryStick, HardDrive, MapPin, Server, Zap } from "lucide-react";
import { ComputeScoreRing } from "./ComputeScoreRing";
import { Button } from "@/components/ui/button";
import type { Provider } from "@services/domain";

export function ProviderCard({ p, onRent }: { p: Provider; onRent?: (p: Provider) => void }) {
  const gpu = p.specs.gpu as string | undefined;
  const vramGb = p.specs.vramGb as number | undefined;
  const cpuCores = p.specs.cpuCores as number | undefined;
  const ramGb = p.specs.ramGb as number | undefined;
  const storageGb = p.specs.storageGb as number | undefined;
  const uptimePct = Math.min(100, Math.max(0, p.trust.signals.uptime * 100));

  return (
    <div className="glass-card glow-hover p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <span className="text-sm font-medium text-foreground">{p.alias}</span>
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {p.region}
            <span className="mx-1">·</span>
            {p.resourceType}
          </div>
        </div>
        <ComputeScoreRing score={p.computeScore} />
      </div>

      <div className="rounded-lg border border-border bg-dot-grid h-20 flex items-center justify-center">
        <Server className="h-6 w-6 text-muted-foreground" />
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={`h-1.5 w-1.5 rounded-full ${p.online ? "bg-success pulse-ring" : "bg-destructive"}`} />
        {p.online ? "online" : "offline"}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {gpu && (
          <div className="col-span-2 flex items-center gap-1.5 text-foreground">
            <Zap className="h-3.5 w-3.5 text-glow" />
            <span className="truncate">{gpu}</span>
            {vramGb !== undefined && <span className="text-muted-foreground">· {vramGb}GB VRAM</span>}
          </div>
        )}
        {cpuCores !== undefined && (
          <div className="flex items-center gap-1.5 text-muted-foreground"><Cpu className="h-3.5 w-3.5" />{cpuCores} cores</div>
        )}
        {ramGb !== undefined && (
          <div className="flex items-center gap-1.5 text-muted-foreground"><MemoryStick className="h-3.5 w-3.5" />{ramGb} GB</div>
        )}
        {storageGb !== undefined && (
          <div className="flex items-center gap-1.5 text-muted-foreground col-span-2"><HardDrive className="h-3.5 w-3.5" />{storageGb} GB SSD</div>
        )}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Rate</div>
          <div className="text-base font-semibold text-foreground">
            ${p.pricePerCharge.toFixed(7)}<span className="text-xs text-muted-foreground"> /sec</span>
          </div>
        </div>
        <div className="flex gap-1">
          <Pill>{uptimePct.toFixed(2)}%</Pill>
          <Pill>{p.trust.signals.successfulRentals.toLocaleString()} rents</Pill>
          <Pill>{p.avgLatencyMs.toFixed(1)}ms</Pill>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button asChild variant="ghost" size="sm" className="flex-1 border border-border hover:bg-card">
          <Link to="/marketplace/$id" params={{ id: p.id }}>Details</Link>
        </Button>
        <Button
          size="sm"
          className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
          disabled={!p.online}
          onClick={() => onRent?.(p)}
        >
          Rent
        </Button>
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="hidden md:inline-flex items-center rounded-full border border-border bg-surface/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {children}
    </span>
  );
}
