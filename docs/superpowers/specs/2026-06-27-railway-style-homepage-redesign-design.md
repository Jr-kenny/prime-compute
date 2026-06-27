# Railway-style Homepage Redesign — Design Spec

**Date:** 2026-06-27
**Status:** Draft, awaiting user review
**Scope:** Homepage + shared shell only (Scope 2 of 3 options)

## Background

The current `src/routes/index.tsx` homepage has a dark "space" aesthetic with starfield background, blue glow accents, and motion-heavy framer animations. The user wanted a Railway.com-style look from the start — sections, sunset gradient hero, oversized serif headlines, animated product canvas, trust layer. Lovable's initial output didn't match that vision.

This design rebuilds the homepage and shared shell to match the Railway aesthetic, keeping Prime Compute's blue color identity rather than Railway's purple.

## Goals

- Hero that feels like Railway's: sunset gradient bg, big serif headline, animated product canvas showing how the app works
- Five-section rail (Build / Network / Scale / Monitor / Evolve) with Railway-style illustration cards + "Alternative to X / Y / Z" comparison rows
- Trust layer: real-time stats counter, customer logo strip, testimonial cards
- Tightened Navbar and Footer so every page in the app inherits the new visual rhythm
- Inner pages (Marketplace, Dashboard, Provider, Docs) keep their layouts — they get a new shell only

## Non-goals

- No new routes
- No business-logic changes
- No new dependencies (use existing framer-motion, lucide-react, recharts)
- No full design-token overhaul (small color tweaks only)
- Dashboard / Marketplace / Provider / Docs route internals untouched in this pass

## Visual system

| Token | Current | New |
|---|---|---|
| `--background` | `oklch(0.16 0.04 265)` `#060c1a` | `oklch(0.14 0.04 250)` `#050a18` (deeper navy) |
| `--surface` | `oklch(0.22 0.06 265)` `#0d1635` | `oklch(0.20 0.06 250)` `#0a1430` (slightly bluer) |
| `--primary` | `oklch(0.58 0.21 262)` `#2563eb` | unchanged (keep blue) |
| `--glow` | (existing) | unchanged |
| Display type | Inter bold | **Instrument Serif** for hero headlines (e.g. *"Pay per heartbeat."* in italic) |
| Body type | Inter | Inter (kept) |
| Mono type | system mono | **JetBrains Mono** for code, streaming counters, nav-demo labels |
| Hero gradient | black + starfield | sunset gradient (deep navy → mid blue → lighter blue at bottom) |
| Section dividers | hairline borders | alternating bg-color sections (no hard dividers between Build / Network / Scale / Monitor / Evolve) |

## Component changes

### Replace

| File | Becomes | Reason |
|---|---|---|
| `src/components/site/SpaceBackground.tsx` | `HeroGradient.tsx` | Sunset gradient bg; no stars/particles |
| `src/components/site/HeroAnimation.tsx` | `HeroCanvas.tsx` | Animated SVG product canvas demo (Job → Broker → Provider nodes, animated pulse lines, streaming rate counter, status line) |

### Rebuild

| File | Reason |
|---|---|
| `src/routes/index.tsx` | New hero, logo strip, 5-section rail, trust layer, CTA |
| `src/components/site/Navbar.tsx` | Thinner, sticky blur, primary nav inline, "Connect Wallet" + "Get Started" pills right |
| `src/components/site/Footer.tsx` | 3-col layout: brand / links / "Powered by Circle Payments" |
| `src/components/site/PageShell.tsx` | Tighten motion (no initial fade if it interferes with new hero entrance), keep structure |

### Keep as-is

`BrokerFlow.tsx`, `ProviderCard.tsx`, `StatCounter.tsx`, `ComputeScoreRing.tsx`, `StreamingTicker.tsx` — these may get touched in passing if padding or color conflicts surface, but no structural changes.

## Homepage structure (`src/routes/index.tsx`)

Top to bottom:

1. **Hero** (`<section>`)
   - Eyebrow pill: green dot + "Live on testnet"
   - Headline (serif): "Rent compute." + italic line "Pay per heartbeat."
   - Subtitle: "The AI-brokered marketplace for idle GPUs, CPUs, and servers. Streaming nanopayments that stop the instant your job does."
   - CTAs: primary "Browse compute →" (filled), secondary "List your server" (ghost)
   - **HeroCanvas component** — animated SVG with sidebar nav (Canvas / Providers / Jobs / Wallet, services list), canvas area (Job → Broker → H100 × 8 / A100 × 4 nodes), animated gradient pulse lines from Job→Broker→Provider, live streaming rate counter (`$0.00018420 streaming`), status line ("broker matched inference-gpu-01 (compute score: 942) · streaming USDC @ $0.00001/sec")
