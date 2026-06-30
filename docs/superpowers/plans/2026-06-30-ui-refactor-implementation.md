# UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's blue-tinted neutral palette with a desaturated near-black scale, retire the decorative neon/glow/gradient layer, restyle the sidebar with a workspace-switcher header and account-footer overflow menu, and convert the dashboard/provider "live and running" cards from always-visible control panels into click-to-open detail sheets, with zero changes to the underlying rent/provider write-path behavior.

**Architecture:** Pure CSS-token + JSX-restructuring work. One new shared presentational component (`OperationalTile`) backs the dashboard, provider, and marketplace tile patterns. Two new `Sheet`-based detail panels (already-used Radix primitive) carry the pause/resume/cancel and online/offline controls that used to live directly on the cards. No new server functions, no new state shapes beyond local UI state (which rent/server is selected).

**Tech Stack:** React 19, TanStack Router/Query, Tailwind v4 (`@theme inline` + oklch tokens in `src/styles.css`), Radix UI primitives (`@/components/ui/*`), `framer-motion` (already a dependency), `lucide-react` icons.

**Source spec:** [`docs/superpowers/specs/2026-06-30-ui-refactor-design.md`](../specs/2026-06-30-ui-refactor-design.md)

---

## Before you start

Run these once to get your bearings — every task below assumes a clean tree on top of current `main`:

```bash
git status
npx tsc --noEmit
```

Both should be clean before Task 1.

---

### Task 1: Desaturate the design tokens, retire dead/decorative CSS

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Replace the `:root` token block**

In `src/styles.css`, replace the entire `:root { ... }` block (currently lines 71-110) with:

```css
:root {
  --radius: 0.875rem;
  /* Prime Compute neutral dark palette: desaturated near-black neutrals, brand colors unchanged. */
  --background: oklch(0.105 0.006 270);        /* #0d0d12 */
  --foreground: oklch(0.965 0.003 270);        /* #f5f5f7 */
  --surface: oklch(0.115 0.005 270);           /* #111116 */
  --card: oklch(0.145 0.008 270);              /* #16161d */
  --card-foreground: oklch(0.965 0.003 270);
  --popover: oklch(0.145 0.008 270);
  --popover-foreground: oklch(0.965 0.003 270);
  --primary: oklch(0.58 0.21 262);             /* #2563eb */
  --primary-foreground: oklch(0.98 0.005 250);
  --secondary: oklch(0.175 0.01 270);
  --secondary-foreground: oklch(0.965 0.003 270);
  --muted: oklch(0.16 0.008 270);
  --muted-foreground: oklch(0.60 0.012 270);   /* #8b8b96 */
  --accent: oklch(0.65 0.19 260);              /* #3b82f6 */
  --accent-foreground: oklch(0.98 0.005 250);
  --glow: oklch(0.76 0.14 255);                /* #60a5fa */
  --success: oklch(0.74 0.18 145);             /* #22c55e */
  --warning: oklch(0.78 0.16 70);              /* #f59e0b */
  --destructive: oklch(0.66 0.22 25);          /* #ef4444 */
  --destructive-foreground: oklch(0.98 0.005 250);
  --border: oklch(0.235 0.012 270);            /* #26262f */
  --input: oklch(0.175 0.01 270);
  --ring: oklch(0.65 0.19 260);
  --chart-1: oklch(0.65 0.19 260);
  --chart-2: oklch(0.76 0.14 255);
  --chart-3: oklch(0.74 0.18 145);
  --chart-4: oklch(0.78 0.16 70);
  --chart-5: oklch(0.66 0.22 25);
  --sidebar: oklch(0.125 0.006 270);           /* #111116, matches surface */
  --sidebar-foreground: oklch(0.965 0.003 270);
  --sidebar-primary: oklch(0.58 0.21 262);
  --sidebar-primary-foreground: oklch(0.98 0.005 250);
  --sidebar-accent: oklch(0.175 0.01 270);
  --sidebar-accent-foreground: oklch(0.965 0.003 270);
  --sidebar-border: oklch(0.235 0.012 270);
  --sidebar-ring: oklch(0.65 0.19 260);
}
```

(`--primary`, `--accent`, `--glow`, `--success`, `--warning`, `--destructive` are unchanged from the current file, per the spec — only the neutral chrome moves.)

- [ ] **Step 2: Replace the utilities block**

Replace everything from `@utility glass-card` through the final `.pulse-ring { ... }` line (currently lines 134-186) with:

```css
@utility glass-card {
  background-color: color-mix(in oklab, var(--color-card) 80%, transparent);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  transition: box-shadow 200ms ease, border-color 200ms ease, transform 200ms ease;
}

@utility glow-hover {
  &:hover {
    border-color: color-mix(in oklab, var(--color-accent) 60%, var(--color-border));
  }
}

@utility bg-dot-grid {
  background-image: radial-gradient(
    circle,
    color-mix(in oklab, var(--color-border) 90%, transparent) 1px,
    transparent 1px
  );
  background-size: 16px 16px;
}

@keyframes pulse-ring {
  0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--color-success) 60%, transparent); }
  70% { box-shadow: 0 0 0 10px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}

.pulse-ring { animation: pulse-ring 1.8s ease-out infinite; }
```

This removes `text-gradient-blue`, `bg-grid`, `.drift`/`.drift-slow`/`.twinkle` and their keyframes entirely, drops the `box-shadow` bloom from `glow-hover` (keeping only the border-color shift), and adds the new `bg-dot-grid` utility used by the operational-tile pattern in later tasks.

- [ ] **Step 3: Confirm nothing else references the removed utilities yet**

```bash
grep -rn "text-gradient-blue\|bg-grid\|\bdrift\b\|drift-slow\|twinkle" src --include="*.tsx"
```

Expected: 5 hits for `text-gradient-blue` (`dashboard.tsx` ×2, `marketplace.index.tsx` ×1, `provider.tsx` ×2) and nothing for the rest. Those 5 get fixed in Tasks 7 and 8 below — at the end of this task `tsc` will not yet be clean because of them, which is expected and resolved later. Confirm the `bg-grid`/`drift`/`twinkle` greps are empty (they were already dead code).

- [ ] **Step 4: Commit**

