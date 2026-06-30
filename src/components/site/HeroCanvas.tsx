import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MousePointer2 } from "lucide-react";
import { navLinks } from "./Sidebar";

type View = "/marketplace" | "/dashboard";

export function HeroCanvas() {
  const [view, setView] = useState<View>("/marketplace");

  useEffect(() => {
    const id = setInterval(() => {
      setView((v) => (v === "/marketplace" ? "/dashboard" : "/marketplace"));
    }, 3200);
    return () => clearInterval(id);
  }, []);

  const activeIndex = navLinks.findIndex((l) => l.to === view);

  return (
    <div className="relative w-full max-w-5xl mx-auto rounded-2xl overflow-hidden border border-border bg-card">
      {/* Browser chrome */}
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-border bg-surface/60">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 text-[11px] text-muted-foreground font-mono">
          primecompute.app{view}
        </span>
      </div>

      {/* App body: mirrors the real Sidebar + content layout */}
      <div className="relative grid grid-cols-[200px_1fr] gap-3 p-4 min-h-[320px]">
        {/* Sidebar nav, structure mirrors components/site/Sidebar.tsx */}
        <aside className="rounded-lg bg-sidebar border border-sidebar-border p-3">
          <div className="flex items-center gap-2 px-1 pb-3 mb-2 border-b border-sidebar-border">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-glow text-[10px] font-semibold">
              PC
            </span>
            <span className="text-xs font-semibold text-white truncate">Prime Compute</span>
          </div>
          <nav className="flex flex-col gap-1">
            {navLinks.map((l) => {
              const active = l.to === view;
              const Icon = l.icon;
              return (
                <div
                  key={l.to}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-full text-xs transition ${
                    active ? "bg-sidebar-accent text-white" : "text-sidebar-foreground/55"
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${active ? "text-glow" : ""}`} />
                  <span>{l.label}</span>
                </div>
              );
            })}
          </nav>
        </aside>

        {/* Content area: crossfades between two simplified product views */}
        <div className="relative rounded-lg border border-border bg-surface/40 overflow-hidden">
          <AnimatePresence mode="wait">
            {view === "/dashboard" ? (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="absolute inset-0 p-5"
              >
                <div className="text-[10px] uppercase tracking-wider text-glow">Consumer</div>
                <div className="mt-1 text-lg font-semibold text-foreground">Dashboard</div>
                <div className="mt-4 rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground">llama-fine-tune</span>
                    <span className="inline-flex items-center gap-1 text-success">
                      <span className="h-1.5 w-1.5 rounded-full bg-success pulse-ring" />
                      running
                    </span>
                  </div>
                  <div className="mt-2 font-mono text-sm text-foreground">$0.00018420</div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="marketplace"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="absolute inset-0 p-5"
              >
                <div className="text-[10px] uppercase tracking-wider text-glow">Marketplace</div>
                <div className="mt-1 text-lg font-semibold text-foreground">
                  Compute Marketplace
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {["node-astral-1", "node-cygnus-8"].map((alias) => (
                    <div key={alias} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-center gap-1.5 text-xs text-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        {alias}
                      </div>
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        H100 · $0.0000045/s
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Simulated cursor: animates to the active nav item's row */}
        <motion.div
          className="pointer-events-none absolute z-20 text-foreground"
          animate={{ top: 64 + activeIndex * 34, left: 20 }}
          transition={{ type: "spring", stiffness: 120, damping: 18 }}
        >
          <MousePointer2 className="h-4 w-4" />
        </motion.div>
      </div>

      {/* Status line */}
      <div className="mx-4 mb-4 px-3 py-2.5 rounded-lg bg-primary/10 border border-primary/15 font-mono text-[11px] text-muted-foreground flex items-center gap-2">
        <span className="text-success">▸</span>
        broker matched inference-gpu-01 (compute score: 942) · streaming USDC @ $0.00001/sec
      </div>
    </div>
  );
}
