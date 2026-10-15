# F1nsight: ideas, libraries and datasets (research pass)

Date of research: 2026-10-08. Scope: data sources, libraries, feature ideas and a shortlist for
the stats, fantasy and predictions site in this repo. Read-only pass: no code, no git, no
processes touched. Nothing here is a decision; it is input for the owner.

How to read the confidence marks:

- **[confirmed]** the claim comes from an official page or from the repo itself.
- **[single source]** one web source, not cross-checked.
- **[unverified]** a search snippet or an aggregator that contradicts or does not confirm the
  claim. Check the primary source before relying on it.

Free-only rule (SPEC.md): anything below that needs a paid plan, a key with a quota that will
run out, or a non-commercial licence in a commercial setting is flagged **[free risk]**.

---

## 1. What the repo already has (so the ideas below can be judged)

Checked on disk, not from memory:

- `pipeline/src/f1p/fastf1/` downloads FastF1 car data (`car_data.ff1pkl` in
  `data/fastf1_cache`), positions (`positions.py` calls `lap.get_telemetry()`), race control,
  weather, session results. So per-lap speed, throttle, brake, gear and RPM already exist
  for FastF1 years. This is the biggest unlock for telemetry features.
- `data/raw/`: `f1db/`, `fantasy/`, `fastf1/`, `jolpica/`, `livetiming/`, `openf1/`,
  `openmeteo/`. Weather is already fetched from Open-Meteo.
- `pipeline/pyproject.toml` pins `fastf1>=3.8.3`, `duckdb>=1.5.6`, `polars>=2.0.0`.
- Site: `forecast`, `fantasy`, `live` (track map, timing tower, replay), `stats`
  (standings, results, lap chart, pit stops, progression), `history`, `circuits`, `drivers`,
  `teams`, `races`. The forecast page already shows a track record.
- Licences the site must credit (INTEGRATION_TODO.md): OpenF1 (CC BY-NC-SA 4.0, non-commercial),
  F1DB (CC BY 4.0), Jolpica, DHL pit stop data.

---

## 2. Data sources: what changed in 2025 and 2026

### 2.1 OpenF1

- No official 2026 changelog or new endpoint announcement was found. Treat OpenF1 as
  unchanged unless the docs say otherwise. Check the docs and GitHub directly.
  [unverified] https://openf1.org (search gave only third-party pages)
- Access: the Community tier is described as free, with no key and about 3 requests per second
  across all sessions since 2023. [single source]
  https://freeapihub.com/apis/openf1-api
- A November 2025 test reported that 21 of 22 REST endpoints work without a paid account, and
  that MQTT/WebSocket streaming is a paid (Sponsor) feature. Sponsor live access is described
  as available only in a window from 30 minutes before to 30 minutes after a session.
  [single source, and this contradicts the SPEC.md "no OpenF1 sponsor account" rule, so
  keep to REST/replay]
  https://glama.ai/mcp/servers/@Panth1823/formula1-mcp/blob/b44b4b76a8666677b0071cb506c78d347cc31dff/TESTING_SUMMARY.md
- Licence is non-commercial (INTEGRATION_TODO.md). **[free risk]** if the site ever runs ads or
  paid tiers.

### 2.2 FastF1

- The search snapshot shows the docs at 3.8.1 and no dated 2026 release notes. The pipeline
  already requires `fastf1>=3.8.3`, so the search index is behind the code. Nothing to change,
  but do not trust search for FastF1 version numbers. [confirmed local, search stale]
  https://docs.fastf1.dev/changelog/index.html
  https://pypi.org/project/fastf1/
- The FastF1 `SignalRClient` has a `no_auth` parameter (default False), which suggests the
  library already has an authenticated path for the live feed. Not tested here.
  https://docs.fastf1.dev/_sources/changelog/v3.1.x.rst.txt (changelog index only)

### 2.3 Jolpica (Ergast successor)

- Ergast shut down at the start of 2025. Jolpica-F1 is the drop-in successor at
  `api.jolpi.ca/ergast/f1`; FastF1 points at it. [confirmed by FastF1 docs]
  https://docs.fastf1.dev/api_reference/jolpica.html
- Still active; no 2026 shutdown or status change found. [single source]
- Rate-limited, no key. A paid supporter tier exists for commercial use. **[free risk]**
  if the site is ever monetised. [single source]
  https://github.com/jolpica/jolpica-f1 (check the README for current policy)

