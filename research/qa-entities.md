# QA: entity pages (drivers, teams, circuits, standings, history)

Scope: `app/drivers/**`, `app/teams/**`, `app/circuits/**`, `app/standings/**`, `app/history/**`, and
`components/stats/{circuit-outline, entity-header, entity-index, progression-chart, season-picker,
standings-page, standings-tables}.tsx`.

## What was checked

**Method.** A Playwright walk (`research/scratch/qa-entities/walk.mjs`, output in `report.json`
and `shots/`) loaded 22 routes at 1440 and 390 widths, in light and dark. For each load it recorded
the HTTP status, console errors, failed requests, horizontal page overflow, elements that extend past
the viewport (outside `.scroll-x`), text containing `undefined`, `NaN`, `[object` or `null`, broken
images, and the table sizes at 390. Screenshots were reviewed by the `visual-qa` agent, not in the
main session.

**Routes.**
- Drivers: `/drivers`, `/drivers/max_verstappen` (current), `/drivers/senna` (legend),
  `/drivers/abate` (2 starts, 1962 to 1963), `/drivers/nobody-here` (unknown id).
- Teams: `/teams`, `/teams/ferrari` (current), `/teams/toyota` (defunct, 2002 to 2009),
  `/teams/adams` (defunct, 1950 only), `/teams/nobody-here`.
- Circuits: `/circuits`, `/circuits/monza` (current), `/circuits/adelaide` (historic),
  `/circuits/nobody-here`.
- Standings: `/standings` (current), `/standings/2026`, `/standings/2021`, `/standings/1988`,
  `/standings/1957` (no constructors table), `/standings/1950`, `/standings/9999`.
- History: `/history`.

**Results of the walk.** Clean on every route, both widths and both themes:
- No page-level horizontal overflow, and no element runs past the viewport outside its table box.
- No console errors, no failed requests, no text with `undefined`, `NaN`, `[object` or `null`, and
  no broken images.
- At 390, every table sits inside its `.scroll-x` box and the page stays 390 wide. Wide tables
  (drivers and teams index, 640 px minimum) scroll sideways inside the box.
- Unknown ids (`/drivers/nobody-here`, `/teams/...`, `/circuits/...`, `/standings/9999`) render the
  "Nothing on this grid slot" page. See the 404 status note below.

**Visual QA (12 screenshots, verdict from `visual-qa`).** Problems it reported in my pages:
- Nothing in my content areas was clipped or overlapping, apart from the header problems listed
  under requests. Table scrolling, dark and light colours, the circuit map, the 1950 and 1957
  standings and the Ferrari and Adams team pages were reported clean.
- The circuit turn numbers were nearly invisible (fixed, see below).
- Driver portraits for legends fall back to initials ("AS", "AD"). This is by design: only the 22
  current drivers have portrait files in `public/drivers`. Not changed.

**Data spot-checks** (against my own F1 knowledge, from `lib/data/fixtures/history` and
`seasons/2026.json`):
- Drivers' champions 1950 to 2025 match: Farina 1950, Fangio 1951, Ascari 1952 and 1953, Fangio
  1954 to 1957, Hawthorn 1958, Brabham 1959, 1960 and 1966, Phil Hill 1961, Hill 1962, Clark 1963
  and 1965, Surtees 1964, Hulme 1967, Graham Hill 1968, Stewart 1969, 1971 and 1973, Rindt 1970,
  Fittipaldi 1972 and 1974, Lauda 1975, 1977 and 1984, Hunt 1976, Andretti 1978, Scheckter 1979,
  Jones 1980, Piquet 1981, 1983 and 1987, Rosberg 1982, Prost 1985, 1986, 1989 and 1993, Senna
  1988, 1990 and 1991, Mansell 1992, Schumacher 1994, 1995 and 2000 to 2004, Hill 1996,
  Villeneuve 1997, Hakkinen 1998 and 1999, Alonso 2005 and 2006, Raikkonen 2007, Hamilton 2008,
  2014, 2015 and 2017 to 2020, Button 2009, Vettel 2010 to 2013, Rosberg 2016, Verstappen 2021 to
  2024, Norris 2025.
- Constructors' champions match, including Vanwall 1958 as the first, the Lotus splits (Lotus-Climax
  1963 and 1965, Lotus-Ford 1968, Team Lotus 1970, 1972, 1973 and 1978) and the 1950 to 1957 seasons
  shown as "not awarded".
