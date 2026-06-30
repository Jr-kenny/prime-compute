# UI Refactor: Neutral Palette + Operational Card Pattern — Design

**Status:** approved (brainstormed 2026-06-30, visual companion used). Next: implementation plan via writing-plans.

**One-line contract:** Every page reads from a desaturated, neutral dark palette instead of the
current blue-navy tint, every decorative neon/glow/gradient effect is gone or restrained, and any
card representing something *live and running* (an active rent, a provider currently serving one)
opens a side panel with its detail and controls instead of cramming Pause/Resume/Stop onto the
card itself. The sidebar nav stays, restyled with a workspace-switcher header and an account
footer.

---

## Why this shape

Two reference images drove this, confirmed interactively with mockups:

1. A cross-chain flow dashboard screenshot, used purely as a **palette and restraint** reference,
   not a feature to replicate. Near-black neutral background, soft low-contrast borders, color
   only where data itself is colored, no brand-wash over the chrome.
2. Railway's own dashboard, used as a **structural** reference: a workspace switcher above the
   nav links, real line icons, a refined active-nav pill, an account footer with an overflow menu,
   and project tiles (preview area + status row) that you click to drill into detail.

The current app's actual brand/semantic colors (the blue primary/accent, success green, warning
amber, destructive red) turned out to already be close to what the approved mockups used, the real
problem is the *neutral* scale (background/surface/card/border/foreground/muted-foreground)
carries too much blue chroma, and several utilities and inline styles add decorative
glow/gradient/shadow effects on top of it. Fixing the neutral scale and retiring the decorative
layer gets most of the way there without touching the brand colors at all.

---

## 1. Design tokens (`src/styles.css`)

The neutral scale gets desaturated from its current blue-tinted oklch values (chroma ~0.04-0.08)
down to near-neutral gray (chroma ~0.005-0.012), matching the approved mockup palette:

| Token | Current | New | Roughly |
|---|---|---|---|
| `--background` | `oklch(0.14 0.04 250)` | `oklch(0.105 0.006 270)` | `#0d0d12` |
| `--surface` | `oklch(0.20 0.06 250)` | `oklch(0.115 0.005 270)` | `#111116` |
| `--card` | `oklch(0.26 0.07 265)` | `oklch(0.145 0.008 270)` | `#16161d` |
| `--border` | `oklch(0.34 0.08 265)` | `oklch(0.235 0.012 270)` | `#26262f` |
| `--foreground` | `oklch(0.96 0.01 250)` | `oklch(0.965 0.003 270)` | `#f5f5f7` |
| `--muted-foreground` | `oklch(0.62 0.03 255)` | `oklch(0.60 0.012 270)` | `#8b8b96` |
| `--sidebar` | `oklch(0.22 0.06 265)` | `oklch(0.125 0.006 270)` | `#111116` (matches surface) |
| `--popover` / `--secondary` / `--muted` | (blue-tinted variants) | desaturated to match the new card/border scale | — |

**Unchanged** (already close to the approved mockup values, confirmed by checking the hex used in
the mockups against the existing oklch): `--primary`, `--accent`, `--glow`, `--success`,
`--warning`, `--destructive`. The brand identity isn't moving, only the neutral chrome around it.

**Removed (dead code, zero usages anywhere in `src/`):** `.bg-grid`, `.drift`, `.drift-slow`,
`.twinkle` and their keyframes.

**Changed utilities:**
- `glow-hover`: drop the `box-shadow` bloom on hover, keep only the `border-color` shift. No more
  neon halo on card hover.
- `text-gradient-blue`: retired. Its 5 call sites (`dashboard.tsx` ×2, `marketplace.index.tsx` ×1,
  `provider.tsx` ×2, all on stat numbers like "Total spent") switch to plain `text-foreground`.

**Kept as-is:** `text-glow` (17 usages) is just `color: var(--color-glow)`, a plain accent-color
application, not a glow/shadow effect despite the name. Already restrained, no change needed.
`pulse-ring` (4 usages, the live-status dot animation) is already a restrained, functional
indicator, kept as-is.

---

## 2. Ad-hoc neon shadows removed

Two inline `shadow-[0_0_24px_-6px_color-mix(...)]` strings, found by grep, removed entirely:
- `src/components/site/Sidebar.tsx` (the primary CTA button)
- `src/components/site/LumenOverlay.tsx` (the floating action button)

(A third match, `src/components/ui/sidebar.tsx`, is an unused shadcn-installed primitive never
imported anywhere in `src/`. Confirmed dead. Out of scope, not touched here.)

---

## 3. Landing page hero background (`src/components/site/HeroGradient.tsx`)

Currently a full-bleed bright blue linear-gradient wash (`#050a18` → `#2d5cb0`) plus a 50%-opacity
radial blob. Replaced with the new neutral near-black background and one subtle, static,
low-opacity radial accent glow in a single corner, no animation, matching the reference's
barely-there ambient glow instead of a bright colored wash.

---

## 4. Landing page hero demo (`src/components/site/HeroCanvas.tsx`)

`HeroCanvas` already wraps its content in a browser-chrome frame (traffic-light dots, URL bar),
that structure stays. What's inside it changes: today it's an abstract animated SVG diagram
(consumer/broker/provider nodes joined by pulsing lines), which gets replaced with a choreographed
product demo, confirmed via an animated mockup in the visual companion.

