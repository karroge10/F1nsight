# F1nsight: the site

Next.js 16 (App Router, React 19, TypeScript strict, Tailwind v4). Four pillars: race forecast,
F1 Fantasy tool, live timing with a track map and replays, and the full stats archive since 1950.
Everything is free: open-licence fonts and icons, public data, no paid services.

```
npm install
npm run dev          # http://localhost:3000
npm run build && npm start   # static export into out/, served on :3000 like Cloudflare Pages
npm run lint && npm run typecheck && npm test
npm run fixtures     # rebuild src/lib/data/fixtures from the Jolpica dump + API snapshots
node scripts/fetch-images.mjs [--force]        # current-season headshots into public/drivers
node scripts/fetch-current-logos.mjs [--force] # current-season logos into public/teams/<season>, then the registry
node scripts/build-logo-registry.mjs           # season ranges for team logos into images.json
```

## Images and licensing

Images stay current on their own: `refresh.ps1` runs both fetch scripts after the pipeline
(step `images`, never fatal: a CDN failure logs a warning and keeps the old files). The season and
roster come from the served database (`F1_DATA_DIR/serve/f1.sqlite`, `season_entries` of the
latest season with results), so a mid-season seat change gives the driver's latest team. A
headshot is downloaded only for a new driver or when their season or team changed (both are
stored per driver in `images.json`); a logo only when the season folder lacks it, so a new team
or a new season is picked up automatically. `--force` re-downloads everything.

Driver headshots are the official season photos from Formula 1's media CDN, cropped to a square
around the face by the CDN (`scripts/fetch-images.mjs`); the legacy path in the OpenF1 drivers
feed is the fallback. CDN team slugs are derived from the team name (lowercase, letters and digits
only: "Haas F1 Team" is `haasf1team`), checked with a HEAD request and cached in `images.json`
(`cdnTeamSlugs`); `scripts/lib/current-season.mjs` holds the shared roster and slug code. Team logos
are official artwork used as published, never recoloured or inverted: the current season's colour
and white variants from F1's image CDN (`scripts/fetch-current-logos.mjs`, into
`public/teams/<season>`) and the per-season PNGs for brands
that no longer race (`public/teams/legacy`, white background knocked out with
`scripts/process-team-logos.mjs`). `scripts/build-logo-registry.mjs` writes the season ranges into
`src/lib/data/fixtures/images.json`; `TeamLogo` picks the variant for the season shown, uses the
white mark on the dark theme, puts colour-only legacy marks on a small light plate in dark mode,
and falls back to a team-colour monogram for constructors with no official artwork. Two free
Wikimedia Commons files cover Caterham (to 2014) and Manor Marussia (2015). Still without a
logo since 2014: Force India (2014 to 2018), Sauber before Kick Sauber (2014 to 2018), Manor
Racing (2016), Marussia (2012 to 2014) and Lotus F1 (2012 to 2015); the F1 CDN has nothing for
them and the Wikipedia infobox logos are non-free files. Everything earlier is a monogram.

Personal, non-commercial use only. Revisit before the site goes public: the images are F1's and
the teams' property and would need clearing or replacing.

## Data

The site is a static export (`output: "export"`): every page is prerendered at build time and
the data below is read only then, so a data refresh needs a rebuild (`refresh.ps1` runs
`../scripts/publish.ps1`, which builds and uploads `out/` to Cloudflare Pages). Time zones, the
live service, `?session=`, `?s=` and the fantasy planner are handled in the browser. Build-time JSON
for the browser lives under `out/api/` (`fantasy.json`, `replay/<season>/<round>.json`,
`telemetry/<key>.json`). `scripts/fix-export-segments.mjs` runs after every build to work around a
Windows path bug in Next's export; `scripts/check-export.mjs` checks the Pages file limits.

`src/lib/data/index.ts` is the only import for pages. Storage is chosen in `source.ts`:

| Data | Primary | Fallback |
| --- | --- | --- |
| Seasons, races, results, qualifying, laps, pit stops, standings, drivers, teams, circuits | `../data/serve/f1.sqlite` via `node:sqlite` (`sqlite-source.ts`) | JSON fixtures in `src/lib/data/fixtures` |
| Forecast | `../data/predictions/next.json` and `history/*.json` | fixture predictions from `scripts/build-predictions.mjs` |
| Fantasy market (prices, history, ownership) | `../data/serve/fantasy_rounds.json`, latest round (`src/lib/fantasy/market.ts`); game rules from the fixture | `fixtures/fantasy/2026.json` |
| Fantasy scenarios | `../data/predictions/fantasy.json` | built from the market fixture and the forecast |
| Track outlines | `fixtures/tracks/*.json` (MultiViewer outlines) | none |

Set `F1_DATA_DIR` to point at another data folder, or `F1_DATA_SOURCE=fixtures` to force fixtures
(tests do this).

## Live

`src/lib/live`: typed client for the service in `../live` (see its README for the messages), a
pure reducer, and a fixture-driven mock stream used only when the service is unreachable. The
service is looked for at `NEXT_PUBLIC_LIVE_HTTP` / `NEXT_PUBLIC_LIVE_WS` when set at build time,
otherwise at localhost:8765 only when the page is served from localhost; the hosted site never
probes it and shows the no-live-session state. Races replay without the service; other sessions
need it. The
page opens live automatically when a session is running; otherwise nothing plays until a
session is picked and play is pressed.

## QA scripts

`node scripts/shoot.mjs <name> <path> [settleMs] [dark|light]` writes full-page screenshots at
1440 and 390 px to `.qa/`, with console errors and horizontal overflow checks.
`node scripts/live-probe.mjs <url>` reports frame timings and tower state for the live page.
