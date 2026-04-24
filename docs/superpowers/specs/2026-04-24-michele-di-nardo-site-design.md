# Michele Di Nardo — Site Redesign Spec

**Date:** 2026-04-24
**Target:** `Michele Di Nardo.html` (current) → `index.html` (redesign)
**Subject:** Games industry production & publishing consultancy site for Michele Di Nardo (aka Miki), Turin-based producer.

## Context

The current file is a self-unpacking Framer-style HTML export (5 MB, base64+gzip bundled). Not editable as source. This spec defines a ground-up rebuild that preserves the positioning and content of the current site while upgrading design, motion, and stack portability. Original file is kept alongside the new one for reference.

## Goals

- **Faithful content, rethought presentation.** Same services, same narrative, same CTAs — reconsidered hierarchy, palette, typography, layout, motion.
- **Portable stack.** Single `index.html` with embedded CSS + vanilla JS. No build step. Can be dropped on Netlify, Vercel, GitHub Pages, personal server, or emailed.
- **Editorial character.** Michele's work is about precision and structure; the site should read like a producer's dossier, not a generic agency landing.

## Non-goals

- No React/Next/Framework migration.
- No CMS, analytics, or backend wiring in this pass (form posts to `mailto:` as fallback; real handler is a future concern).
- No import or decompression of the bundled assets from the existing file. New visual design is typographic-first; no photo dependency.

## Audience & positioning

- **Primary audience:** indie and mid-size game studio founders, heads of production, publishing leads. They are shopping for a fractional producer or short-term consultant.
- **Primary CTA:** "Book a 30-minute discovery call" (anchors to contact section).
- **Secondary CTA:** "See services" (anchors to services).
- **Voice:** direct, unfussy, confident. Already strong in the existing copy — preserve with minor punch-up.

## Brand system

### Palette

Departure from the current saturated navy `#0A2540` + orange `#F49B1A` (both flagged by the audit: pure-ish navy with oversaturated accent).

New warm-editorial palette:

| Token | Hex | Role |
|---|---|---|
| `--paper` | `#F5F1EA` | Page background, warm paper |
| `--paper-2` | `#EEE8DC` | Sectional contrast, subtle tint |
| `--ink` | `#1A1815` | Primary text, headlines |
| `--ink-2` | `#5A564F` | Secondary text |
| `--rule` | `#D9D2C2` | Hairline rules, dividers |
| `--clay` | `#B54A2C` | Single accent — desaturated terracotta |
| `--clay-soft` | `#E7C9B8` | Accent wash, hover tint |

One accent. Saturation <80%. Consistent warm gray family. No purple/blue gradient. Shadows (when used) tinted warm, not pure black.

### Typography

- **Display:** `Fraunces` (Google Fonts, variable: opsz + wght). Opsz=144 for H1, tight tracking, leading-none. Editorial serif with character.
- **Body / UI:** `Geist` (Google Fonts). Weights 400/500/600.
- **Mono / numerics:** `Geist Mono` for section numerals ("01 —"), status readouts, tabular figures in the process timeline.

Inter is banned per design-taste rules. Serif on display is allowed here — this is editorial/portfolio, not a dashboard.

### Motion

- `MOTION_INTENSITY: 6` — staggered fade+lift on scroll (IntersectionObserver), 200–300ms transitions on interactive elements, smooth anchor scroll, hover lifts using `transform` only.
- No JS animation libraries. Pure CSS transitions + one small IntersectionObserver for reveal cascades.
- No perpetual loops except a subtle marquee on the shipped-titles strip.

### Micro-details

- Warm grain overlay at ~4% opacity, fixed, pointer-events-none.
- 1px hairline rules instead of card borders where possible.
- Rounded corners used sparingly (8px on inputs, 0 on structural sections).
- Shadows, when used, are warm and tight: `0 1px 0 rgba(26,24,21,0.06), 0 8px 24px -12px rgba(181,74,44,0.18)`.

## Information architecture

Single long-scroll page with anchor sections. Top nav:

1. `01 — Consultancy` (about)
2. `02 — Services`
3. `03 — Process`
4. `04 — Contact`

### Sections (in order)

1. **Hero** — asymmetric split (not centered).
   - Left: section kicker "Production & Publishing Consultancy". H1: "Turning game ideas into shipped titles." Intro paragraph. Two CTAs: "See services →" (ghost), "Get in touch →" (filled clay).
   - Right: editorial capsule — monogram "M.", availability badge ("Available Q3 2026" style), current role status ("Producer at Untold Games · City 20"), one line about base ("Based in Turin").
