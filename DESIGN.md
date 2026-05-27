---
name: Spritz Consulting
description: Production & publishing consultancy for indie games — editorial-typographic site with mustard signature.
colors:
  paper: "#0A0B0E"
  paper-2: "#12141A"
  paper-3: "#1A1D25"
  ink: "#ECEFF6"
  ink-2: "#8E95A4"
  ink-3: "#5C6272"
  rule: "#262A33"
  rule-soft: "#1C1F27"
  clay: "#E5B415"
  clay-deep: "#C4970A"
  clay-soft: "#2A1F05"
  accent-2: "#FF2EC8"
  danger: "#FF2EC8"
  success: "#62C28A"
  err-bg: "#2A1020"
  portrait-bg: "#E5B415"
  paper-light: "#F4F3ED"
  paper-2-light: "#E9E7DE"
  paper-3-light: "#FBFAF4"
  ink-light: "#0A0B0E"
  ink-2-light: "#4A4E58"
  ink-3-light: "#5F6168"
  rule-light: "#CFCDC2"
  rule-soft-light: "#DCDAD0"
  clay-light: "#8A6600"
  clay-deep-light: "#6B5000"
  clay-soft-light: "#F3E4A8"
  accent-2-light: "#BE1383"
typography:
  display:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(44px, 7.4vw, 112px)"
    fontWeight: 400
    lineHeight: 0.94
    letterSpacing: "-0.035em"
    fontVariation: "opsz 96"
  headline:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(40px, 5.4vw, 76px)"
    fontWeight: 400
    lineHeight: 1.0
    letterSpacing: "-0.03em"
    fontVariation: "opsz 80"
  title:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(22px, 2.4vw, 32px)"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.015em"
    fontVariation: "opsz 36"
  body:
    fontFamily: "SF Pro Text, -apple-system, BlinkMacSystemFont, Segoe UI Variable Text, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  body-article:
    fontFamily: "SF Pro Text, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.78
    letterSpacing: "normal"
  label:
    fontFamily: "Bebas Neue, Impact, Haettenschweiler, Arial Narrow, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.08em"
  meta:
    fontFamily: "Bebas Neue, Impact, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.14em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  card: "12px"
  card-lg: "14px"
  card-xl: "16px"
  panel: "18px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "28px"
  xl: "44px"
  section: "clamp(80px, 12vw, 160px)"
  wrap-inline: "clamp(20px, 4vw, 56px)"
  wrap-max: "1280px"
  article-max: "860px"
  calc-max: "1180px"
components:
  button-primary:
    backgroundColor: "{colors.clay}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "14px 22px"
  button-primary-hover:
    backgroundColor: "{colors.clay-deep}"
    textColor: "{colors.paper}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "14px 22px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  nav-link-active:
    backgroundColor: "{colors.clay}"
    textColor: "{colors.paper}"
  preset-btn:
    backgroundColor: "{colors.paper-3}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "10px 18px"
  preset-btn-active:
    backgroundColor: "{colors.clay}"
    textColor: "{colors.paper}"
  input:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "14px 16px"
  card-panel:
    backgroundColor: "{colors.paper-3}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "28px"
  card-result:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card-lg}"
    padding: "32px"
  card-tldr:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.card-lg}"
    padding: "32px 34px"
  card-cta:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card-xl}"
    padding: "48px"
  chip-filter:
    backgroundColor: "{colors.paper-3}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "13px 48px"
  chip-filter-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  toggle-pill:
    backgroundColor: "{colors.paper-3}"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  toggle-pill-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
---

# Design System: Spritz Consulting

## 1. Overview

**Creative North Star: "The Production-Side Editorial"**

Voice of a producer who's also a typesetter. The site reads like a printed dossier — generous serif display, tabular monospace tickers, body in a system sans. Near-black surface lit from behind by a slow mustard aurora and a permanent 5% grain, signaling craft over template. The mustard (`#E5B415`) is the same hue as the founder's portrait backdrop, so the brand color is photographic in origin, not arbitrary.

Density is editorial, not SaaS. Headlines breathe at `clamp(44px, 7.4vw, 112px)`, articles cap at 860px, body holds 65–75ch. Cards exist but are reserved for genuine containers (hero deck, result panel, TL;DR, CTA, calculator input groups); the resources list is a flat divided list, not a grid of icon-tiles. Magenta (`#FF2EC8`) is present but rare — kicker accents in light theme, danger states only.

