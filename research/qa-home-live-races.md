# QA: home, live, races

Scope: `app/page.tsx`, `app/live/**`, `app/races/**`, `components/forecast/*`, `components/live/*`,
and `components/stats/{calendar-page,results-table,lap-chart,pit-stops-table}.tsx`.
Scratch scripts and the JSON output are in `v2/research/scratch/` (`qa-walk.mjs`, `qa-live.mjs`,
`qa-space.mjs`, `qa-replay-debug.mjs`, `qa-walk.json`, `shots/`).

## What was checked

**DOM walk (Playwright, dark and light, 1440 and 390 wide), 17 routes each:**
home; `/live`; `/live` replay (`season=2024&round=18&session=R`); `/races`; `/races/1950`,
`1994`, `1995`, `2025`, `2026`; `/races/1994/1`; `/races/1995/16` (last round of 1995); `/races/2026/1`
(finished); `/races/2026/2` (finished sprint weekend); `/races/2026/17` (next race, sprint weekend,
no results yet); `/races/2026/23` (not run yet); and unknown pages `/races/2026/24`, `/races/9999`,
`/races/2026/99`. No cancelled round exists in the stored data for 2021 to 2025, so that state was
not exercised.

Result after the fixes: no horizontal page overflow at 390 or 1440 in any route and theme, no
element spilling outside a `.scroll-x` wrapper, no console errors, no page errors, no failed
requests, and no em dash characters in rendered text.

**Live and replay (Playwright, interaction):**
- Replay: "Play replay" starts the stream; the scrubber moves while playing;
  Space pauses and resumes once even when the play button has focus (no double toggle);
  ArrowRight skips 10 s; speed buttons present (0.5x to 16x).
- With no session live, the page shows "No live session now" and the session browser, and nothing
  plays until a session is picked.
- The live service (`localhost:8765`) answered, so the replay came from the live service archive.

**Data spot checks** (winner and pole from the race pages, against F1 knowledge):
1950 round 1 FAR, 1994 round 1 MSC (pole SEN), 2024 round 1 VER, 2024 round 18 NOR, 2025 round 1
NOR (pole NOR), 2026 rounds 1 to 16 as stored. Results that I know agree with the data. The 2026
season is beyond what I can verify from memory.

**Visual**: 10 screenshots (desktop and mobile, dark and light) were checked by a `visual-qa`
subagent. Its findings are in the visual check section below.

## What was fixed

1. **Forecast hero, predicted-winner note** (`components/forecast/forecast-hero.tsx`).
   Before: "so his expected finish is lower". After: "so the expected finish is lower".
   Why: the note assumed a gender for a real driver. Neutral wording avoids a wrong guess.

2. **Title odds, rounds left** (`components/forecast/title-odds.tsx`, `app/page.tsx`).
   Before: the count was hard-coded as `23 - rounds completed`. After: the home page passes the
   number of non-cancelled rounds (the same value the hero uses) into `TitleOdds`.
   Why: a hard-coded 23 breaks as soon as a season has a different calendar (2024 and 2025 had
   24 rounds). With the current 2026 data the number is the same, so nothing visible changes today.

3. **Replay player, clock on a race** (`components/live/player.tsx`).
   Before: a race showed "22:00:00 left" next to the lap counter. The status bar hides the clock for
   races, so the two disagreed. After: the player hides the clock for race and sprint sessions, the
   same rule as the status bar.
   Why: a race has no clock to count down, so the value was meaningless.

4. **Race control icon** (`components/live/race-control-feed.tsx`).
   Before: a direct import from `@phosphor-icons/react` (the only one in the area; it bypasses the
   icon layer and the server-safe import rule). After: `IconPulse` from `@/components/icons`.
   Why: one icon layer, same duotone weight as the rest of the page.

5. **Calendar table, dead branch** (`components/stats/calendar-page.tsx`).
   Before: an empty `<span>` whose text was `race.status === "completed" ? "" : ""`. After: nothing is
   rendered when there is no winner.
   Why: the expression always produced an empty string. Removing it changes no output.

6. **Entrance motion, CSS only, reduced motion respected** (existing `stagger-in` utility from
   `globals.css`, which the global reduced-motion rule turns off).
   - Forecast hero: the left (race identity) and right (predicted winner) columns fade in, one after
     the other.
   - Constructor points: each team row staggers 90 ms apart.
   - Lap chart: the chart wrapper fades and lifts in once.

7. **Route error boundaries** (new files): `app/live/error.tsx` and `app/races/error.tsx`. Each shows
   the page intro, a short message and a "Try again" button that calls `reset`. Before, an exception
   in these segments fell back to the framework's default error page.

