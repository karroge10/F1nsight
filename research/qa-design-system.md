# QA: design system, motion and shared components

Scope: `src/app/globals.css`, `src/app/layout.tsx`, `src/app/loading.tsx`, `src/app/not-found.tsx`,
`src/app/error.tsx` (new), `src/components/ui/*`, `src/components/layout/*`, `src/components/icons/*`,
`src/components/charts/*`, `src/components/charts/line-chart.tsx`.

## What was checked

- **Contract:** `AGENTS.md` (Next 16 docs: `error.tsx` receives `error` and `retry`) and `DESIGN.md`.
- **Contrast (WCAG AA):** the token values in `globals.css` against the page background in both themes.
  Values are estimated from OKLCH lightness (luminance is roughly L cubed), so treat the ratios as close,
  not exact.
- **Typography:** Archivo and JetBrains Mono load through `next/font` with `display: swap`, `font-synthesis`
  is `none`, and the `timing`, `headline`, `label` and `section-title` utilities match DESIGN.md.
- **Icons:** every icon in `components/icons/index.tsx` is Phosphor duotone, sized in em. The header theme
  toggle was the one exception (a hand-drawn SVG), see below.
- **Header and nav:** mobile nav scrolls horizontally, the active link is centred on mount, `aria-current`
  is set. Focus rings use `--focus` with a 2px offset.
- **Loading and error states:** `loading.tsx` skeletons match the final layout. There was no `error.tsx`.
- **Automated:** `npm run typecheck` passes (no output, exit 0). `npm test` passes: 15 files, 143 tests.
- **Browser (DOM and text assertions, no screenshots in the main session):** standings page at 1440 and 390:
  no horizontal page overflow, nav active state is "Standings", the skip link is present, the theme toggle
  shows exactly one icon, and there are zero console errors or page errors.
- **Full walk (`research/scratch/qa-design-chrome.mjs`, output `qa-chrome-out.json`):** 10 routes x 2 themes
  x 2 widths. Every route has no horizontal overflow, the nav is present with the right active link, the
  theme toggle shows one icon, and there are no console errors, except:
  - `/fantasy` (both themes, both widths): the page does not load. In light mode the dev server reports a
    JSX parse error at `src/components/fantasy/planner.tsx:141` ("Expected '</', got 'ident'"). That file is
    owned by the fantasy agent and was probably mid-edit. In dark mode and on mobile the navigation timed out.
    Re-run the walk once that file compiles.
  - `/no-such-page` logs a 404 resource error. That is the expected 404 page, so it is not a bug.
- **Not done:** visual judgement (rhythm, balance, how the shimmer looks). Send screenshots to `visual-qa`.

## What was fixed (before, after, why)

1. **Label and table-header text contrast (dark theme).** Before: `--ink-3` was `oklch(0.56 0.01 260)`,
   about 4.3:1 on the page background, below the 4.5:1 AA minimum for small text. After: `oklch(0.62 0.01 260)`,
   about 5.5:1. Why: `ink-3` is the colour of every label, caption, table header and muted number.
2. **Label and table-header text contrast (light theme).** Before: `oklch(0.56 0.01 260)`, about 4.4:1. After:
   `oklch(0.50 0.01 260)`, about 5.5:1 on the lightest surface. Same reason.
3. **Delta text contrast (light theme).** Before: `--delta-up oklch(0.6 0.17 150)` about 3.8:1, and
   `--delta-down oklch(0.56 0.215 28)` about 4.4:1. After: both `oklch(0.52 ...)`, about 5.3:1. Why: Delta
   figures are text, so they need AA. Dark-theme values are unchanged (they already pass).
4. **Header theme toggle icon.** Before: a hand-drawn half-filled circle in an inline SVG, not from the
   Phosphor set, so it did not match every other icon. After: Phosphor duotone `IconSun` and `IconMoon`, with
   the existing `.theme-icon-sun` and `.theme-icon-moon` CSS (which was already written for this and never
   used) swapping them per theme. Why: one icon family, as DESIGN.md requires.
5. **Nav focus ring clipped.** Before: the nav is a horizontal scroll box, so its overflow clipped the 2px
   focus ring on the top, bottom and edge links. After: the nav has 4px of padding inside a matching negative
   margin, so the ring has room. Why: keyboard users could not see focus on the nav links.
6. **No skip link.** Before: keyboard users had to tab through the whole header to reach content. After: a
   "Skip to content" link, visually hidden until focused, jumps to `#main`. Why: standard keyboard
   navigation (WCAG 2.4.1).
7. **No error page.** Before: a runtime error in a route showed Next's default error screen. After:
   `src/app/error.tsx`, a client component in the same visual style as the 404 page, with a "Try again" button
   that calls `retry()` and logs the error. Why: DESIGN.md's global error state was missing.
8. **Skeleton loaders used a flat pulse.** Before: `animate-pulse`. After: a `.skeleton` class with a
   shimmer band (1.6s, linear), same footprint. `SkeletonBlock` keeps its API. Why: DESIGN.md asks for a
   shimmer. Under reduced motion it stops after one pass and stays static.
