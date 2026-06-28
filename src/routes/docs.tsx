import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/site/AppShell";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Docs — Prime Compute" },
      { name: "description", content: "How Prime Compute works: marketplace, AI broker, streaming settlement, and Compute Score." },
    ],
  }),
  component: Docs,
});

const sections = [
  { id: "start", title: "Getting started" },
  { id: "pricing", title: "How pricing works" },
  { id: "broker", title: "The AI broker" },
  { id: "settlement", title: "Streaming payments" },
  { id: "reputation", title: "Reputation & Compute Score" },
  { id: "api", title: "API reference" },
];

function Docs() {
  const [active, setActive] = useState("start");
  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10 grid lg:grid-cols-[220px_1fr] gap-10">
        <aside className="lg:sticky lg:top-24 self-start">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Docs</div>
          <nav className="space-y-1">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={() => setActive(s.id)}
                className={cn(
                  "block rounded-md px-3 py-1.5 text-sm transition",
                  active === s.id ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.title}
              </a>
            ))}
          </nav>
        </aside>

        <article className="prose prose-invert max-w-none space-y-12">
          <Section id="start" title="Getting started">
            <p>Prime Compute is an open marketplace for renting computing power. Anyone with idle hardware can register as a provider, and anyone with a workload can submit a job and pay only for the milliseconds they consume.</p>
            <p>There are two starting paths: <strong>browse compute</strong> if you need to run a job, or <strong>list your server</strong> if you have hardware sitting idle. Both flows take under three minutes.</p>
          </Section>

          <Section id="pricing" title="How pricing works">
            <p>Every provider sets its own per-second rate in USDC. When a consumer submits a job, the broker picks the cheapest matching provider that still clears the consumer's quality bar (Compute Score, latency, region).</p>
            <p>Settlement is streamed per millisecond. If a 1-hour job lists at <code>$0.0000098/s</code>, you'd pay roughly <code>$0.035</code> for the hour — but if you cancel after 12 minutes, you only pay for those 12 minutes. The unused allocation refunds back to your wallet immediately.</p>
          </Section>

          <Section id="broker" title="The AI broker">
            <p>The broker is the routing layer between consumers and providers. It is not a chatbot. It has no personality and runs no reasoning loops you can talk to. It is plumbing.</p>
            <p>Its job is to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Discover</strong> providers in the on-chain registry that match your job's hardware, region, and budget.</li>
              <li><strong>Rank</strong> them by Compute Score, predicted completion probability, latency, and price.</li>
              <li><strong>Route</strong> the workload, opening a streaming payment channel to the winning provider. For oversized jobs it splits the workload across multiple providers.</li>
              <li><strong>Monitor</strong> heartbeat, output quality, and latency drift while the job runs.</li>
              <li><strong>Migrate</strong> the job to another provider if the current one degrades or goes offline. The payment stream follows the job.</li>
              <li><strong>Verify</strong> delivered work against the provider's claimed hardware and flag mismatches on its reputation record.</li>
              <li><strong>Settle</strong> by closing the payment channel the instant the job finishes, is cancelled, or fails.</li>
            </ul>
          </Section>

          <Section id="settlement" title="Streaming payments">
            <p>Payments are streamed via Circle-backed nanopayment rails. The meter ticks per millisecond while a job is running and freezes the moment you pause, cancel, or the provider drops the heartbeat. Providers eat the loss for undelivered compute; consumers never pay for time they didn't use.</p>
            <p>There is no monthly bill and no holds on your card. You fund a USDC balance, and the streamed spend draws against it in real time.</p>
          </Section>

          <Section id="reputation" title="Reputation & Compute Score">
            <p>Every provider has a <strong>Compute Score</strong> from 0 to 100, computed from observed uptime, benchmark results, completed-job ratio, cancellation rate, latency, network throughput, and verified hardware claims. The score is on-chain and the broker weights it heavily when ranking matches.</p>
            <p>Faking specs or accepting jobs you can't finish costs you score immediately, and consumers can filter for a minimum score on the marketplace. There's no review system to game; the score is derived from measured behavior.</p>
          </Section>

          <Section id="api" title="API reference">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-border rounded-md">
                <thead className="bg-card/50">
                  <tr><th className="text-left p-3">Endpoint</th><th className="text-left p-3">Method</th><th className="text-left p-3">Purpose</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr><td className="p-3 font-mono text-xs">/v1/providers</td><td className="p-3">GET</td><td className="p-3">List providers in the registry</td></tr>
                  <tr><td className="p-3 font-mono text-xs">/v1/jobs</td><td className="p-3">POST</td><td className="p-3">Submit a job with requirements + budget</td></tr>
                  <tr><td className="p-3 font-mono text-xs">/v1/jobs/:id</td><td className="p-3">GET</td><td className="p-3">Fetch live status, spend, and provider</td></tr>
                  <tr><td className="p-3 font-mono text-xs">/v1/jobs/:id/cancel</td><td className="p-3">POST</td><td className="p-3">Stop the job and freeze the stream</td></tr>
                  <tr><td className="p-3 font-mono text-xs">/v1/streams/:id</td><td className="p-3">GET</td><td className="p-3">Read current settled vs streamed amounts</td></tr>
                </tbody>
              </table>
            </div>
          </Section>
        </article>
      </div>
    </AppShell>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-2xl font-bold">{title}</h2>
      <div className="mt-4 space-y-3 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}