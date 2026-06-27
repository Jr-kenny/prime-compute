import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles, Layers, Activity, Wallet, Award, ChevronRight } from "lucide-react";
import { PageShell } from "@/components/site/PageShell";
import { SpaceBackground } from "@/components/site/SpaceBackground";
import { HeroAnimation } from "@/components/site/HeroAnimation";
import { BrokerFlow } from "@/components/site/BrokerFlow";
import { ProviderCard } from "@/components/site/ProviderCard";
import { StatCounter } from "@/components/site/StatCounter";
import { Button } from "@/components/ui/button";
import { providers } from "@/lib/mock-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Prime Compute — Rent compute. Pay per millisecond." },
      { name: "description", content: "The AI-brokered marketplace for idle GPUs, CPUs, and servers. Streaming nanopayments that stop the instant your job does." },
      { property: "og:title", content: "Prime Compute" },
      { property: "og:description", content: "Rent compute. Pay per millisecond." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <PageShell>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <SpaceBackground />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 pt-20 pb-24 md:pt-28 md:pb-32">
          <div className="flex flex-col items-center text-center">
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              Live on testnet
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="mt-6 text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight"
            >
              Rent compute. <br className="hidden md:block" />
              <span className="text-gradient-blue">Pay per millisecond.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
              className="mt-5 max-w-2xl text-base md:text-lg text-muted-foreground"
            >
              The AI-brokered marketplace for idle GPUs, CPUs, and servers. Streaming
              nanopayments that stop the instant your job does.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.3 }}
              className="mt-8 flex flex-wrap items-center justify-center gap-3"
            >
              <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_40px_-10px_color-mix(in_oklab,var(--color-glow)_80%,transparent)]">
                <Link to="/marketplace">Browse compute <ArrowRight className="h-4 w-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="border border-border hover:bg-card">
                <Link to="/register">List your server</Link>
              </Button>
            </motion.div>

            <div className="mt-16 w-full">
              <HeroAnimation />
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="relative border-y border-border/60 bg-surface/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { v: 12847, suf: "", lbl: "Providers online" },
            { v: 0.00001, dec: 5, pre: "$", suf: " /sec", lbl: "Minimum rate" },
            { v: 99.97, dec: 2, suf: "%", lbl: "Uptime SLA" },
            { v: 8, suf: "ms", lbl: "Broker match time" },
          ].map((s, i) => (
            <div key={i} className="text-center md:text-left">
              <div className="text-3xl md:text-4xl font-semibold text-gradient-blue">
                <StatCounter value={s.v} prefix={s.pre} suffix={s.suf} decimals={s.dec ?? 0} />
              </div>
              <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{s.lbl}</div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-20">
        <SectionHeader eyebrow="How it works" title="From idle hardware to running job in seconds" />
        <div className="mt-10 grid md:grid-cols-3 gap-6 relative">
          {[
            { n: "01", t: "Register or browse", d: "Providers list hardware specs, region, and a per-second rate. Consumers submit a job with budget and resource requirements." },
            { n: "02", t: "AI broker matches", d: "The broker discovers providers, ranks them by Compute Score and price, and opens a streaming payment channel." },
            { n: "03", t: "Pay as you compute", d: "Nanopayments stream per millisecond. Cancel anytime — the meter freezes and you only pay for what ran." },
          ].map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.1 }}
              className="glass-card glow-hover p-6"
            >
              <div className="text-xs text-glow font-mono">{s.n}</div>
              <h3 className="mt-2 text-lg font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{s.d}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* BROKER FLOW */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 pb-20">
        <BrokerFlow />
      </section>

      {/* LAYERS */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 pb-20">
        <SectionHeader eyebrow="System layers" title="Four layers, one open compute marketplace" />
        <div className="mt-10 grid md:grid-cols-2 gap-4">
          {[
            { icon: Layers, t: "Marketplace layer", d: "Open provider registry, job submission, and hardware-spec matching. On-chain so it stays trustless." },
            { icon: Sparkles, t: "AI broker layer", d: "Discovers, ranks, routes, splits, migrates, and rebalances jobs in real time. Detects fraudulent hardware." },
            { icon: Wallet, t: "Streaming settlement", d: "Nanopayments per ms via Circle. Instant pause, resume, and refund on cancellation or failure." },
            { icon: Award, t: "Reputation layer", d: "On-chain Compute Score from uptime, benchmarks, completed jobs, and verified specs. Bad actors get deprioritized." },
          ].map((l) => (
            <div key={l.t} className="glass-card glow-hover p-6">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-glow ring-1 ring-primary/30">
                  <l.icon className="h-4 w-4" />
                </span>
                <h3 className="font-semibold">{l.t}</h3>
              </div>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{l.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PROVIDER SHOWCASE */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 pb-20">
        <div className="flex items-end justify-between mb-8">
          <SectionHeader eyebrow="Available right now" title="What's online on the network" align="left" />
          <Link to="/marketplace" className="hidden sm:inline-flex items-center text-sm text-glow hover:text-foreground">
            Open marketplace <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="relative overflow-hidden group">
          <div className="flex gap-4 animate-[scroll_40s_linear_infinite] group-hover:[animation-play-state:paused]" style={{ width: "max-content" }}>
            {[...providers.slice(0, 6), ...providers.slice(0, 6)].map((p, i) => (
              <div key={i} className="w-[320px] shrink-0">
                <ProviderCard p={p} />
              </div>
            ))}
          </div>
        </div>
        <style>{`@keyframes scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 pb-20">
        <div className="relative overflow-hidden rounded-2xl border border-border p-10 md:p-14 text-center bg-gradient-to-br from-primary/30 via-surface to-background">
          <div className="absolute inset-0 bg-grid opacity-[0.06]" />
          <div className="relative">
            <h2 className="text-3xl md:text-4xl font-bold">Got idle hardware? Turn it into yield.</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
              List your server in under three minutes. Earn streaming USDC the moment a job lands.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Link to="/register">List your server <ArrowRight className="h-4 w-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="border border-border">
                <Link to="/docs">Read the docs</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}

function SectionHeader({ eyebrow, title, align = "center" }: { eyebrow: string; title: string; align?: "left" | "center" }) {
  return (
    <div className={align === "center" ? "text-center" : ""}>
      <div className="text-[11px] uppercase tracking-wider text-glow">{eyebrow}</div>
      <h2 className="mt-2 text-2xl md:text-4xl font-bold tracking-tight">{title}</h2>
    </div>
  );
}