Rejects: SaaS gradient buttons; navy-and-cyan B2B template; glassmorphism beyond the header backdrop-filter; neon-on-black "fintech for crypto" vibes; gradient text; identical icon-tile card grids; nested cards.

**Key Characteristics:**
- Tinted near-black `#0A0B0E` (paper) tilted toward warm-cool, never `#000`.
- Single saturated accent — clay mustard `#E5B415`. Touches: dot pulse, headline `<em>`, button primary, scrollbar thumb, focus ring, aurora wash.
- Three families: Bricolage Grotesque (display, variable opsz), SF Pro Text (body), Bebas Neue (mono/label uppercase).
- Pill radius (999px) for interactive; 8–18px for panels; 4px focus.
- Theme-paired: dark mustard-on-near-black; light deep-mustard-on-cream. Magenta promoted to kicker accents in light.

## 2. Colors: The Mustard-on-Coal Palette

The system runs on a single saturated brand color against a tinted near-black or warm cream. Primary carries identity; magenta carries danger and one light-theme expression; neutrals tilt warm.

### Primary
- **Clay Mustard** (`#E5B415`, deep `#C4970A`, soft wash `#2A1F05`): brand signature — primary button fill, headline italics, kicker bar, scrollbar thumb, focus outline, aurora gradient, link hover. In light theme, deepens to `#8A6600` for cream-surface legibility.

### Secondary
- **Magenta** (`#FF2EC8` dark / `#BE1383` light): danger state, form errors, and (light-theme only) kicker bar + numeral accent. Never a decorative accent — semantic role only.

### Tertiary
- **Success Green** (`#62C28A` dark / `#1F6B3D` light): form confirmation only. Not used decoratively.

### Neutral (Dark, default)
- **Paper** (`#0A0B0E`): page background. Cool near-black, not `#000`.
- **Paper-2** (`#12141A`): card surfaces, TL;DR, CTA card, result card base.
- **Paper-3** (`#1A1D25`): elevated controls — toggles, input prefix chips, hero-right panel.
- **Ink** (`#ECEFF6`): primary text, headlines.
- **Ink-2** (`#8E95A4`): body prose, secondary text, descriptions.
- **Ink-3** (`#5C6272`): meta, captions, disabled state.
- **Rule** (`#262A33`) / **Rule-soft** (`#1C1F27`): dividers, card borders.

### Neutral (Light)
- **Paper** (`#F4F3ED`): warm cream, not white.
- **Paper-3** (`#FBFAF4`): elevated controls.
- **Ink** (`#0A0B0E`): primary text.
- **Rule** (`#CFCDC2`): dividers.

### Named Rules

**The One Mustard Rule.** Clay is the only chromatic accent on any screen unless the role is semantic (danger = magenta, success = green). If something needs to "pop" but isn't a CTA, the answer is weight or scale, not a second color.

**The Photographic-Origin Rule.** `--portrait-bg: #E5B415` is theme-invariant. The brand color is locked to the portrait's actual backdrop. Don't theme-shift it for variety.

**The Tinted-Black Rule.** Never `#000`, never `#fff`. Paper is always tilted toward the brand hue (cool warm-coal in dark, warm cream in light).

## 3. Typography

**Display Font:** Bricolage Grotesque (variable, `opsz` axis 12–96).
**Body Font:** SF Pro Text (system stack with full fallback chain).
**Label/Mono Font:** Bebas Neue (condensed display sans, used as monospace-role).

**Character:** Editorial pairing — variable-opsz serif-leaning grotesque for display does the heavy expression, SF Pro keeps body invisible and fast, Bebas Neue does meta/labels/numerals at small sizes with tight uppercase. Bebas is "mono" by role (tickers, kickers, nav, meta) even though it's a condensed sans — chosen for editorial weight, not for monospace fidelity.

