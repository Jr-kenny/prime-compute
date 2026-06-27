# Workspace Shell for Inner Pages — Design Spec

**Date:** 2026-06-27
**Status:** Draft, awaiting user review
**Scope:** Apply the homepage hero canvas's "workspace" chrome (browser bar + sidebar + main area + status bar) to all 6 inner routes: `/dashboard`, `/marketplace`, `/marketplace/$id`, `/provider`, `/register`, `/docs`. Homepage `/` keeps its existing full-bleed hero (unchanged).

## Background

The homepage hero (`HeroCanvas.tsx`) renders an animated SVG product mockup inside a recognizable "app window" chrome: macOS-style traffic-light dots + URL bar at the top, sidebar nav on the left, canvas area in the middle, status line at the bottom. The user loves this pattern and wants it applied to every inner page — but with real page content in the canvas area (not the SVG), and the sidebar/status bar adapted to each page's purpose.

## Goals

- Wrap each inner page in the same "app window" chrome so the visual rhythm is consistent across the app
- Each page's sidebar shows the global Workspace nav + page-specific items (filters, active jobs, server list, step indicator, doc sections)
- Each page's status bar shows page-relevant live info (streaming rates, provider counts, onboarding progress)
- Inner pages keep their existing content, behavior, and per-page widgets — only the wrapping chrome changes
- Homepage and 404/error pages keep `PageShell` as-is

## Non-goals

- No changes to inner page content, copy, or business logic
- No changes to the homepage or the animated SVG canvas
- No new dependencies
- No design-token overhaul (this reuses the same tokens Task 1 introduced)
- No mobile-specific layout changes (workspace shell collapses gracefully — sidebar goes below main on `<lg` screens)

## Component changes

### New

| File | Purpose |
|---|---|
| `src/components/site/WorkspaceShell.tsx` | New shell component used by inner pages. Wraps children with the workspace chrome (browser bar + sidebar + main area + status bar). |
| `src/components/site/WorkspaceSidebar.tsx` | Optional helper for the sidebar (Workspace nav + page-specific section). Extracted only if `WorkspaceShell.tsx` exceeds ~150 lines. |
| `src/components/site/WorkspaceStatusBar.tsx` | Optional helper for the status bar. Extracted only if needed. |

### Modified

| File | Reason |
|---|---|
| `src/routes/dashboard.tsx` | Replace `PageShell` with `WorkspaceShell`. Sidebar shows Active jobs + Wallet. Status bar: "N jobs running · streaming $X/sec · wallet $Y · broker match". |
| `src/routes/marketplace.tsx` | Replace `PageShell`. Sidebar shows Filters (type checkboxes, score slider, price slider, available toggle — moved from main area). Main area keeps search + provider cards grid. Status bar: provider count + market open. |
| `src/routes/marketplace.$id.tsx` | Replace `PageShell`. Sidebar shows Workspace + breadcrumb to provider. Status bar: provider online status + compute score. |
| `src/routes/provider.tsx` | Replace `PageShell`. Sidebar shows My servers list (online toggles). Status bar: servers online + earning rate. |
| `src/routes/register.tsx` | Replace `PageShell`. Sidebar shows onboarding step indicator (Hardware → Pricing → Verification → Review). Status bar: step X of 4. |
| `src/routes/docs.tsx` | Replace `PageShell`. Sidebar shows Workspace + section nav (Getting started / Pricing / etc.). Status bar: docs version + last updated. |

### Unchanged

- `src/routes/index.tsx` (homepage uses full-bleed hero, not workspace shell)
- `src/components/site/PageShell.tsx` (still used by homepage)
- `src/components/site/Navbar.tsx`, `Footer.tsx` (shell wraps them — workspace shell is the *page body*, not the top nav)

## WorkspaceShell API

```tsx
<WorkspaceShell
  path="/dashboard"           // shown in browser-bar URL
  sidebar={                   // page-specific sidebar items (ReactNode, rendered as-is)
    <WorkspaceSection label="Workspace">
      <WorkspaceItem label="Canvas" />
      <WorkspaceItem label="Providers" />
      <WorkspaceItem label="Jobs" active />
      <WorkspaceItem label="Wallet" />
    </WorkspaceSection>
    <WorkspaceSection label="Active jobs">
      <JobItem name="llama-fine-tune" provider="p-04" />
      <JobItem name="stable-diffusion-eval" provider="p-12" />
    </WorkspaceSection>
    <WalletCard balance="$1,284.93" currency="USDC" />
  }
  status={                    // page-specific status line (ReactNode)
    <>
      <span>2 jobs running</span>
      <span className="text-glow">streaming $0.000026/sec</span>
      <span>wallet $1,284.93</span>
      <span>8ms broker match</span>
    </>
  }
>
  {/* existing page content (tabs, cards, forms, etc.) */}
</WorkspaceShell>
```

`<WorkspaceSection>`, `<WorkspaceItem>`, `<JobItem>`, and `<WalletCard>` are inline JSX components defined and exported from `WorkspaceShell.tsx` (same file, no separate file). They're presentational only — no state, no effects.