### 2.4 F1 live timing (2026 changes and risks)

This matters most for `live` (positions are "estimated" when the official feed is blocked).

- Since the 2025 Dutch GP, some F1 live timing streams need a valid F1 TV subscription (a JWT
  token). Driver tracker positions, DRS indicator, championship tables and pit stop times are
  reported affected. Replay still works without auth, because replay uses static archive files.
  [single source, several community projects agree]
  https://github.com/JustAman62/undercut-f1
  https://community.home-assistant.io/t/formula-1-racing-sensor/880842
- Reports of IP blocking by F1 on the live feed, and a hosted project being down as a result.
  [single source] Relevant to the "live" pillar and to the Friday 2026-10-09 probe tasks in
  INTEGRATION_TODO.md. Keep the static-archive replay as the reliable path.
- Official F1 "Live Timing improvements" article exists. [single source, content not read]
  https://www.formula1.com/en/latest/article/you-speak-we-listen-the-latest-f1-live-timing-improvements.G9HzG04abEZ7wSosVjUfg

### 2.5 2026 regulations: data that exists and data that does not

What the rules change, as the data sees it:

- DRS is gone. Active aero: rear and front wing flaps, with a "Straight Mode" and a default
  "Corner Mode". [single source, multiple articles agree]
  https://www.formula1.com/en/latest/article/everything-you-need-to-know-about-the-new-f1-rules-for-2026.48bv0VTxhIlhrQXmxercXk
- Overtake Mode: usable only within 1 second of the car ahead at a detection point, and only in
  approved zones. It adds electrical energy to assist a pass. [single source]
  https://www.planetf1.com/news/explained-how-f1-new-overtaking-mode-will-work
- Boost Mode: deploy stored ERS energy anywhere on track at the driver's choice. Energy is
  recovered under braking, at throttle lift and in part-throttle corners. [single source]
- Speed threshold for the extra output: one source says 209 mph (337 km/h), another cites
  340 km/h. Check the FIA text. [unverified]
- Telemetry: no public feed of Overtake Mode or ERS deployment state was found. Official F1
  publishes limited telemetry; teams hold far more. [single source]
  https://www.espn.com/f1/story/_/id/47333501/ (terminology explainer)

Community 2026 data:

- **TracingInsights 2026** (GitHub, not affiliated with F1). Speed, throttle, brake, DRS, RPM,
  gear and 3-axis acceleration sampled at 3.7 Hz, per driver per lap. Updated about 30 minutes
  after each session. The licence is not confirmed in the search. **[unverified licence,
  check before any redistribution]**
  https://www.mintlify.com/TracingInsights/2026
  https://github.com/TracingInsights/2026
- The DRS channel will be dead or meaningless in 2026 (the repo already has `drs` null in
  2026 in the live contract). Use speed, throttle, brake and gear, and treat DRS as absent.

Derived "energy" view (see idea 22): we can estimate deployment from speed trace, throttle
and brake, and label it **estimated**. We cannot show the real ERS state.

### 2.6 Pirelli 2026 tyres

- Five dry compounds for 2026, C1 (hardest) to C5 (softest). The C6 is not returning.
  [single source] https://www.motorsport.com/f1/news/pirelli-sets-f1-2026-compounds-abandons-c6/10779540/
- Compound approval was due by 15 December (from an article on the 2026 development cycle).
  [single source]
- No public raw tyre telemetry for 2026 found. Pirelli publishes compound specs and occasional
  test summaries. Tyre data for the site stays what FastF1 gives (compound, tyre life, stint).
  [confirmed by absence of source]

### 2.7 Weather

- Open-Meteo: forecasts 16 days ahead (global), hourly local models; historical archive from
  1940 via ERA5. No key. [single source; the official site was partially read]
  https://open-meteo.com/
- Free tier is non-commercial. Bulk downloads are rate-limited (community forum). Self-host is
  AGPL-3.0. **[free risk]** only if the site goes commercial. Already in use (`data/raw/openmeteo`).
  https://open-meteo.com/en/licence (check the licence page; not read in this pass)

### 2.8 Team radio transcripts

- No public F1 team radio transcript dataset found on Kaggle or Hugging Face in this search.
  [confirmed by absence in search; search was weak, so a manual Kaggle/HF check is worth it]
