import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type StatusTone = "success" | "warning" | "destructive" | "neutral";

const DOT_CLASS: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  neutral: "bg-muted-foreground",
};

/**
 * Click-to-open tile for something live and running (an active rent, a
 * server). Shows a name/subtitle header, a dotted-grid preview area with a
 * centered icon, and a bottom status row. Clicking opens the caller's detail
 * panel — this component carries no control buttons itself.
 */
export function OperationalTile({
  title,
  subtitle,
  icon: Icon,
  statusLabel,
  statusTone = "neutral",
  pulse = false,
  onClick,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  statusLabel: string;
  statusTone?: StatusTone;
  pulse?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="glass-card glow-hover w-full text-left flex flex-col overflow-hidden"
    >
      <div className="px-5 py-4">
        <div className="text-sm font-medium truncate">{title}</div>
        <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
      </div>
      <div className="mx-5 mb-4 rounded-lg border border-border bg-dot-grid h-28 flex items-center justify-center">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="flex items-center gap-1.5 border-t border-border px-5 py-3 text-xs text-muted-foreground">
        <span className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASS[statusTone], pulse && "pulse-ring")} />
        <span>{statusLabel}</span>
      </div>
    </button>
  );
}
