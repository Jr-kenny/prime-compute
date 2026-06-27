# Workspace Shell for Inner Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap each of the 6 inner pages in the same "workspace" chrome as the homepage hero canvas (browser bar + sidebar + main area + status bar). Per-page sidebar + status bar adapts to the page's purpose.

**Architecture:** Build one shared `WorkspaceShell` component (browser bar + grid layout + status bar wrapper). Each inner route swaps `PageShell` for `WorkspaceShell` and supplies page-specific sidebar/status content. The 4 inline sub-components (`WorkspaceSection`, `WorkspaceItem`, `JobItem`, `WalletCard`) live in the same file as `WorkspaceShell` and are exported from it.

**Tech Stack:** TanStack Start + React 19 + TypeScript + Tailwind v4 (oklch tokens). Existing design tokens: `bg-background`, `bg-surface`, `bg-card`, `border-border/60`, `text-foreground`, `text-muted-foreground`, `text-glow`, `bg-primary/15`. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-06-27-workspace-shell-inner-pages-design.md`](../specs/2026-06-27-workspace-shell-inner-pages-design.md)

**Branch:** working on `main` (the workspace shell build is a continuation of the merged Railway-style work). Commit per task; do NOT force-push.

---

## File Structure

**Created:**
- `src/components/site/WorkspaceShell.tsx` — main shell + 4 inline sub-components (`WorkspaceSection`, `WorkspaceItem`, `JobItem`, `WalletCard`)

**Modified:**
- `src/routes/dashboard.tsx` — replace `PageShell` with `WorkspaceShell`, supply sidebar + status
- `src/routes/marketplace.tsx` — same; move Filters panel into sidebar
- `src/routes/marketplace.$id.tsx` — same; sidebar shows Workspace + breadcrumb
- `src/routes/provider.tsx` — same; sidebar shows My servers list
- `src/routes/register.tsx` — same; sidebar shows onboarding steps
- `src/routes/docs.tsx` — same; sidebar shows section nav

**Unchanged:**
- `src/routes/index.tsx` (homepage uses `PageShell`, full-bleed hero)
- `src/components/site/PageShell.tsx`, `Navbar.tsx`, `Footer.tsx`
- `src/components/site/HeroGradient.tsx`, `HeroCanvas.tsx`, etc.
- All `src/lib/` and route configs

---

## Task 1: Build `WorkspaceShell.tsx`

**Files:**
- Create: `src/components/site/WorkspaceShell.tsx`

This is the foundational component. All 6 page refactors depend on it. Build it carefully with the exact spec API.

- [ ] **Step 1: Create the component file**

Write `src/components/site/WorkspaceShell.tsx`:

```tsx
import type { ReactNode } from "react";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";

/* ---------- main shell ---------- */

