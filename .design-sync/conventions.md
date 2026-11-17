# Building with the Spritz design system

Editorial-typographic system: near-black paper, mustard ("clay") accent, oversized
variable-serif headlines. Restraint is the point — clay is a highlight, never a fill
colour for large areas.

## 1. Wrap everything in `SpritzRoot`

**All design tokens live on `SpritzRoot`.** Anything rendered outside it has no
`--spz-*` variables and comes out as unstyled browser-default text. There is no
other provider — wrap once, at the top.

```jsx
<SpritzRoot theme="dark">
  <Wrap>{/* page content */}</Wrap>
</SpritzRoot>
```

- `theme` — `"dark"` (brand default) or `"light"`. Both are complete; light is a
  warm cream paper with a deeper mustard, and it promotes magenta into kicker
  accents automatically. Never hand-build a light variant.
- `grain` / `aurora` — optional ambient layers (film grain, drifting clay washes).
  Use for hero/landing surfaces, skip for dense UI.
- `Wrap` is the content column: max 1280px, fluid gutters. Use it inside
  `SpritzRoot` for anything that shouldn't run full-bleed. `Marquee` and
  `SiteHeader` handle their own width — don't nest those in `Wrap`.

## 2. Styling idiom: CSS custom properties, not utility classes

This is **not** a utility-class system and **not** a props-based theme system.
Components carry their own `spz-`-prefixed classes; your own layout glue should use
inline styles or your own classes that **reference the system's tokens**:

```jsx
<div style={{ display: "grid", gap: 24, color: "var(--spz-ink-2)" }}>
```

Never hardcode a hex. The full token vocabulary:

| Group | Tokens |
|---|---|
| Surfaces | `--spz-paper` (page), `--spz-paper-2` (recessed band), `--spz-paper-3` (raised card) |
| Text | `--spz-ink` (primary), `--spz-ink-2` (secondary/body), `--spz-ink-3` (muted/labels) |
| Accent | `--spz-clay` (mustard, the brand), `--spz-clay-deep` (hover), `--spz-clay-soft` (wash) |
| Signal | `--spz-accent-2` (magenta), `--spz-danger`, `--spz-success` |
| Lines | `--spz-rule`, `--spz-rule-soft` |
| Type | `--spz-serif` (Bricolage Grotesque — display), `--spz-sans` (body), `--spz-mono` (Bebas Neue — labels/numerals) |
| Shape | `--spz-radius-sm` `-md` `-lg` `-pill` |
| Depth | `--spz-shadow-sm`, `--spz-shadow-md` |
| Motion | `--spz-ease` |

Every one of these flips with `theme`, so token-based work is automatically correct
in both themes. Hardcoded hexes are not.

## 3. Typographic signatures — use these, they carry the brand

- **Clay emphasis.** `Display` and `Section`'s `title` render `<em>` as
  upright clay (no italics). This is the single most recognisable Spritz move — use it on one
  phrase per heading, never more:
  `<Display>Ship the game, <em>not the excuses</em>.</Display>`
- **`Kicker`** opens a section: a clay rule, a tabular number, an uppercase label
  in the condensed face. Pair with `Section`'s `kicker` / `num` props.
- **Bebas Neue (`--spz-mono`) is for labels and numerals only** — kickers, field
  labels, meta rows, tags. Never body copy.
- Headline sizes are fluid `clamp()` values already; don't override font-size on
  `Display`, `Section` titles, or `ResultPanel` values.

## 4. Component map — reach for these before building anything custom

| Need | Use |
|---|---|
| Page shell | `SpritzRoot`, `Wrap`, `SiteHeader` |
| Section with heading | `Section` (`kicker`/`num`/`title`/`lede`, `layout="stacked" \| "split" \| "center"`) |
| Hero headline | `Display` |
| Actions | `Button` (`variant="primary" \| "ghost"`) |
| Tags / filters / presets | `Chip` (`variant="default" \| "preset" \| "filter"`) in a `ChipGroup` |
| Surfaces | `Panel` (`variant="raised" \| "flat"`, `wash`) |
| Offer / capability | `ServiceCard` |
| Numbers | `StatRail` (`variant="full" \| "compact"`, `columns`) wrapping `Stat` tiles |
| Social proof | `Testimonial`, `Marquee` + `LogoTile` |
| Q&A | `FaqList` + `FaqItem` |
| Article furniture | `TldrCard`, `CtaCard`, `ResourceRow` |
| Calculator / tool UI | `CalculatorInput`, `ResultPanel` |
| Forms | `Form` + `FormGrid` + `Field` + `FormFoot` |
| Key/value detail | `MetaList` |
| Personality | `SpeechBubble` |
| Icons | `ArrowRight`, `ArrowUpRight`, `ChevronLeft`, `ChevronRight` |

`ResultPanel` is the payoff element on any calculator — when present it should be
the largest thing on screen.

## 5. Read the real files

Before styling anything, read `_ds/<folder>/styles.css` and the files it
`@import`s — that is the authoritative token and class source. Per-component API
and usage live in each component's `.d.ts` and `.prompt.md`. Prefer those over
anything summarised here.

## 6. Idiomatic example

```jsx
<SpritzRoot theme="dark" aurora>
  <Wrap>
    <Section
      kicker="Services" num="02"
      title={<>What I actually <em>do</em></>}
      lede="Production and publishing support for teams that have to ship something real."
      layout="split"
    >
      <div style={{ marginTop: 48, borderTop: "1px solid var(--spz-rule)" }}>
        <ServiceCard
          title="Publishing deal review"
          intro="A line-by-line read of the term sheet before you sign anything."
          bullets={["Recoup structure", "Net vs gross", "Splits", "Termination"]}
          related={<Chip href="/tools/recoup">Recoup calculator</Chip>}
        />
      </div>
      <div style={{ marginTop: 32 }}>
        <Button href="/contact">Book a call</Button>
      </div>
    </Section>
  </Wrap>
</SpritzRoot>
```

Library components for the parts; tokens for the glue between them.