- Title totals match: Hamilton 7, Schumacher 7, Fangio 5, Prost, Verstappen and Vettel 4 each.
  Win totals: Hamilton 106 is the top, then Schumacher 91, Verstappen 72, Vettel 53, Prost 51.
  I did not check the totals against a source, so the current-season counts are unverified.

**Data issues found (not fixed, these are in the data, not the UI):**
1. 2026 round 16 is named "Bahrain Grand Prix in Malaysia" (circuit `sepang`). The progression chart
   already has a short code for that name, so the pipeline knows about it, but the label is worth
   checking against the source before it goes public.
2. 2026 round 1 qualifying has 19 rows against 22 race results. Max Verstappen's Quali cell is blank
   on his season table because he is not in the qualifying list. Either the source is incomplete or
   the three missing drivers should show a "no time" marker.
3. Driver season tables leave the Quali cell blank when there is no qualifying row. Showing "no time"
   or "-" would read better. Not changed (a copy decision).

## What was fixed

1. **Circuit turn numbers, `components/stats/circuit-outline.tsx`.**
   Before: turn labels at 10 units of the SVG scale in `--ink-3`. On screen they were about 7 px and
   faint in both themes.
   After: 14 units in `--ink-2`, about 10 px and readable.
   Why: the visual check reported them as nearly invisible on the 1440 and 390 layouts.

2. **Error pages for the five top-level segments: `app/drivers/error.tsx`, `app/teams/error.tsx`,
   `app/circuits/error.tsx`, `app/standings/error.tsx`, `app/history/error.tsx`.**
   Before: a failed data call fell through to the root error page, which has no segment label and
   whose button does not work (see request 2).
   After: each segment shows its own compact heading, one plain sentence and a "Try again" button
   that calls Next's `reset`. The markup matches `app/races/error.tsx`. Nested routes
   (`/drivers/[id]`, `/teams/[id]`, `/circuits/[id]`) are covered by the segment file.
   Why: the brief asked for an error state per segment.

3. **Staggered entrance for the current-season grids, `app/drivers/page.tsx` and `app/teams/page.tsx`.**
   Before: the 22 driver rows and the 11 constructor rows appeared at once.
   After: each row uses the design system's `stagger-in` class with `--stagger` set to its index,
   capped at 12 steps (about 1.1 s at most). The global `prefers-reduced-motion` rule disables it.
   Why: the brief asked for an index stagger. The sections and page intros already stagger through
   `Section` and `PageIntro`, and the table rows already have hover states, so I did not add more.

Checks after the edits: `npm run typecheck` passes, `npm test` passes (15 files, 145 tests), and
`eslint` on my files is clean. The route walk was rerun for drivers and circuits with no new errors.

## Not changed, and why

- **Soft 404 status.** Unknown ids render the 404 content but return HTTP 200 in dev. The likely
  cause is that these segments have a `loading.tsx`, so Next streams the shell before `notFound()`
  runs. Fixing it needs a route-level decision, so I left it.
- **Empty standings body.** When there is no standings data, the page shows only the dek "No results
  yet." and no body. The dek covers it, so I did not add another line.
- **EntityIndex shows 400 rows at most.** The filter searches all rows, but sorting by a column
  shows only the first 400 of the sorted list (818 drivers). The caption says "400 of 818". Raising
  the limit to all rows would be a one-line change; say if you want it.
- **Chart reveal.** The progression chart uses the shared `LineChart`, which is not in my area. See
  request 3.

## Requests for other areas

1. **Mobile header (layout, design-system owner).** At 390 the nav labels are clipped ("Circuits",
   "History" shows as "Histo", "Standings" as "Driv" where it sits behind the theme toggle), and the
   end of a nav label shows beside the wordmark ("ams"). The nav needs its own horizontal scroll
   container, and the wordmark area needs an opaque background.
2. **`app/error.tsx` (root error page, not my file).** The component takes a prop named `retry`, but
   Next passes `reset`. The "Try again" button calls an undefined function, so it throws. Rename the
   prop to `reset` and call `reset()`. The `races` and `live` error pages already use `reset`.
3. **Chart reveal (`components/charts/line-chart.tsx`).** For the progression charts, add the
   existing `draw-in` class to each series path, staggered by series index. Reduced motion is already
   handled by the global rule.
4. **Soft 404 (app-wide).** If the 404 status matters for search indexing, the `loading.tsx`
   placement for the entity segments may need to change. Owner decision.
5. **Data (pipeline).** Items 1 and 2 under "Data issues found".
