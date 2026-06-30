import { Link } from "@tanstack/react-router";
import { Cpu, MemoryStick, HardDrive, MapPin, Zap } from "lucide-react";
import { ComputeScoreRing } from "./ComputeScoreRing";
import { Button } from "@/components/ui/button";
import type { Provider } from "@/lib/mock-data";

export function ProviderCard({ p, onRent }: { p: Provider; onRent?: (p: Provider) => void }) {
  return (
    <div className="glass-card glow-hover p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${p.online ? "bg-success pulse-ring" : "bg-destructive"}`}
            />
            <span className="text-sm font-medium text-foreground">{p.alias}</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {p.region}
            <span className="mx-1">·</span>
            {p.resourceType}
          </div>
        </div>
        <ComputeScoreRing score={p.computeScore} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {p.gpu && (
          <div className="col-span-2 flex items-center gap-1.5 text-foreground">
            <Zap className="h-3.5 w-3.5 text-glow" />
            <span className="truncate">{p.gpu}</span>
            <span className="text-muted-foreground">· {p.vramGb}GB VRAM</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-muted-foreground"><Cpu className="h-3.5 w-3.5" />{p.cpuCores} cores</div>
        <div className="flex items-center gap-1.5 text-muted-foreground"><MemoryStick className="h-3.5 w-3.5" />{p.ramGb} GB</div>
        <div className="flex items-center gap-1.5 text-muted-foreground col-span-2"><HardDrive className="h-3.5 w-3.5" />{p.storageGb} GB SSD</div>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Rate</div>
          <div className="text-base font-semibold text-foreground">
            ${p.pricePerSecond.toFixed(7)}<span className="text-xs text-muted-foreground"> /sec</span>
          </div>
        </div>
        <div className="flex gap-1">
          <Pill>{p.uptime.toFixed(2)}%</Pill>
          <Pill>{p.jobsCompleted.toLocaleString()} jobs</Pill>
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