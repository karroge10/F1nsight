# F1nsight: shared spec

Written 2026-10-07; the 2026 season is in progress (new technical regulations, 11 teams incl. Cadillac, Audi replaced Sauber).

The site has four pillars, in priority order:

1. **Predictions** (the hero of the site): next-race finishing order with probabilities
   (win, podium, points, DNF, full position distribution), trained locally on the GPU.
2. **F1 Fantasy**: predicted fantasy points and predicted price change for every driver and
   constructor for the next race.
3. **Live / replay**: a track map with every car moving, plus a live timing tower (gaps,
   intervals, sectors, tyres, pit stops, race control, weather). When no session is live,
   the same view replays any past session from recorded position data.
4. **Stats**: standings, race results, driver/team/circuit pages, full history since 1950.

Never use the em dash character anywhere (code, comments, UI copy, docs).

**Everything must be completely free.** No paid APIs, subscriptions, paid tokens (no F1TV
subscription, no OpenF1 sponsor account), paid hosting or paid fonts. Where a feature hits a
paywall, build a free workaround (estimate, reconstruct, or use a public archive) instead of
asking for a key, and label estimated data honestly in the UI.

## Layout

```
F1nsight/
  SPEC.md            this file
  pipeline/          Python (uv, py3.12): data download, ETL, ML training, export
    src/f1p/...      package code; scripts runnable with `uv run python -m f1p.<module>`
  live/              Python (uv, py3.12): FastAPI live + replay relay service
  ml/                Python (uv, py3.12): feature building, GPU training, backtest, export of
                     data/predictions/*. Env ready: torch 2.11 cu128 (RTX 5070 Ti verified),
                     xgboost 3.4 (GPU), lightgbm, optuna, polars, duckdb, scikit-learn
  site/              Next.js app (App Router, TypeScript, Tailwind v4)
  data/              NOT in git
    raw/             downloaded source data, one subfolder per source
                     (jolpica/, fastf1/, openf1/, fantasy/, ...)
    processed/       cleaned parquet tables (see below)
    serve/           what the site reads: f1.sqlite + small JSON files
    predictions/     model output JSON (contract below)
    fastf1_cache/    FastF1 HTTP cache (shared by pipeline and live)
```

The pipeline env already exists at `pipeline` (uv project; fastf1, pandas, polars,
pyarrow, duckdb, requests, httpx, tqdm, numpy). Add deps with `uv add` from that folder.

## Processed tables (parquet in data/processed/)

Use stable string ids from Jolpica/Ergast (`driverId`, `constructorId`, `circuitId`) as the
join keys everywhere; FastF1/OpenF1/Fantasy data must be mapped onto them (keep a mapping
table `id_map.parquet` with driver number, 3-letter code, fantasy id, openf1 id per season).

- `races` (season, round, raceName, circuitId, date, time, sprint flag, url)
- `circuits`, `drivers`, `constructors`
- `results`, `sprint_results`, `qualifying` (one row per driver per event)
- `lap_times` (Jolpica, 1996+), `pit_stops` (2011+)
- `driver_standings`, `constructor_standings` (after each round)
- `ff1_laps` (FastF1, 2018+: every lap of every session FP1..R incl. sprint sessions, with
  compound, tyre life, stint, sector times, speed traps, track status, deleted flag)
- `ff1_weather`, `ff1_race_control`, `ff1_session_results`
- `fantasy_prices`, `fantasy_points` (per driver/constructor per round, as far back as found)

Each downloader must be resumable and idempotent (skip what is already on disk) and write a
short `data/raw/<source>/README.md` describing what was fetched, coverage and gaps.

## Prediction contract: data/predictions/next.json

```jsonc
{
  "generatedAt": "ISO-8601",
  "model": { "version": "string", "trainedAt": "ISO", "notes": "string",
             "backtest": { "seasons": [2024, 2025, 2026], "winnerAccuracy": 0.0,
                           "podiumHitRate": 0.0, "spearman": 0.0, "brier": 0.0,
                           "baseline": { "name": "grid order", "spearman": 0.0 } } },
  "race": { "season": 2026, "round": 19, "raceName": "", "circuitId": "", "circuitName": "",
            "country": "", "date": "ISO", "hasSprint": false,
            "stage": "pre-weekend | post-practice | post-qualifying",
            "inputsUsed": ["FP1", "FP2", "FP3", "Q"] },
  "drivers": [{
    "driverId": "", "code": "VER", "number": 1, "name": "", "constructorId": "",
    "team": "", "teamColor": "#RRGGBB", "grid": null,
    "expectedPosition": 0.0, "positionDist": [/* P1..P22 probabilities */], "pDnf": 0.0,
    "pWin": 0.0, "pPodium": 0.0, "pPoints": 0.0, "expectedPoints": 0.0,
    "fantasy": { "price": 0.0, "expectedPoints": 0.0, "p10": 0.0, "p90": 0.0,
                 "expectedPriceChange": 0.0, "priceChangeProbs": { "-0.3": 0.0 } },
    "reasons": ["short human-readable factors, e.g. 'strong long-run pace in FP2'"]
  }],
  "constructors": [{ "constructorId": "", "name": "", "teamColor": "",
                     "expectedPoints": 0.0,
                     "fantasy": { "price": 0.0, "expectedPoints": 0.0, "p10": 0.0, "p90": 0.0,
                                  "expectedPriceChange": 0.0 } }],
  "championship": { "drivers": [{ "driverId": "", "pTitle": 0.0, "expectedFinalPoints": 0.0 }],
                    "constructors": [{ "constructorId": "", "pTitle": 0.0 }] }
}
```