2. **Ships marquee** — a slow horizontal ticker of shipped titles: Redout · Sniper Elite 4 · Strange Brigade · Zombie Army 4 · Kathy Rain 2 · Moonstone Island · Dome Keeper · City 20. Text-only, large display serif, no logo grid.
3. **About / 01 — Consultancy** — editorial long-form, single column constrained to 65ch. Pull-quote styling for the "Nine years inside the game development machine." line. Inline role list formatted as a career timeline, one row per studio: year range · studio · role · shipped titles.
4. **Services / 02** — three zones as a vertical editorial "dossier," not a 3-card row.
   - Each zone: number, title, one-line summary, 6 bullets, no box. Hairline rule between zones. Optional inline icon per service (custom SVG, 1.5 stroke).
   - Zones: Production & Project Operations · Platform & Release Management · Strategic Publishing Support.
5. **Process / 03** — four steps in a desktop horizontal rail with tabular-numbered ligatures. Stacks vertically on mobile. Step title + one-line summary each.
6. **Contact / 04** — split screen.
   - Left: "Got a project that needs an experienced hand?" heading, sub-copy, and the 1–3 day response note.
   - Right: form — Name*, Company, Email*, Phone, Message. Labels above inputs. Paper-inset input style. Submits via `mailto:` with encoded body as no-backend fallback. Inline client-side validation for required + email format. Clear error text below each input.
7. **Footer** — minimal. Wordmark, © 2026, LinkedIn, Email. One-line status ("Say hi · anytime").

## Component details

### Nav
- Fixed top, warm-paper translucent (backdrop-blur), 1px bottom rule.
- Left: wordmark "miki — producer".
- Right: the four numbered anchors. Active section indicated via scroll-spy.
- Mobile: hamburger → full-screen overlay with same numbered list.

### Hero
- Grid: `grid-template-columns: 1.4fr 1fr` on desktop; stacks on <768px.
- H1 in Fraunces 144 opsz, ~88px desktop / ~48px mobile, `letter-spacing: -0.035em`, `text-wrap: balance`.
- CTAs: clay filled primary, ghost secondary. Active state: `translateY(1px)` + slight shadow compress.

### Services zone
- Number: 01 / 02 / 03 in Geist Mono, clay color, small caps tracking.
- Title: Fraunces, 40px desktop.
- Bullets: custom SVG marker (tiny clay dot), Geist body.

### Process rail
- Desktop: four columns, each with big tabular-numbered digit in Fraunces + title below + short copy.
- Connector: hairline rule with inline clay dots at each node.

### Contact form
- Inputs: paper-2 background, 1px rule border, 8px radius, Geist body, focus ring in clay at 30% alpha.
- Validation: required + email pattern checked on submit and on blur after first submit. Errors render under inputs in clay.
- Submit button: clay filled, full width on mobile.
- `action="mailto:miki@example.com"` as fallback (real address to confirm with user; placeholder `hello@micheledinardo.com` will be used pending input).

### Marquee
- CSS `@keyframes` on `transform: translateX` at ~40s period. Duplicated track for seamless loop. `prefers-reduced-motion` halts animation.

## Accessibility

- Skip-to-content link (visually hidden until focused).
- Semantic landmarks: `<header>`, `<nav>`, `<main>`, `<section>` with `aria-labelledby`, `<footer>`.
- Focus rings preserved and visible (clay ring).
- All SVG icons have `aria-hidden="true"` or `role="img"` + `<title>` where meaningful.
- Form: labels `for`/`id` paired, error messages with `aria-describedby`, required fields marked with `aria-required`.
- Respect `prefers-reduced-motion` on marquee and reveal animations.
- Color contrast: ink on paper exceeds 4.5:1; clay on paper tested for AA on text usage.

## Responsive

- Breakpoints: `md: 768px`, `lg: 1024px`, `xl: 1280px`.
- Container: `max-width: 1280px` with fluid padding (`clamp(20px, 4vw, 56px)`).
- All asymmetric layouts collapse to single-column under 768px.
- Hero uses `min-height: 100dvh` (not `100vh`), with optical bottom padding.

## Content preserved from original

All copy lifted from the current site is kept substantively intact. The tweaks:
- "Production & Publishing Consultancy ·" trailing middle-dot dropped.
- Section headings renumbered consistently (01 → 04).
- No AI-slop language to remove; the current copy is already direct.

## Risks / open questions

Left for later or for sensible defaults:
- **Real email address** — using `hello@micheledinardo.com` as placeholder in `mailto:`. User can swap.
- **LinkedIn URL** — `#` placeholder in footer.
- **Real logos for shipped titles** — skipped; text marquee used instead.
- **Personal photo** — not included in this pass. Typography-led design stands without.
- **Form backend** — `mailto:` fallback only. Future: wire to Formspree/Basin/own endpoint.

## Deliverables

- `index.html` — the new single-file site at `C:/Users/Miki/Desktop/Website/index.html`.
- Original `Michele Di Nardo.html` left untouched for comparison/fallback.
- This spec committed under `docs/superpowers/specs/`.

## Acceptance

- Opens in a modern browser with no console errors.
- All anchor links resolve to their sections with smooth scroll.
- Form validates client-side and opens the user's mail client on submit.
- Marquee animation respects reduced-motion.
- Looks coherent at 360px, 768px, 1024px, and 1440px viewports.
