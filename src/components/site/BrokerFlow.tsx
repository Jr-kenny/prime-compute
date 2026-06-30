import { motion } from "framer-motion";
import { Search, BarChart3, Route, Wallet, Shield, Activity } from "lucide-react";

/**
 * Visual representation of how the AI Broker layer processes a rent.
 * No personality, no chatter — just the infrastructure pipeline.
 */
const stages = [
  { icon: Search, name: "Discover", detail: "Scan registry for providers matching CPU/GPU/RAM/region/budget." },
  { icon: BarChart3, name: "Rank", detail: "Score candidates by Compute Score, latency, price, completion probability." },
  { icon: Route, name: "Route", detail: "Open stream to best match. Split across providers if the rent is too large." },
  { icon: Activity, name: "Monitor", detail: "Heartbeat, output checks, latency drift. Migrate on degradation." },
  { icon: Shield, name: "Verify", detail: "Cross-check delivered work against claimed specs. Flag mismatches." },
  { icon: Wallet, name: "Settle", detail: "Stream nanopayments per ms. Close the channel the instant the rent ends." },
];

export function BrokerFlow() {
  return (
    <div className="glass-card p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-glow">AI Broker Layer</div>
          <h3 className="mt-1 text-lg font-semibold">How a rent flows through the broker</h3>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> live pipeline
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        {stages.map((s, i) => (
          <motion.div
            key={s.name}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: i * 0.08 }}
            className="relative rounded-xl border border-border bg-surface/60 p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-glow ring-1 ring-primary/30">
                <s.icon className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs text-muted-foreground">0{i + 1}</span>
            </div>
            <div className="text-sm font-medium text-foreground">{s.name}</div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{s.detail}</p>
            {i < stages.length - 1 && (
              <div className="hidden lg:block absolute top-1/2 -right-2 h-px w-4 bg-gradient-to-r from-border to-transparent" />
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}