```bash
git add src/styles.css
git commit -m "$(cat <<'EOF'
refactor(ui-tokens): desaturate the neutral palette, drop dead/decorative CSS

The neutral scale (background/surface/card/border/foreground/muted-foreground)
carried blue chroma left over from the original navy theme. Bring it down to a
near-neutral gray scale and drop the glow-hover box-shadow bloom plus unused
bg-grid/drift/twinkle keyframes while here. Brand colors (primary, accent,
glow, success, warning, destructive) are untouched.
EOF
)"
```

---

### Task 2: Remove the ad-hoc neon shadow on the Lumen FAB

**Files:**
- Modify: `src/components/site/LumenOverlay.tsx:383`

- [ ] **Step 1: Drop the inline shadow**

In `LumenFab`, change:

```tsx
      className="fixed bottom-20 right-4 z-30 md:bottom-6 md:right-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_30px_-6px_color-mix(in_oklab,var(--color-glow)_70%,transparent)] transition hover:scale-105 active:scale-95"
```

to:

```tsx
      className="fixed bottom-20 right-4 z-30 md:bottom-6 md:right-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:scale-105 active:scale-95"
```

(The Sidebar's matching ad-hoc shadow on its "Get Started" button gets removed as part of the account-footer rewrite in Task 5, not here.)

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: no new errors introduced by this change (pre-existing `text-gradient-blue` errors, if any, are unrelated — there are none, since `text-gradient-blue` is a CSS class name, not a TS symbol; `tsc` should be fully clean after this step).

- [ ] **Step 3: Commit**

```bash
git add src/components/site/LumenOverlay.tsx
git commit -m "$(cat <<'EOF'
refactor(ui): drop the neon shadow on the Lumen floating action button

Part of retiring the decorative glow/shadow layer across the app.
EOF
)"
```

---

### Task 3: Neutral hero background

**Files:**
- Modify: `src/components/site/HeroGradient.tsx`

- [ ] **Step 1: Replace the whole file**

```tsx
export function HeroGradient() {
  return (
    <div aria-hidden className="absolute inset-0 -z-10 bg-background">
      <div
        className="absolute -top-24 -right-24 h-[480px] w-[480px] rounded-full opacity-20 blur-3xl"
        style={{
          background: "radial-gradient(circle, var(--color-glow), transparent 70%)",
        }}
      />
    </div>
  );
}
```

This replaces the bright blue linear-gradient wash and the 50%-opacity radial blob with the neutral background plus one static, low-opacity corner glow.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/site/HeroGradient.tsx
git commit -m "$(cat <<'EOF'
refactor(landing): neutral hero background, drop the bright blue wash

Matches the new desaturated palette: one static, low-opacity corner glow
instead of a full-bleed blue gradient and animated-looking radial blob.
EOF
)"
```

---

### Task 4: Choreographed hero demo (replaces the abstract SVG diagram)

**Files:**
- Modify: `src/components/site/HeroCanvas.tsx`

- [ ] **Step 1: Replace the whole file**

```tsx
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
```

This drops the abstract animated SVG node diagram entirely. `navLinks` is imported from `./Sidebar` (already exported there) so the demo's nav items can never drift out of sync with the real sidebar's labels, order, or icons — only `/marketplace` and `/dashboard` are demoed since those are the two views that exist as simplified mockups here; `/provider` and `/docs` stay in the nav list (matching the real sidebar) but aren't cycled to. A `setInterval` toggles between the two views every 3.2s, the content area crossfades via `AnimatePresence`, and a `MousePointer2` icon springs to the active nav row's vertical position to sell the "click happened here" illusion.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: clean. `navLinks` must be importable from `./Sidebar` without changes to that file (it's already exported — confirm with `grep -n "export const navLinks" src/components/site/Sidebar.tsx`).

- [ ] **Step 3: Manual check**

```bash
npm run dev
```

Open `/` in a browser, scroll to the hero demo, and confirm: the cursor icon moves between two row positions, the content area crossfades between a "Dashboard" view and a "Marketplace" view, and it loops without erroring in the console. Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add src/components/site/HeroCanvas.tsx
git commit -m "$(cat <<'EOF'
refactor(landing): hero demo becomes a choreographed product walkthrough

Replaces the abstract animated node-graph SVG with real component markup
(scaled sidebar + content area) and a simulated cursor that crossfades
between Dashboard and Marketplace, looping. Built with framer-motion
(already a dependency) rather than a recorded video.
EOF
)"
```

---

### Task 5: Sidebar — workspace-switcher header, refined nav pill, account-footer overflow menu

**Files:**
- Modify: `src/components/site/Sidebar.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/components/site/Sidebar.tsx`, change:

```tsx
import { Link, useRouterState } from "@tanstack/react-router";
import { Boxes, LayoutDashboard, Store, Server, BookOpen, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth/session";
import { LumenSidebarEntry } from "./LumenOverlay";
```

to:

```tsx
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Boxes,
  LayoutDashboard,
  Store,
  Server,
  BookOpen,
  Wallet,
  ChevronsUpDown,
  MoreVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth/session";
import { walletChainSegment } from "@/lib/circle/chain";
import { LumenSidebarEntry } from "./LumenOverlay";
```

- [ ] **Step 2: Replace the desktop `Sidebar` function**

Replace the entire `export function Sidebar(...)` block (currently lines 39-121) with:

```tsx
export function Sidebar({ onOpenLumen }: { onOpenLumen?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { session, walletAddress, signOut } = useSession();

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col sticky top-0 h-screen border-r border-sidebar-border bg-sidebar">
      <Link to="/" className="h-16 flex items-center gap-2.5 px-4 border-b border-sidebar-border group">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-glow ring-1 ring-primary/30 group-hover:ring-primary/60 transition">
          <Boxes className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold tracking-tight text-white truncate">
            Prime Compute
          </div>
          <div className="text-[11px] text-sidebar-foreground/50 font-mono truncate">
            {walletChainSegment}
          </div>
        </div>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/40" />
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-1" aria-label="Primary">
        {navLinks.map((l) => {
          const active = pathname === l.to || pathname.startsWith(l.to + "/");
          const Icon = l.icon;
          return (
            <Link
              key={l.to}
              to={l.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-full px-3 py-2 text-sm transition",
                active
                  ? "bg-sidebar-accent text-white"
                  : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-white/5",
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", active && "text-glow")} />
              <span>{l.label}</span>
            </Link>
          );
        })}

        {/* Lumen AI assistant entry */}
        {onOpenLumen && (
          <div className="mt-2 pt-2 border-t border-sidebar-border/50">
            <LumenSidebarEntry onClick={onOpenLumen} />
          </div>
        )}
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        {session ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-white/5 transition">
                <span className="h-1.5 w-1.5 rounded-full bg-success pulse-ring shrink-0" />
                <span className="flex-1 text-left font-mono text-xs truncate">
                  {shortWallet(walletAddress)}
                </span>
                <MoreVertical className="h-4 w-4 shrink-0 text-sidebar-foreground/40" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover border-border">
              <DropdownMenuItem onClick={() => signOut()}>
                <Wallet className="h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            asChild
            size="sm"
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Link to="/onboarding" search={{ redirect: pathname }}>
              Get Started
            </Link>
          </Button>
        )}
      </div>
    </aside>
  );
}
```