- A CoreWeave write-up describes an AI pipeline transcribing 2026 Monaco radio (over 21,000
  messages, over 50 hours). It is a case study, not a released dataset. [single source]
  https://coreweave.com/blog/how-ai-agents-on-coreweave-help-process-f1-radio-in-near-real-time
- Transcribing ourselves is possible only if we get audio, which is not in the free public
  data we checked. Treat radio as a gap.

### 2.9 Betting odds (for calibration)

- The Odds API: free "Starter" plan of 500 credits per month. Credits depend on markets times
  regions for live odds, and historical odds cost 10 times more. [single source, several
  aggregators agree on 500 credits]
  https://sportsapis.dev/apis/the-odds-api
- **F1 coverage unconfirmed.** Odds-API.io has an F1 feature request showing F1 odds not
  available. [single source]
  https://feedback.odds-api.io/p/motorsport-f1-motogp-coverage
- Cheap check: the sports list endpoint is free (no credits). Call it once with a free key to
  see whether an F1 key with outrights exists. [method, not verified]
- Historical odds for backtest calibration are the expensive part (10x). **[free risk]**.
- Sportradar has F1 live odds docs but is an enterprise product. Not free. [single source]
  https://docs.sportradar.com/uof/live-competition-odds/live-odds-formula-1

### 2.10 Car telemetry datasets (Kaggle, HF)

- Kaggle: an F1 Drivers Dataset 1950 to 2026 (career stats), updated to the 2026 Japanese GP.
  Tables only, no telemetry. [single source]
  https://baselight.app/u/kaggle/dataset/kushagrajain19_f1_drivers_dataset_1950_2026
- TracingInsights RaceData is sourced from Kaggle and released CC0 (per its own page), updated
  within 3 hours of each race. Race tables, not car telemetry. [single source]
  https://www.mintlify.com/TracingInsights/RaceData/introduction
- Hugging Face: no F1 telemetry dataset found in search. [not found]
- Academic: IEEE DataPort "adaptive aerodynamics research dataset". Not F1 telemetry, not
  checked further. https://ieee-dataport.org/documents/adaptive-aerodynamics-research-dataset
- Awesome list for more leads: https://github.com/subinium/awesome-f1

### 2.11 Official F1 APIs

- No public official F1 data API found. The F1 TV / live timing paths are the official feed,
  and they are gated (see 2.4). Official fan app data (Ferrari fan app) is out of scope.

### 2.12 Fantasy (2026 rules, from fan/media sources only)

Sources disagree with our own rules file. Use `data/raw/fantasy/rules_2026.json` as the
authority and cross-check these points in the game:

- Transfers netted per race, so test lineups are free. [single source]
  https://www.fanamp.com/articles/f1-fantasy-2026-rules-scoring-and-whats-changed-this-season
- Sprint DNF / NC penalty halved, from -20 to -10. [single source, same article]
- Minimum asset price reduced to $3M (was $4.5M). Cost cap still $100M for 5 drivers and 2
  constructors. [single source, mid-season guide, so possibly already changed]
  https://www.fanamp.com/articles/best-and-worst-f1-fantasy-picks-for-the-austrian-grand-prix-2026
- Prize eligibility may now cover all teams, not only Team 1. [unverified]
  https://www.motorsport.com/f1/news/f1-fantasy-2026-prizes-and-changes-coming-to-this-season-explained/10800060/

---

## 3. Libraries worth adopting (2026 check)

Versions are what the search surfaced. Where it says unverified, run `npm view <pkg> version`
before pinning. Every item has a maintenance note.