### Hierarchy
- **Display** (Bricolage 400, `clamp(44px, 7.4vw, 112px)`, lh 0.94, ls -0.035em, opsz 96): hero H1. Italics in clay for the emphasized phrase.
- **Headline** (Bricolage 400, `clamp(40px, 5.4vw, 76px)`, lh 1.0, ls -0.03em, opsz 80): resources hero, calculator hero.
- **Article H1** (Bricolage 600, `clamp(48px, 8vw, 104px)`, lh 1.02, ls -0.04em, opsz 96): article title.
- **Article H2** (Bricolage 600, `clamp(26px, 3.4vw, 40px)`, lh 1.12, ls -0.025em, opsz 40): with `01` `02` mono counters in clay above, plus top border-rule.
- **Title** (Bricolage 500, `clamp(22px, 2.4vw, 32px)`, lh 1.15, ls -0.015em, opsz 36): resource card title, calculator input label.
- **Deck/Lede** (Bricolage 500, `clamp(20px, 2.4vw, 28px)`, lh 1.5, ls -0.015em): article deck under H1, with bottom rule.
- **Body** (SF Pro 400, 17px, lh 1.55): default site copy.
- **Body Article** (SF Pro 400, 18px, lh 1.78): long-form article prose, looser for read-through.
- **Label** (Bebas 400, 14px, ls 0.08em, UPPERCASE): nav, kickers, button text, preset chips.
- **Meta** (Bebas 400, 12–13px, ls 0.14em, UPPERCASE): byline, footer, breakdown rows, category tags.

### Named Rules

**The Italic-Means-Clay Rule.** Italic text is always clay (`em` in headlines, `em` in body, deck italics). Never an italic in default ink.

**The Counter-Header Rule.** Article H2 carries an `::before` numeral counter (`01`, `02`) in clay Bebas above the heading. The number is the marker, the heading is the content.

**The Op-Size Rule.** Bricolage uses `font-variation-settings: "opsz" N` matched to the rendered size (opsz 24 for 20px wordmark, opsz 40 for H2, opsz 96 for display). Don't render a 100px headline at opsz 24.

**The Mono-For-Numbers Rule.** Any numeric value rendered in chrome (nav `01`–`05`, article counter, breakdown rows, calc result) uses `font-variant-numeric: tabular-nums`.

## 4. Elevation

Flat by default. Surfaces are tonal — paper, paper-2, paper-3 stack three near-black tones with no separating shadows. Depth comes from value contrast and 1px rules, not blur.

Shadows appear in three places only: (a) hero-right panel and primary button get a subtle grounded glow tinted in clay, (b) calc-result lifts with a clay-tinted ambient drop, (c) CTA card lifts a tinted glow on hover. The site uses ambient grain (5% noise overlay, blend-mode `screen` dark / `multiply` light) and two slow drifting aurora blobs (mustard radial gradients, 34s + 44s alternating) as continuous atmosphere — both are pinned `position: fixed`, animation pauses on tab hide.

### Shadow Vocabulary
- **shadow-sm** (`0 1px 0 rgba(0,0,0,0.55), 0 2px 8px -2px rgba(229,180,21,0.22)`): primary button at rest. The 1px black hairline grounds; the clay glow signals the brand color the button is.
- **shadow-md** (`0 1px 0 rgba(0,0,0,0.55), 0 20px 50px -20px rgba(229,180,21,0.26)`): hero-right panel, deck cards. Long soft clay drop.
- **calc-result inner+drop** (`inset 0 1px 0 + 0 24px 60px -32px` both clay-tinted): result panel gets an inner highlight and a falloff drop.
- **cta-card hover** (`0 0 0 1px + 0 8px 32px -8px` clay-tinted): CTA card lifts on hover only, never at rest.

### Named Rules

**The Flat-At-Rest Rule.** Cards, inputs, list items, filter chips are all flat at rest. Shadows respond to state (primary CTA, result reveal, hover) — never decorative.

**The Clay-Tinted-Shadow Rule.** Every shadow that exists is tinted with the brand mustard at low alpha. No neutral grey shadows. The shadow IS the brand color leaking through.

**The Ambient-Atmosphere Rule.** Grain and aurora are always-on but barely-on (`opacity: 0.05` / `0.42`). They produce a "this is a printed thing photographed slightly out of focus" feel without crossing into theme.

## 5. Components