Real component markup, scaled down inside the frame, showing the app's actual sidebar (post-
refactor, so the new workspace-switcher header and nav from section 5 below) next to a content
area. A simulated cursor moves to a sidebar nav item, "clicks" it, and the content area crossfades
to the corresponding view (Dashboard → Marketplace, looping). Built with `framer-motion` (already
a dependency, already used in `BrokerFlow.tsx`), not a recorded video, an actual screen-recorded
walkthrough was considered and explicitly deferred as a separate production task (would mean
either manually recording the running app or standing up a Playwright-driven capture/encode
pipeline), out of scope for this PR. The sidebar shown inside the demo must mirror the real
`Sidebar.tsx` structure exactly, not an invented layout (an earlier draft used a top-nav style and
was corrected for this reason).

---

## 5. Sidebar (`src/components/site/Sidebar.tsx`)

Restructured per the approved mockup:
- **Workspace-switcher header** (replaces the plain brand-only header): logo, "Prime Compute",
  and the wallet's chain (`baseSepolia`, already known from `src/lib/circle/chain.ts`) as a small
  label underneath, with a chevron. No dropdown behavior yet, just the visual structure, single
  chain today.
- **Nav items**: unchanged icons (already real `lucide-react` icons, not emoji), refined
  active-state to a filled pill background matching the new neutral scale.
- **Account footer**: replaces the current stacked Connect-Wallet/Get-Started/Sign-out buttons
  (built earlier this session) with the same underlying state (`useSession()`) rendered as a
  single row: status dot + truncated wallet address + an overflow (kebab) menu containing "Sign
  out". Signed-out state keeps the existing "Get Started" CTA, just restyled. No new auth logic,
  this is a visual relayout of what's already there.

**Explicitly dropped from the mockups:** the content-area "broker online" status pill I sketched
in the v2/v3 mockups. There's no always-on broker process (established earlier this session,
`feedback.md`/project memory), so a persistent "online" indicator would be exactly the kind of
fake state this whole product build has been removing. Not carried into the real design.

---

## 6. Operational card + detail panel pattern

New pattern, used in two places:

**`src/routes/dashboard.tsx` — Active rents.** Each `ActiveRentCard` becomes a tile: name header,
a dotted-grid preview area with a centered icon, a bottom status row (dot + status + provider
alias). Clicking a tile opens a `Sheet` (the same component already used for the marketplace's
`RentSheet` and mobile filters) showing the full detail: name, provider, status pill, the
streaming-spend stat block (rate, elapsed), and the Pause/Resume/Stop buttons. Those buttons keep
their exact existing behavior (`pauseRent`/`resumeRent`/`cancelRent`, gated by
`canPause`/`canResume`/`canCancel` from `services/src/rent-transitions.ts`), this is a visual
relocation off the always-visible card and into the panel, not a behavior change.

**`src/routes/provider.tsx` — My servers.** Same treatment for `ServerCard`: tile with a preview
area and status row, click to open a panel showing the server's specs, its currently-running rent
(if any) with the real `pricePerCharge` ticker, and the online/offline toggle.

---

## 7. Marketplace stays a dedicated page

Per the approved A/B comparison: `ProviderCard` tiles get the same visual treatment (dotted-grid
preview area, status row) for consistency, but clicking still navigates to the existing
`/marketplace/$id` detail page exactly as today, not a side panel. Browsing/comparing providers
needs the room for hardware specs and rent history tabs that a slide-over doesn't have. No
behavior change here, purely a visual reskin of the existing tile and detail page.

---

## 8. Scope across the rest of the app

Every route inherits the token change automatically (it's a CSS custom property swap in one
file). Pages with no structural changes beyond that and the neon-shadow/gradient cleanup already
covered: `docs.tsx`, `register.tsx`, `onboarding.tsx`, `marketplace.$id.tsx`. Lumen's visual
chrome (the overlay, FAB, sidebar entry) is in scope for the palette/shadow cleanup like every
other component; **its conversational logic and wiring are explicitly out of scope**, per your
instruction to leave that for Opus.

---

## Testing

No unit-testable logic changes here (CSS tokens + JSX class/markup restructuring, no behavior
changes to the rent/provider write paths touched in the prior two PRs). Verification is:
`tsc --noEmit` clean, `npm run build` succeeds, and a manual pass through every route at both
desktop and mobile widths (the app has real mobile breakpoints via `MobileTopBar`/`BottomTabBar`)
confirming the new palette renders correctly and the two new detail panels (dashboard, provider)
open/close and the pause/resume/cancel buttons still work exactly as before.

---

## Resulting PR shape

1. `src/styles.css`: neutral-scale token rewrite, retire `glow-hover`'s shadow and
   `text-gradient-blue`, delete dead `bg-grid`/`drift`/`twinkle` CSS.
2. Remove the two ad-hoc neon `shadow-[0_0_24px...]` strings (Sidebar, LumenOverlay).
3. `HeroGradient.tsx`: bright blue wash → neutral background + one static subtle corner glow.
4. `HeroCanvas.tsx`: abstract SVG diagram → choreographed sidebar+content demo (framer-motion,
   simulated cursor, real component markup, no recorded video).
5. `Sidebar.tsx`: workspace-switcher header, refined active-nav pill, account-footer-with-overflow-menu.
6. New shared tile pattern + two `Sheet`-based detail panels (dashboard active rents, provider's
   my servers), wired to the existing pause/resume/cancel and server-status logic with zero
   behavior change.
7. `ProviderCard.tsx`: tile-style reskin, same click-through-to-page behavior.
8. Token-level pass (automatic) + decorative cleanup on every remaining route.
9. Lumen's visual chrome restyled; its logic untouched.