8. **Replay start overlay** (`components/live/live-view.tsx`). Before: 60% transparent, so the
   placeholder text behind it showed around the "Play replay" button at 390 wide. After: opaque
   until play is pressed. Why: the text looked broken; the overlay is a start card, not a veil.

## Data issues found (not fixed here, owned by the data or live pipeline)

- **Live service round mapping (2026).** The sessions list from `localhost:8765/sessions` tags the
  Miami sprint (Sprint and Sprint Qualifying, 1 to 2 May) as round 6, while the calendar has Miami
  as round 4 and Monaco as round 6. As a result the session browser shows "2026 R6 Monaco Grand Prix"
  with Miami sprint sessions inside, and round 4 has no sessions at all.
- **Calendar name.** Round 16 is "Bahrain Grand Prix in Malaysia" at Sepang. Looks like a deliberate
  rename in the data, but it reads oddly on the calendar and in the forecast hero. Worth a check.
- **2026 calendar length.** 23 rounds stored, numbered 1 to 23 with no gap. I believe the published
  2026 calendar has 24 rounds, so a round may have been dropped in the data. Confirm, since the
  title-odds count now follows the stored calendar.
- **Race clock.** The replay data gives a `clock.remainingMs` value for races (22:00:00 for the
  fixture race). Probably a placeholder. The player no longer shows it for races, but the value is
  still wrong in the data.
- **Sprint weekends** render correctly (`/races/2026/2` shows the Sprint section; the Sprint and
  Sprint Qualifying sessions in the live list belong to a different round, see above).

## Requests for other areas

- **Root error boundary** (`app/error.tsx`, owned by the design system): there is none, so a crash on
  the home page or any other route without its own boundary shows the framework default page.
- **404 status code.** `/races/9999`, `/races/2026/24` and `/races/2026/99` render the 404 content but
  return HTTP 200, because `app/races/loading.tsx` streams the shell before `notFound()` runs. Fix
  options: move the streaming boundary below the notFound check, or drop `loading.tsx` for races and
  rely on the layout's fallback. The layout owner should decide.
- **Live tower motion.** The timing tower rows re-render with their key, so positions change
  instantly. A position-change animation needs a FLIP transition (or a `transform` on row-level
  wrapper elements) in `globals.css` (`.tower`). Not done here because it belongs to the design system
  file. Cell colour changes already use the 160 ms transition from the DESIGN brief.
- **Track map debug hook.** `components/live/track-map.tsx` writes frame statistics to
  `window.__f1nsightFrames` and sorts a 300-sample array on every animation frame. If the hook is
  only for tests, make it conditional (for example on `?debug=1`). Left as is, since it is in use by
  other code paths I did not verify.
- **Unused component.** `components/live/replay-controls.tsx` (`ReplayControls`) is not used anywhere;
  `Player` replaced it. Delete it, or keep it for the design inventory. Not deleted here.
- **Shared Phosphor import.** `components/layout` or other shared files may import Phosphor directly
  in the same way race control did; a quick grep would confirm.

## Visual check

The `visual-qa` subagent reviewed the 10 screenshots. Findings and what was done:

- **Replay start overlay at 390 wide (fixed).** The "Play replay" overlay was 60% transparent, so the
  placeholder text ("No session and no replay selected.") showed around the button. The overlay is
  now opaque (`live-view.tsx`).
- **Mobile tables clipped at the right edge** (race results, season calendar, and the qualifying and
  pit stop tables by the same pattern). This is the horizontal scroll region (`.scroll-x`) doing its
  job: the table scrolls and the trailing edge fades. The fade is the design system's job, so no
  change here. A visible scroll hint would need `.scroll-x` in `globals.css`.
- **Navigation items clipped under the theme toggle at 390 wide** ("Rac", "Live", "Teams" in the
  header). Site header, owned by the design system. Request below.
- **A red sliver after the "F1nsight" wordmark at 390 wide (dark)**. Looks like the live indicator in
  the header. Same owner as above; not confirmed in the DOM.
- **Date format in the calendar.** The short month for September prints as "Sept" (for example "6
  Sept") while the other months are three letters. Comes from `formatDate` in `lib/format` (en-GB
  output). Request to the owner of `lib/format`: format September as "Sep", or pass a fixed month
  list.
- **Driver labels crowd on the replay track map** near the last two corners. Cosmetic, not changed.

Requests for the design system owner, collected here:

- Header: nav items must not run under the theme toggle at 390 wide.
- `.scroll-x`: a visible edge cue on tables that overflow on mobile.
- `app/error.tsx` root boundary and the 404 status issue (see above).
