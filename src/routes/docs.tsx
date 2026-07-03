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
  { id: "list", title: "List a service" },
  { id: "rent", title: "Rent a service" },
  { id: "pricing", title: "How pricing works" },
  { id: "broker", title: "The AI broker" },
  { id: "settlement", title: "Streaming payments" },
  { id: "types", title: "Service types" },
  { id: "api", title: "API & MCP reference" },
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
            <p>Prime Compute is an open marketplace for renting real services: GPU, CPU, and full servers, plus storage, VPN, and workers. Connect a wallet to sign in (RainbowKit + SIWE). Signing in provisions a spend wallet the platform custodies for you: fund it with USDC and it pays for rents automatically as they stream. From there you can rent a service or list one of your own.</p>
          </Section>

          <Section id="list" title="List a service">
            <p>Listing means running your own service endpoint and registering it so the broker can route renters to you.</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Run your service behind a public HTTPS endpoint. For compute this is an x402 seller that charges per unit (use the provider server template in <code>services/</code> as a starting point); the endpoint is where renters and the meter reach you.</li>
              <li>Pick a per-unit price. You keep every payment: settlement lands directly in the wallet your endpoint signs with. Prime Compute never holds your earnings.</li>
              <li>Register the service: on <a href="/register">List a server</a>, or for agents <code>POST /api/v1/providers</code> with your alias, endpoint URL, region, price, and type-specific specs.</li>
              <li>Stay online. The broker only routes to reachable, healthy endpoints; your Compute Score reflects real behavior.</li>
            </ol>
          </Section>

          <Section id="rent" title="Rent a service">
            <p>Renting gives you real credentials to a real service.</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Fund your spend wallet with USDC (the wallet panel shows your address and a faucet).</li>
              <li>Rent: pick a listing on the <a href="/marketplace">marketplace</a>, or for agents <code>POST /api/v1/rents</code>. The broker matches you a provider and the lease goes live.</li>
              <li>Use what you get. The connect payload depends on the type: SSH host + credentials for compute, a WireGuard profile for VPN, a bucket URL + keys for storage, a submit URL + token for a worker. Connect to the provider directly with those, exactly as you would any real server or service.</li>
              <li>Pay as it runs. The meter streams USDC per unit from your spend wallet; you only pay for what actually runs, and stopping the lease stops the charges.</li>
            </ol>
          </Section>

          <Section id="pricing" title="How pricing works">
            <p>Every service is priced per unit and metered as it runs. Time-based services (GPU, CPU, full servers, workers) are priced per second, so we also show an exact per-day figure. Volume services show an honest per-unit rate with an example: VPN is per GB (shown as a cost per 100 GB), storage is per GB-hour (shown as a cost per GB-day). A "charge" is one unit at the listed price; your budget is a count of units, so you always know the ceiling.</p>
          </Section>

          <Section id="broker" title="The AI broker">
            <p>An AI broker matches each rent to a provider by reasoning over the live listings against what you asked for. It is soul-driven, not a hardcoded score: its behavior comes from a policy it reasons from, with a deterministic fallback so a model outage never blocks a rent.</p>
          </Section>

          <Section id="settlement" title="Streaming payments">
            <p>Payments settle per unit over x402 on Arc. Each unit is one micro-payment from your custodied spend wallet to the provider's endpoint, recorded as a charge. There is no upfront lump sum and no lock-in: an idle lease accrues nothing, and cancelling stops the stream immediately.</p>
          </Section>

          <Section id="types" title="Service types">
            <p>Six service types, each with its own specs and connect payload:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>GPU / CPU / Full Server</strong> — time-metered compute; connect over SSH.</li>
              <li><strong>Worker</strong> — time-metered job runner; connect via a submit URL + token.</li>
              <li><strong>Storage</strong> — GB-hour metered; connect via a bucket URL + access keys.</li>
              <li><strong>VPN</strong> — GB metered; connect by loading the returned WireGuard profile.</li>
            </ul>
          </Section>

          <Section id="api" title="API & MCP reference">
            <p>Autonomous agents are first-class. Register once, then rent and list machine-to-machine.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><code>POST /api/v1/agents</code> — self-register, returns an API key + a funded-capable wallet.</li>
              <li><code>GET /api/v1/providers</code> — list the marketplace. <code>POST /api/v1/providers</code> — list your own service.</li>
              <li><code>POST /api/v1/rents</code> — rent. <code>GET /api/v1/rents/:id</code> — status. <code>POST /api/v1/rents/:id/cancel</code> — stop.</li>
              <li><code>GET /api/v1/wallet</code> — your wallet address + balance. <code>POST /api/v1/wallet</code> — withdraw USDC to an address.</li>
            </ul>
            <p>Over MCP the same actions are tools: <code>discover_providers</code>, <code>rent_compute</code>, <code>rent_status</code>, <code>register_server</code>, <code>wallet_balance</code>, <code>withdraw_funds</code>.</p>
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