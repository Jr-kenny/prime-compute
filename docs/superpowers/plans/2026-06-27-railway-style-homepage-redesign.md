# Railway-style Homepage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Prime Compute homepage (`/`) and shared shell (Navbar, Footer, PageShell) to match a Railway.com-style aesthetic — sunset gradient hero with animated product canvas, five-section rail, trust layer — while keeping Prime Compute's blue color identity.

**Architecture:** Replace two hero sub-components (`SpaceBackground` → `HeroGradient`, `HeroAnimation` → `HeroCanvas`) and rebuild the homepage composition. Keep existing inner-page routes unchanged. Visual changes propagate to all pages via the new Navbar/Footer. No new dependencies, no business-logic changes.

**Tech Stack:** TanStack Start + React 19 + TypeScript + Tailwind v4 (oklch tokens) + framer-motion + lucide-react. No test runner is configured in this project — verification is via `npm run lint`, `npm run build`, and browser walkthrough. Each task ends with a commit.

**Spec:** [`docs/superpowers/specs/2026-06-27-railway-style-homepage-redesign-design.md`](../specs/2026-06-27-railway-style-homepage-redesign-design.md)

---

## File Structure

**Created:**
- `src/components/site/HeroGradient.tsx` — sunset gradient background (replaces `SpaceBackground.tsx`)
- `src/components/site/HeroCanvas.tsx` — animated SVG product canvas (replaces `HeroAnimation.tsx`)

**Modified:**
- `src/styles.css` — color token tweaks + Google Fonts imports (Instrument Serif, JetBrains Mono)
- `src/routes/index.tsx` — full rebuild: hero, logo strip, 5-section rail, trust layer, CTA
- `src/components/site/Navbar.tsx` — new visual rhythm
- `src/components/site/Footer.tsx` — new 3-col layout
- `src/components/site/PageShell.tsx` — tighten entrance motion

**Deleted after migration:**
- `src/components/site/SpaceBackground.tsx`
- `src/components/site/HeroAnimation.tsx`

**Unchanged (referenced by new index.tsx):**
- `src/components/site/BrokerFlow.tsx`
- `src/components/site/ProviderCard.tsx`
- `src/components/site/StatCounter.tsx`
- `src/components/site/ComputeScoreRing.tsx`
- `src/components/site/StreamingTicker.tsx`

---

## Task 1: Update `styles.css` — color tokens + font imports

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add Google Fonts @import at the top of styles.css**

Open `src/styles.css`. Right after the `@import "tailwindcss" source(none);` line (line 1), add a new line:

```css
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600&display=swap');
```

- [ ] **Step 2: Update `--background` token**

In the `:root` block, change `--background` from:
```css
--background: oklch(0.16 0.04 265);          /* #060c1a */
```
to:
```css
--background: oklch(0.14 0.04 250);          /* #050a18 — deeper navy */
```

- [ ] **Step 3: Update `--surface` token**

Change `--surface` from:
```css
--surface: oklch(0.22 0.06 265);             /* #0d1635 */
```
to:
```css
--surface: oklch(0.20 0.06 250);             /* #0a1430 — slightly bluer */
```

- [ ] **Step 4: Add font-family tokens to the `@theme inline` block**

Inside the `@theme inline { ... }` block, alongside `--font-sans`, add:
```css
--font-display: "Instrument Serif", ui-serif, Georgia, serif;
--font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
```

- [ ] **Step 5: Update `--font-sans` to keep Inter as the first choice**

Change `--font-sans` from:
```css
--font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
```
to:
```css
--font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
--font-display: "Instrument Serif", ui-serif, Georgia, serif;
--font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
```

(Drop the duplicate `--font-sans` line if you added `--font-display` and `--font-mono` separately in Step 4. Final block should contain exactly one of each.)

- [ ] **Step 6: Verify lint passes**

Run: `npm run lint`
Expected: exits 0, no warnings about styles.css.

- [ ] **Step 7: Commit**