| Need | Pick | Version / status | Why | Verdict |
| --- | --- | --- | --- | --- |
| Dense telemetry traces (speed, throttle, 60k points) | **uPlot** | 1.6.32, MIT, latest found on jsDelivr. Dec 2025 bump mirrored. [single source] https://www.jsdelivr.com/package/npm/uplot | Canvas, tiny, fast on huge series; fits telemetry overlay and lap charts | **Adopt** for telemetry |
| General charts (bars, heatmaps, box plots) | **Apache ECharts** | 6.1.0 found (release date inconsistent across sources, 2026 plausible). Apache 2.0. [single source] https://echarts.apache.org/handbook/en/basics/release-note/v6-feature | Mature, heatmap and geo support; big bundle, lazy-load | Adopt only if a heatmap or sankey is needed (strategy, tyre usage) |
| Declarative plots | Observable Plot | 0.6.17 on npm (publish date not confirmed). https://www.npmjs.com/package/@observablehq/plot | Concise, good for quick stats charts | Optional; the site already has its own chart components |
| Charts (React-first) | visx | not checked in this pass | | Skip unless more D3 control is needed |
| Track maps and 3D circuits | **React Three Fiber** + **drei** | R3F v9 is the React 19 line; v9 migration guide: https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide . drei version conflicts in search (one source says 10.x, another 9.x). Verify with npm. [unverified] | Real 3D flyover of track outline, elevation optional | **Adopt for idea 9**, lazy-load behind a route. Note Strict Mode breaking changes in v9 |
| Animation | **Motion** (`motion/react`) | Renamed from framer-motion. 13.x seen on Socket.dev (13.3.0). Date unconfirmed. https://motion.dev (not fetched) | Layout and shared-element animation for the live tower | Adopt; import from `motion/react`, not `framer-motion` |
| Page transitions | View Transitions API | Browser standard, but Next.js `experimental.viewTransition` flag is still experimental in 16.2.x docs; `<ViewTransition>` comes from React canary. https://nextjs.org/docs/app/guides/view-transitions | Cross-fade between races on the live page | **Wait** on production use; try in a branch only |
| Static site search | **Pagefind** | Builds a static index after build, runs in browser. Version not verified. https://pagefind.app | Best for the stats pages and history: no server | **Adopt** for stats/history text search |
| Runtime search with vectors | **Orama** | Apache 2.0, in-browser and edge, hybrid search. ~150k weekly downloads (secondary). https://github.com/oramasearch/orama | Overkill for pages, fine for fuzzy driver-name search | Optional |
| In-browser analytics on parquet | **DuckDB-WASM** | 1.5.1 per DuckDB official docs (npm not checked). https://duckdb.org/docs/lts/clients/wasm/overview | Query `ff1_laps` parquet in the browser for "compare any two laps", NL Q&A | **Adopt** for interactive analytics; ship parquet subsets, not the whole lake |
| Local DB for serve layer | SQLite (better-sqlite3, read only) | already in SPEC | Stays free and simple | Keep |
| Hosted DB | Turso / libSQL | Free tier numbers conflict across aggregators (100 DBs, 5 GB, 500M rows read; one source says embedded replicas are paid). https://turso.tech/pricing (check) | Only needed if the leaderboard must be server-side | **Do not adopt yet**; a leaderboard can live on the free Cloudflare or local SQLite first |
| Auth without Supabase | **Better Auth** | Self-hosted TypeScript auth. Reports (single source, July 2026) that Vercel acquired it, with the library staying MIT and free. [unverified, check the announcement] https://www.achromatic.dev/blog/vercel-acquires-better-auth-nextjs-saas | Needed for prediction leaderboard accounts | **Adopt** if accounts are needed; Auth.js v5 still beta; next-auth 4.24.14 stable (single source) |
| Push notifications | Web Push via `web-push` + Next.js PWA guide | iOS 16.4+ works only for Home Screen installs; permission needs a user gesture. https://nextjs.org/docs/app/guides/progressive-web-apps (Next 16 docs) . `web-push` version not verified | Price alerts, race-start alerts | Adopt only after home-screen install hint is designed; Serwist is the maintained next-pwa successor |
| OG images | Next.js built-in `ImageResponse` (`next/og`) | not searched in this pass; built into Next, no extra dep | Shareable prediction cards | Adopt (no extra dependency) |
| LLM race summaries / NL Q&A | Local model only | DuckDB-NSQL-7B (Llama-2 based, licence caveat) https://huggingface.co/blog/duckdb-nsql-7b ; duckthink `ASK()` needs a hosted LLM https://duckdb.org/community_extensions/extensions/duckthink | Free rule: no paid tokens. A local 7B is slow for a website | **Prefer deterministic NL (intent parser over DuckDB-WASM) plus templated recaps.** A local LLM only for a build-time pipeline step |
| Social sentiment | not researched | | | Skip for now; most APIs are paid |

Notes on the rest of the stack:

- Edge hosting and OG: check Vercel hobby terms before any commercial use. [not checked]
- Cloudflare: the Cloudflare docs tools are available if D1/KV is wanted for the leaderboard.
  Not checked in this pass.

---

## 4. Feature ideas (25+)