### Buttons
- **Shape:** pill (radius 999px) for `.btn`, `.preset-btn`, `.res-cta`, `.calc-handoff-btn`.
- **Primary** (`btn-primary`): clay fill, paper text, `padding: 14px 22px`, `shadow-sm`. Hover → `clay-deep`, no shadow change. Right-arrow icon translates 3px on hover via `.arrow` span.
- **Ghost** (`btn-ghost`): transparent fill, `1px solid rule`, ink text. Hover → border becomes clay, text becomes clay.
- **Preset chip** (`.preset-btn`): paper-3 fill, rule border, ink text, mono label. Hover → border 70%-mix clay, bg 8%-mix clay, text clay. Active → clay fill, paper text.
- **CTA on resource card** (`.res-cta`): clay pill, paper text, has magnetic translate(`--mx`, `--my`) on parent hover (JS sets vars), reduced-motion disables.

### Filter Chips
- **Container** (`.res-filters`): rule-bordered pill bar, paper-3 fill, 5px inner padding, holds chip group as a segmented control.
- **Chip** (`.res-filter-btn`): pill, `13px 48px`, weight 600, 16px size. Default — transparent fill, rule border, ink text. Hover → border `ink-3`. Active → ink fill, paper text, ink border.
- Mobile (`<768px`): chips flex to fill row, padding shrinks to `12px 16px`.

### Cards / Containers
- **Hero-right panel:** rule border, paper-3 fill, `border-radius: 18px`, `padding: 28px`, `shadow-md`. Deck cards inside tilt ±1.6° at rest, slide-and-blur out of focus when inactive.
- **TL;DR card:** paper-2 fill, rule border, radius 14px, `padding: 32px 34px`. Label is a clay pill with paper text, 12px Bebas, ls 0.16em. List items get a clay `·` bullet.
- **CTA card:** paper-2 fill, rule border, radius 16px, `padding: 48px`. `::before` adds a soft clay radial wash at 100% 50%. Hover scales 1.025, clay-mix border, clay-tinted box-shadow; `::after` gradient frame fades in. The whole card is the hover target. (Single-column on mobile.)
- **Resource card (`.res-card`):** flat divided row, `border-bottom: 1px solid rule`, 56px icon column + 1fr body. Hover bg → 4%-mix clay tint, title color → clay. Unlocked variant promotes the icon stroke and border to clay (30%-mix).
- **Icon box (`.res-icon`):** 48px paper-3 square, rule border, radius 12px. Houses a 22px stroked icon at 1.5 stroke-width.

### Inputs
- **Wrap** (`.calc-input-wrap`): paper-2 fill, rule border, radius 8px, overflow hidden so the prefix/suffix chips read as integral parts. Focus-within → clay border.
- **Prefix/Suffix** (`.calc-currency`, `.calc-suffix`): paper-3 fill, ink-3 mono text, `padding: 14px 16px`, divided by 1px rule line.
- **Input** (`.calc-input`): transparent fill, ink text, SF Pro 16px, padding `14px 16px`. Webkit spinners dimmed to opacity 0.3. Wheel-blur on number inputs (JS) to prevent scroll-jumping values.

### Result Card
- **Surface** (`.calc-result`): clay-mix paper-2 (6% clay tint), clay-mix rule border (28%), radius 14px, dual shadow (inner 1px clay highlight + soft drop).
- **Label**: serif 500, opsz 36, sized `clamp(24px, 2.8vw, 32px)`, with a clay italic `Σ` prefix and a clay-tinted rule extending to the right.
- **Value**: serif 600, `clamp(56px, 10vw, 104px)`, ls -0.045em, opsz 96, tabular-nums.
- **Breakdown rows**: Bebas 13px mono, ls 0.06em, tabular-nums, separated by 1px clay-tinted rule.

### Navigation
- **Bar:** sticky, `backdrop-filter: saturate(140%) blur(14px)`, paper at 82% opacity. Scrolled state → 92% opacity, rule-soft bottom border.
- **Links:** Bebas 14px ls 0.04em UPPERCASE, ink-2 default. Number prefix (`01`–`04`) in clay tabular-nums. Hover → underline `::after` scales to 0.6. Active → clay pill background, paper text.
- **Resources link:** opted out of the numbered scheme — clay color at opacity 0.85, trailing `↗` arrow, distinct from the in-page anchors.
- **Mobile menu:** full-bleed paper overlay, serif 36px (opsz 60) nav list, mono `01`-style numbers in clay.

