# F1nsight: design brief

## Name

F1nsight (chosen by the owner from a shortlist of names that mention F1 with some wit). The
wordmark sets the 1 in the accent colour, a touch heavier and tighter than the letters around
it, so the word still reads as "insight" at a glance. The favicon (`src/app/icon.svg`) is the
same idea reduced to a mark: a near-black rounded square, the F in white, the 1 in the accent
red, geometric so it holds at 16px in both themes.

## Concept: the timing screen, edited

The site should read like a broadsheet data section built by the people who make the
pit-wall timing screens. Two registers, kept strictly apart:

- **Editorial register** for headings, intros and reasons: a condensed grotesk set big and
  tight, generous whitespace, hairline rules instead of cards.
- **Timing register** for every number that matters: a monospaced face with tabular figures,
  dense rows, colour only where it carries meaning (sector purple/green/yellow, tyre compound,
  track status, team identity).

The forecast is the front page. It opens with the predicted finishing order for the next Grand
Prix, not a greeting, not a countdown widget, not a grid of cards. The model earns trust by
showing its record right under the forecast (backtest metrics and the last three races,
predicted against actual) rather than by looking confident.

What we deliberately avoid: gradient backgrounds, glassmorphism, card grids, emoji, glow,
skeleton dashboards, purple as a brand colour (purple is reserved for "fastest sector").

## Typography

| Role | Face | Notes |
| --- | --- | --- |
| Display and UI | Archivo (variable, wght 100 to 900, wdth 62 to 125) | Headings at wdth 75 to 85, weight 600 to 700, tracking -0.02em, line-height 1.0 to 1.1. Body and labels at wdth 100. |
| Live timing tower only | JetBrains Mono (variable) | Lap times, gaps and intervals in the live tower, where columns must align like a timing screen. Everywhere else numbers are Archivo with `tabular-nums` (the `timing` utility), so a block never mixes families. |

Both are loaded with `next/font/google`, which self-hosts the woff2 at build time.
`font-synthesis: none` on the root. Hero figures (e.g. "41%") use Archivo with proportional
figures; tabular figures only inside columns.

Scale (rem): 0.75 (caption), 0.8125 (table), 0.875 (ui), 1 (body), 1.25 (h3), 1.5 (h2),
2.25 to 3.5 fluid (h1), 4.5 to 7 fluid (display number). Small uppercase labels get +0.08em
tracking.

## Colour (OKLCH, dark primary)

| Token | Dark | Light |
| --- | --- | --- |
| `--bg` | `oklch(0.135 0.004 260)` | `oklch(0.985 0.002 90)` |
| `--bg-raised` | `oklch(0.17 0.005 260)` | `oklch(0.955 0.003 90)` |
| `--bg-sunken` | `oklch(0.11 0.004 260)` | `oklch(0.93 0.003 90)` |
| `--rule` (hairline) | `oklch(0.26 0.006 260)` | `oklch(0.87 0.004 90)` |
| `--rule-strong` | `oklch(0.36 0.008 260)` | `oklch(0.75 0.006 90)` |
| `--ink` | `oklch(0.95 0.004 90)` | `oklch(0.16 0.006 260)` |
| `--ink-2` | `oklch(0.74 0.008 260)` | `oklch(0.42 0.01 260)` |
| `--ink-3` | `oklch(0.56 0.01 260)` | `oklch(0.56 0.01 260)` |
| `--accent` (live, selection) | `oklch(0.66 0.215 28)` | `oklch(0.56 0.215 28)` |

Semantic data colours (same in both modes, lightness tuned per mode where noted):

- Sector best overall `--sector-purple oklch(0.64 0.23 305)`, personal best `--sector-green
  oklch(0.74 0.19 150)`, slower `--sector-yellow oklch(0.86 0.17 95)`.
- Track status: green `oklch(0.74 0.19 150)`, yellow and SC/VSC `oklch(0.86 0.17 95)`,
  red `oklch(0.6 0.22 28)`.
- Tyres: soft `oklch(0.62 0.22 28)`, medium `oklch(0.86 0.17 95)`, hard `oklch(0.9 0 0)`,
  inter `oklch(0.72 0.18 150)`, wet `oklch(0.6 0.17 250)`.
- Probability (sequential, one hue): hue 250, lightness ramp from surface to
  `oklch(0.7 0.14 250)`; dark mode steps brighten, light mode steps darken.