9. **Probability bars did not animate.** Before: the fill width was set inline, so it jumped. After: the fill
   always spans the track and is scaled with `transform: scaleX(...)` (`.bar-fill`), so it grows from zero on
   first paint and glides when the value changes (480ms). Why: the motion request for `ProbBar`. Consumers and
   props are unchanged.
10. **Sparklines and chart lines did not animate.** Before: static. After: `pathLength="1"` and `.draw-in`
    (720ms draw from left) on the sparkline path and on each line in `LineChart`. Why: chart draw-in request.
11. **Table and timing cell colours snapped.** Before: no transition on `.data-table td` or `.tower td`. After:
    160ms `background-color` (and `color` on the timing tower), matching DESIGN.md. Probability heat cells
    (`.prob-cell`) fade their fill over 160ms too.
12. **Page and section enter.** Before: nothing animated. After: `PageIntro` and `Section` use the existing
    `stagger-in` utility (opacity plus a 6px rise, 480ms). The fill was changed from `both` to `backwards`, so
    the element does not keep a `transform` after the animation (which would make it a containing block).
    Decision: DESIGN.md says the hero stagger runs "on first paint only". CSS cannot tell a first paint from a
    client navigation, so `PageIntro` and `Section` also fade on each route change. If you want first paint
    only, the hero needs a client check; say so and I will do it.
13. **Reduced motion.** The existing `prefers-reduced-motion` block already sets animation and transition
    durations to 0.01ms with a single iteration, so the shimmer, `draw-in`, `bar-fill` and cell transitions all
    end at their final state. `stagger-in` is switched off. No change needed.

## Not changed, noted

- `--accent` in light mode (`oklch(0.56 0.215 28)`) is about 4.4:1. It is used for icons and the wordmark
  accent, which need 3:1 or large-text contrast, so it passes for its uses. Do not use it for small text.
- The `.tyre` chip uses `0.625rem` text, below the 0.75rem type scale floor. It is a fixed-size glyph inside
  an 18px circle, so I left it.
- `Figure`, `Delta` and count-up numbers: DESIGN.md asks for number transitions, but these are server
  components with static text. A number tween needs a small client component. Not done, needs a decision.
- `ProbBar` puts `aria-label` on a plain `span` with no role. Screen readers may ignore it. It is harmless
  (the visible percentage is still read), so left alone.
- No `app/global-error.tsx`. `error.tsx` does not catch errors thrown by the root layout (header, footer), so
  those still show Next's default page. Adding it is a small new file, outside my list, so it is a request below.

## Requests for other areas

- **Fantasy (`src/components/fantasy/planner.tsx`, around lines 467-476):** the loading placeholders use
  `animate-pulse`. Replace them with `SkeletonBlock` (or the `skeleton` class) so they get the shimmer.
- **Fantasy and live (`planner.tsx` lines 150, 190; `fantasy-table.tsx:72`; `live/player.tsx:219`;
  `live/replay-controls.tsx:61`):** `rounded-[3px]` is not on the radius scale. Use `rounded-chip` (2px) or
  `rounded-control` (4px), as DESIGN.md says.
- **Calendar (`src/components/stats/calendar-page.tsx:63`):** the "Next" chip uses `text-[0.625rem]`, below the
  type scale. Use `text-caption`.
- **Forecast hero (`src/components/forecast/forecast-hero.tsx`):** DESIGN.md asks for the hero rows to
  stagger in. Add `stagger-in` with a per-row `style={{ "--stagger": i }}` (utility already in `globals.css`).
- **Forecast and stats pages:** any page that renders its own `animate-pulse` or a custom heading should use
  `Section` or `SectionTitle` so it gets the enter motion and the shared heading.
- **Charts (`position-dist.tsx`, `lap-chart.tsx`, `progression-chart.tsx`):** any path that should draw in
  needs `pathLength={1}` and `className="draw-in"`. `PositionDist` cells already fade via `.prob-cell`.

## Files touched

- `src/app/globals.css`: contrast tokens, motion utilities (`.skeleton`, `.bar-fill`, `.draw-in`), cell
  transitions, `stagger-in` fill mode.
- `src/app/layout.tsx`: skip link.
- `src/app/error.tsx`: new.
- `src/components/ui/skeleton.tsx`: shimmer class.
- `src/components/ui/prob-bar.tsx`: scaled fill with `bar-fill`.
- `src/components/ui/sparkline.tsx`: `pathLength` and `draw-in` on the path.
- `src/components/ui/page-intro.tsx`, `src/components/ui/section.tsx`: `stagger-in`.
- `src/components/charts/line-chart.tsx`: `pathLength` and `draw-in` on each series.
- `src/components/layout/theme-toggle.tsx`: Phosphor sun and moon.
- `src/components/layout/nav-links.tsx`: focus-ring room.

Scratch files (not part of the app): `research/scratch/qa-design-chrome.mjs` (browser walk),
`qa-ds-tsc.txt` (typecheck output), `qa-chrome-out.json` and `qa-chrome-err.txt` (empty, the walk did not
finish).
