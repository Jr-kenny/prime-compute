# Marketplace clarity and wallet completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the clarity and wallet gaps in the marketplace: human-readable rates, honest landing/docs, brand-consistent logo, register navigation, discoverable wallet, an agent withdraw path, honest provider payout copy, real listing/renting guides, and a simulation badge on our own listings.

**Architecture:** Small pure helpers (`rate.ts`, `first-party.ts`, agent `withdraw.ts`) carry the testable logic; the rest is UI/content wiring in existing components. No schema migration: agent withdraw reuses the existing `agent_wallets` / `circle_wallets` and mirrors the user's `withdrawFromSpendWallet`. Providers self-custody, so there is no provider withdraw, only honest copy.

**Tech Stack:** TanStack Start / React (web) + Vite, Zod, `@services/*` (Bun backend imported via alias), `@modelcontextprotocol/sdk` (mcp), `bun test`. The `@services/` alias maps to `services/src/`.

**Spec:** `docs/superpowers/specs/2026-07-03-marketplace-clarity-and-wallet-completeness-design.md`

Conventions: run commands from the repo root. `bun test src` runs the web tests; `cd mcp && bun test` runs the mcp tests. The repo uses `noUncheckedIndexedAccess`; guard index access. `bunx tsc --noEmit` typechecks the web app; `cd mcp && bunx tsc --noEmit` the mcp package. UI changes are verified in the browser preview (dev server `bun run dev` on :8080).

---

### Task 1: Human-readable rate helper

**Files:**
- Create: `src/lib/pricing/rate.ts`
- Test: `src/lib/pricing/rate.test.ts`

- [ ] **Step 1: Write the failing test (`src/lib/pricing/rate.test.ts`)**

```ts
import { describe, test, expect } from "bun:test";
import { rateDisplay } from "./rate";

describe("rateDisplay", () => {
  test("time types show an exact per-day figure", () => {
    const r = rateDisplay("GPU", 0.0000098);
    expect(r.streaming).toBe("$0.0000098 /sec");
    expect(r.human).toBe("$0.85 / day"); // 0.0000098 * 86400 = 0.84672
  });

  test("VPN (per GB) shows a per-100GB example, no invented per-day", () => {
    const r = rateDisplay("VPN", 0.02);
    expect(r.streaming).toBe("$0.0200 /GB");
    expect(r.human).toBe("$2.00 per 100 GB"); // 0.02 * 100
  });

  test("storage (per GB-hour) shows a per-GB-day figure", () => {
    const r = rateDisplay("Storage", 0.02);
    expect(r.streaming).toBe("$0.020000 /GB-hour");
    expect(r.human).toBe("$0.48 / GB-day"); // 0.02 * 24
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/lib/pricing/rate.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/pricing/rate.ts`**

```ts
// src/lib/pricing/rate.ts
// Turns a provider's per-charge price + its service descriptor into display strings. Time types get
// an exact $/day (price * 86400). Volume types can't have an honest fixed per-day without assuming
// usage, so VPN shows a per-100GB example and storage shows $/GB-day (per-GB-hour * 24).
import { descriptorFor } from "@services/services/registry";

export type RateDisplay = {
  streaming: string; // the raw metered rate, e.g. "$0.0000098 /sec"
  human: string;     // a human-reasonable figure, e.g. "$0.85 / day"
  unit: string;      // the descriptor unit
};

const usd = (n: number, dp = 2) => `$${n.toFixed(dp)}`;

export function rateDisplay(resourceType: string, pricePerCharge: number): RateDisplay {
  const d = descriptorFor(resourceType);
  if (d.metering === "time") {
    return { streaming: `$${pricePerCharge.toFixed(7)} /sec`, human: `${usd(pricePerCharge * 86400)} / day`, unit: d.unit };
  }
  if (d.unit === "GB") {
    return { streaming: `$${pricePerCharge.toFixed(4)} /GB`, human: `${usd(pricePerCharge * 100)} per 100 GB`, unit: d.unit };
  }
  return { streaming: `$${pricePerCharge.toFixed(6)} /GB-hour`, human: `${usd(pricePerCharge * 24)} / GB-day`, unit: d.unit };
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/lib/pricing/rate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/rate.ts src/lib/pricing/rate.test.ts
git commit -m "feat(web): human-readable per-day/per-unit rate helper"
```

---

### Task 2: Render the human rate on cards, detail, and rent sheet

**Files:**
- Modify: `src/components/site/ProviderCard.tsx:60-66`
- Modify: `src/routes/marketplace.$id.tsx:76`
- Modify: `src/components/site/RentSheet.tsx:125`