export function WorkspaceShell({
  path,
  sidebar,
  status,
  children,
}: {
  /** URL path shown in the browser-bar (e.g. "/dashboard") */
  path: string;
  /** Page-specific sidebar content (sections + items) */
  sidebar: ReactNode;
  /** Page-specific status line content (spans) */
  status: ReactNode;
  /** The actual page content (tabs, cards, forms, etc.) */
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 md:py-8">
          <div className="rounded-2xl overflow-hidden border border-border/60 bg-[#0a0e1f] shadow-[0_0_60px_-20px_rgba(91,140,255,0.25)]">
            {/* Browser chrome */}
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/8 bg-white/2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-3 text-[11px] text-white/40 font-mono">
                primecompute.app{path}
              </span>
            </div>

            {/* Body: sidebar + main */}
            <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-3 p-3 bg-[#050a18]">
              <aside className="rounded-lg bg-[#0f1530] border border-white/5 p-3 order-2 lg:order-1">
                {sidebar}
              </aside>

              <div className="rounded-lg border border-white/5 bg-[radial-gradient(circle_at_30%_30%,rgba(37,99,235,0.08),transparent_60%)_#0a0e1f] p-4 order-1 lg:order-2 min-h-[400px]">
                {children}
              </div>
            </div>

            {/* Status bar */}
            <div className="mx-3 mb-3 px-3 py-2.5 rounded-lg bg-primary/10 border border-primary/15 font-mono text-[11px] text-[#8aa3c7] flex items-center gap-2">
              <span className="text-[#7fffaf]">▸</span>
              {status}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

/* ---------- inline sub-components ---------- */

export function WorkspaceSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-[10px] text-white/40 tracking-[0.15em] uppercase mb-2.5">
        {label}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

export function WorkspaceItem({
  label,
  active = false,
}: {
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-2 rounded-md text-xs ${
        active
          ? "bg-primary/20 text-white"
          : "text-[#8aa3c7]"
      }`}
    >
      <span>{active ? "●" : "○"}</span>
      <span>{label}</span>
    </div>
  );
}

export function JobItem({
  name,
  provider,
}: {
  name: string;
  provider: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-xs text-[#cfe0ff]">
      <span className="flex items-center gap-2">
        <span className="text-[#7fffaf]">●</span>
        <span>{name}</span>
      </span>
      <span className="text-[10px] text-white/40">on {provider}</span>
    </div>
  );
}

export function WalletCard({
  balance,
  currency = "USDC",
  note,
}: {
  balance: string;
  currency?: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg bg-primary/8 border border-primary/15 p-3">
      <div className="text-[10px] text-white/40 uppercase tracking-wider">
        Balance
      </div>
      <div className="text-base text-[#7fffaf] font-mono mt-1">{balance}</div>
      <div className="text-[10px] text-white/40 mt-1">
        {note ?? `${currency} streaming`}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit (no page uses this yet — that's fine)**

```bash
cd /Users/user/Documents/prime-compute
git add src/components/site/WorkspaceShell.tsx
git -c user.email=kimchi@local -c user.name=kimchi commit -m "feat(site): add WorkspaceShell component (browser chrome + sidebar + status bar)"
```

---

## Task 2: Refactor `/dashboard` to use `WorkspaceShell`

**Files:**
- Modify: `src/routes/dashboard.tsx`

The dashboard already has `useState`, `Tabs`, charts, and `ActiveJobCard` etc. Keep all that. Replace `<PageShell>` with `<WorkspaceShell>`. Move the existing content into the workspace shell as-is.

- [ ] **Step 1: Update imports + replace `PageShell` usage**

Edit `src/routes/dashboard.tsx`:

1. Add to imports (top of file, after existing imports):
   ```tsx
   import {
     WorkspaceShell,
     WorkspaceSection,
     WorkspaceItem,
     JobItem,
     WalletCard,
   } from "@/components/site/WorkspaceShell";
   ```

2. Remove the `PageShell` import:
   ```tsx
   import { PageShell } from "@/components/site/PageShell";
   ```

3. Replace the wrapper in `Dashboard()`:
   - Find `<PageShell>` and the closing `</PageShell>` near the end of `Dashboard()`.
   - Replace with `<WorkspaceShell path="/dashboard" sidebar={...} status={...}>...</WorkspaceShell>`.

4. Inside `WorkspaceShell`, the existing `<div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">` is removed (the shell handles the chrome). The remaining content (eyebrow + h1 + tabs) goes as `children`.

The sidebar prop should be:
```tsx
sidebar={
  <>
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
    <WalletCard balance="$1,284.93" note="USDC streaming wallet" />
  </>
}
```

The status prop should be:
```tsx
status={
  <>
    <span>2 jobs running</span>
    <span className="text-glow">streaming $0.000026/sec</span>
    <span>wallet $1,284.93</span>
    <span>8ms broker match</span>
  </>
}
```

(Values are placeholder — same as the existing mock-data values already in the file. Read `activeJobs` to use real values if convenient, e.g. `{activeJobs.length} jobs running`.)

- [ ] **Step 2: Verify TypeScript + lint + build**

```bash
npx tsc --noEmit
npx eslint src/routes/dashboard.tsx
npm run build
```
Expected: all pass.

- [ ] **Step 3: Browser walkthrough**

Start dev server (`npm run dev`), open `http://localhost:8080/dashboard`, confirm:
- Browser chrome (3 dots + URL `/dashboard`)
- Sidebar with Workspace / Active jobs / Wallet
- Existing tabs + job cards in the main area
- Status bar at the bottom

- [ ] **Step 4: Commit**

```bash
cd /Users/user/Documents/prime-compute
git add src/routes/dashboard.tsx
git -c user.email=kimchi@local -c user.name=kimchi commit -m "refactor(dashboard): wrap in WorkspaceShell with page-aware sidebar + status"
```

---

## Task 3: Refactor `/marketplace` — move filters into sidebar

**Files:**
- Modify: `src/routes/marketplace.tsx`

The marketplace currently has a Filters panel rendered in the main area's left sidebar. The new design moves filters into the workspace shell's sidebar, so the main area only shows search + provider cards.

- [ ] **Step 1: Update imports + restructure**

Edit `src/routes/marketplace.tsx`:

1. Replace `PageShell` import with the workspace shell sub-components (same set as Task 2):
   ```tsx
   import {
     WorkspaceShell,
     WorkspaceSection,
     WorkspaceItem,
   } from "@/components/site/WorkspaceShell";
   ```
   (No JobItem or WalletCard needed for marketplace.)

2. Replace `<PageShell>` with `<WorkspaceShell>` per Task 2's pattern.

3. **Move the FiltersPanel** from the main area's `<aside className="hidden lg:block">` into the workspace shell's `sidebar` prop. The FiltersPanel component itself stays defined in the file — just move where it's rendered.

4. The main area should now only show: search input + provider cards grid (and the mobile filter sheet button if you want to keep it for `<lg` screens — optional, can be removed since filters are always visible on mobile via the workspace sidebar now).

5. Sidebar prop:
   ```tsx
   sidebar={
     <>
       <WorkspaceSection label="Workspace">
         <WorkspaceItem label="Canvas" />
         <WorkspaceItem label="Providers" active />
         <WorkspaceItem label="Jobs" />
         <WorkspaceItem label="Wallet" />
       </WorkspaceSection>
       <WorkspaceSection label="Filters">
         <FiltersPanel
           types={types}
           toggleType={toggleType}
           minScore={minScore}
           setMinScore={setMinScore}
           maxPrice={maxPrice}
           setMaxPrice={setMaxPrice}
           availableOnly={availableOnly}
           setAvailableOnly={setAvailableOnly}
         />
       </WorkspaceSection>
     </>
   }
   ```

6. Status prop:
   ```tsx
   status={
     <>
       <span>{filtered.length} providers match</span>
       <span className="text-glow">market open</span>
       <span>24h volume $4,231.18</span>
       <span>8ms broker match</span>
     </>
   }
   ```

7. Inside `WorkspaceShell` children, drop the outer `<div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">` and the left-side `<aside>`. The main area starts with the search header + provider cards grid.

- [ ] **Step 2: Verify TS / lint / build**

- [ ] **Step 3: Browser walkthrough**

Open `/marketplace`, confirm:
- Browser chrome + URL
- Sidebar shows Workspace + Filters (filters are now in the sidebar, working as before)
- Main area shows only the search + provider grid
- Status bar at the bottom

- [ ] **Step 4: Commit**

```bash
git add src/routes/marketplace.tsx
git -c user.email=kimchi@local -c user.name=kimchi commit -m "refactor(marketplace): move Filters panel into WorkspaceShell sidebar"
```

---

## Task 4: Refactor `/marketplace/$id`

**Files:**
- Modify: `src/routes/marketplace.$id.tsx`

Simpler — just wrap in WorkspaceShell. Sidebar shows Workspace + a breadcrumb link back to /marketplace.

- [ ] **Step 1: Update imports + wrap**

Edit `src/routes/marketplace.$id.tsx`:

1. Add WorkspaceShell imports.
2. Replace `PageShell` import with `WorkspaceShell` import (remove PageShell import).
3. Replace the three `<PageShell>` occurrences (main, notFound, errorComponent) with `<WorkspaceShell>`. Only the main one passes sidebar + status; the notFound and error ones can use a minimal `<WorkspaceShell path="..." sidebar={...} status={...}>` with a minimal status.

For the main component:
```tsx
sidebar={
  <>
    <WorkspaceSection label="Workspace">
      <WorkspaceItem label="Canvas" />
      <WorkspaceItem label="Providers" active />
      <WorkspaceItem label="Jobs" />
      <WorkspaceItem label="Wallet" />
    </WorkspaceSection>
    <WorkspaceSection label="Provider">
      <Link
        to="/marketplace"
        className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-[#8aa3c7] hover:text-white"
      >
        ← All providers
      </Link>
    </WorkspaceSection>
  </>
}
status={
  <>
    <span>{p.alias}</span>
    <span className="text-glow">{p.online ? "online" : "offline"}</span>
    <span>compute score {p.computeScore}</span>
    <span>${p.pricePerSecond.toFixed(7)}/sec</span>
  </>
}
```

The ProviderDetail component already has `<Link to="/marketplace">` for the back button — keep that, but also link from the sidebar.

- [ ] **Step 2: Verify TS / lint / build**

- [ ] **Step 3: Browser walkthrough** — visit `/marketplace/prv_001` (or any id), confirm shell + provider content.

- [ ] **Step 4: Commit**

```bash
git add src/routes/marketplace.$id.tsx
git -c user.email=kimchi@local -c user.name=kimchi commit -m "refactor(marketplace/$id): wrap in WorkspaceShell with provider breadcrumb sidebar"
```

---

## Task 5: Refactor `/provider`

**Files:**
- Modify: `src/routes/provider.tsx`

Sidebar shows My servers list. Status shows online count + earning rate.

- [ ] **Step 1: Update imports + wrap**

Edit `src/routes/provider.tsx`:

1. Add WorkspaceShell imports (including `JobItem` or a new server item pattern — reuse `WorkspaceItem` for now with custom rendering if needed).
2. Replace `PageShell` import with `WorkspaceShell` import.
3. Replace `<PageShell>` with `<WorkspaceShell>`.

Sidebar:
```tsx
sidebar={
  <>
    <WorkspaceSection label="Workspace">
      <WorkspaceItem label="Canvas" />
      <WorkspaceItem label="Providers" />
      <WorkspaceItem label="Jobs" />
      <WorkspaceItem label="Wallet" />
    </WorkspaceSection>
    <WorkspaceSection label="My servers">
      {myServers.map((s) => (
        <WorkspaceItem
          key={s.id}
          label={`${s.alias} · ${s.online ? "online" : "offline"}`}
          active={s.online}
        />
      ))}
    </WorkspaceSection>
  </>
}
```

(Status: myServers is computed inside the component — `const myServers = providers.slice(0, 2);`.)

Status:
```tsx
status={
  <>
    <span>{myServers.filter((s) => s.online).length} servers online</span>
    <span className="text-glow">earning $0.000023/sec</span>
    <span>today $64.12</span>
    <span>8ms broker match</span>
  </>
}
```

Inside WorkspaceShell children, drop the outer `<div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">` wrapper. The Tabs + content stay as-is.

- [ ] **Step 2: Verify TS / lint / build**

- [ ] **Step 3: Browser walkthrough** — visit `/provider`, confirm shell + my servers sidebar + status.

- [ ] **Step 4: Commit**

```bash
git add src/routes/provider.tsx
git -c user.email=kimchi@local -c user.name=kimchi commit -m "refactor(provider): wrap in WorkspaceShell with My servers sidebar + status"
```

---

## Task 6: Refactor `/register`

**Files:**
- Modify: `src/routes/register.tsx`

Sidebar shows onboarding step indicator. Status shows current step.

- [ ] **Step 1: Update imports + wrap**

Edit `src/routes/register.tsx`:

1. Add WorkspaceShell imports.
2. Replace `PageShell` import.
3. Replace `<PageShell>` with `<WorkspaceShell>`.

Sidebar: a step indicator. Reuse `WorkspaceSection` + `WorkspaceItem` (with `active` flag for the current step):
```tsx
sidebar={
  <>
    <WorkspaceSection label="Workspace">
      <WorkspaceItem label="Canvas" />
      <WorkspaceItem label="Providers" />
      <WorkspaceItem label="Jobs" />
      <WorkspaceItem label="Wallet" />
    </WorkspaceSection>
    <WorkspaceSection label="Onboarding">
      {steps.map((s, i) => (
        <WorkspaceItem key={s} label={`${i + 1}. ${s}`} active={i === step} />
      ))}
    </WorkspaceSection>
  </>
}
```

Status:
```tsx
status={
  <>
    <span>Step {step + 1} of {steps.length}</span>
    <span className="text-glow">~{Math.max(1, (steps.length - step) * 45)}s remaining</span>
    <span>testnet preview</span>
  </>
}
```

(steps is `["Hardware", "Pricing", "Verification", "Review"]` — defined in the existing component.)

Inside WorkspaceShell children, drop the outer `<div className="mx-auto max-w-3xl px-4 sm:px-6 py-12">`. Keep the form content + progress bar.

- [ ] **Step 2: Verify TS / lint / build**

- [ ] **Step 3: Browser walkthrough** — visit `/register`, walk through the 4 steps, confirm sidebar reflects current step.

- [ ] **Step 4: Commit**

```bash
git add src/routes/register.tsx
git -c user.email=kimchi@local -c user.name=kimchi commit -m "refactor(register): wrap in WorkspaceShell with onboarding step sidebar"
```

---

## Task 7: Refactor `/docs`

**Files:**
- Modify: `src/routes/docs.tsx`

Sidebar shows Workspace + doc section nav (mirroring the current sidebar nav).

- [ ] **Step 1: Update imports + wrap**

Edit `src/routes/docs.tsx`:

1. Add WorkspaceShell imports.
2. Replace `PageShell` import.
3. Replace `<PageShell>` with `<WorkspaceShell>`.
4. The existing left aside with section nav moves into the workspace shell's `sidebar` prop. Wrap each section link in a `WorkspaceItem`:

```tsx
sidebar={
  <>
    <WorkspaceSection label="Workspace">
      <WorkspaceItem label="Canvas" />
      <WorkspaceItem label="Providers" />
      <WorkspaceItem label="Jobs" />
      <WorkspaceItem label="Wallet" />
    </WorkspaceSection>
    <WorkspaceSection label="Docs">
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          onClick={() => setActive(s.id)}
          className={`flex items-center gap-2 px-2.5 py-2 rounded-md text-xs transition ${
            active === s.id
              ? "bg-primary/20 text-white"
              : "text-[#8aa3c7] hover:text-white"
          }`}
        >
          <span>{active === s.id ? "●" : "○"}</span>
          <span>{s.title}</span>
        </a>
      ))}
    </WorkspaceSection>
  </>
}
```

Status:
```tsx
status={
  <>
    <span>docs</span>
    <span className="text-glow">v1</span>
    <span>last updated today</span>
    <span>{sections.length} sections</span>
  </>
}
```

Inside WorkspaceShell children, drop the outer grid wrapper (`mx-auto max-w-7xl px-4 sm:px-6 py-10 grid lg:grid-cols-[220px_1fr] gap-10`). The article content stays as-is.

- [ ] **Step 2: Verify TS / lint / build**

- [ ] **Step 3: Browser walkthrough** — visit `/docs`, confirm section nav in sidebar works, click a section, scroll happens.

- [ ] **Step 4: Commit**

```bash
git add src/routes/docs.tsx
git -c user.email=kimchi@local -c user.name=kimchi commit -m "refactor(docs): wrap in WorkspaceShell with section nav sidebar"
```

---

## Task 8: Final verification

**Files:** none

- [ ] **Step 1: Lint on all touched files**

```bash
cd /Users/user/Documents/prime-compute
npx eslint src/components/site/WorkspaceShell.tsx \
            src/routes/dashboard.tsx \
            src/routes/marketplace.tsx \
            src/routes/marketplace.\$id.tsx \
            src/routes/provider.tsx \
            src/routes/register.tsx \
            src/routes/docs.tsx
```
Expected: 0 errors on each. (Pre-existing errors in OTHER files are out of scope.)

- [ ] **Step 2: Build**

```bash
npm run build
```
Expected: exit 0.

- [ ] **Step 3: Browser walkthrough — all routes**

Start dev server (`npm run dev`) and visit each:
- `/` — homepage UNCHANGED (full-bleed hero with animated SVG canvas)
- `/dashboard` — workspace shell, sidebar with Workspace + Active jobs + Wallet, status bar
- `/marketplace` — workspace shell, sidebar with Workspace + Filters, status bar
- `/marketplace/prv_001` — workspace shell, sidebar with Workspace + Provider breadcrumb, status bar
- `/provider` — workspace shell, sidebar with Workspace + My servers, status bar
- `/register` — workspace shell, sidebar with Workspace + Onboarding steps, status bar
- `/docs` — workspace shell, sidebar with Workspace + Docs sections, status bar

Confirm:
- Browser chrome (3 dots + URL) on all inner pages
- Sidebar visible on lg+ screens (240px wide)
- Status bar at bottom on all pages
- Mobile (<lg): sidebar collapses below main, status bar still visible
- No console errors in devtools

- [ ] **Step 4: Mobile check**

Resize browser to <lg width on each page:
- Sidebar stacks below main (not beside)
- Browser chrome still visible
- Status bar still visible at bottom

- [ ] **Step 5: Commit summary + ship-ready report**

Run `git log --oneline d2452e1..HEAD` to list all workspace-shell commits (8 total expected: WorkspaceShell creation + 6 page refactors + 1 final cleanup if needed). Report count and any failures.

---

## Self-Review Notes

**Spec coverage:**
- New `WorkspaceShell` component — Task 1
- Per-page sidebar (Workspace + page-specific) — Tasks 2-7
- Per-page status line (page-relevant live info) — Tasks 2-7
- Browser chrome + URL bar — Tasks 2-7 (shared via Task 1)
- Mobile collapse (<lg sidebar stacks below main) — Task 1 + Step 4 of Task 8
- `src/routes/index.tsx` unchanged — implicit (not touched)
- All 4 inline sub-components in one file — Task 1

**Type consistency:** `WorkspaceShell` props (`path: string`, `sidebar: ReactNode`, `status: ReactNode`, `children: ReactNode`) match the spec API. Sub-components exported from same file with consistent prop signatures.

**Placeholder scan:** No "TBD", "TODO", "implement later". All per-page sidebar/status content is concrete in each task. Status values are real (`activeJobs.length`, `filtered.length`, etc.) where possible; one or two static placeholders (e.g. "earning $0.000023/sec") are noted as such.

**Potential gotchas:**
- Task 3 moves the FiltersPanel from `<aside>` (inside the page) into the workspace shell's `sidebar` prop. The FiltersPanel component itself doesn't change — only its render location.
- Tasks 4-7 are mechanical wrapper swaps; logic/content stays intact.
- The `<a>` for docs sidebar sections uses `href="#id"` which triggers browser-native scroll. The `setActive(s.id)` state still updates the highlighted item.
- Task 4 wraps 3 components (main, notFound, errorComponent). Each gets its own minimal shell with path-only setup.
- Mobile collapse uses `order-1 lg:order-2` / `order-2 lg:order-1` to stack sidebar below main on `<lg`.

**Not in scope:** Real-time status bar updates, per-page sidebar item deep-linking, WorkspaceShell animations, functional Canvas/Providers/Jobs/Wallet links.
