# QA follow-up pass

Scope: the eleven requests in the four QA reports (`qa-design-system.md`, `qa-entities.md`,
`qa-fantasy.md`, `qa-home-live-races.md`). Paths are relative to `v2/site/`.

Checks at the end: `npm run typecheck` passes, `npm test` passes (16 files, 149 tests),
`npx eslint` on every touched file passes. Browser checks ran with Playwright against the running
dev server (scripts in `v2/research/scratch/qa-followup-*.mjs`). No screenshot was read in the main
session; `scratch/followup-header-390.png` was written for a visual-qa pass if one is wanted.

## 1. Error boundary prop name

- **Before:** the root `app/error.tsx` took `retry`. Seven segment files (`live`, `races`, `drivers`,
  `teams`, `circuits`, `standings`, `history`) took `reset`.
- **After:** all eight files take `retry` and call it from the button.
- **Why:** Next 16.4 passes both props (checked in `node_modules/next/dist/client/components/error-boundary.js`:
  `reset: this.reset, retry: this.retry`). The 16.x error docs say `retry()` is the one to use in most cases
  (stable since 16.3). `reset()` only clears the error state and re-renders without re-fetching, which is
  the wrong tool for a failed data call. So the root file was not broken as the QA report said; the
  segment files were the ones to change.
- **Verified:** I added two temporary pages that throw on the first request (one at the root, one under
  `/history`), clicked "Try again" and saw the page render. Both pages were deleted afterwards.

## 2. Mobile header at 390 px

- **Before:** the nav had negative margins (`-mx-4` on mobile). It sat under the wordmark, so a piece of a
  nav label showed beside the logo ("ams"), and it ran under the theme toggle, which clipped "Histo" and
  "Driv".
- **After:** no negative margins on the nav. The wordmark and the toggle wrapper are `shrink-0`. The nav is a
  single scroll region (`scroll-x`) between them, with its trailing edge fade from the existing
  scroll-driven mask.
- **Why:** the overlap came from the margins, not from the nav's content. Measured at 390 px: wordmark right
  edge 78 px, nav left edge 102 px, nav right edge 299 px, toggle left edge 323 px. No overlap.
- **Not done:** no leading-edge fade. The nav scrolls to the active item on load, so the leading edge is
  often already scrolled; a fixed leading fade would dim the first label. Say if you want one.
- Files: `src/components/layout/site-header.tsx`, `src/components/layout/nav-links.tsx`.

## 3. Edge cue on `.scroll-x` tables

- **Before:** `.scroll-x` already fades the trailing edge while there is more to scroll
  (`app/globals.css`, a scroll-driven `mask-image` keyframe, 56 px). The QA report missed it or saw it
  only in one browser.
- **After:** no change.
- **Why:** measured on `/drivers` at 390 px in Chromium: the mask is a fade at scroll start and none at the
  scroll end. A stronger cue for other browsers would need a static fade, which would also dim tables that
  do not overflow, so I left it.
- **Limit:** the cue needs `animation-timeline: scroll()`. Browsers without it show no fade (the table still
  scrolls).

## 4. Real 404 status for unknown ids

- **Before:** `/drivers/nobody-here`, `/teams/nobody-here`, `/races/2026/99` return HTTP 200 with the 404
  content. Checked with curl against the dev server.
- **After:** not changed.
- **Why:** `app/loading.tsx` (root) wraps the whole tree in a Suspense boundary. The response starts
  streaming when the fallback renders, before the page calls `notFound()`, and the status is then fixed at
  200. Per the Next 16 `loading.js` docs ("Status codes"), a `notFound()` only gives a real 404 if it runs
  before the body streams. Removing the segment `loading.tsx` files would not be enough, because the root
  one still applies.
- **Options, for your decision:**
  1. Delete `app/loading.tsx` and every segment `loading.tsx` (drivers, teams, circuits, races, standings,
     history, live, fantasy). Real 404s, but no instant skeleton on any navigation.
  2. Add `src/proxy.ts`. The docs' recommended way is a check before streaming: the proxy checks the id
     against the data and rewrites unknown ids to a not-found route. It needs to read the data layer
     (SQLite or fixtures) on every request, so I did not build it.
  3. `generateStaticParams` with `dynamicParams = false` on the entity segments. Unknown ids get a real 404
     from the router and the skeletons stay. It prerenders about 1,000 pages (818 drivers, teams, circuits,
     races, seasons), which lengthens `next build`. I did not add it because I cannot run a build here.
- **Recommendation:** option 3 if the build time is acceptable, otherwise option 2.

## 5. "Sept" in `formatDate`

- **Before:** en-GB output on this Node/ICU (CLDR 47) prints "6 Sept". `formatDateTime` had the same problem.
- **After:** both go through `formatEnGB`, which replaces the month part "Sept" with "Sep". Helpers sit below
  the exported functions in `src/lib/format.ts`.
- **Test:** `src/lib/format.test.ts` checks "6 Sep" for `formatDate`, and that `formatDateTime` contains "Sep"
  and not "Sept". Raw ICU output for the same input is "6 Sept", so the test fails without the fix.

## 6. Line chart reveal

- **Before:** the series paths already had `pathLength={1}` and `className="draw-in"` (the QA report was
  written before that). They all started at the same time.
- **After:** each series path gets `animationDelay` of 90 ms per series index, so the lines draw in one
  after the other.