2. **Logo strip** — 7-8 placeholder customer names (Arcol, G2X, Bilt, Vendora, TripAdvisor, Cognizant, Mercado Libre) on dark band
3. **Build / Deploy section** — left: eyebrow "Deploy", serif heading "Deploy anything without the complexity.", body copy, "Alternative to RunPod / Vast.ai / AWS / GCP" tags; right: deploy-style illustration card with "Alternative to" overlay row
4. **Network section** — alternating bg; right: copy; left: provider-routing illustration card
5. **Scale section** — alternating bg; left: copy; right: scale illustration card
6. **Monitor section** — alternating bg; right: copy; left: log/dashboard mock card
7. **Evolve section** — alternating bg; left: copy; right: environment/preview illustration
8. **Trust layer** — eyebrow "Real-time", italic heading "0+ jobs and counting", 5-stat grid (Providers online / $/sec minimum / Uptime SLA / Broker match time / Jobs completed), 2 testimonial cards
9. **CTA** — "Got idle hardware? Turn it into yield." with two CTAs
10. **Footer** — new layout (rendered by `PageShell`, not in `index.tsx`)

## Navbar

- Sticky top, 64px tall, `bg-background/70 backdrop-blur-xl`, hairline bottom border
- Brand left (existing `Boxes` icon + "Prime **Compute**" wordmark, accent in `--glow` color)
- Center (md+): `Marketplace / Dashboard / Provider / Docs` inline pills, active state = bg card/60
- Right (md+): `Connect Wallet` (ghost) + `Get Started` (primary filled pill with glow shadow)
- Mobile: hamburger → slide-down panel with same links + CTAs
- No top promo bar

## Footer

- 3-col on md+, stacked on mobile
- Col 1: brand (icon + wordmark)
- Col 2: links (Home / Marketplace / Dashboard / Docs) centered
- Col 3: "Powered by Circle Payments" right-aligned
- Below: hairline divider + copyright bar

## File-level changes summary

```
src/
├── routes/index.tsx                 REBUILD
├── components/site/
│   ├── PageShell.tsx                TWEAK motion
│   ├── Navbar.tsx                   REBUILD
│   ├── Footer.tsx                   REBUILD
│   ├── HeroAnimation.tsx            REPLACE → HeroCanvas.tsx
│   ├── SpaceBackground.tsx          REPLACE → HeroGradient.tsx
│   ├── BrokerFlow.tsx               KEEP
│   ├── ProviderCard.tsx             KEEP (touch up if needed)
│   ├── StatCounter.tsx              KEEP
│   ├── ComputeScoreRing.tsx         KEEP
│   └── StreamingTicker.tsx          KEEP
└── styles.css                       TWEAK color tokens, ADD Instrument Serif + JetBrains Mono imports
```

No changes to `src/lib/`, `src/hooks/`, route configs, or business logic.

## Build order

1. `styles.css` — tweak `--background` / `--surface`, add font imports
2. `HeroGradient.tsx` — small, low risk, replaces SpaceBackground
3. `HeroCanvas.tsx` — animated SVG nav-demo (the centerpiece)
4. `index.tsx` — rebuild section by section, visual check after each
5. `Navbar.tsx` + `Footer.tsx` — refresh
6. `PageShell.tsx` — tighten entrance motion
7. Visual sweep on `/marketplace`, `/dashboard`, `/provider`, `/docs` — fix any padding/color collisions with new shell
8. Verify: `npm run lint` + `npm run build` + browser walkthrough of all touched pages

## Verification

- `npm run lint` exits 0
- `npm run build` exits 0
- Browser walkthrough: hero SVG animates smoothly, all 5 sections render, navbar sticky + blur works, footer 3-col layout correct, all routes still navigable
- Mobile (≤640px): hamburger menu works, no horizontal scroll, hero scales down cleanly

## Open questions

None — user approved scope 2 and the design as presented on 2026-06-27.

## Out of scope (deferred)

- Dashboard / Marketplace / Provider / Docs visual overhauls
- Light-mode toggle
- Real customer logos (placeholders used)
- Full design-token overhaul (font scale, spacing scale, motion tokens)
- Real product illustration assets (using placeholder-style SVG/CSS for now)