- [ ] **Step 1: ProviderCard — show streaming + human rate**

In `src/components/site/ProviderCard.tsx`, add the import at the top:

```ts
import { rateDisplay } from "@/lib/pricing/rate";
```

Replace the rate block (currently lines ~60-66):

```tsx
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Rate</div>
          <div className="text-base font-semibold text-foreground">
            ${p.pricePerCharge.toFixed(7)}<span className="text-xs text-muted-foreground"> /sec</span>
          </div>
        </div>
```

with:

```tsx
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Rate</div>
          <div className="text-base font-semibold text-foreground">{rateDisplay(p.resourceType, p.pricePerCharge).streaming}</div>
          <div className="text-[11px] text-muted-foreground">{rateDisplay(p.resourceType, p.pricePerCharge).human}</div>
        </div>
```

- [ ] **Step 2: marketplace.$id — show the human rate as a second stat**

In `src/routes/marketplace.$id.tsx`, add the import:

```ts
import { rateDisplay } from "@/lib/pricing/rate";
```

Replace the Rate stat (line ~76):

```tsx
          <Stat label="Rate" value={`$${p.pricePerCharge.toFixed(7)}/s`} />
```

with:

```tsx
          <Stat label="Rate" value={rateDisplay(p.resourceType, p.pricePerCharge).streaming} />
          <Stat label="Est." value={rateDisplay(p.resourceType, p.pricePerCharge).human} />
```

- [ ] **Step 3: RentSheet — append the human rate to the metering line**

In `src/components/site/RentSheet.tsx`, add the import:

```ts
import { rateDisplay } from "@/lib/pricing/rate";
```

Replace the metering line (line ~125):

```tsx
                at ${provider.pricePerCharge.toFixed(7)}/s · metered per second, only pay for what runs
```

with:

```tsx
                at {rateDisplay(provider.resourceType, provider.pricePerCharge).streaming} ({rateDisplay(provider.resourceType, provider.pricePerCharge).human}) · metered per unit, only pay for what runs
```

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/site/ProviderCard.tsx src/routes/marketplace.\$id.tsx src/components/site/RentSheet.tsx
git commit -m "feat(web): render human per-day/per-unit rate on cards, detail, rent sheet"
```

---

### Task 3: First-party detection + Simulation badge

**Files:**
- Create: `src/lib/marketplace/first-party.ts`
- Test: `src/lib/marketplace/first-party.test.ts`
- Modify: `src/components/site/ProviderCard.tsx` (badge near the alias)

- [ ] **Step 1: Write the failing test (`src/lib/marketplace/first-party.test.ts`)**

```ts
import { describe, test, expect } from "bun:test";
import { isFirstParty } from "./first-party";