```bash
cd /Users/user/Documents/prime-compute
git add src/styles.css
git -c user.email=kimchi@local -c user.name=kimchi commit -m "style: tweak background tokens, add Instrument Serif + JetBrains Mono fonts"
```

---

## Task 2: Create `HeroGradient.tsx`

**Files:**
- Create: `src/components/site/HeroGradient.tsx`
- Delete (later, after Task 7 verifies nothing references it): `src/components/site/SpaceBackground.tsx`

- [ ] **Step 1: Create the new component**

Write `src/components/site/HeroGradient.tsx`:

```tsx
export function HeroGradient() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 -z-10"
      style={{
        background:
          "linear-gradient(180deg, #050a18 0%, #0a1430 30%, #142a5a 55%, #1e4080 80%, #2d5cb0 100%)",
      }}
    >
      <div
        className="absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 100%, rgba(91,140,255,0.35), transparent 70%)",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit (do not delete SpaceBackground yet — old index.tsx still imports it)**

```bash
cd /Users/user/Documents/prime-compute
git add src/components/site/HeroGradient.tsx
git -c user.email=kimchi@local -c user.name=kimchi commit -m "feat(site): add HeroGradient component (sunset gradient bg)"
```

---

## Task 3: Create `HeroCanvas.tsx` (the animated SVG product canvas)

**Files:**
- Create: `src/components/site/HeroCanvas.tsx`

- [ ] **Step 1: Create the component**

Write `src/components/site/HeroCanvas.tsx`:

```tsx
export function HeroCanvas() {
  return (
    <div className="relative w-full max-w-5xl mx-auto rounded-2xl overflow-hidden border border-white/10 bg-[#0a0e1f] shadow-[0_-20px_80px_-10px_rgba(91,140,255,0.18)]">
      {/* Browser chrome */}
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/8 bg-white/2">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 text-[11px] text-white/40 font-mono">
          primecompute.app/canvas
        </span>
      </div>

      {/* App body */}
      <div className="grid grid-cols-[200px_1fr] gap-3 p-4 min-h-[320px]">
        {/* Sidebar nav */}
        <aside className="rounded-lg bg-[#0f1530] border border-white/5 p-3">
          <div className="text-[10px] text-white/40 tracking-[0.15em] uppercase mb-2.5">
            Workspace
          </div>
          <nav className="flex flex-col gap-1">
            {["Canvas", "Providers", "Jobs", "Wallet"].map((label, i) => (
              <div
                key={label}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-md text-xs ${
                  i === 0
                    ? "bg-primary/20 text-white"
                    : "text-[#8aa3c7]"
                }`}
              >
                <span>{i === 0 ? "●" : "○"}</span>
                <span>{label}</span>
              </div>
            ))}
          </nav>
          <div className="text-[10px] text-white/40 tracking-[0.15em] uppercase mt-4 mb-2.5">
            Services
          </div>
          <nav className="flex flex-col gap-1">
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-[#cfe0ff]">
              <span className="text-[#7fffaf]">●</span>
              <span>inference-gpu-01</span>
            </div>
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-[#cfe0ff]">
              <span className="text-[#7fffaf]">●</span>
              <span>postgres-main</span>
            </div>
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-[#cfe0ff]">
              <span className="text-[#febc2e]">●</span>
              <span>broker-node</span>
            </div>
          </nav>
        </aside>

        {/* Canvas */}
        <div className="rounded-lg border border-white/5 bg-[radial-gradient(circle_at_30%_30%,rgba(37,99,235,0.08),transparent_60%)_#0a0e1f] p-4">
          <svg viewBox="0 0 600 280" className="w-full h-full" role="img" aria-label="Job routed from consumer through AI broker to two GPU providers">
            <defs>
              <linearGradient id="pc-grad-job" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#2563eb" stopOpacity="0" />
                <stop offset="50%" stopColor="#5b8cff" stopOpacity="1" />
                <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="pc-grad-route" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#7fffaf" stopOpacity="0" />
                <stop offset="50%" stopColor="#7fffaf" stopOpacity="1" />
                <stop offset="100%" stopColor="#7fffaf" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Static wireframe */}
            <line x1="120" y1="140" x2="300" y2="140" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            <line x1="300" y1="140" x2="480" y2="90" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            <line x1="300" y1="140" x2="480" y2="200" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />

            {/* Animated pulse: consumer -> broker */}
            <line x1="120" y1="140" x2="300" y2="140" stroke="url(#pc-grad-job)" strokeWidth="2" strokeDasharray="40 600">
              <animate attributeName="stroke-dashoffset" from="640" to="0" dur="2.5s" repeatCount="indefinite" />
            </line>

            {/* Animated pulse: broker -> provider 1 */}
            <line x1="300" y1="140" x2="480" y2="90" stroke="url(#pc-grad-route)" strokeWidth="2" strokeDasharray="30 200">
              <animate attributeName="stroke-dashoffset" from="230" to="0" dur="1.5s" repeatCount="indefinite" begin="2s" />
            </line>

            {/* Animated pulse: broker -> provider 2 (delayed) */}
            <line x1="300" y1="140" x2="480" y2="200" stroke="url(#pc-grad-route)" strokeWidth="2" strokeDasharray="30 200">
              <animate attributeName="stroke-dashoffset" from="230" to="0" dur="1.5s" repeatCount="indefinite" begin="2.7s" />
            </line>

            {/* Consumer node */}
            <g transform="translate(80,108)">
              <rect x="0" y="0" width="80" height="64" rx="8" fill="#142a5a" stroke="#5b8cff" strokeWidth="1.5" />
              <text x="40" y="24" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="ui-sans-serif">Job</text>
              <text x="40" y="40" textAnchor="middle" fill="#8aa3c7" fontSize="9" fontFamily="ui-monospace">train.py</text>
              <circle cx="40" cy="52" r="3" fill="#7fffaf">
                <animate attributeName="opacity" values="1;0.2;1" dur="1.5s" repeatCount="indefinite" />
              </circle>
            </g>

            {/* Broker node */}
            <g transform="translate(264,108)">
              <rect x="0" y="0" width="72" height="64" rx="8" fill="#1e4080" stroke="#5b8cff" strokeWidth="1.5" />
              <text x="36" y="24" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="ui-sans-serif">Broker</text>
              <text x="36" y="40" textAnchor="middle" fill="#8aa3c7" fontSize="9" fontFamily="ui-monospace">AI matcher</text>
              <circle cx="36" cy="52" r="3" fill="#5b8cff">
                <animate attributeName="r" values="3;5;3" dur="1.5s" repeatCount="indefinite" />
              </circle>
            </g>

            {/* Provider node 1 (H100) */}
            <g transform="translate(460,58)">
              <rect x="0" y="0" width="100" height="60" rx="8" fill="#0f2a1e" stroke="#7fffaf" strokeWidth="1.5" />
              <text x="50" y="22" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="ui-sans-serif">H100 × 8</text>
              <text x="50" y="38" textAnchor="middle" fill="#8aa3c7" fontSize="9" fontFamily="ui-monospace">$0.00001/s</text>
              <circle cx="50" cy="50" r="3" fill="#7fffaf" />
            </g>

            {/* Provider node 2 (A100) */}
            <g transform="translate(460,170)">
              <rect x="0" y="0" width="100" height="60" rx="8" fill="#0f2a1e" stroke="#7fffaf" strokeWidth="1.5" />
              <text x="50" y="22" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="ui-sans-serif">A100 × 4</text>
              <text x="50" y="38" textAnchor="middle" fill="#8aa3c7" fontSize="9" fontFamily="ui-monospace">$0.00003/s</text>
              <circle cx="50" cy="50" r="3" fill="#febc2e">
                <animate attributeName="fill" values="#febc2e;#7fffaf;#7fffaf" dur="3s" repeatCount="indefinite" />
              </circle>
            </g>

            {/* Streaming rate */}
            <g transform="translate(20, 250)">
              <text fill="#7fffaf" fontFamily="ui-monospace, monospace" fontSize="13" fontWeight="600">$0.00018420</text>
              <text x="105" fill="#8aa3c7" fontFamily="ui-monospace, monospace" fontSize="10">streaming</text>
            </g>
          </svg>
        </div>
      </div>

      {/* Status line */}
      <div className="mx-4 mb-4 px-3 py-2.5 rounded-lg bg-primary/10 border border-primary/15 font-mono text-[11px] text-[#8aa3c7] flex items-center gap-2">
        <span className="text-[#7fffaf]">▸</span>
        broker matched inference-gpu-01 (compute score: 942) · streaming USDC @ $0.00001/sec
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/user/Documents/prime-compute
git add src/components/site/HeroCanvas.tsx
git -c user.email=kimchi@local -c user.name=kimchi commit -m "feat(site): add HeroCanvas component (animated SVG product canvas)"
```

---

## Task 4: Rebuild `src/routes/index.tsx`

**Files:**
- Modify: `src/routes/index.tsx` (full rebuild)

- [ ] **Step 1: Replace the file contents**

Write `src/routes/index.tsx`:

```tsx
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
              The AI-brokered marketplace for idle GPUs, CPUs, and servers. Streaming
              nanopayments that stop the instant your job does.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90">
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
            )
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
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#5b8cff]">
              Real-time
            </div>
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
                <div className="text-2xl md:text-3xl font-semibold text-white">
                  {s.v}
                </div>
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
              <div
                key={t.author}
                className="rounded-xl border border-white/8 bg-[#0f1530] p-6"
              >
                <p className="text-[#e8e1ff] text-sm italic leading-relaxed">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="mt-4 text-[11px] text-white/50 font-mono">
                  — {t.author}
                </div>
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
            <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90">
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
          <div className="text-[11px] uppercase tracking-[0.18em] text-[#5b8cff]">
            {eyebrow}
          </div>
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

function IllustrationCard({ kind }: { kind: "deploy" | "network" | "scale" | "monitor" | "evolve" }) {
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: exits 0. If you get "Cannot find module '@/components/site/HeroCanvas'" or similar, double-check the path.

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 4: Verify build passes**

Run: `npm run build`
Expected: exits 0. Build output dist/ created.

- [ ] **Step 5: Browser walkthrough**

Run: `npm run dev`
Open http://localhost:5173 (or whichever port Vite reports) in a browser.

Expected:
- Hero: sunset gradient bg, "Live on testnet" pill, "Rent compute." in sans, "Pay per heartbeat." in serif italic, two CTAs, animated SVG canvas below
- Animated canvas shows: sidebar nav, canvas with Job → Broker → H100 × 8 / A100 × 4 nodes, animated pulse lines moving Job → Broker and Broker → providers, streaming rate `$0.00018420`, status line at bottom
- Logo strip: 7 customer names on dark band
- Build / Network / Scale / Monitor / Evolve sections render with alternating bg, copy left/right (Network + Monitor flipped), illustration cards with lucide icons
- Trust layer: 5-stat grid + 2 testimonial cards
- CTA: gradient card with two CTAs

- [ ] **Step 6: Commit**

```bash
cd /Users/user/Documents/prime-compute
git add src/routes/index.tsx
git -c user.email=kimchi@local -c user.name=kimchi commit -m "feat(home): rebuild homepage with Railway-style sections + hero canvas"
```

---

## Task 5: Rebuild `src/components/site/Navbar.tsx`

**Files:**
- Modify: `src/components/site/Navbar.tsx` (full rebuild)

- [ ] **Step 1: Replace the file contents**

Write `src/components/site/Navbar.tsx`:

```tsx
import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X, Boxes, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const links = [
  { to: "/marketplace", label: "Marketplace" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/provider", label: "Provider" },
  { to: "/docs", label: "Docs" },
] as const;

export function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <header className="sticky top-0 z-40 border-b border-white/8 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 group">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-[#5b8cff] ring-1 ring-primary/30 group-hover:ring-primary/60 transition">
            <Boxes className="h-4 w-4" />
          </span>
          <span className="font-semibold tracking-tight text-white">
            Prime <span className="text-[#5b8cff]">Compute</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {links.map((l) => {
            const active = pathname === l.to || pathname.startsWith(l.to + "/");
            return (
              <Link
                key={l.to}
                to={l.to}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md transition",
                  active ? "text-white bg-white/8" : "text-white/60 hover:text-white"
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden md:flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-white/60 hover:text-white">
            <Wallet className="h-4 w-4" /> Connect Wallet
          </Button>
          <Button
            size="sm"
            className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_24px_-6px_rgba(91,140,255,0.6)]"
          >
            Get Started
          </Button>
        </div>

        <button
          className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-white"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-white/8 bg-[#0a1430]/95 backdrop-blur-xl">
          <div className="px-4 py-3 flex flex-col gap-1">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className="px-3 py-2 text-sm text-white/70 hover:text-white rounded-md"
              >
                {l.label}
              </Link>
            ))}
            <div className="pt-2 flex gap-2">
              <Button variant="ghost" size="sm" className="flex-1 text-white">
                <Wallet className="h-4 w-4" />Wallet
              </Button>
              <Button size="sm" className="flex-1 bg-primary text-primary-foreground">
                Get Started
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
```

- [ ] **Step 2: Verify lint passes**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 3: Browser walkthrough**

Run: `npm run dev`
Open any page (e.g. `/`, `/marketplace`, `/dashboard`).

Expected:
- Navbar: sticky at top with blurred dark bg, brand left, links inline on md+, "Connect Wallet" + "Get Started" pills right
- Active route highlighted (bg white/8)
- Mobile (resize <768px): hamburger button, links collapse into panel
- Other pages (marketplace, dashboard, etc.) inherit the new navbar without breaking

- [ ] **Step 4: Commit**

```bash
cd /Users/user/Documents/prime-compute
git add src/components/site/Navbar.tsx
git -c user.email=kimchi@local -c user.name=kimchi commit -m "feat(nav): rebuild Navbar with new visual rhythm"
```

---

## Task 6: Rebuild `src/components/site/Footer.tsx`

**Files:**
- Modify: `src/components/site/Footer.tsx` (full rebuild)

- [ ] **Step 1: Replace the file contents**

Write `src/components/site/Footer.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import { Boxes } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-white/8 mt-24 bg-[#050a18]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10 grid gap-8 md:grid-cols-3 items-center">
        <Link to="/" className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-[#5b8cff] ring-1 ring-primary/30">
            <Boxes className="h-4 w-4" />
          </span>
          <span className="font-semibold text-white">
            Prime <span className="text-[#5b8cff]">Compute</span>
          </span>
        </Link>
        <nav className="flex justify-center gap-6 text-sm text-white/60">
          <Link to="/" className="hover:text-white">
            Home
          </Link>
          <Link to="/marketplace" className="hover:text-white">
            Marketplace
          </Link>
          <Link to="/dashboard" className="hover:text-white">
            Dashboard
          </Link>
          <Link to="/docs" className="hover:text-white">
            Docs
          </Link>
        </nav>
        <p className="text-sm text-white/60 md:text-right">
          Powered by Circle Payments
        </p>
      </div>
      <div className="border-t border-white/5 py-4 text-center text-xs text-white/40">
        © {new Date().getFullYear()} Prime Compute. Streaming nanopayments for the open compute layer.
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Verify lint passes**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 3: Browser walkthrough**

Open any page. Expected footer:
- 3-col on md+: brand left, links center, "Powered by Circle Payments" right
- Stacked on mobile
- Copyright bar below with hairline divider
- Footer uses `--background` (#050a18) consistent with new theme

- [ ] **Step 4: Commit**

```bash
cd /Users/user/Documents/prime-compute
git add src/components/site/Footer.tsx
git -c user.email=kimchi@local -c user.name=kimchi commit -m "feat(footer): rebuild Footer with 3-col layout"
```

---

## Task 7: Tighten `src/components/site/PageShell.tsx` motion

**Files:**
- Modify: `src/components/site/PageShell.tsx`

- [ ] **Step 1: Read current PageShell.tsx and remove initial fade**

Read `src/components/site/PageShell.tsx` and replace its entire content with:

```tsx
import type { ReactNode } from "react";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
```

(Removes the framer-motion fade-in on `<main>` so it doesn't compete with the new hero's own entrance animation. The hero already has its own animation timing via the SVG pulses.)

- [ ] **Step 2: Verify lint passes**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 3: Browser walkthrough**

Open the homepage. Expected:
- Page renders without an initial fade flicker
- Hero appears immediately on load
- Footer renders below content

- [ ] **Step 4: Delete the now-unused old hero sub-components**

After confirming nothing references them:

```bash
cd /Users/user/Documents/prime-compute
grep -r "SpaceBackground\|HeroAnimation" src/ 2>&1
```

Expected: no output (no remaining references).

If empty:

```bash
git rm src/components/site/SpaceBackground.tsx src/components/site/HeroAnimation.tsx
git -c user.email=kimchi@local -c user.name=kimchi commit -m "chore(site): remove unused SpaceBackground + HeroAnimation components"
```

If non-empty (something still imports them), STOP and report which file still references them before deleting.

- [ ] **Step 5: Commit the PageShell change**

```bash
cd /Users/user/Documents/prime-compute
git add src/components/site/PageShell.tsx
git -c user.email=kimchi@local -c user.name=kimchi commit -m "refactor(shell): remove initial main fade to avoid clashing with hero entrance"
```

---

## Task 8: Visual sweep on inner pages (`/marketplace`, `/dashboard`, `/provider`, `/docs`)

**Files:**
- Possibly modify: `src/routes/marketplace.tsx`, `src/routes/dashboard.tsx`, `src/routes/provider.tsx`, `src/routes/docs.tsx`
- Possibly modify: `src/components/site/ProviderCard.tsx`, `src/components/site/BrokerFlow.tsx` (only if visual collisions surface)

- [ ] **Step 1: Run dev server and visit each inner route**

Run: `npm run dev`

Visit in browser:
1. `/marketplace` — check navbar, footer, page content padding, card colors
2. `/marketplace/$id` (any provider detail) — same checks
3. `/dashboard` — same checks
4. `/provider` — same checks
5. `/docs` — same checks
6. `/register` — same checks

- [ ] **Step 2: Note any visual issues**

For each page, record:
- Padding collisions (content too close to navbar/footer)
- Color clashes (text invisible against new bg, borders wrong color)
- Card components that look broken (ProviderCard, BrokerFlow)
- Anything that breaks visually

- [ ] **Step 3: Apply minimal fixes**

For each noted issue, make the smallest possible fix:
- Padding: adjust `pt-*` / `pb-*` on the affected `<section>` or page wrapper
- Color: swap hardcoded `bg-background`/`text-foreground` references that don't pick up the new tokens
- Borders: `border-border/60` → `border-white/8` where the old border was visible against the new deeper bg
- Cards: only modify if a card visibly breaks (e.g. unreadable text)

DO NOT change inner page logic, layouts, or content. Only visual fixes.

- [ ] **Step 4: Re-verify each touched page**

Visit each fixed page in the browser. Confirm the issue is gone and nothing else broke.

- [ ] **Step 5: Lint and build**

Run: `npm run lint`
Expected: exits 0.

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 6: Commit (only if changes were made)**

```bash
cd /Users/user/Documents/prime-compute
git add src/
git -c user.email=kimchi@local -c user.name=kimchi commit -m "fix(site): visual sweep — fix padding/colors on inner pages after navbar/footer update"
```

If no changes were needed in this task, skip the commit and move on.

---

## Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: exits 0, no warnings.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Browser walkthrough — homepage**

Run: `npm run dev`, open `http://localhost:5173`.

Walk through:
- [ ] Hero loads with sunset gradient bg
- [ ] "Rent compute." (sans, semibold) + "Pay per heartbeat." (serif, italic) headline renders
- [ ] "Live on testnet" pill with green dot visible
- [ ] Two CTAs visible and clickable
- [ ] Animated SVG canvas: sidebar nav + canvas + status line all visible
- [ ] Pulse lines animate from Job → Broker → Provider nodes (visible motion)
- [ ] Streaming rate `$0.00018420` visible
- [ ] Logo strip shows 7 placeholder customer names
- [ ] Build / Network / Scale / Monitor / Evolve sections render with alternating bg
- [ ] Each section has eyebrow, serif heading, body, "Alternative to" tags, illustration card
- [ ] Trust layer: 5-stat grid + 2 testimonial cards
- [ ] CTA section with two buttons
- [ ] Footer 3-col layout renders

- [ ] **Step 4: Browser walkthrough — inner pages**

For each of `/marketplace`, `/dashboard`, `/provider`, `/docs`:
- [ ] Navbar shows new visual rhythm
- [ ] Footer shows new 3-col layout
- [ ] Page content renders without padding/colour breaks
- [ ] No console errors in browser devtools

- [ ] **Step 5: Mobile check (≤640px)**

Resize browser to mobile width. On the homepage:
- [ ] Navbar collapses to hamburger
- [ ] Hamburger opens slide-down panel
- [ ] Hero scales down (no horizontal scroll)
- [ ] SVG canvas is responsive (no clipping)
- [ ] All sections stack vertically
- [ ] Footer stacks vertically

- [ ] **Step 6: If any verification step fails, fix and re-verify**

For each failure, fix the smallest way possible, commit with `fix:` prefix, then re-run the failing step.

- [ ] **Step 7: Final commit (only if any final fixes were made)**

If Task 9 produced any fixes:

```bash
cd /Users/user/Documents/prime-compute
git status
git add <changed-files>
git -c user.email=kimchi@local -c user.name=kimchi commit -m "fix: final verification fixes"
```

If no fixes: skip this step.

- [ ] **Step 8: Show final summary**

Report:
- Total commits made in this plan (run `git log --oneline 5a63f67..HEAD` to count)
- Browser-tested pages (homepage + 4 inner pages + mobile)
- Build status (passed)
- Lint status (passed)
- Any deferred items remaining

---

## Self-Review Notes

**Spec coverage:**
- Visual system (colors, type) → Task 1
- HeroGradient component → Task 2
- HeroCanvas component (animated SVG) → Task 3
- Homepage rebuild (10 sections per spec) → Task 4
- Navbar rebuild → Task 5
- Footer rebuild → Task 6
- PageShell motion tweak → Task 7
- Inner page visual sweep → Task 8
- Final verification → Task 9
- Illustration assets = placeholder SVG glyphs (per spec, not Railway hot-linked) → handled in Task 4 `IllustrationCard` component

**Placeholder scan:** No "TBD" / "TODO" / "implement later" in any step. Every code block is complete.

**Type consistency:** `HeroCanvas` uses no props. `HeroGradient` uses no props. `FeatureSection` and `IllustrationCard` use the same `kind` union ("deploy" | "network" | "scale" | "monitor" | "evolve"). `illustration` prop in `FeatureSection` matches.

**Potential gotchas:**
- Task 4 imports `Layers` from lucide-react (used in FeatureSection alternative tags via illustration). Verified in package.json.
- Task 4 imports `Wallet` and `Award` for illustration glyphs (still needed for some sections). Verified.
- The streaming rate `$0.00018420` is hardcoded in Task 3 — not animated numerically. If the user wants the counter to actually tick, that's a follow-up.
- Task 4 doesn't import `motion` from framer-motion (the rebuild removed `motion.div` wrappers for simplicity). The visual motion now lives in the SVG animations inside `HeroCanvas`.
- The plan does NOT depend on or modify `src/lib/mock-data.ts`, `ProviderCard`, `BrokerFlow`, `StatCounter`, `ComputeScoreRing`, or `StreamingTicker`. They're imported but unused in the new `index.tsx` — that's fine, unused imports won't break the build but eslint may flag them. If eslint complains, drop the imports.

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-27-railway-style-homepage-redesign.md`.**