Effort: S (under a week of work), M (one to three weeks), L (longer). Wow: 1 to 5.
"Have data" means the repo already has it or FastF1 can supply it without a new source.

| # | Feature | What it is | Why fans care | Data (have / gap) | Effort | Wow |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Telemetry comparison overlay | Pick two drivers and a lap (or a corner); overlay speed, throttle, brake, gear on a shared distance axis | The classic "where did he lose it" question | Have: FastF1 `car_data` cache (2018+) | M | 5 |
| 2 | Ghost-car lap replay | Race the ghost of a rival's fastest lap on the track map, with a live delta bar | Makes the lap feel like a race | Have: positions (`positions.py`), laps | M | 5 |
| 3 | Prediction leaderboard ("beat the model") | Users submit their own finishing order before FP1 or quali; score against the model and the grid baseline | The hero pillar: competition and retention | Have: prediction history. Gap: user identity and a server store | M | 5 |
| 4 | Era-adjusted all-time ratings | Glicko or Elo across 1950 to 2026, adjusted for field size and team strength; drivers and teams | Settles the "best ever" arguments with a number | Have: F1DB and Jolpica results since 1950 | M | 4 |
| 5 | Head-to-head teammate battles | Season-long qualifying gap, race delta, points by round, with a running score | Teammate rivalry is the core of the sport | Have: results, quali | S | 3 |
| 6 | Driver style fingerprint | Radar of throttle lift, brake point, trail braking, gear shifts, minimum corner speeds, from car data | Shows *how* a driver drives, not just the result | Have: `car_data` | M | 4 |
| 7 | Corner-by-corner gain map | On the track outline, colour each corner by which driver gained or lost time vs the field | Explains race results at a glance | Have: sectors, `car_data`, positions | M | 4 |
| 8 | Speed heatmap on the circuit | Speed or throttle coloured along the track outline, per lap or per driver | Beautiful and shareable | Have: `car_data` with position | S | 4 |
| 9 | Circuit 3D flyover | R3F scene of the track outline with speed-coloured ribbon and a camera flyover | Showpiece for circuit pages | Have: track outline (`tracks.py`). Gap: elevation (no free source checked) | M | 5 |
| 10 | Strategy explorer | Stint timeline per driver, tyre life, pit windows, and what an undercut would have needed | Strategy is the best-loved debate | Have: laps, pit stops, compounds | M | 4 |
| 11 | "What if" race simulator | Replay a race with a different pit stop, grid slot or safety car; estimate the new order | Pure fun, and it shows the model works | Have: lap model inputs. Gap: a calibrated lap-time model | L | 5 |
| 12 | Undercut / overcut calculator | Enter two drivers and their gap; get a probability of a successful undercut from history | Quick, useful, fits the forecast pillar | Have: pit loss and gaps history | S | 3 |
| 13 | Tyre degradation curves | Fuel-corrected lap time vs tyre age per compound and circuit | Pirelli-style analysis for fans | Have: `ff1_laps` (compound, tyre life) | M | 3 |
| 14 | Perfect lap composer | Best sector from each driver in a session, stitched into a theoretical best lap | Shows what was on the table | Have: sector times | S | 4 |
| 15 | Qualifying evolution chart | Each driver's best lap through the session, like the broadcast graphic | Clear view of track evolution | Have: `ff1_laps` | S | 3 |
| 16 | "What if the points were different" | Re-score any season under 1950s, 2010s or sprint-heavy systems | Historians and stats nerds | Have: results | S | 3 |
| 17 | Fantasy rivals and league tracking | Enter friends' team IDs or paste team snapshots; compare expected points and price moves | Fantasy is social | Have: fantasy model. Gap: league data (no official league API found; manual entry) | S | 3 |
| 18 | Price-change alerts | Notify when a driver's predicted price change crosses a threshold | Acts on the fantasy pillar | Have: `priceChangeProbs`. Gap: push on iOS needs a Home Screen install | M | 3 |
| 19 | Chip timing planner | Show the best race to play each chip across the horizon | Uses the existing horizon data | Have: `horizon` in fantasy.json | S | 3 |
| 20 | Natural-language stats Q&A | "Who was fastest in Suzuka wet races since 2010?" answered by an intent parser over DuckDB-WASM | Fans ask questions; the site answers them | Have: parquet and SQLite. No LLM needed | M | 4 |
| 21 | Race recap stories | Templated recap built from computed facts (overtakes, pit stops, fastest laps), optionally polished by a build-time model | Gives every race a readable page without a writer | Have: all facts from pipeline | M | 3 |
| 22 | Energy and overtake-mode view (2026) | Estimated electrical deployment from speed, throttle and brake; labelled **estimated** | Explains the new rules, which fans find confusing | Have: `car_data`. Gap: no official ERS channel | M | 4 |
| 23 | "On this day" | Results and anecdotes from the same calendar date in history | Cheap, sticky, shareable | Have: history since 1950 | S | 2 |
| 24 | Guess the circuit or driver | Show a telemetry trace or track outline; the user guesses | Quiz format with real data | Have: outlines, `car_data` | S | 3 |
| 25 | Radio transcript timeline | Radio messages aligned to race control and laps | Huge fan appeal | Gap: no audio or transcripts | L | 4 |
| 26 | Race control and incident timeline | Track limits, penalties and SC periods on a single timeline with the lap chart | Clarifies "why was he penalised" | Have: `ff1_race_control` | S | 2 |
| 27 | Season "what if" for a single driver | Compare a season with and without a DNF or a penalty | Narrative for the title race | Have: results, race control | S | 3 |
| 28 | Shareable prediction cards | OG image of the forecast with the user's pick, for social sharing | Growth loop | Have: forecast. Use `next/og` | S | 3 |
| 29 | Predicted vs actual "shadow" season | Track the model's season total vs the real one, round by round | The track-record story, extended | Have: prediction history | S | 3 |
| 30 | Offline replay cache | Store a recorded session in IndexedDB for offline replay on mobile | Works on a train | Have: replay data (size to check) | M | 2 |