### Signature Components

**Wordmark dot.** `.wordmark .dot` is a 10px clay circle that pulses 1.8s ease-in-out (`scale 1 → 1.18`, opacity drop, expanding box-shadow ring). The dot replaces the typographic period in "spritz·consulting" — brand mark + heartbeat. Reduced-motion disables.

**Aurora.** Two radial mustard blobs at `position: fixed`, drift 28vw / 22vw on slow 34s + 44s alternates, blur via large radius rather than CSS filter blur. Behind everything, opacity 0.42 dark / 0.28 light. Paused on tab hide.

**Grain.** Inline SVG fractalNoise filter, baseFrequency 0.9, `position: fixed inset: -10%`, `background-position` animated 140px loop, blend-mode `screen` dark / `multiply` light, opacity 0.05. Permanent, never decorative; it's the texture of the page itself.

**Article H2 counter rules.** `counter-reset: h2` on article root, `counter-increment: h2` per H2, `::before { content: counter(h2, decimal-leading-zero); }` in clay Bebas above, with `border-top: 1px solid rule` and 72px top margin. The numbered, ruled break IS the chapter mark.

**Theme toggle + Language toggle.** Segmented pill controls. `aria-pressed="true"` button gets ink fill / paper text; inactive buttons hover to ink. Toggle persists to `localStorage` as `mdn-theme`; preload script applies before paint to avoid flash.

## 6. Do's and Don'ts

### Do:
- **Do** tint every neutral toward the brand hue. Paper `#0A0B0E` not `#000`; cream `#F4F3ED` not `#fff`.
- **Do** keep clay (`#E5B415`) as the single chromatic accent. If light theme, deepen to `#8A6600` for legibility on cream.
- **Do** use Bricolage Grotesque for any display text and set `font-variation-settings: "opsz" N` matched to render size.
- **Do** use Bebas Neue uppercase for labels, kickers, nav, and meta — never for body.
- **Do** use the `::before` counter pattern (`decimal-leading-zero` in clay Bebas) for article H2 chapter marks.
- **Do** apply `font-variant-numeric: tabular-nums` to every chrome number (counters, breakdown values, calculator results, nav numerals).
- **Do** italicize the emphasized phrase in headlines in clay (`<em>`).
- **Do** keep CTA cards, TL;DR cards, and result cards at radius 14–18px; pills at 999px; inputs at 8px.
- **Do** clamp display sizes (`clamp(44px, 7.4vw, 112px)`) and clamp section padding (`clamp(80px, 12vw, 160px)`).
- **Do** keep grain + aurora running but barely visible (opacity 0.05 / 0.42). Pause on `prefers-reduced-motion` and `body.is-tab-hidden`.
- **Do** tint shadows with clay at low alpha; black hairline grounds, clay glow signals brand.
- **Do** apply `cubic-bezier(0.16, 1, 0.3, 1)` as the default ease for hover and state transitions.

### Don't:
- **Don't** use `#000` or `#fff` anywhere.
- **Don't** introduce a second decorative accent. Magenta is danger and (light-theme) kicker only; green is success only.
- **Don't** add gradient text (`background-clip: text` + gradient). The single solid clay is the emphasis mechanism.
- **Don't** use glassmorphism beyond the existing sticky header backdrop-filter. No glass cards.
- **Don't** add side-stripe borders (`border-left: 3px solid clay`) on callouts. Use the full-border CTA-card pattern or a clay `::before` rule line instead.
- **Don't** wrap the resource list in icon-tile cards. The current flat divided list is intentional — keep it.
- **Don't** nest cards. The hero-right panel is a card; the deck inside it is not a card-in-a-card, it's tilted absolute-positioned items.
- **Don't** use neutral grey shadows. Every shadow tints toward clay.
- **Don't** render Bricolage Grotesque at the wrong `opsz` (e.g. 96 on a 14px label). Match opsz to size.
- **Don't** use em dashes in UI copy or articles (project convention — commas/colons/parens instead).
- **Don't** let scroll-wheel change number-input values on the calculators. Blur on wheel.
- **Don't** ship animations that ignore `prefers-reduced-motion`. Aurora, grain drift, dot pulse, and `.res-cta` magnetic transform all opt out correctly — keep that contract.