- Delta: positive `oklch(0.74 0.19 150)`, negative `oklch(0.66 0.215 28)`, neutral `--ink-3`.

Team colours come from the data (`teamColor` in the prediction JSON, `color` in the
constructors fixture). They are used as a 3px inline rule beside a driver, a dot on the map,
a line on a chart. They never fill a surface or colour text.

## Grid and spacing

- Max content width 1440px, 24px gutters (16px below 640px). 12 columns at >= 1024px.
- 8pt spacing. Rows in timing tables: 36px desktop, 44px touch.
- Sections are separated by a hairline rule and a small uppercase label, not by boxes.
- Border radius: 2px on chips, 4px on controls, 6px on the few floating surfaces (tooltips).
  Concentric radii when nested.

## Motion

- Cars on the map interpolate linearly between frames; the renderer runs on
  `requestAnimationFrame` and lerps toward the latest frame over the frame interval.
- Timing cell colour changes transition over 160ms (`background-color, color` only).
- Hero sections stagger in (opacity + 6px translate, 90ms apart) on first paint only.
- `prefers-reduced-motion`: no stagger, cars jump between frames, no transitions.

## Headings and copy

- Page intro: eyebrow in sentence case, large headline, one short dek at most.
- Section header: short all-caps title (`section-title`, 13px, +0.08em) with one icon on a
  hairline. Explanations live behind the info mark, never as a subtitle. No filled panel
  backgrounds: structure comes from rules, spacing and type.
- Body, labels and table cells are sentence case. Table headers may stay compact.
- Spacing on an 8px scale (4px half steps for chips and icon gaps).

## Icons

Phosphor Icons (MIT), duotone weight only, imported per icon from the server-safe entry
(`@phosphor-icons/react/dist/ssr`), sized in em so they follow the type scale, coloured by
currentColor so both themes work. Duotone was chosen because its 20% secondary layer echoes the
track-and-fill language of the probability bars, and because the set is broad enough to cover
navigation, weather, playback and fantasy chips in one style. Motorsport marks Phosphor lacks
(chequered flag, flags by colour, pit box, safety car, VSC, fastest lap, overtake, DNF, grid
slot, helmet, sprint, track temperature, rain, wind, chip, tyre compounds) are drawn in
`src/components/icons/motorsport.tsx` on the same 256 grid with the same 16 unit stroke.
Icons that carry meaning alone get an `aria-label`; decorative ones are hidden.

Placement: navigation items, hero rows (circuit, race, next session, forecast stage), the
predicted winner (trophy), probability column headers (trophy, medal, DNF), factor chips,
race control messages (flag colour, safety car, pit, stewards), weather panel, player controls,
tyre column, standings movement arrows, record categories, fantasy chips and transfers, empty
states.

## Component inventory

Layout: `SiteHeader` (nav, live indicator, theme toggle), `PageIntro` (label, h1, dek),
`SectionLabel`, `Rule`.

Predictions: `ForecastHero` (stage, countdown, race meta), `ForecastTable` (order, probability
bars, DNF, reasons), `PositionDistribution` (22 cell heat strip per driver), `TitleOdds`,
`TrackRecord` (backtest metrics + past predictions vs actual).

Fantasy: `FantasyTable` (sortable, filterable), `RangeBar` (p10/p90 with expected marker),
`TeamBuilder` (budget solver output).

Live: `TrackMap` (SVG outline + car dots + labels), `TimingTower`, `SectorCell`, `TyreChip`,
`TrackStatusBar`, `RaceControlFeed`, `WeatherStrip`, `useLiveSession` hook
with reducer and `MockLiveStream`.

Stats: `StandingsTable`, `PointsProgressionChart` (SVG line chart), `Calendar`, `ResultsTable`,
`QualifyingTable`, `LapChart` (SVG position per lap), `PitStopTable`, `DriverHeader`,
`SeasonTable`, `CircuitMap` (static outline), `RecordsList`.

Shared: `DataTable` primitives, `ProbBar`, `Delta`, `Figure`, `Sparkline`.

## Accessibility

Contrast at or above WCAG AA for all text (sector and tyre colours are backgrounds behind dark
ink, never coloured text on the dark surface). Every chart has a table twin or direct labels.
All controls are keyboard reachable with a visible focus ring (`--accent`, 2px offset).