describe("isFirstParty", () => {
  test("matches a configured first-party wallet (case-insensitive)", () => {
    const wallets = new Set(["0xabc"]);
    expect(isFirstParty({ ownerWallet: "0xABC" }, wallets)).toBe(true);
  });

  test("a third-party wallet is not first-party", () => {
    const wallets = new Set(["0xabc"]);
    expect(isFirstParty({ ownerWallet: "0xdef" }, wallets)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/lib/marketplace/first-party.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/marketplace/first-party.ts`**

```ts
// src/lib/marketplace/first-party.ts
// Which listings are our own demo/simulation boxes. Only these get the "Simulation" badge, so a
// renter can tell our demo hardware from real third-party providers. Configurable via
// VITE_FIRST_PARTY_WALLETS (comma-separated), defaulting to the seeded demo owner wallets.
import type { Provider } from "@services/domain";

const DEFAULT_FIRST_PARTY = ["0xa11ce", "0xb0b", "0xc4r0l", "0xd4ve", "0xe1e", "0xf00d"];

export function firstPartyWallets(): Set<string> {
  const raw = (import.meta.env?.VITE_FIRST_PARTY_WALLETS as string | undefined) ?? "";
  const list = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set(list.length ? list : DEFAULT_FIRST_PARTY);
}

export function isFirstParty(p: Pick<Provider, "ownerWallet">, wallets: Set<string> = firstPartyWallets()): boolean {
  return wallets.has(p.ownerWallet.toLowerCase());
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/lib/marketplace/first-party.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the badge to ProviderCard**

In `src/components/site/ProviderCard.tsx`, add the import:

```ts
import { isFirstParty } from "@/lib/marketplace/first-party";
```

Replace the alias line:

```tsx
          <span className="text-sm font-medium text-foreground">{p.alias}</span>
```

with:

```tsx
          <span className="text-sm font-medium text-foreground">{p.alias}</span>
          {isFirstParty(p) && (
            <span className="ml-2 inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-400 align-middle">
              Simulation
            </span>
          )}
```

- [ ] **Step 6: Typecheck + commit**

```bash
bunx tsc --noEmit
git add src/lib/marketplace/first-party.ts src/lib/marketplace/first-party.test.ts src/components/site/ProviderCard.tsx
git commit -m "feat(web): simulation badge on our own listings via isFirstParty"
```

---

### Task 4: Register — live $/day readout + a top nav bar

**Files:**
- Modify: `src/routes/register.tsx` (pricing step ~181-187; add a top bar in the return)

- [ ] **Step 1: Live human-rate readout in the pricing step**

In `src/routes/register.tsx`, add the import near the other imports:

```ts
import { rateDisplay } from "@/lib/pricing/rate";
```

Replace the price helper text in the Pricing step (the block that reads "At this rate, a 1-hour rent costs…", lines ~184-186):

```tsx
                <p className="mt-2 text-xs text-muted-foreground">
                  At this rate, a 1-hour rent costs <span className="text-foreground">${(form.pricePerCharge * 3600).toFixed(4)}</span>.
                </p>
```

with:

```tsx
                <p className="mt-2 text-xs text-muted-foreground">
                  Renters see this as <span className="text-foreground">{rateDisplay(form.type, form.pricePerCharge).human}</span> ({rateDisplay(form.type, form.pricePerCharge).streaming}). The streaming meter charges per unit; they only pay for what runs.
                </p>
```

- [ ] **Step 2: Add a slim top nav bar to the register page**

In `src/routes/register.tsx`, add these imports:

```ts
import { Link } from "@tanstack/react-router";
import { LanternMark } from "@/components/site/LanternMark";
```

(`LanternMark` is created in Task 7. If executing tasks out of order and it does not yet exist, do Task 7 Step 1-3 first.)

Immediately inside the top-level `<PageShell>` return, before `<div className="mx-auto max-w-3xl px-4 sm:px-6 py-12">`, insert:

```tsx
        <div className="border-b border-border">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 h-14 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2 text-sm font-semibold text-white">
              <LanternMark className="h-6 w-6" />
              Prime <span className="text-glow">Compute</span>
            </Link>
            <div className="flex items-center gap-3 text-sm">
              <Link to="/marketplace" className="text-muted-foreground hover:text-foreground transition">Marketplace</Link>
              <Link to="/dashboard" className="text-muted-foreground hover:text-foreground transition">Dashboard</Link>
            </div>
          </div>
        </div>
```

- [ ] **Step 3: Typecheck + browser check**

Run: `bunx tsc --noEmit` (expected clean once Task 7 is done).
Start the dev server (`bun run dev`), open `/register`, confirm the top bar shows and links to `/marketplace` and `/dashboard`, and the pricing step shows the live human rate as you change the price.

- [ ] **Step 4: Commit**

```bash
git add src/routes/register.tsx
git commit -m "feat(web): register page top nav + live human-rate readout"
```

---

### Task 5: Landing page — remove the false stats and testimonials

**Files:**
- Modify: `src/routes/index.tsx:170-213`

- [ ] **Step 1: Replace the fabricated stats + testimonials block**

In `src/routes/index.tsx`, replace the whole block from the "Real-time" heading through the testimonials grid (the section spanning roughly lines 170-213: the `12,847` stats array and the two named quotes) with an honest "how it works" strip and real capabilities:

```tsx
          <div className="text-center">
            <div className="text-[11px] uppercase tracking-[0.18em] text-glow">How it works</div>
            <h2 className="mt-3 text-3xl md:text-4xl font-display italic text-white">
              List, match, stream.
            </h2>
          </div>
          <div className="mt-12 grid md:grid-cols-3 gap-6 text-center">
            {[
              { t: "List a service", d: "Run your endpoint, set a per-unit price, register it. GPU, CPU, full servers, storage, VPN, or workers." },
              { t: "The broker matches", d: "An AI broker reasons over live listings and picks one for the renter, honestly and on their terms." },
              { t: "Stream USDC per unit", d: "Payment settles per unit over x402 on Arc. Renters only pay for what actually runs." },
            ].map((s) => (
              <div key={s.t} className="rounded-xl border border-border bg-card p-6">
                <div className="text-lg font-semibold text-white">{s.t}</div>
                <div className="mt-2 text-sm text-white/60 leading-relaxed">{s.d}</div>
              </div>
            ))}
          </div>
          <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { v: "6", lbl: "Service types" },
              { v: "x402", lbl: "Streaming settlement" },
              { v: "Arc", lbl: "Settlement chain" },
              { v: "REST + MCP", lbl: "Agent-native API" },
            ].map((s) => (
              <div key={s.lbl}>
                <div className="text-2xl md:text-3xl font-semibold text-white">{s.v}</div>
                <div className="mt-1 text-[11px] text-white/50 uppercase tracking-wider">{s.lbl}</div>
              </div>
            ))}
          </div>
```

Note: this removes the `0+ rents and counting` heading, the invented stat numbers, and both named testimonials. If `Award` or other icon imports become unused after this edit, remove them from the top import to keep tsc/lint clean.

- [ ] **Step 2: Typecheck + browser check**

Run: `bunx tsc --noEmit`
Open `/`, confirm no `12,847` / `99.97%` / testimonials remain and the new strip renders. Console clean.

- [ ] **Step 3: Commit**

```bash
git add src/routes/index.tsx
git commit -m "fix(web): remove fabricated landing stats and testimonials, honest how-it-works"
```

---

### Task 6: In-app docs rewrite (real product + listing/renting guides + API)

**Files:**
- Modify: `src/routes/docs.tsx`

- [ ] **Step 1: Rewrite the section content**

`src/routes/docs.tsx` renders `<Section id title>` blocks and a `sections` nav array `{id, title}`. Update the `sections` array to:

```ts
const sections = [
  { id: "start", title: "Getting started" },
  { id: "list", title: "List a service" },
  { id: "rent", title: "Rent a service" },
  { id: "pricing", title: "How pricing works" },
  { id: "broker", title: "The AI broker" },
  { id: "settlement", title: "Streaming payments" },
  { id: "types", title: "Service types" },
  { id: "api", title: "API & MCP reference" },
] as const;
```

Then replace the rendered `<Section>` bodies with the following real content (keep the existing `<Section>` component and page layout; only the sections and their children change):

```tsx
      <Section id="start" title="Getting started">
        <p>Connect a wallet to sign in (RainbowKit + SIWE). Signing in provisions a spend wallet the platform custodies for you: fund it with testnet USDC, and it pays for rents automatically as they stream. From there you can rent a service or list one of your own.</p>
      </Section>

      <Section id="list" title="List a service">
        <p>Listing means running your own service endpoint and registering it so the broker can route renters to you. The steps:</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Run your service behind a public HTTPS endpoint. For compute this is an x402 seller that charges per unit (use the provider server template in <code>services/</code> as a starting point); the endpoint is where renters and the meter reach you.</li>
          <li>Pick a per-unit price. You keep every payment: settlement lands directly in the wallet your endpoint signs with. Prime Compute never holds your earnings.</li>
          <li>Register the service: on <a href="/register">List a server</a>, or for agents <code>POST /api/v1/providers</code> with your alias, endpoint URL, region, price, and type-specific specs.</li>
          <li>Stay online. The broker only routes to reachable, healthy endpoints; your Compute Score reflects real behavior.</li>
        </ol>
      </Section>

      <Section id="rent" title="Rent a service">
        <p>Renting gives you real credentials to a real service. The steps:</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Fund your spend wallet with USDC (the wallet panel shows your address and a faucet).</li>
          <li>Rent: pick a listing on the <a href="/marketplace">marketplace</a>, or for agents <code>POST /api/v1/rents</code>. The broker matches you a provider and the lease goes live.</li>
          <li>Use what you get. The connect payload depends on the type: SSH host + credentials for compute, a WireGuard profile for VPN, bucket URL + keys for storage, a submit URL + token for a worker. Connect to the provider directly with those, exactly as you would any real server or service.</li>
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
          <li><b>GPU / CPU / Full Server</b> — time-metered compute; connect over SSH.</li>
          <li><b>Worker</b> — time-metered job runner; connect via a submit URL + token.</li>
          <li><b>Storage</b> — GB-hour metered; connect via a bucket URL + access keys.</li>
          <li><b>VPN</b> — GB metered; connect by loading the returned WireGuard profile.</li>
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
```

(If the existing `Section` children are plain strings, wrapping them in the richer JSX above is fine; the component renders `children`.)

- [ ] **Step 2: Typecheck + browser check**

Run: `bunx tsc --noEmit`
Open `/docs`, confirm the eight sections render, the nav lists them, and links work. Console clean.

- [ ] **Step 3: Commit**

```bash
git add src/routes/docs.tsx
git commit -m "docs(web): rewrite in-app docs for the real product + listing/renting guides"
```

---

### Task 7: Lantern mark — logo matches the favicon

**Files:**
- Create: `src/components/site/LanternMark.tsx`
- Modify: `src/components/site/Sidebar.tsx` (two `Boxes` spots + the import)
- Modify: `src/components/site/Footer.tsx` (one `Boxes` spot + the import)

- [ ] **Step 1: Create `src/components/site/LanternMark.tsx`**

Inline SVG matching `public/favicon.svg` (the lantern), sized by className:

```tsx
// src/components/site/LanternMark.tsx
// The Prime Compute / Lumen lantern, matching public/favicon.svg, as an inline SVG so the in-app
// logo is brand-consistent with the favicon. Sized via className (default h-4 w-4).
export function LanternMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="32" cy="34" r="20" fill="#ff963c" fillOpacity="0.18" />
      <circle cx="32" cy="34" r="13" fill="#ff963c" fillOpacity="0.22" />
      <path d="M32 9 v6" stroke="#caa15a" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="32" cy="17" r="3" fill="none" stroke="#caa15a" strokeWidth="2.5" />
      <path d="M22 44 q-2 -20 10 -23 q12 3 10 23 z" fill="#16203c" stroke="#3a5ba8" strokeWidth="2" />
      <circle cx="32" cy="36" r="8" fill="#ffd98a" />
      <circle cx="32" cy="36" r="3.5" fill="#fff3d0" />
      <rect x="24" y="46" width="16" height="4" rx="2" fill="#caa15a" />
    </svg>
  );
}
```

- [ ] **Step 2: Swap `Boxes` in Sidebar**

In `src/components/site/Sidebar.tsx`: remove `Boxes,` from the `lucide-react` import, and add `import { LanternMark } from "./LanternMark";`. Replace both `<Boxes className="h-4 w-4" />` occurrences (in `Brand` and in the desktop sidebar header) with `<LanternMark className="h-4 w-4" />`.

- [ ] **Step 3: Swap `Boxes` in Footer**

In `src/components/site/Footer.tsx`: replace `import { Boxes } from "lucide-react";` with `import { LanternMark } from "./LanternMark";` and `<Boxes className="h-4 w-4" />` with `<LanternMark className="h-4 w-4" />`.

- [ ] **Step 4: Typecheck + browser check**

Run: `bunx tsc --noEmit`
Open any app page, confirm the sidebar/footer now show the lantern (not the hexagon), matching the favicon. Console clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/site/LanternMark.tsx src/components/site/Sidebar.tsx src/components/site/Footer.tsx
git commit -m "feat(web): in-app logo uses the lantern mark, matching the favicon"
```

---

### Task 8: Make the wallet reachable from the sidebar

**Files:**
- Modify: `src/components/site/AppShell.tsx` (host the WalletSheet + pass `onOpenWallet`)
- Modify: `src/components/site/Sidebar.tsx` (a "Wallet" button that calls `onOpenWallet`)

- [ ] **Step 1: Host the WalletSheet in AppShell**

In `src/components/site/AppShell.tsx`, add imports:

```ts
import { WalletSheet } from "./WalletSheet";
import { useSession } from "@/lib/auth/session";
```

Inside `AppShell`, add state + the session token, and pass `onOpenWallet` to `Sidebar`, and render the sheet:

```tsx
  const [lumenOpen, setLumenOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const { session } = useSession();
```

Change `<Sidebar onOpenLumen={() => setLumenOpen(true)} />` to:

```tsx
      <Sidebar onOpenLumen={() => setLumenOpen(true)} onOpenWallet={() => setWalletOpen(true)} />
```

And before the closing `</div>` of the shell, add:

```tsx
      <WalletSheet open={walletOpen} onClose={() => setWalletOpen(false)} accessToken={session?.access_token} />
```

- [ ] **Step 2: Add the Wallet entry to the Sidebar**

In `src/components/site/Sidebar.tsx`, extend the `Sidebar` prop type and render a Wallet button among the nav. Change the signature:

```tsx
export function Sidebar({ onOpenLumen, onOpenWallet }: { onOpenLumen?: () => void; onOpenWallet?: () => void }) {
```

The nav renders `navLinks` as `<Link>`s and the Lumen entry as a button (`LumenSidebarEntry`). Add a Wallet button next to the Lumen entry (same visual treatment as a nav item). Locate where `LumenSidebarEntry` is rendered in the nav and add immediately before it:

```tsx
          <button
            type="button"
            onClick={onOpenWallet}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white transition w-full"
          >
            <Wallet className="h-4 w-4" />
            Wallet
          </button>
```

(`Wallet` is already imported in `Sidebar.tsx`.)

- [ ] **Step 3: Typecheck + browser check**

Run: `bunx tsc --noEmit`
Open `/dashboard` (or any app page), click the sidebar "Wallet" entry, confirm the WalletSheet opens with balance/address/withdraw. Console clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/site/AppShell.tsx src/components/site/Sidebar.tsx
git commit -m "feat(web): persistent Wallet entry in the sidebar opens the wallet sheet"
```

---

### Task 9: Provider dashboard — honest payout copy

**Files:**
- Modify: `src/routes/provider.tsx` (the "Payout wallet" settings block + the earnings label)

- [ ] **Step 1: Reword the payout block and drop the fake minimum**

In `src/routes/provider.tsx`, replace the "Payout wallet" settings block:

```tsx
              <div className="glass-card p-6 space-y-4">
                <h3 className="font-semibold">Payout wallet</h3>
                <Input readOnly value={walletAddress ?? "—"} className="font-mono bg-card border-border" />
                <Label>Minimum payout</Label>
                <Input defaultValue="50" className="bg-card border-border" />
              </div>
```

with:

```tsx
              <div className="glass-card p-6 space-y-3">
                <h3 className="font-semibold">Earnings & payout</h3>
                <p className="text-sm text-muted-foreground">
                  You're paid directly on-chain to the wallet your service endpoint signs with. Prime Compute never holds your earnings, so there's nothing to withdraw here — the money is already yours the moment a charge settles.
                </p>
                <Label>Identity wallet (attribution)</Label>
                <Input readOnly value={walletAddress ?? "—"} className="font-mono bg-card border-border" />
              </div>
```

- [ ] **Step 2: Clarify the "Total earned" label**

In the earnings tab, change the "across N rents" caption under Total earned so it reads as billed volume, not a withdrawable balance. Replace:

```tsx
                <div className="mt-1 text-xs text-muted-foreground">across {allRents.length} rent{allRents.length === 1 ? "" : "s"}</div>
```

with:

```tsx
                <div className="mt-1 text-xs text-muted-foreground">billed to renters across {allRents.length} rent{allRents.length === 1 ? "" : "s"} · paid directly to your endpoint wallet</div>
```

- [ ] **Step 3: Typecheck + browser check**

Run: `bunx tsc --noEmit`
Open `/provider` (authed), Settings tab, confirm the new copy and that the "Minimum payout" field is gone. Console clean.

- [ ] **Step 4: Commit**

```bash
git add src/routes/provider.tsx
git commit -m "fix(web): honest provider earnings/payout copy (self-custody, no fake minimum)"
```

---

### Task 10: Agent withdraw — pure service function

**Files:**
- Create: `src/lib/agents/withdraw.ts`
- Test: `src/lib/agents/withdraw.test.ts`

- [ ] **Step 1: Write the failing test (`src/lib/agents/withdraw.test.ts`)**

```ts
import { describe, test, expect } from "bun:test";
import { withdrawAgentFunds, parseUsdc, type WithdrawDeps } from "./withdraw";
import type { Principal } from "@services/domain";

const agent: Principal = { kind: "agent", id: "a1", walletAddress: "0x1111111111111111111111111111111111111111" };
const to = "0x2222222222222222222222222222222222222222";

function deps(over: Partial<WithdrawDeps> = {}): WithdrawDeps {
  return {
    findCircleWalletId: async () => null,
    circleTransfer: async () => "circle-tx",
    rawSigner: async () => async () => "raw-tx",
    ...over,
  };
}

describe("withdrawAgentFunds", () => {
  test("uses the Circle path when the agent has a Circle wallet", async () => {
    const r = await withdrawAgentFunds(agent, to, "1.5", deps({ findCircleWalletId: async () => "cw-1" }));
    expect(r.txHash).toBe("circle-tx");
  });

  test("falls back to the raw signer when there is no Circle wallet", async () => {
    const r = await withdrawAgentFunds(agent, to, "1.5", deps());
    expect(r.txHash).toBe("raw-tx");
  });

  test("rejects a bad destination address", async () => {
    await expect(withdrawAgentFunds(agent, "nope", "1", deps())).rejects.toThrow(/destination address/);
  });

  test("rejects a non-positive amount", async () => {
    await expect(withdrawAgentFunds(agent, to, "0", deps())).rejects.toThrow(/positive/);
  });

  test("rejects a non-agent principal", async () => {
    const user: Principal = { kind: "user", id: "u1", walletAddress: "0x0" };
    await expect(withdrawAgentFunds(user, to, "1", deps())).rejects.toThrow(/agent/);
  });

  test("parseUsdc handles decimals to 6 places", () => {
    expect(parseUsdc("1.5")).toBe(1_500_000n);
    expect(() => parseUsdc("1.1234567")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/lib/agents/withdraw.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/agents/withdraw.ts`**

```ts
// src/lib/agents/withdraw.ts
// Withdraw USDC from an agent's custodied wallet, symmetric to the user's withdrawFromSpendWallet.
// Circle-controlled wallets go through Circle's createTransaction; legacy raw wallets are signed
// locally. All I/O is injected so the logic is unit-tested without network or Supabase.
import type { Principal } from "@services/domain";

export type WithdrawDeps = {
  findCircleWalletId: (agentId: string) => Promise<string | null>;
  circleTransfer: (walletId: string, toAddress: string, amount: string) => Promise<string>; // -> tx id
  rawSigner: (agentId: string) => Promise<((toAddress: string, atomic: bigint) => Promise<string>) | null>;
};

export function parseUsdc(s: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(s.trim())) throw new Error("invalid amount");
  const [whole, frac = ""] = s.trim().split(".");
  return BigInt(whole + frac.padEnd(6, "0"));
}

export async function withdrawAgentFunds(
  principal: Principal,
  toAddress: string,
  amount: string,
  deps: WithdrawDeps,
): Promise<{ txHash: string }> {
  if (principal.kind !== "agent") throw new Error("agent principal required");
  if (!/^0x[0-9a-fA-F]{40}$/.test(toAddress)) throw new Error("invalid destination address");
  const atomic = parseUsdc(amount);
  if (atomic <= 0n) throw new Error("amount must be positive");

  const circleId = await deps.findCircleWalletId(principal.id);
  if (circleId) return { txHash: await deps.circleTransfer(circleId, toAddress, amount) };

  const signer = await deps.rawSigner(principal.id);
  if (!signer) throw new Error("no wallet for agent");
  return { txHash: await signer(toAddress, atomic) };
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/lib/agents/withdraw.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/withdraw.ts src/lib/agents/withdraw.test.ts
git commit -m "feat(api): agent withdraw service function (circle + raw paths)"
```

---

### Task 11: Wire agent withdraw into POST /api/v1/wallet

**Files:**
- Modify: `src/routes/api.v1.wallet.ts`

- [ ] **Step 1: Add the POST handler**

In `src/routes/api.v1.wallet.ts`, add a `POST` handler alongside the existing `GET`. It parses the body, `authAgent`s, builds live deps, and calls `withdrawAgentFunds`. Add the handler inside `handlers`:

```ts
      POST: async ({ request }) => {
        const principal = await authAgent(request);
        if (principal instanceof Response) return principal;
        let body: { toAddress?: unknown; amount?: unknown };
        try { body = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
        if (typeof body.toAddress !== "string" || typeof body.amount !== "string") {
          return json({ error: "toAddress and amount are required strings" }, 400);
        }
        const { withdrawAgentFunds } = await import("@/lib/agents/withdraw");
        const { supabaseAdmin } = await import("@/lib/supabase/server");
        const { getOnchain } = await import("@/lib/wallet/store");
        const { walletStoreFor } = await import("@/lib/marketplace/wallet");
        try {
          const result = await withdrawAgentFunds(principal, body.toAddress, body.amount, {
            findCircleWalletId: async (agentId) => {
              const { data } = await supabaseAdmin()
                .from("circle_wallets").select("wallet_id")
                .eq("owner_kind", "agent").eq("owner_id", agentId).maybeSingle();
              return (data?.wallet_id as string | undefined) ?? null;
            },
            circleTransfer: async (walletId, toAddress, amount) => {
              const { makeCircleClient } = await import("@services/wallet/circle");
              const res: any = await makeCircleClient().createTransaction({
                walletId, tokenAddress: process.env.USDC_ADDRESS!, blockchain: "ARC-TESTNET" as any,
                destinationAddress: toAddress, amount: [amount], fee: { type: "level", config: { feeLevel: "MEDIUM" } },
              });
              return res.data?.id as string;
            },
            rawSigner: async (agentId) => {
              const signer = await walletStoreFor(principal).loadSigner(agentId);
              if (!signer) return null;
              return (toAddress, atomic) => getOnchain().usdcTransfer(signer, toAddress, atomic);
            },
          });
          return json(result);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "withdraw failed" }, 400);
        }
      },
```

Ensure the top imports include `json` and `authAgent` (the file already imports both for GET). No new top-level import is required beyond what the dynamic imports cover.

- [ ] **Step 2: Add a route-level auth test**

Add to (or create) `src/routes/api.v1.wallet.test.ts` a check that a POST without a key is rejected. If the repo has no route tests for this file, mirror the smoke style used by other `api.v1.*` tests; at minimum assert `authAgent` rejects. If no HTTP harness exists, skip the route test and rely on Task 10's unit tests plus the manual curl in Step 3 — do not invent a harness.

- [ ] **Step 3: Manual verification (documented, run if a key is available)**

```bash
# with a valid agent key in $KEY against the dev server:
curl -sS -X POST localhost:8080/api/v1/wallet -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{"toAddress":"0x0000000000000000000000000000000000000000","amount":"0.01"}'
# expect a { txHash } on success or a 400 { error } (e.g. insufficient balance), NOT a 500/404.
```

- [ ] **Step 4: Typecheck + commit**

```bash
bunx tsc --noEmit
git add src/routes/api.v1.wallet.ts src/routes/api.v1.wallet.test.ts
git commit -m "feat(api): POST /api/v1/wallet withdraws USDC from an agent's wallet"
```

---

### Task 12: MCP withdraw_funds tool

**Files:**
- Modify: `mcp/src/client.ts` (add `withdraw`)
- Modify: `mcp/src/index.ts` (register the tool)

- [ ] **Step 1: Add `withdraw` to PrimeClient**

In `mcp/src/client.ts`, add next to `walletBalance()`:

```ts
  withdraw(toAddress: string, amount: string) { return this.call("/api/v1/wallet", "POST", { toAddress, amount }); }
```

- [ ] **Step 2: Register the `withdraw_funds` tool**

In `mcp/src/index.ts`, after the `wallet_balance` tool registration, add:

```ts
server.registerTool(
  "withdraw_funds",
  {
    description: "Withdraw USDC from your agent wallet to an external address",
    inputSchema: { toAddress: z.string(), amount: z.string() },
  },
  async (a) => asText(await client.withdraw(a.toAddress, a.amount)),
);
```

- [ ] **Step 3: Typecheck**

Run: `cd mcp && bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add mcp/src/client.ts mcp/src/index.ts
git commit -m "feat(mcp): withdraw_funds tool over POST /api/v1/wallet"
```

---

### Task 13: Full gates and browser verification

**Files:** none (verification only)

- [ ] **Step 1: Run every gate**

```bash
bun test src
cd mcp && bun test && bunx tsc --noEmit && cd ..
bunx tsc --noEmit
bun run build
```

Expected: web + mcp tests green (the pre-existing env-gated live-Supabase tests, `profiles.contract` and `SupabaseSpendWalletStore (live)`, fail without creds at repo root and are not regressions), both tsc clean, build succeeds.

- [ ] **Step 2: Browser preview pass**

Dev server up (`bun run dev`, :8080). Verify:
- `/` — no `12,847` / `99.97%` / testimonials; the how-it-works strip renders.
- `/marketplace` — cards show streaming + human rate; our seeded listing shows a "Simulation" badge, a non-seed one doesn't.
- `/register` — top nav links back to marketplace/dashboard; the pricing step shows the live human rate; per-type fields still render (Task from prior plan).
- sidebar/footer show the lantern mark, matching the favicon tab icon.
- sidebar "Wallet" entry opens the WalletSheet.
- `/provider` (authed) Settings — self-custody copy, no "Minimum payout".
- `/docs` — the eight rewritten sections render.
Screenshot the marketplace (badge + rate) for the user. Console clean throughout.

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "chore: marketplace clarity + wallet completeness gate fixes"
```

---

## Self-review notes

- Spec coverage: rate helper (T1) + rendering (T2); simulation badge (T3); register readout+nav (T4); landing (T5); docs + guides (T6); logo=favicon (T7); wallet discoverability (T8); provider honesty (T9); agent withdraw fn (T10) + route (T11) + MCP (T12); gates (T13). Every spec section maps to a task.
- Type consistency: `rateDisplay(resourceType, pricePerCharge)` returns `{streaming, human, unit}`, used identically in T2/T4; `isFirstParty(provider, wallets?)` from T3 used in ProviderCard; `withdrawAgentFunds(principal, toAddress, amount, deps)` from T10 consumed by T11; `PrimeClient.withdraw` from T12 hits the T11 route; `LanternMark` from T7 used in T4/T7.
- Watch items: `LanternMark` (T7) is referenced by the register nav (T4) — do T7 before T4's tsc, or accept a transient missing-import until T7. The `api.v1.wallet.test.ts` route test (T11 Step 2) is best-effort: only add it if a matching HTTP harness already exists, else rely on T10 unit tests. `VITE_FIRST_PARTY_WALLETS` is optional; the default seed-wallet set covers our current listings.
```
