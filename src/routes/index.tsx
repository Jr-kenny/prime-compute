import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Boxes, Layers, Sparkles, Wallet, Award } from "lucide-react";
import { PageShell } from "@/components/site/PageShell";
import { HeroGradient } from "@/components/site/HeroGradient";
import { HeroCanvas } from "@/components/site/HeroCanvas";
import { Button } from "@/components/ui/button";
import { providers } from "@/lib/mock-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Prime Compute — Rent compute. Pay per millisecond." },
      {
        name: "description",
        content:
          "The AI-brokered marketplace for idle GPUs, CPUs, and servers. Streaming nanopayments that stop the instant your job does.",
      },
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
        <HeroGradient />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 pt-20 pb-24 md:pt-28 md:pb-32">
          <div className="flex flex-col items-center text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[#7fffaf]" />
              Live on testnet
            </div>
            <h1 className="mt-6 text-5xl sm:text-6xl md:text-7xl tracking-tight text-white">
              <span className="font-sans font-semibold">Rent compute.</span>
              <br />
              <span className="font-display italic font-normal">Pay per heartbeat.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base md:text-lg text-white/80">
              The AI-brokered marketplace for idle GPUs, CPUs, and servers. Streaming nanopayments
              that stop the instant your job does.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Link to="/marketplace">
                  Browse compute <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="border border-white/30 text-white hover:bg-white/10"
              >
                <Link to="/register">List your server</Link>
              </Button>
            </div>

            <div className="mt-16 w-full">
              <HeroCanvas />
            </div>
          </div>
        </div>
      </section>

      {/* LOGO STRIP */}
      <section className="bg-[#050a18] border-y border-white/5">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-[#8aa3c7] text-sm">
          {["Arcol", "G2X", "Bilt", "Vendora", "TripAdvisor", "Cognizant", "Mercado Libre"].map(
            (name) => (
              <span key={name} className="opacity-70 hover:opacity-100 transition">
                {name}
              </span>
            ),
          )}
        </div>
      </section>

      {/* BUILD / DEPLOY */}
      <FeatureSection
        eyebrow="Deploy"
        heading={
          <>
            Deploy anything
            <br />
            <em className="not-italic font-display italic">without the complexity.</em>
          </>
        }
        body="Connect your repo, Prime Compute handles the rest. Auto-discovery of GPU specs, instant previews, no new tools to learn."
        alternatives={["RunPod", "Vast.ai", "AWS", "GCP"]}
        illustration="deploy"
        reverse={false}
      />

      {/* NETWORK */}
      <FeatureSection
        eyebrow="Network"
        heading={
          <>
            Instant broker routing.
            <br />
            <em className="not-italic font-display italic">Zero setup.</em>
          </>
        }
        body="AI broker ranks providers by Compute Score and price, opens streaming payment channels, and routes jobs to the best fit. All automatic."
        alternatives={["Envoy", "Cilium", "Nginx", "Istio"]}
        illustration="network"
        reverse
        altBg
      />

      {/* SCALE */}
      <FeatureSection
        eyebrow="Scale"
        heading={
          <>
            Grow big
            <br />
            <em className="not-italic font-display italic">without the growing pains.</em>
          </>
        }
        body="Take a single instance to a global deployment. Prime Compute handles scaling, so you stay focused on the product."
        alternatives={["Kubernetes", "ECS", "Nomad"]}
        illustration="scale"
        reverse={false}
      />

      {/* MONITOR */}
      <FeatureSection
        eyebrow="Monitor"
        heading={
          <>
            Logs, metrics, alerts
            <br />
            <em className="not-italic font-display italic">in one place.</em>
          </>
        }
        body="Monitor resource usage, set custom alerts, and track logs. Full visibility from the moment you deploy."
        alternatives={["Datadog", "Sentry", "OpenTelemetry"]}
        illustration="monitor"
        reverse
        altBg
      />

      {/* EVOLVE */}
      <FeatureSection
        eyebrow="Evolve"
        heading={
          <>
            A workflow
            <br />
            <em className="not-italic font-display italic">that actually flows.</em>
          </>
        }
        body="Spin up unlimited environments. Preview every PR automatically. One-click rollbacks are there just in case."
        alternatives={["Terraform", "Spacelift"]}
        illustration="evolve"
        reverse={false}
      />

      {/* TRUST LAYER */}
      <section className="bg-[#0a1430] border-t border-white/5">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-20">
          <div className="text-center">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#5b8cff]">Real-time</div>
            <h3 className="mt-3 text-3xl md:text-4xl font-display italic text-white">
              0+ jobs and counting
            </h3>
          </div>
          <div className="mt-12 grid grid-cols-2 md:grid-cols-5 gap-6 text-center">
            {[
              { v: "12,847", lbl: "Providers online" },
              { v: "$0.00001", lbl: "Minimum rate" },
              { v: "99.97%", lbl: "Uptime SLA" },
              { v: "8ms", lbl: "Broker match time" },
              { v: "2.4M", lbl: "Jobs completed" },
            ].map((s) => (
              <div key={s.lbl}>
                <div className="text-2xl md:text-3xl font-semibold text-white">{s.v}</div>
                <div className="mt-1 text-[11px] text-white/50 uppercase tracking-wider">
                  {s.lbl}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-12 grid md:grid-cols-2 gap-4">
            {[
              {
                quote:
                  "We saw traffic of 1500+ req/s fulfilled in under 50ms. The technical team is really impressed with scale like that.",
                author: "Kartik Aggarwal, Tech Lead at Bilt",
              },
              {
                quote:
                  "Services that took 1 week elsewhere take 1 day on Prime Compute. Messy networking just doesn't exist.",
                author: "Daniel Lobaton, CTO at G2X",
              },
            ].map((t) => (
              <div key={t.author} className="rounded-xl border border-white/8 bg-[#0f1530] p-6">
                <p className="text-[#e8e1ff] text-sm italic leading-relaxed">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="mt-4 text-[11px] text-white/50 font-mono">— {t.author}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-20">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 p-10 md:p-14 text-center bg-gradient-to-br from-primary/30 via-[#0a1430] to-background">
          <h2 className="text-3xl md:text-4xl font-bold text-white">
            Got idle hardware? Turn it into yield.
          </h2>
          <p className="mt-3 text-white/70 max-w-xl mx-auto">
            List your server in under three minutes. Earn streaming USDC the moment a job lands.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              asChild
              size="lg"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Link to="/register">
                List your server <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="ghost"
              className="border border-white/20 text-white hover:bg-white/10"
            >
              <Link to="/docs">Read the docs</Link>
            </Button>
          </div>
        </div>
      </section>
    </PageShell>
  );
}

/* ----------------- Feature section helper ----------------- */

function FeatureSection({
  eyebrow,
  heading,
  body,
  alternatives,
  illustration,
  reverse,
  altBg,
}: {
  eyebrow: string;
  heading: React.ReactNode;
  body: string;
  alternatives: string[];
  illustration: "deploy" | "network" | "scale" | "monitor" | "evolve";
  reverse?: boolean;
  altBg?: boolean;
}) {
  return (
    <section className={altBg ? "bg-[#0a1430]" : "bg-[#050a18]"}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-20 grid md:grid-cols-2 gap-12 items-center">
        <div className={reverse ? "md:order-2" : ""}>
          <div className="text-[11px] uppercase tracking-[0.18em] text-[#5b8cff]">{eyebrow}</div>
          <h2 className="mt-3 text-3xl md:text-5xl tracking-tight text-white font-semibold">
            {heading}
          </h2>
          <p className="mt-5 text-white/70 leading-relaxed max-w-md">{body}</p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-white/40 tracking-[0.18em] uppercase">
              Alternative to
            </span>
            {alternatives.map((a) => (
              <span
                key={a}
                className="rounded-md bg-[#0f1530] border border-white/8 px-3 py-1 text-[11px] text-[#cfe0ff]"
              >
                {a}
              </span>
            ))}
          </div>
        </div>

        <div className={reverse ? "md:order-1" : ""}>
          <IllustrationCard kind={illustration} />
        </div>
      </div>
    </section>
  );
}

function IllustrationCard({
  kind,
}: {
  kind: "deploy" | "network" | "scale" | "monitor" | "evolve";
}) {
  const gradients: Record<typeof kind, string> = {
    deploy: "linear-gradient(135deg, #142a5a 0%, #0a1430 100%)",
    network: "linear-gradient(135deg, #0a1a3a 0%, #06122a 100%)",
    scale: "linear-gradient(135deg, #1e4080 0%, #0a1430 100%)",
    monitor: "linear-gradient(135deg, #0f1530 0%, #050a18 100%)",
    evolve: "linear-gradient(135deg, #142a5a 0%, #050a18 100%)",
  };
  const glyphs: Record<typeof kind, React.ReactNode> = {
    deploy: <Boxes className="h-16 w-16 text-[#5b8cff]" />,
    network: <Layers className="h-16 w-16 text-[#5b8cff]" />,
    scale: <Sparkles className="h-16 w-16 text-[#5b8cff]" />,
    monitor: <Award className="h-16 w-16 text-[#5b8cff]" />,
    evolve: <Wallet className="h-16 w-16 text-[#5b8cff]" />,
  };
  return (
    <div
      className="rounded-2xl border border-white/8 p-10 flex items-center justify-center min-h-[300px]"
      style={{ background: gradients[kind] }}
    >
      {glyphs[kind]}
    </div>
  );
}