Notes on what changed: the plain brand-only header is now a workspace-switcher row (logo, "Prime Compute", the wallet's chain as a small label underneath, a trailing chevron — no dropdown behavior yet, matching the spec's "visual structure only, single chain today"). The active-nav pill is `rounded-full` instead of `rounded-md` with a ring, for the refined-pill look. The signed-in footer collapses the old two-button stack (status row + separate "Sign out" button) into one row with a kebab (`MoreVertical`) trigger opening a `DropdownMenu` containing "Sign out" — this also removes the redundant disabled "Not signed in" ghost button in the signed-out state and drops the ad-hoc neon shadow on the "Get Started" button (its `shadow-[0_0_24px...]` class is gone).

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Manual check**

```bash
npm run dev
```

Visit any app page (e.g. `/marketplace`) at desktop width both signed out (confirm the restyled "Get Started" button, no neon halo) and signed in (confirm the workspace header shows "Prime Compute" / `baseSepolia`, the active nav item renders as a filled pill, and clicking the kebab menu in the footer opens a menu with a working "Sign out" item). Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add src/components/site/Sidebar.tsx
git commit -m "$(cat <<'EOF'
refactor(sidebar): workspace-switcher header, refined nav pill, account-footer overflow menu

Replaces the brand-only header with a workspace-switcher row (logo, app
name, current chain, chevron), refines the active-nav indicator to a
filled pill, and collapses the signed-in footer into a single status
row with a kebab menu for sign-out instead of a stacked button list.
No auth logic changes — this is a relayout of useSession() state that
was already there.
EOF
)"
```

---

### Task 6: Shared `OperationalTile` component

**Files:**
- Create: `src/components/site/OperationalTile.tsx`

- [ ] **Step 1: Write the component**

```tsx
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
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: clean (the component isn't imported anywhere yet, so this just checks it compiles standalone).

- [ ] **Step 3: Commit**

```bash
git add src/components/site/OperationalTile.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add the shared OperationalTile component

A click-to-open tile (name header, dotted-grid preview, status row) for
anything live and running. Backs the dashboard active-rents tiles, the
provider my-servers tiles, and the marketplace provider tiles, each
wired to their own detail panel or destination.
EOF
)"
```

---

### Task 7: Dashboard — active-rent tiles open a detail sheet

**Files:**
- Modify: `src/routes/dashboard.tsx`

- [ ] **Step 1: Replace the whole file**

```tsx
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { authGuard } from "../lib/auth/guard";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Square, Copy, Cpu } from "lucide-react";
import { AppShell } from "@/components/site/AppShell";
import { OperationalTile } from "@/components/site/OperationalTile";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StreamingTicker, ElapsedTimer } from "@/components/site/StreamingTicker";
import { useSession } from "@/lib/auth/session";
import { listMyRents, listProviders, pauseRent, resumeRent, cancelRent } from "@/lib/broker/server-fns";
import { canPause, canResume, canCancel } from "@services/rent-transitions";
import type { Provider, Rent, RentStatus } from "@services/domain";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: authGuard,
  head: () => ({
    meta: [
      { title: "Consumer Dashboard — Prime Compute" },
      { name: "description", content: "Monitor your active rents, history, and streaming spend." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { session } = useSession();
  const accessToken = session?.access_token;
  const [selectedRentId, setSelectedRentId] = useState<string | null>(null);

  const { data: rents = [] } = useQuery({
    queryKey: ["rents", "mine", accessToken],
    queryFn: () => listMyRents({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken,
  });
  const { data: providers = [] } = useQuery({
    queryKey: ["providers"],
    queryFn: () => listProviders(),
  });
  const providersById = Object.fromEntries(providers.map((p) => [p.id, p]));

  const activeRents = rents.filter((r) => r.status === "running" || r.status === "queued" || r.status === "paused");
  const historyRents = rents.filter((r) => r.status === "completed" || r.status === "cancelled" || r.status === "failed");
  const runningRents = rents.filter((r) => r.status === "running");
  const streamingRate = runningRents.reduce(
    (acc, r) => acc + (r.providerId ? (providersById[r.providerId]?.pricePerCharge ?? 0) : 0),
    0,
  );
  const totalSpent = rents.reduce((s, r) => s + r.totalCost, 0);
  const selectedRent = rents.find((r) => r.id === selectedRentId) ?? null;

  return (
    <>
      <AppShell>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
          <div className="text-[11px] uppercase tracking-wider text-glow">Consumer</div>
          <h1 className="mt-1 text-3xl md:text-4xl font-bold">Dashboard</h1>

          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success pulse-ring" />
              {runningRents.length} rents running
            </span>
            <span>
              streaming <span className="text-glow font-mono">${streamingRate.toFixed(7)}/sec</span>
            </span>
          </div>

          <Tabs defaultValue="active" className="mt-8">
            <TabsList className="bg-surface border border-border">
              <TabsTrigger value="active">Active rents</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="billing">Billing</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="active" className="mt-6 grid gap-4 lg:grid-cols-2">
              {activeRents.map((r) => (
                <OperationalTile
                  key={r.id}
                  title={r.name}
                  subtitle={`on ${r.providerId ? providersById[r.providerId]?.alias ?? "unmatched" : "unmatched"}`}
                  icon={Cpu}
                  statusLabel={r.status}
                  statusTone={r.status === "running" ? "success" : r.status === "paused" ? "warning" : "neutral"}
                  pulse={r.status === "running"}
                  onClick={() => setSelectedRentId(r.id)}
                />
              ))}
              {activeRents.length === 0 && (
                <div className="col-span-full glass-card p-10 text-center text-muted-foreground">
                  No active rents. Head to the marketplace to rent some compute.
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-6 glass-card p-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-muted-foreground text-left">
                    <th className="py-2">Rent</th>
                    <th>Provider</th>
                    <th>Duration</th>
                    <th>Cost</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {historyRents.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2">{r.name}</td>
                      <td className="text-muted-foreground">{r.providerId ? providersById[r.providerId]?.alias ?? "—" : "—"}</td>
                      <td>{r.startedAt && r.endedAt ? `${Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000)}m` : "—"}</td>
                      <td>${r.totalCost.toFixed(4)}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td className="text-muted-foreground text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {historyRents.length === 0 && (
                    <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No completed rents yet.</td></tr>
                  )}
                </tbody>
              </table>
            </TabsContent>

            <TabsContent value="billing" className="mt-6 grid gap-6 lg:grid-cols-3">
              <div className="glass-card p-6 lg:col-span-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Total spent</div>
                <div className="mt-2 text-3xl font-bold text-foreground">${totalSpent.toFixed(4)}</div>
                <div className="mt-1 text-xs text-muted-foreground">across {rents.length} rent{rents.length === 1 ? "" : "s"}</div>
              </div>
            </TabsContent>

            <TabsContent value="settings" className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="glass-card p-6 space-y-4">
                <h3 className="font-semibold">Notifications</h3>
                {["Rent completed", "Rent failed", "Low balance", "Migration events"].map((l) => (
                  <div key={l} className="flex items-center justify-between">
                    <Label>{l}</Label>
                    <Switch defaultChecked />
                  </div>
                ))}
              </div>
              <div className="glass-card p-6 space-y-4">
                <h3 className="font-semibold">API key</h3>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value="pc_live_••••••••••••••sk29x"
                    className="font-mono bg-card border-border"
                  />
                  <Button variant="ghost" size="icon" className="border border-border">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <Label>Default payment</Label>
                <Input readOnly value="USDC · 0x4F…91Ae" className="font-mono bg-card border-border" />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </AppShell>

      <RentDetailSheet
        rent={selectedRent}
        provider={selectedRent?.providerId ? providersById[selectedRent.providerId] : undefined}
        onClose={() => setSelectedRentId(null)}
      />
    </>
  );
}

function RentDetailSheet({
  rent,
  provider,
  onClose,
}: {
  rent: Rent | null;
  provider: Provider | undefined;
  onClose: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [mutating, setMutating] = useState(false);
  const startedAtMs = rent?.startedAt ? new Date(rent.startedAt).getTime() : Date.now();

  async function mutate(fn: typeof pauseRent) {
    if (!rent || !session) {
      router.navigate({ to: "/onboarding", search: { redirect: router.state.location.pathname } });
      return;
    }
    setMutating(true);
    try {
      await fn({ data: { accessToken: session.access_token, rentId: rent.id } });
      await queryClient.invalidateQueries({ queryKey: ["rents", "mine"] });
    } finally {
      setMutating(false);
    }
  }

  return (
    <Sheet open={!!rent} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="bg-surface border-border">
        <SheetHeader>
          <SheetTitle>{rent?.name ?? "Rent"}</SheetTitle>
        </SheetHeader>
        {rent && (
          <div className="mt-6 space-y-5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">on {provider?.alias ?? "unmatched"}</span>
              <StatusBadge status={rent.status} />
            </div>
            <div className="glass-card p-4 flex items-end justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Streaming spend
                </div>
                <StreamingTicker
                  ratePerSecond={provider?.pricePerCharge ?? 0}
                  startedAt={startedAtMs}
                  paused={rent.status !== "running"}
                  className="text-2xl font-semibold text-foreground"
                />
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Elapsed</div>
                <div className="text-sm text-foreground">
                  <ElapsedTimer startedAt={startedAtMs} paused={rent.status !== "running"} />
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {canPause(rent) && (
                <Button variant="ghost" className="flex-1 border border-border" disabled={mutating} onClick={() => mutate(pauseRent)}>
                  <Pause className="h-4 w-4" /> Pause
                </Button>
              )}
              {canResume(rent) && (
                <Button variant="ghost" className="flex-1 border border-border" disabled={mutating} onClick={() => mutate(resumeRent)}>
                  <Pause className="h-4 w-4" /> Resume
                </Button>
              )}
              {canCancel(rent) && (
                <Button
                  variant="ghost"
                  className="flex-1 border border-destructive/30 text-destructive hover:bg-destructive/10"
                  disabled={mutating}
                  onClick={() => mutate(cancelRent)}
                >
                  <Square className="h-4 w-4" /> Stop
                </Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function StatusBadge({ status }: { status: RentStatus }) {
  const map: Record<RentStatus, string> = {
    completed: "bg-success/15 text-success border-success/30",
    cancelled: "bg-warning/15 text-warning border-warning/30",
    failed: "bg-destructive/15 text-destructive border-destructive/30",
    running: "bg-primary/15 text-glow border-primary/30",
    paused: "bg-muted/40 text-muted-foreground border-border",
    queued: "bg-muted/40 text-muted-foreground border-border",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${map[status]}`}
    >
      {status}
    </span>
  );
}
```

What changed and why: the old `ActiveRentCard` (card with always-visible Pause/Resume/Stop buttons) is gone. Each active rent now renders as an `OperationalTile`; clicking one sets `selectedRentId`, which opens `RentDetailSheet` — the same `pauseRent`/`resumeRent`/`cancelRent` calls, gated by the same `canPause`/`canResume`/`canCancel` from `services/src/rent-transitions.ts`, just relocated into the panel. The two `text-gradient-blue` call sites (`totalSpent` in the billing tab, the streaming-spend stat inside the new sheet) are now `text-foreground`.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Manual check**

```bash
npm run dev
```

Sign in, visit `/dashboard`, confirm active rents render as tiles (no buttons on the tile itself), clicking one opens a sheet with the status pill, streaming-spend ticker, elapsed timer, and the correct subset of Pause/Resume/Stop buttons for that rent's status, and that clicking a button still mutates the rent and the tile list updates after the sheet's mutation. Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add src/routes/dashboard.tsx
git commit -m "$(cat <<'EOF'
refactor(dashboard): active rents become tiles with a detail sheet

Active rent cards no longer carry Pause/Resume/Stop directly — clicking
a tile opens a Sheet with the full detail (status, streaming spend,
elapsed time) and the same mutation behavior gated by the existing
canPause/canResume/canCancel rules. No behavior change to the rent
write paths, purely a visual relocation off the always-visible card.
EOF
)"
```

