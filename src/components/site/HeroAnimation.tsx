import { motion } from "framer-motion";
import { Activity, Cpu, Zap, Globe2, CheckCircle2 } from "lucide-react";
import { StreamingTicker } from "./StreamingTicker";
import { ComputeScoreRing } from "./ComputeScoreRing";

const nodes = [
  { name: "node-astral-7", region: "US-East", score: 98, rate: 0.0000124, gpu: "H100" },
  { name: "node-orion-2", region: "EU-West", score: 94, rate: 0.0000091, gpu: "A100" },
  { name: "node-nebula-5", region: "Asia-Pac", score: 91, rate: 0.0000077, gpu: "L40S" },
];

export function HeroAnimation() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="relative w-full max-w-5xl mx-auto"
    >
      <div className="glass-card p-4 md:p-6 shadow-[0_30px_120px_-30px_color-mix(in_oklab,var(--color-glow)_50%,transparent)]">
        {/* fake window chrome */}
        <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
            <span className="ml-3 text-xs text-muted-foreground">primecompute://broker/live</span>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            Broker online · 8ms
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Provider grid */}
          <div className="md:col-span-2 space-y-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Globe2 className="h-3 w-3" /> Available providers
            </div>
            <div className="grid gap-2">
              {nodes.map((n, i) => (
                <motion.div
                  key={n.name}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + i * 0.15 }}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface/60 px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <ComputeScoreRing score={n.score} size={36} />
                    <div>
                      <div className="text-sm text-foreground">{n.name}</div>
                      <div className="text-[10px] text-muted-foreground">{n.region} · {n.gpu}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-foreground">${n.rate.toFixed(7)}<span className="text-muted-foreground">/s</span></div>
                    {i === 0 && (
                      <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-success">
                        <CheckCircle2 className="h-3 w-3" /> Matched
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Live job panel */}
          <div className="rounded-lg border border-border bg-surface/60 p-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Live job</div>
              <span className="inline-flex items-center gap-1 text-[10px] text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success pulse-ring" /> running
              </span>
            </div>
            <div>
              <div className="text-sm text-foreground">llama-3-fine-tune</div>
              <div className="text-[10px] text-muted-foreground">on node-astral-7</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Streaming spend</div>
              <StreamingTicker
                ratePerSecond={0.0000124}
                startedAt={Date.now() - 1000 * 92}
                className="text-xl font-semibold text-gradient-blue"
              />
              <div className="mt-0.5 text-[10px] text-muted-foreground">paid per millisecond · pauses instantly</div>
            </div>
            <div className="space-y-1.5">
              <Bar label="CPU" value={78} icon={<Cpu className="h-3 w-3" />} />
              <Bar label="MEM" value={62} icon={<Activity className="h-3 w-3" />} />
              <Bar label="NET" value={41} icon={<Zap className="h-3 w-3" />} />
            </div>
          </div>
        </div>

        {/* Broker pipeline strip */}
        <div className="mt-4 grid grid-cols-4 gap-2 text-[10px]">
          {["Discover", "Rank", "Route", "Settle"].map((step, i) => (
            <motion.div
              key={step}
              initial={{ opacity: 0.4 }}
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.5 }}
              className="rounded-md border border-border bg-surface/50 px-2 py-1.5 text-center text-muted-foreground"
            >
              {step}
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function Bar({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">{icon}{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-1 w-full rounded-full bg-border overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 1.2, delay: 0.8 }}
          className="h-full bg-gradient-to-r from-accent to-glow"
        />
      </div>
    </div>
  );
}