- `<WorkspaceSection label="…">` wraps a labelled section (uppercase eyebrow + children)
- `<WorkspaceItem label="…" active?>` renders a single sidebar row. `active` highlights the row matching the current page.
- The 4 Workspace nav items (Canvas / Providers / Jobs / Wallet) are labels only in this phase — they don't link anywhere. They're visual decoration consistent with the homepage hero canvas. (Deferred: making them functional links to other pages.)

### Status bar rendering

The `status` prop is a ReactNode rendered as-is into the status bar (single horizontal row, separator bullets). Pages compose it from plain `<span>` elements with appropriate Tailwind classes. The leading `▸` glyph and primary/10 background are added by `WorkspaceShell` itself — pages don't include them.

## Visual structure (top to bottom)

```
┌────────────────────────────────────────────────────────────┐
│ • • •  primecompute.app/dashboard                         │  ← Browser chrome (URL is page path)
├──────────┬─────────────────────────────────────────────────┤
│ Workspace│                                                  │
│  Canvas  │                                                  │
│  Provid. │                                                  │
│  Jobs ●  │       Existing page content goes here           │  ← Main area (real content)
│  Wallet  │       (tabs, cards, forms, charts, etc.)        │
│          │                                                  │
│ Active   │                                                  │
│  jobs    │                                                  │
│  [list]  │                                                  │
│          │                                                  │
│ Wallet   │                                                  │
│  $1,284  │                                                  │
└──────────┴─────────────────────────────────────────────────┘
│ ▸ 2 jobs running · streaming $0.000026/sec · ...           │  ← Status bar
└────────────────────────────────────────────────────────────┘
```

Sidebar width: `240px` on `lg+`, collapses below on mobile (existing patterns).

## Per-page sidebar + status bar content

| Page | Sidebar sections (after Workspace) | Status bar |
|---|---|---|
| `/dashboard` | Active jobs (list of running jobs with provider), Wallet card | `N jobs running · streaming $X/sec · wallet $Y · 8ms broker match` |
| `/marketplace` | Filters (moved from main area sidebar: type checkboxes, score slider, price slider, available toggle) | `N providers online · market open · 24h volume $X` |
| `/marketplace/$id` | Workspace + provider breadcrumb back-link | `<alias> online · compute score N · $X/sec` |
| `/provider` | My servers (list of server aliases with online toggle) | `N servers online · earning $X/sec · today $Y` |
| `/register` | Onboarding steps (Hardware / Pricing / Verification / Review) with active state | `Step X of 4 · ~N min remaining` |
| `/docs` | Docs sections (Getting started / Pricing / AI broker / Streaming payments / Reputation / API) | `docs · v1 · last updated today` |

## File-level changes summary

```
src/
├── routes/
│   ├── dashboard.tsx                REPLACE PageShell with WorkspaceShell
│   ├── marketplace.tsx              REPLACE PageShell, move filters into sidebar
│   ├── marketplace.$id.tsx          REPLACE PageShell
│   ├── provider.tsx                 REPLACE PageShell
│   ├── register.tsx                 REPLACE PageShell
│   ├── docs.tsx                     REPLACE PageShell
│   └── index.tsx                    UNCHANGED
└── components/site/
    ├── WorkspaceShell.tsx           NEW (reusable workspace shell)
    ├── WorkspaceSidebar.tsx         NEW (optional helper, only if shell exceeds 150 lines)
    ├── WorkspaceStatusBar.tsx       NEW (optional helper, only if needed)
    ├── PageShell.tsx                UNCHANGED (homepage still uses it)
    ├── Navbar.tsx, Footer.tsx       UNCHANGED
    └── ...
```

No changes to `src/lib/`, `src/hooks/`, route configs, or business logic.

## Build order

1. Build `WorkspaceShell.tsx` (shared chrome + sub-components).
2. Refactor each of the 6 inner routes one at a time:
   - `/dashboard` (most complex — sets the pattern)
   - `/marketplace` (filter relocation — biggest visual change)
   - `/marketplace/$id`
   - `/provider`
   - `/register`
   - `/docs`
3. Verify: lint, build, browser walkthrough on all 6 routes + mobile check.

## Verification

- `npm run lint` exits 0 on all touched files
- `npm run build` exits 0
- Browser walkthrough:
  - Homepage unchanged (still full-bleed hero with animated SVG)
  - All 6 inner routes show the same browser chrome + sidebar + main + status bar structure
  - Each page's sidebar reflects its content (filters for marketplace, jobs for dashboard, etc.)
  - Each page's status bar shows page-specific live info
  - No console errors on any route
- Mobile (<lg): sidebar collapses below main, status bar still visible

## Open questions

None — user approved the workspace shell pattern and the per-page sidebar/status bar breakdown on 2026-06-27.

## Out of scope (deferred)

- Real-time status bar updates (the values shown are placeholders — making them truly live with streaming websockets is a separate feature)
- Per-page sidebar item deep-linking (clicking "Job X" in dashboard's sidebar could navigate to a job detail page — but no such detail page exists yet)
- WorkspaceShell animations (the canvas area currently mounts immediately; we could add a subtle fade-in matching the homepage hero)
- "Canvas" link in the Workspace sidebar (links to `/`? or stays as a label? — for now, all 4 items are inactive anchor labels; only the page's own sidebar item gets `active` state)