---

### Task 8: Provider dashboard — server tiles open a detail sheet

**Files:**
- Modify: `src/routes/provider.tsx`

- [ ] **Step 1: Replace the whole file**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { authGuard } from "../lib/auth/guard";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Server } from "lucide-react";
import { AppShell } from "@/components/site/AppShell";
import { OperationalTile } from "@/components/site/OperationalTile";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ComputeScoreRing } from "@/components/site/ComputeScoreRing";
import { StreamingTicker } from "@/components/site/StreamingTicker";
import { useSession } from "@/lib/auth/session";
import { listMyProviders, listProviderRents } from "@/lib/broker/server-fns";
import type { Provider, Rent } from "@services/domain";

export const Route = createFileRoute("/provider")({
  beforeLoad: authGuard,
  head: () => ({
    meta: [
      { title: "Provider Dashboard — Prime Compute" },
      { name: "description", content: "Manage your servers, rents, and earnings as a Prime Compute provider." },
    ],
  }),
  component: ProviderDash,
});

function ProviderDash() {
  const { session, walletAddress } = useSession();
  const accessToken = session?.access_token;
  const [onlineByServer, setOnlineByServer] = useState<Record<string, boolean>>({});
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  const { data: myServers = [] } = useQuery({
    queryKey: ["providers", "mine", accessToken],
    queryFn: () => listMyProviders({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken,
  });

  const serverIds = myServers.map((s) => s.id);
  const { data: rentsByProvider = {} } = useQuery({
    queryKey: ["rents", "forProviders", serverIds],
    queryFn: async () => {
      const lists = await Promise.all(
        serverIds.map((id) => listProviderRents({ data: { providerId: id } })),
      );
      return Object.fromEntries(serverIds.map((id, i) => [id, lists[i]]));
    },
    enabled: serverIds.length > 0,
  });

  const allRents = Object.values(rentsByProvider).flat();
  const totalEarned = allRents.reduce((s, r) => s + r.totalCost, 0);
  const isOnline = (s: Provider) => onlineByServer[s.id] ?? s.online;
  const selectedServer = myServers.find((s) => s.id === selectedServerId) ?? null;

  return (
    <>
      <AppShell>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
          <div className="text-[11px] uppercase tracking-wider text-glow">Provider</div>
          <h1 className="mt-1 text-3xl md:text-4xl font-bold">Server operations</h1>

          <Tabs defaultValue="servers" className="mt-8">
            <TabsList className="bg-surface border border-border">
              <TabsTrigger value="servers">My servers</TabsTrigger>
              <TabsTrigger value="earnings">Earnings</TabsTrigger>
              <TabsTrigger value="rents">Rents</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="servers" className="mt-6 grid gap-4 lg:grid-cols-2">
              {myServers.map((s) => (
                <OperationalTile
                  key={s.id}
                  title={s.alias}
                  subtitle={`${s.region} · ${(s.specs.gpu as string | undefined) ?? (s.specs.cpuCores ? `${s.specs.cpuCores} cores` : "—")}`}
                  icon={Server}
                  statusLabel={isOnline(s) ? "online" : "offline"}
                  statusTone={isOnline(s) ? "success" : "destructive"}
                  pulse={isOnline(s)}
                  onClick={() => setSelectedServerId(s.id)}
                />
              ))}
              {myServers.length === 0 && (
                <div className="col-span-full glass-card p-10 text-center text-muted-foreground">
                  No servers registered to this wallet yet.
                </div>
              )}
            </TabsContent>

            <TabsContent value="earnings" className="mt-6 grid gap-6 lg:grid-cols-3">
              <div className="glass-card p-6 lg:col-span-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Total earned</div>
                <div className="mt-2 text-3xl font-bold text-foreground">${totalEarned.toFixed(4)}</div>
                <div className="mt-1 text-xs text-muted-foreground">across {allRents.length} rent{allRents.length === 1 ? "" : "s"}</div>
              </div>
            </TabsContent>

            <TabsContent value="rents" className="mt-6 glass-card p-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-xs uppercase tracking-wider text-muted-foreground text-left"><th className="py-2">Rent</th><th>Duration</th><th>Earned</th><th>Status</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {allRents.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2">{r.name}</td>
                      <td>{r.startedAt && r.endedAt ? `${Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000)}m` : "—"}</td>
                      <td>${r.totalCost.toFixed(4)}</td>
                      <td className="text-muted-foreground">{r.status}</td>
                    </tr>
                  ))}
                  {allRents.length === 0 && (
                    <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No rents yet.</td></tr>
                  )}
                </tbody>
              </table>
            </TabsContent>

            <TabsContent value="settings" className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="glass-card p-6 space-y-4">
                <h3 className="font-semibold">Auto-accept</h3>
                <div className="flex items-center justify-between"><Label>Accept matched rents automatically</Label><Switch defaultChecked /></div>
                <div className="flex items-center justify-between"><Label>Allow rent migration in</Label><Switch defaultChecked /></div>
              </div>
              <div className="glass-card p-6 space-y-4">
                <h3 className="font-semibold">Payout wallet</h3>
                <Input readOnly value={walletAddress ?? "—"} className="font-mono bg-card border-border" />
                <Label>Minimum payout</Label>
                <Input defaultValue="50" className="bg-card border-border" />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </AppShell>

      <ServerDetailSheet
        server={selectedServer}
        rents={selectedServer ? rentsByProvider[selectedServer.id] ?? [] : []}
        online={selectedServer ? isOnline(selectedServer) : false}
        onOnlineChange={(v) =>
          selectedServer && setOnlineByServer((m) => ({ ...m, [selectedServer.id]: v }))
        }
        onClose={() => setSelectedServerId(null)}
      />
    </>
  );
}