- **Why:** the brief asked for a staggered reveal. The reduced-motion rule in `globals.css` already turns the
  animation off.
- File: `src/components/charts/line-chart.tsx`.

## 7. Timing tower row animation

- **Before:** rows re-keyed by car number and jumped to their new position.
- **After:** `TimingTower` records each row's `offsetTop` after every render (`useLayoutEffect` on the rows).
  A row that moved animates with the Web Animations API from its old offset to 0 over 320 ms (FLIP).
  Reduced motion skips the animation. Rows carry `data-row` for the lookup.
- **Why this way:** keeps the logic next to the table, with no change to `globals.css`. The row memoisation
  is unchanged, since the animation only reads positions.
- **Not verified visually.** The replay ran in Playwright with no console or page errors. I did not check that
  the animation looks right on a live position change.
- **Limit:** transforms on `<tr>` are not applied in every browser (older Safari). There the rows jump as before.
- File: `src/components/live/timing-tower.tsx`.

## 8. Track map debug hook

- **Before:** `track-map.tsx` wrote frame statistics to `window.__f1nsightFrames` and sorted a 300-sample array
  on every animation frame.
- **After:** the sampling, the sort, the statistics object and the `window` write are removed. The frame loop
  only moves the car dots. A check in the browser after a replay confirmed `window.__f1nsightFrames` is
  undefined. Nothing in `src` read it; the only other reference is my check script, which asserts it is gone.
- File: `src/components/live/track-map.tsx`.

## 9. Fantasy expected points (274 vs 126)

- **Verdict: correct, not a bug.** The 126 is the sum of the five best driver projections across the whole
  field (`top5` in the probe), not the five drivers of the best team. The 274 is the team's
  drivers + constructors + boosts.
- **Check:** `recommend` on the fixture file with no team gave 181.6 expected points for the best team:
  drivers 66.7 + constructors 81.2 + boost 33.7 (the x2 Boost on the top driver). The engine adds up
  (`toTeamResult` in `optimiser.ts`: weight 1 for each member, 1 + boostExtra on the Boost driver).
- **Still unverified:** the x3 chip keeps the x2 Boost on a second driver (`extraBoostKeepsRegularBoost`
  in `rules.ts`, documented as a best guess). If the rule is different, the total changes.
- **After (UI):** the headline's "Expected points" note now reads
  "Drivers 60 + constructors 124 + boosts 22", then the p10 to p90 range. Rendered in Playwright at 1280 px:
  60 + 124 + 22 = 206, matching the headline.
- Files: `src/components/fantasy/planner.tsx` (`sumPoints`, `RecommendationView`, `Stat` accepts a node as the note).

## 10. Keyboard for the objective and asset tabs

- **Before:** the Objective radio group and the Drivers / Constructors tab list had no arrow-key handling.
  Every button was in the tab order.
- **After:** a shared `handleRovingKey` (`src/lib/roving-keys.ts`) moves focus and selects the neighbouring
  button on Arrow keys, Home and End (wraps at the ends). The selected button has `tabIndex` 0 and the rest -1.
- **Verified:** ArrowRight on the Objective group selects "Safe" in the group, and ArrowRight on the
  Drivers tab selects "Constructors" and moves focus to it.
- **Not done:** the free-transfers radio group (1, 2, 3) on the same page has the same gap. It was not in the
  request; the same two-line change would fix it.
- Test: `src/lib/roving-keys.test.ts` covers the index logic.
- Files: `src/components/fantasy/planner.tsx`, `src/components/fantasy/fantasy-table.tsx`.

## 11. Unused `replay-controls.tsx`

- **Before:** `src/components/live/replay-controls.tsx` exported `ReplayControls`. Nothing imported it (grep
  over `src`, `scripts` and `DESIGN.md`).
- **After:** file deleted. `DESIGN.md` no longer lists `ReplayControls` in the component inventory.
- Fantasy `TeamBuilder` and `solveLineups` were left alone, as asked.

## Other changes

- `src/components/fantasy/planner.tsx`: the invalid-pick cleanup was an effect that called `setState`
  synchronously. ESLint (`react-hooks/set-state-in-effect`) flagged it. It now runs inside the fetch's
  `.then`, which does the same job without the effect. This lint error was already in the file before this pass.

## Files changed

- `src/app/error.tsx`, `src/app/{live,races,drivers,teams,circuits,standings,history}/error.tsx`: `retry` prop.
- `src/components/layout/site-header.tsx`, `src/components/layout/nav-links.tsx`: header overlap.
- `src/lib/format.ts`, `src/lib/format.test.ts`: "Sep".
- `src/components/charts/line-chart.tsx`: stagger.
- `src/components/live/timing-tower.tsx`: FLIP.
- `src/components/live/track-map.tsx`: debug hook and per-frame sort removed.
- `src/components/fantasy/planner.tsx`, `src/components/fantasy/fantasy-table.tsx`: breakdown, keyboard, lint fix.
- `src/lib/roving-keys.ts`, `src/lib/roving-keys.test.ts` (new).
- `src/components/live/replay-controls.tsx`: deleted.
- `DESIGN.md`: removed `ReplayControls` from the inventory.

## Open decisions

1. Soft 404 (item 4): option 1, 2 or 3 above.
2. Free-transfers radio group keyboard support (item 10).
3. Leading-edge fade on the header nav (item 2).