Also `data/predictions/history/<season>-<round>.json`: the same shape as published before that
race plus an `"actual"` block, so the site can show the model's track record.

## Fantasy contract: data/predictions/fantasy.json (written by `f1ml.predict`)

```jsonc
{
  "generatedAt": "ISO", "season": 2026, "round": 17, "raceName": "", "hasSprint": false,
  "rules": { /* copied from data/raw/fantasy/rules_2026.json: budget cap, team size
               (5 drivers + 2 constructors), free transfers, extra transfer penalty,
               boost (2x) rule, chips with their exact effects */ },
  "assets": [{ "id": "max_verstappen", "kind": "driver | constructor", "fantasyId": "",
               "name": "", "constructorId": "", "teamColor": "#RRGGBB", "price": 0.0,
               "expectedPoints": 0.0, "p10": 0.0, "p90": 0.0, "pNegative": 0.0,
               "breakdown": { "qualifying": 0.0, "race": 0.0, "sprint": 0.0,
                              "positionsGained": 0.0, "overtakes": 0.0, "fastestLap": 0.0,
                              "dotd": 0.0, "pitStops": 0.0, "dnfPenalty": 0.0 },
               "expectedPriceChange": 0.0, "priceChangeProbs": { "+0.1": 0.0 } }],
  // Joint Monte Carlo outcomes so the team optimiser can account for correlation
  // (teammates, a driver and his constructor, chaos races). points[i][j] = fantasy points of
  // assets[j] in simulated weekend i (rounded to 0.1). n around 2000.
  "scenarios": { "n": 2000, "points": [[0.0]] },
  // Next few rounds for multi-race planning (transfers, price growth, chip timing).
  "horizon": [{ "round": 18, "raceName": "", "hasSprint": false,
                "expectedPoints": { "<asset id>": 0.0 },
                "expectedPriceChange": { "<asset id>": 0.0 } }]
}
```

The site's fantasy tool (no accounts; user state in localStorage, with a shareable URL)
lets the user enter budget, current team, transfers available and chips to use, and runs a
TypeScript optimiser in `site/src/lib/fantasy/` over this file.

## Live contract (service on http://localhost:8765)

- `GET /status` -> `{ "live": bool, "session": {...} | null, "next": {...} }`
- `GET /sessions?season=2026` -> sessions available for replay
- `WS /ws/live` and `WS /ws/replay?season=&round=&session=R&speed=1` send the same messages:
  - `{"type":"init","session":{...},"track":{"outline":[[x,y],...],"rotation":deg,"corners":[...],
     "sectors":[...]},"drivers":[{"number","code","name","team","teamColor"}]}`
  - `{"type":"frame","t":ms,"cars":[{"number","x","y","status"}]}` at ~4 to 10 Hz
  - `{"type":"timing","t":ms,"lap":{"current","total"},"rows":[{"pos","number","gap",
     "interval","lastLap","bestLap","s1","s2","s3","tyre","tyreAge","pits","inPit",
     "retired","drs"}]}` on change
  - `{"type":"raceControl", ...}`, `{"type":"weather", ...}`, `{"type":"trackStatus", ...}`
  Replay supports `{"cmd":"seek","t":ms}`, `{"cmd":"speed","value":4}`, pause/resume.
  BUILT: `live/README.md` is the authoritative message reference. Additions over this
  sketch: message types `loading`, `pitStop`, `tyreChange`, `playback`, `error`;
  `init.positionsAvailable` (false only when no positions at all can be shown, so the map must
  hide dots and still show the tower); `init.positionsSource` and `frame.source` are
  `official`, `official-delayed` or `estimated` (a live session without an F1TV token gets
  positions estimated from the free timing feed; label them as estimated in the UI); `t` is ms since `init.origin`; `drs` is null in
  2026 (no DRS under the 2026 rules). Start: `cd live && uv run python -m f1live`, or
  `uv run python -m f1live --simulate 2026:16:R --sim-speed 4` to feed a recorded race into
  `/ws/live`.

## Site

Next.js (latest stable), React 19, TypeScript strict, Tailwind v4. Server components read
`data/serve/f1.sqlite` (better-sqlite3 or similar, read only) and `data/predictions/*.json`
via a small `site/src/lib/data/*` layer. Live page connects to the live service WebSocket.
No Supabase, no news scraper, no paywall stubs.