function ServerDetailSheet({
  server,
  rents,
  online,
  onOnlineChange,
  onClose,
}: {
  server: Provider | null;
  rents: Rent[];
  online: boolean;
  onOnlineChange: (v: boolean) => void;
  onClose: () => void;
}) {
  const runningRent = rents.find((r) => r.status === "running");
  const cpuCores = server?.specs.cpuCores as number | undefined;
  const ramGb = server?.specs.ramGb as number | undefined;
  const storageGb = server?.specs.storageGb as number | undefined;
  const gpu = server?.specs.gpu as string | undefined;

  return (
    <Sheet open={!!server} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="bg-surface border-border">
        <SheetHeader>
          <SheetTitle>{server?.alias ?? "Server"}</SheetTitle>
        </SheetHeader>
        {server && (
          <div className="mt-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ComputeScoreRing score={server.computeScore} size={40} />
                <span className="text-xs text-muted-foreground">{server.region}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{online ? "Online" : "Offline"}</span>
                <Switch checked={online} onCheckedChange={onOnlineChange} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <div><div className="text-foreground">{cpuCores ?? "—"}</div>cores</div>
              <div><div className="text-foreground">{ramGb ? `${ramGb}GB` : "—"}</div>ram</div>
              <div><div className="text-foreground">{storageGb ? `${storageGb}GB` : "—"}</div>ssd</div>
            </div>
            {gpu && <div className="text-xs text-foreground">{gpu}</div>}
            {runningRent && online ? (
              <div className="rounded-lg border border-border bg-surface/60 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{runningRent.name}</span>
                  <span className="inline-flex items-center gap-1 text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success pulse-ring" />
                    running
                  </span>
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Earning
                    </div>
                    <StreamingTicker
                      ratePerSecond={server.pricePerCharge}
                      startedAt={runningRent.startedAt ? new Date(runningRent.startedAt).getTime() : Date.now()}
                      className="text-lg font-semibold text-foreground"
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">${server.pricePerCharge.toFixed(7)}/s</div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                {online ? "Waiting for matched rents…" : "Server offline. Toggle to start accepting rents."}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

What changed and why: the old `ServerCard` (card with an inline online/offline `Switch` and inline earning block) is gone. Each server now renders as an `OperationalTile`; clicking one opens `ServerDetailSheet` with the specs, the currently-running rent's real `pricePerCharge` ticker, and the online/offline toggle. The toggle's local state moves from per-card `useState` to a `Record<string, boolean>` keyed by server id in the parent (`onlineByServer`), since the tile no longer owns its own toggle — same default-to-`server.online` behavior, just lifted one level so the tile's status row can reflect it. The two `text-gradient-blue` call sites (`totalEarned`, the earning ticker) are now `text-foreground`.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: clean.

```bash
grep -rn "text-gradient-blue" src --include="*.tsx"
```

Expected: 1 remaining hit, in `src/routes/marketplace.index.tsx` — that one is fixed in Task 9 (it's bundled with the `ProviderCard` reskin since both touch the marketplace).

- [ ] **Step 3: Manual check**

```bash
npm run dev
```

Sign in as a provider, visit `/provider`, confirm servers render as tiles, clicking one opens a sheet showing specs and the online/offline toggle, toggling it updates the tile's status row after closing the sheet, and a server with a running rent shows the earning ticker only while online. Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add src/routes/provider.tsx
git commit -m "$(cat <<'EOF'
refactor(provider): server cards become tiles with a detail sheet

My-servers cards no longer carry the online/offline switch and earning
ticker inline — clicking a tile opens a Sheet with specs, the running
rent's real pricePerCharge ticker, and the toggle. Same underlying
state, relocated off the always-visible card.
EOF
)"
```

---

### Task 9: ProviderCard tile reskin (marketplace) + the last `text-gradient-blue` call site

**Files:**
- Modify: `src/components/site/ProviderCard.tsx`
- Modify: `src/routes/marketplace.index.tsx:302`

`text-gradient-blue` is retired in Task 1, and Tasks 7-8 fix 4 of its 5 call sites
(`dashboard.tsx` ×2, `provider.tsx` ×2). The 5th lives in this same marketplace route, in
`RentSheet`'s budget display — fix it here since this task already touches the marketplace.

- [ ] **Step 1: Replace the whole file**

```tsx
import { Link } from "@tanstack/react-router";
import { Cpu, MemoryStick, HardDrive, MapPin, Server, Zap } from "lucide-react";
import { ComputeScoreRing } from "./ComputeScoreRing";
import { Button } from "@/components/ui/button";
import type { Provider } from "@services/domain";

export function ProviderCard({ p, onRent }: { p: Provider; onRent?: (p: Provider) => void }) {
  const gpu = p.specs.gpu as string | undefined;
  const vramGb = p.specs.vramGb as number | undefined;
  const cpuCores = p.specs.cpuCores as number | undefined;
  const ramGb = p.specs.ramGb as number | undefined;
  const storageGb = p.specs.storageGb as number | undefined;
  const uptimePct = Math.min(100, Math.max(0, p.trust.signals.uptime * 100));

  return (
    <div className="glass-card glow-hover p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <span className="text-sm font-medium text-foreground">{p.alias}</span>
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {p.region}
            <span className="mx-1">·</span>
            {p.resourceType}
          </div>
        </div>
        <ComputeScoreRing score={p.computeScore} />
      </div>

      <div className="rounded-lg border border-border bg-dot-grid h-20 flex items-center justify-center">
        <Server className="h-6 w-6 text-muted-foreground" />
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={`h-1.5 w-1.5 rounded-full ${p.online ? "bg-success pulse-ring" : "bg-destructive"}`} />
        {p.online ? "online" : "offline"}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {gpu && (
          <div className="col-span-2 flex items-center gap-1.5 text-foreground">
            <Zap className="h-3.5 w-3.5 text-glow" />
            <span className="truncate">{gpu}</span>
            {vramGb !== undefined && <span className="text-muted-foreground">· {vramGb}GB VRAM</span>}
          </div>
        )}
        {cpuCores !== undefined && (
          <div className="flex items-center gap-1.5 text-muted-foreground"><Cpu className="h-3.5 w-3.5" />{cpuCores} cores</div>
        )}
        {ramGb !== undefined && (
          <div className="flex items-center gap-1.5 text-muted-foreground"><MemoryStick className="h-3.5 w-3.5" />{ramGb} GB</div>
        )}
        {storageGb !== undefined && (
          <div className="flex items-center gap-1.5 text-muted-foreground col-span-2"><HardDrive className="h-3.5 w-3.5" />{storageGb} GB SSD</div>
        )}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Rate</div>
          <div className="text-base font-semibold text-foreground">
            ${p.pricePerCharge.toFixed(7)}<span className="text-xs text-muted-foreground"> /sec</span>
          </div>
        </div>
        <div className="flex gap-1">
          <Pill>{uptimePct.toFixed(2)}%</Pill>
          <Pill>{p.trust.signals.successfulRentals.toLocaleString()} rents</Pill>
          <Pill>{p.avgLatencyMs.toFixed(1)}ms</Pill>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button asChild variant="ghost" size="sm" className="flex-1 border border-border hover:bg-card">
          <Link to="/marketplace/$id" params={{ id: p.id }}>Details</Link>
        </Button>
        <Button
          size="sm"
          className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
          disabled={!p.online}
          onClick={() => onRent?.(p)}
        >
          Rent
        </Button>
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="hidden md:inline-flex items-center rounded-full border border-border bg-surface/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {children}
    </span>
  );
}
```

This is not converted to the `OperationalTile` component itself — `ProviderCard` needs two distinct actions (a "Details" link and a "Rent" button), which doesn't fit `OperationalTile`'s single-`onClick`-wraps-everything model. Instead it gets the same visual ingredients (dotted-grid preview area with a centered icon, a status row) added manually, while the existing "Details" link still navigates to `/marketplace/$id` and the "Rent" button still calls `onRent` exactly as before — no behavior change, per the spec.

- [ ] **Step 2: Fix the last `text-gradient-blue` call site**

In `src/routes/marketplace.index.tsx`, inside `RentSheet`, change:

```tsx
              <div className="mt-1 text-2xl font-semibold text-gradient-blue">${budget}</div>
```

to:

```tsx
              <div className="mt-1 text-2xl font-semibold text-foreground">${budget}</div>
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
grep -rn "text-gradient-blue" src --include="*.tsx"
```

Expected: `tsc` clean, and the grep now returns **no output** — this is the last of the 5 call sites (`dashboard.tsx` ×2 and `provider.tsx` ×2 were fixed in Tasks 7-8), so `text-gradient-blue` should have zero remaining references anywhere in `src/`.

- [ ] **Step 4: Manual check**

```bash
npm run dev
```

Visit `/marketplace`, confirm each provider tile shows the new preview area + status row, "Details" still navigates to the provider's detail page, and "Rent" still opens the existing rent sheet — open it and confirm the "Estimated max budget" figure renders in plain foreground color, not a gradient. Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add src/components/site/ProviderCard.tsx src/routes/marketplace.index.tsx
git commit -m "$(cat <<'EOF'
refactor(marketplace): ProviderCard gets the dotted-grid tile treatment

Visual reskin only — Details still navigates to /marketplace/$id and
Rent still opens the existing RentSheet. Browsing/comparing providers
keeps the dedicated page rather than moving to a side panel, since
specs and rent history need more room than a slide-over gives. Also
retires the last text-gradient-blue call site, in RentSheet's budget
display.
EOF
)"
```

---

### Task 10: Landing page — convert hardcoded blue-navy hex to the new neutral tokens

**Files:**
- Modify: `src/routes/index.tsx`

The hero (`HeroGradient`/`HeroCanvas`, done in Tasks 3-4) is the only part of `index.tsx` the original spec called out, on the assumption the rest of the page "inherits the token change automatically." It doesn't: the logo strip, every `FeatureSection`, the trust-layer stats section, the testimonials, the CTA banner, and `IllustrationCard`'s gradients all use hardcoded hex literals (`#050a18`, `#0a1430`, `#5b8cff`, `#0f1530`, `#cfe0ff`, `#e8e1ff`, `#142a5a`, `#1e4080`, `#06122a`, `#1a3a`, etc.) copied from the old blue-navy scale, not CSS custom properties. Left alone, the page would show a neutral hero sitting directly above a still-blue-navy rest-of-page. This task brings those literals onto the same token scale as everything else.

- [ ] **Step 1: Logo strip background**

Change:

```tsx
      <section className="bg-[#050a18] border-y border-white/5">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-[#8aa3c7] text-sm">
```

to:

```tsx
      <section className="bg-background border-y border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-muted-foreground text-sm">
```

- [ ] **Step 2: "Live on testnet" pill dot**

Change:

```tsx
              <span className="h-1.5 w-1.5 rounded-full bg-[#7fffaf]" />
```

to:

```tsx
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
```

- [ ] **Step 3: Trust-layer section**

Change:

```tsx
      <section className="bg-[#0a1430] border-t border-white/5">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-20">
          <div className="text-center">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#5b8cff]">Real-time</div>
```

to:

```tsx
      <section className="bg-surface border-t border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-20">
          <div className="text-center">
            <div className="text-[11px] uppercase tracking-[0.18em] text-glow">Real-time</div>
```

And further down in the same section, change:

```tsx
              <div key={t.author} className="rounded-xl border border-white/8 bg-[#0f1530] p-6">
                <p className="text-[#e8e1ff] text-sm italic leading-relaxed">
```

to:

```tsx
              <div key={t.author} className="rounded-xl border border-border bg-card p-6">
                <p className="text-foreground/90 text-sm italic leading-relaxed">
```

- [ ] **Step 4: CTA banner**

Change:

```tsx
        <div className="relative overflow-hidden rounded-2xl border border-white/10 p-10 md:p-14 text-center bg-gradient-to-br from-primary/30 via-[#0a1430] to-background">
```

to:

```tsx
        <div className="relative overflow-hidden rounded-2xl border border-border p-10 md:p-14 text-center bg-gradient-to-br from-primary/30 via-surface to-background">
```

- [ ] **Step 5: `FeatureSection` background + eyebrow + alternatives pill**

Change:

```tsx
  return (
    <section className={altBg ? "bg-[#0a1430]" : "bg-[#050a18]"}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-20 grid md:grid-cols-2 gap-12 items-center">
        <div className={reverse ? "md:order-2" : ""}>
          <div className="text-[11px] uppercase tracking-[0.18em] text-[#5b8cff]">{eyebrow}</div>
```

to:

```tsx
  return (
    <section className={altBg ? "bg-surface" : "bg-background"}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-20 grid md:grid-cols-2 gap-12 items-center">
        <div className={reverse ? "md:order-2" : ""}>
          <div className="text-[11px] uppercase tracking-[0.18em] text-glow">{eyebrow}</div>
```

And further down in the same function, change:

```tsx
              <span
                key={a}
                className="rounded-md bg-[#0f1530] border border-white/8 px-3 py-1 text-[11px] text-[#cfe0ff]"
              >
```

to:

```tsx
              <span
                key={a}
                className="rounded-md bg-card border border-border px-3 py-1 text-[11px] text-muted-foreground"
              >
```

- [ ] **Step 6: `IllustrationCard` gradients + glyph color**

Change:

```tsx
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
```

to:

```tsx
  const gradients: Record<typeof kind, string> = {
    deploy: "linear-gradient(135deg, var(--color-card) 0%, var(--color-surface) 100%)",
    network: "linear-gradient(135deg, var(--color-surface) 0%, var(--color-background) 100%)",
    scale: "linear-gradient(135deg, var(--color-card) 0%, var(--color-surface) 100%)",
    monitor: "linear-gradient(135deg, var(--color-card) 0%, var(--color-background) 100%)",
    evolve: "linear-gradient(135deg, var(--color-card) 0%, var(--color-background) 100%)",
  };
  const glyphs: Record<typeof kind, React.ReactNode> = {
    deploy: <Boxes className="h-16 w-16 text-glow" />,
    network: <Layers className="h-16 w-16 text-glow" />,
    scale: <Sparkles className="h-16 w-16 text-glow" />,
    monitor: <Award className="h-16 w-16 text-glow" />,
    evolve: <Wallet className="h-16 w-16 text-glow" />,
  };
  return (
    <div
      className="rounded-2xl border border-border p-10 flex items-center justify-center min-h-[300px]"
      style={{ background: gradients[kind] }}
    >
```

- [ ] **Step 7: Verify the sweep is complete**

```bash
grep -n "#0[0-9a-f]\{5\}\|#[0-9a-f]\{6\}\|border-white\|text-white/" src/routes/index.tsx
```

Expected: only the three browser-chrome traffic-light colors (`#ff5f57`, `#febc2e`, `#28c840`) if they still appear anywhere imported from `HeroCanvas` usage (they don't live in `index.tsx` itself, so expect no output here), plus any remaining `text-white`/`border-white/*` literals used for one-off emphasis (e.g. headings styled `text-white` for max contrast against the new near-black background) — those are fine to leave since `--foreground` and pure white read almost identically against the new near-black background; this grep is to catch leftover *navy-hex* literals, not every white reference.

- [ ] **Step 8: tsc + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both clean.

- [ ] **Step 9: Manual check**

```bash
npm run dev
```

Visit `/` and scroll the full page at desktop width: confirm the hero, logo strip, all five feature sections, the trust-layer stats/testimonials, and the CTA banner all read as one consistent neutral near-black scale with no visible seam where the old blue-navy started. Stop the dev server when done.

- [ ] **Step 10: Commit**

```bash
git add src/routes/index.tsx
git commit -m "$(cat <<'EOF'
refactor(landing): convert the rest of index.tsx off hardcoded blue-navy hex

The hero already moved to the new neutral tokens, but the logo strip,
feature sections, trust-layer stats, testimonials, and CTA banner were
still using one-off hex literals from the old palette (#0a1430,
#5b8cff, etc.) that don't follow a token swap. Move them onto
background/surface/card/border/glow so the whole landing page reads
as one consistent scale instead of a neutral hero sitting on top of a
still-blue-navy page.
EOF
)"
```

---

### Task 11: Full-app verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both clean. This is the final confirmation that every task's changes compose correctly together.

- [ ] **Step 2: Confirm the dead-code removals didn't leave stragglers**

```bash
grep -rn "text-gradient-blue\|bg-grid\|\bdrift\b\|drift-slow\|twinkle\|shadow-\[0_0_24px\|shadow-\[0_0_30px" src --include="*.tsx" --include="*.css"
```

Expected: no output.

- [ ] **Step 3: Manual walkthrough — desktop**

```bash
npm run dev
```

At a desktop viewport width, visit every route and confirm the neutral palette renders with no leftover blue-navy tint and no neon glow/shadow:
- `/` — hero (neutral background, static corner glow, choreographed demo), logo strip, feature sections, trust layer, CTA
- `/marketplace` — provider tiles, filters sidebar, the existing RentSheet still opens and submits
- `/marketplace/$id` — provider detail page (token-only changes, no structural change)
- `/dashboard` (signed in) — active-rent tiles, detail sheet open/close, Pause/Resume/Stop still work, history table, billing, settings tabs
- `/provider` (signed in, as a provider wallet) — server tiles, detail sheet open/close, online/offline toggle, earnings/rents/settings tabs
- `/docs`, `/register`, `/onboarding` — token-only changes, no structural change
- Sidebar on every app page — workspace-switcher header, active-nav pill, account-footer kebab menu (or "Get Started" when signed out)
- Lumen overlay (FAB + sidebar entry) — opens/closes, no neon shadow on the FAB

- [ ] **Step 4: Manual walkthrough — mobile**

Resize the browser to a mobile width (or use device emulation) and repeat the same route walkthrough, confirming `MobileTopBar` and `BottomTabBar` render correctly with the new tokens and the dashboard/provider detail sheets still open as bottom/side sheets without layout breakage. Stop the dev server when done.

- [ ] **Step 5: No commit for this task**

This task is verification only — if Step 3 or 4 surfaces a problem, fix it in the relevant task's file and amend that task's commit (or add a small fixup commit), then re-run Steps 1-2 here before considering the plan complete.

---

## Summary of files touched

| File | Change |
|---|---|
| `src/styles.css` | Token rewrite, dead CSS removal, new `bg-dot-grid` utility |
| `src/components/site/LumenOverlay.tsx` | Drop FAB neon shadow |
| `src/components/site/HeroGradient.tsx` | Neutral background + corner glow |
| `src/components/site/HeroCanvas.tsx` | Choreographed sidebar+content demo |
| `src/components/site/Sidebar.tsx` | Workspace header, nav pill, account-footer menu |
| `src/components/site/OperationalTile.tsx` | New shared tile component |
| `src/routes/dashboard.tsx` | Active-rent tiles + detail sheet |
| `src/routes/provider.tsx` | Server tiles + detail sheet |
| `src/components/site/ProviderCard.tsx` | Tile reskin, same click-through |
| `src/routes/marketplace.index.tsx` | Last `text-gradient-blue` call site → `text-foreground` |
| `src/routes/index.tsx` | Hardcoded hex → tokens (logo strip, features, trust layer, CTA) |