---

## 5. Top 10 shortlist (suggested order)

1. **Telemetry comparison overlay (idea 1).** Uses the `car_data` cache we already have.
   Establishes the uPlot telemetry component that ideas 2, 6 and 8 reuse. Best value.
2. **Speed heatmap on the circuit (idea 8).** Small follow-up on the same data and the track map.
   Gives a quick visual win for the circuit pages.
3. **Ghost-car lap replay (idea 2).** Reuses the live track-map code and telemetry. Strong
   demo for the live pillar.
4. **Head-to-head teammate battles (idea 5).** S effort, no new data, a clear stats page.
5. **Era-adjusted all-time ratings (idea 4).** Pure history data, shareable, and it gives the
   history section a reason to exist.
6. **Prediction leaderboard "beat the model" (idea 3).** Biggest retention lever for the hero
   pillar. Start with local-only picks (localStorage plus a share URL) before adding accounts
   (Better Auth) and a store. Keep it free.
7. **Strategy explorer with undercut calculator (ideas 10 and 12).** Shares pit and lap data;
   fans love strategy debates.
8. **Natural-language stats Q&A (idea 20).** DuckDB-WASM plus a deterministic intent parser. No
   paid LLM, no key, free to run.
9. **Circuit 3D flyover (idea 9).** Showpiece with R3F, lazy-loaded so the stats pages stay
   light. Do after the telemetry work, since it reuses the same speed colouring.
10. **Fantasy rivals and price-change alerts (ideas 17 and 18).** Makes the fantasy pillar
    social. Push only after the Home Screen install hint is designed (iOS limits).

Stretch, after the top 10: the "what if" simulator (idea 11) and the 2026 energy view (idea 22).
The energy view should go early if the 2026 regs are the owner's priority, because it is the
most topical feature right now.

---

## 6. Risks and open questions for the owner

- **Live feed access.** If F1 keeps gating live streams (2.4), the live pillar relies on
  estimated positions and static replay. Plan the UI copy accordingly.
- **Licence conflicts.** OpenF1 is non-commercial; TracingInsights licence unconfirmed. Do not
  redistribute either in the site data without checking.
- **Odds calibration.** The free odds path looks thin. Options: accept no market benchmark, or
  use a one-off manual sample. Decide before building calibration pages.
- **Fantasy rules.** Cross-check `rules_2026.json` against the in-game rules before any new
  fantasy feature. Several 2026 facts above are from fan guides.
- **Radio.** No free data. Drop it or accept it as a stretch with no data.
- **Versions to verify before pinning:** Observable Plot, R3F and drei, Motion, Pagefind, Orama,
  DuckDB-WASM npm version, `web-push`, Better Auth (Vercel acquisition), Turso free-tier terms.

---

## 7. Sources

Official or primary:

- Open-Meteo: https://open-meteo.com/
- FastF1 docs (Jolpica, changelog): https://docs.fastf1.dev/api_reference/jolpica.html ,
  https://docs.fastf1.dev/changelog/index.html , https://pypi.org/project/fastf1/
- Next.js PWA guide: https://nextjs.org/docs/app/guides/progressive-web-apps
- Next.js View Transitions: https://nextjs.org/docs/app/guides/view-transitions
- Next.js viewTransition config: https://nextjs.org/docs/app/api-reference/config/next-config-js/viewTransition
- DuckDB-WASM docs: https://duckdb.org/docs/lts/clients/wasm/overview
- React Three Fiber v9 migration: https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide
- ECharts 6 features: https://echarts.apache.org/handbook/en/basics/release-note/v6-feature
- F1 2026 rules explainer: https://www.formula1.com/en/latest/article/everything-you-need-to-know-about-the-new-f1-rules-for-2026.48bv0VTxhIlhrQXmxercXk
- F1 live timing article: https://www.formula1.com/en/latest/article/you-speak-we-listen-the-latest-f1-live-timing-improvements.G9HzG04abEZ7wSosVjUfg
- Pirelli 2026 compounds: https://www.motorsport.com/f1/news/pirelli-sets-f1-2026-compounds-abandons-c6/10779540/
- Pirelli 2026 development: https://www.f1technical.net/news/27918

Community and secondary (single source, verify):

- TracingInsights 2026: https://www.mintlify.com/TracingInsights/2026 , https://github.com/TracingInsights/2026
- TracingInsights RaceData: https://www.mintlify.com/TracingInsights/RaceData/introduction
- undercut-f1 (live timing auth): https://github.com/JustAman62/undercut-f1
- Home Assistant F1 thread: https://community.home-assistant.io/t/formula-1-racing-sensor/880842
- OpenF1 test summary: https://glama.ai/mcp/servers/@Panth1823/formula1-mcp/blob/b44b4b76a8666677b0071cb506c78d347cc31dff/TESTING_SUMMARY.md
- OpenF1 community tier listing: https://freeapihub.com/apis/openf1-api
- Active aero / overtake mode: https://www.planetf1.com/news/explained-how-f1-new-overtaking-mode-will-work
- Terminology explainer: https://www.espn.com/f1/story/_/id/47333501/
- 2026 Fantasy rules (fan guides): https://www.fanamp.com/articles/f1-fantasy-2026-rules-scoring-and-whats-changed-this-season ,
  https://www.fanamp.com/articles/best-and-worst-f1-fantasy-picks-for-the-austrian-grand-prix-2026 ,
  https://www.motorsport.com/f1/news/f1-fantasy-2026-prizes-and-changes-coming-to-this-season-explained/10800060/
- Odds API (free tier): https://sportsapis.dev/apis/the-odds-api
- Odds-API.io F1 request: https://feedback.odds-api.io/p/motorsport-f1-motogp-coverage
- Sportradar F1 odds: https://docs.sportradar.com/uof/live-competition-odds/live-odds-formula-1
- Team radio AI pipeline (CoreWeave): https://coreweave.com/blog/how-ai-agents-on-coreweave-help-process-f1-radio-in-near-real-time
- Kaggle F1 drivers 1950 to 2026: https://baselight.app/u/kaggle/dataset/kushagrajain19_f1_drivers_dataset_1950_2026
- Awesome F1 list: https://github.com/subinium/awesome-f1
- Better Auth and Vercel (July 2026, unverified): https://www.achromatic.dev/blog/vercel-acquires-better-auth-nextjs-saas
- Better Auth Next.js guide: https://www.noqta.tn/tutorials/better-auth-nextjs-authentication-tutorial-2026
- Turso pricing (aggregators, conflicting): https://toolradar.com/tools/turso/pricing
- Motion (formerly framer-motion): https://socket.dev/npm/package/framer-motion/overview/13.3.0
- Pagefind / Orama comparison: https://merginit.com/blog/22062026-free-site-search-comparison
- uPlot on jsDelivr: https://www.jsdelivr.com/package/npm/uplot
- DuckDB-NSQL-7B: https://huggingface.co/blog/duckdb-nsql-7b
- duckthink extension: https://duckdb.org/community_extensions/extensions/duckthink
