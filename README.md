# F1nsight

A personal Formula 1 site that costs nothing: refreshed, retrained and published by GitHub
Actions (see "Cloud runs"), with this PC as a manual fallback. A race forecast, an F1 Fantasy
planner, live timing with a moving track map (and replays of any recent session), and the full
stats archive since 1950. Every source is free and public; where a feature
would need a paid service, a free estimate is used and labelled as such. Shared rules for
contributors are in `SPEC.md`.

## Architecture

```
 free sources                     pipeline/ (Python, uv)                    site/ (Next.js)
 ─────────────                    ──────────────────────                    ───────────────
 Jolpica API + dump ─┐            f1p.history   ─> data/processed/*.parquet ─┐
 F1DB releases ──────┤            f1p.openf1    ─> data/processed/openf1_*   │   reads on every
 OpenF1 (history) ───┤            f1p.fantasy   ─> data/processed/fantasy_*  ├─> request:
 F1 Fantasy feeds ───┤            f1p.fastf1    ─> data/processed/ff1_*      │   data/serve/f1.sqlite
 DHL pit stops ──────┤                              data/serve/f1.sqlite ────┤   data/predictions/*.json
 F1 live timing ─────┘                                                       │
 archive (FastF1)                 ml/ (Python, uv, GPU)                      │
                                  f1ml.features / train / backtest / predict │
                                  ─> data/predictions/next.json, fantasy.json,
                                     backtest.json, history/<season>-<round>.json

 F1 live timing (SignalR, free) ─> live/ (FastAPI, :8765) ── WebSocket ──> site /live
 F1 static archive (replays)    ─┘
```

- `pipeline/`: downloads and cleans every source into `data/processed/*.parquet`, builds
  `data/serve/f1.sqlite`. Entry points are `python -m f1p.<module>`. `pipeline/src/f1p/refresh.py`
  runs them all in order.
- `ml/`: point-in-time features, XGBoost rankers plus a set transformer on the GPU, Monte Carlo
  simulation of the weekend and the championship, fantasy points and price changes. See
  `ml/README.md` and `ml/REPORT.md` (accuracy).
- `live/`: live timing relay and replay server, see `live/README.md`.
- `site/`: the website, see `site/README.md` and `site/DESIGN.md`. Pages render per request, so
  new data shows up on the next page load without a rebuild or restart.
- `data/`: everything downloaded and generated (not in git). `logs/`: refresh, retrain and
  service logs.

## Commands

All from the repo root in PowerShell unless noted.

| What | Command |
| --- | --- |
| Start everything and open the browser | `.\start.ps1` (live service on 8765, site on 3000; reuses a running dev server; `-Rebuild` forces a fresh build) |
| Refresh after a session or race | `.\refresh.ps1` (`-Force`, `-Only fastf1,predict`, `-Skip openf1`) |
| Windows tasks for a weekend (fallback only, off while the cloud schedules run) | `.\scripts\schedule-weekend.ps1` (`-List`, `-Remove`, `-RemoveAll`, `-Season 2026 -Round 18`) |
| Retrain, promote only if not worse | `.\scripts\retrain-gate.ps1 -Now` (or `cd ml; uv run python scripts/retrain_if_better.py`) |
| Forecast only | `cd ml; uv run python -m f1ml.predict` |
| Full history rebuild | `cd pipeline; uv run python -m f1p.history.update` |
| FastF1 bulk download (resumable) | `cd pipeline; uv run python -m f1p.fastf1.download` |
| FastF1 tables | `cd pipeline; uv run python -m f1p.fastf1.build_tables` |
| Site dev server | `cd site; npm run dev` |
| Live service | `cd live; uv run python -m f1live` |

### The refresh

`refresh.ps1` runs `python -m f1p.refresh`, which runs seven steps in order, each as its own
process so one failing source never stops the others:

1. **history**: `f1p.history.update` (Jolpica + F1DB, rebuilds `f1.sqlite`, runs the data checks).
   Skipped unless a finished race has no results locally and Jolpica now has them, or the last
   success is older than 7 days.
2. **openf1**: `f1p.openf1.download --refresh` for the current season, then `f1p.openf1.process`
   only when a raw file actually changed.
3. **fantasy**: `f1p.fantasy.update`, skipped unless a session ended since its last success, an
   OpenF1 table changed, or it is older than 3 days.
4. **fastf1**: `f1p.fastf1.incremental`: this weekend's finished sessions, then `build_tables`
   when a session was added. Safe next to the bulk download (per-session claim files,
   `build_tables.lock`); a session whose archive is still incomplete is left for the retry.
5. **penalties**: updates the announced grid penalties.
6. **weather**: `f1ml.weather` collects missing observations and archived forecasts, and refreshes
   the next race's live forecast at most every 3 hours. Timestamped copies are retained in
   `data/raw/openmeteo/forecast-history/<raceId>/`, alongside the latest forecast. The cloud's
   `raw-other` state group preserves these files. Weather remains a research input.
7. **predict**: `f1ml.predict` (picks the stage by itself: pre-weekend, post-practice,
   post-qualifying) when any input changed since the last forecast; checks that `next.json` was
   rewritten.

Weather collection also runs during the cloud's two-hour news checks before a race, alongside
penalties and prediction. API calls reuse the three-hour live forecast cache.

Output: `logs/refresh-<time>.log` (every line), `logs/refresh-last.json` (step summary),
`logs/refresh_state.json` (what the skip rules remember). Exit code 0 when every step succeeded
or had nothing new, 1 when a step failed (the summary names it), 3 when another refresh still held
`logs/refresh.lock` after 40 minutes.

### The retrain gate

`ml/scripts/retrain_if_better.py`: rebuilds the FastF1 tables if stale, then features, trains a
candidate (immediately putting `models/latest.json` back to the current model), backtests the
candidate into `ml/staging/<version>/` and compares it with the published backtest on the races
both cover. It promotes only if post-qualifying win log loss, post-qualifying Spearman and
pre-weekend win log loss are all no worse than their seed-noise tolerance (0.031, 0.0013 and
0.0061, measured over three seeds of the 5 ranker, 10 network ensemble); then it copies the
staged backtest and history files into `data/predictions/` and runs `f1ml.predict`. Otherwise
the current model stays. The decision and metrics are in `ml/reports/retrain_gate.json`, the run
log in `logs/retrain-<time>.log`. Takes about 2 hours on a GitHub runner (backtest about 105
minutes). `--no-promote` is a dry run, `--force-promote` promotes whatever the comparison says.

## Cloud runs (GitHub Actions): the primary path

Everything scheduled runs on GitHub's servers (free for a public repo), so the hosted site
https://f1nsight.pages.dev updates with the PC off. Secrets: `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID` and `F1_DISPATCH_TOKEN` (fine-grained, this repo, Actions read and write).

GitHub's `schedule` runs late or skips runs for hours, so the Cloudflare Worker `f1nsight-cron`
(`cloud/cron-worker`, deployed from the PC with `npx wrangler deploy` in that folder) dispatches
Refresh and Retrain with `gate=true` on time; the GitHub schedules below stay as a backup. A gated run that
finds nothing due stops in about a minute. When the GitHub token expires (its date is on
github.com/settings/personal-access-tokens), make a new one and run `cloud\cron-worker\set-token.ps1`.

| Workflow | When (UTC) | What |
| --- | --- | --- |
| `refresh.yml` (Refresh) | every 30 minutes, `7,37 * * * *` | the gate (`python -m f1p.weekend --due`) stops in about a minute unless a planned run fell due since the last cloud run: session end + 1 h, a retry 3 h later, race morning, Monday 06:00 forced, and from 3.5 days before a race until its start a news check every 2 hours (only `penalties,predict`; the site is rebuilt only if the forecast changed). Then pull the state, `python -m f1p.refresh` (CPU forecast), site images, build, `check-export.mjs`, `wrangler pages deploy` from the repo root, push the changed groups |
| `retrain-live.yml` (Retrain) | started by Refresh when it brings new results; also hourly (Worker) and every 6 hours (`23 */6 * * *`) | `retrain_if_better.py --check-due`: only when results have a race newer than the model and the gate has not run for it. Runs the gate (about 2 h); on a promotion pushes `model` and `backtest`, then starts Refresh so the forecast and the site use the new model |
| `keepalive.yml` | monthly, `0 5 1 * *` | re-enables the scheduled workflows, which GitHub would switch off after 60 days without activity |
| `retrain.yml` (Retrain trial) | manual | the gate with `--no-promote`, one job per seed: timing and noise checks, pushes nothing |

- **State**: the data the runs build on is kept as assets of the GitHub release `state`
  (`cloud/state.py`), one tar.gz per group; only groups whose files changed are uploaded again.
  Groups: `refresh-state` (`logs/refresh_state.json`), `processed`, `serve`, `predictions`
  (`next.json`, `fantasy.json`), `backtest` (`backtest.json`, `history/`), `model`
  (`latest.json`, its folder, `params.json`, the backtest rows and the gate report in
  `ml/reports`) and `data/raw` without logs in four groups. The refresh never writes `model` or
  `backtest` and the retrain never writes the data groups, so neither push overwrites the other.
  `data/fastf1_cache` is not kept: the refresh downloads the sessions it needs.

| What | Command |
| --- | --- |
| Refresh now | `gh workflow run refresh.yml` (`-f force=true`, `-f only=fastf1,predict`, `-f publish=false`) |
| Retrain now | `gh workflow run retrain-live.yml` (`-f force=true` promotes even if the comparison rejects) |
| Watch a run | `gh run watch` or `gh run view --log` |
| State per group, local and remote | `pipeline\.venv\Scripts\python.exe cloud\state.py status` |
| Get the cloud's data on the PC | `pipeline\.venv\Scripts\python.exe cloud\state.py pull` |

## PC scripts (manual fallback)

The PC no longer runs anything on a schedule (the Windows tasks were removed on 13 Oct 2026).
The scripts still work for a manual run, for example when GitHub Actions is down or to train
on the GPU:

```powershell
.\refresh.ps1                                  # refresh, forecast and publish from this PC
.\scripts\retrain-gate.ps1 -Now -PullState     # pull the cloud's data, retrain on the GPU, and
                                               # after a promotion push model + backtest to the cloud
pipeline\.venv\Scripts\python.exe cloud\state.py pull    # first, so a PC refresh starts from the cloud's data
```

Pull the cloud state before a PC refresh and keep the cloud schedules in mind: a PC refresh
publishes to the same Pages project but does not push its data back, so the next cloud run
works from its own state. `scripts\schedule-weekend.ps1` and `retrain-gate.ps1 -Register`
would bring the Windows tasks back; do not use them while the cloud schedules are on.

## Tests

| Suite | Command | Last run |
| --- | --- | --- |
| Site unit tests (vitest) | `cd site; npm test` | 15 files, 143 tests pass |
| Site types and lint | `cd site; npm run typecheck; npm run lint` | clean |
| Live service (pytest) | `cd live; uv run pytest` | 46 pass |
| Pipeline refresh tooling (pytest) | `cd pipeline; uv run --no-sync --with pytest python -m pytest tests -q` | 7 pass |
| History data checks | part of `f1p.history.update` (exit code 1 on a failed check) | all pass |
| End-to-end QA (site running) | `cd site; node scripts/qa-e2e.mjs http://localhost:3000` | writes `logs/qa/qa-results.json` |

`qa-e2e.mjs` checks every route and a sample of dynamic routes from 1950 to 2026, console errors,
the forecast's model version and probability formatting, the fantasy planner through its web
worker, a 2026 R16 replay over the live WebSocket, and the track record.

## Data sources and their limits

| Source | Used for | Limits |
| --- | --- | --- |
| Jolpica F1 API and monthly dump | results, qualifying, standings, laps, pit stops, calendar | about 4 requests/s and 500/h; results usually appear a few hours after a race; a few session times in the source are wrong and corrected at build time (`pipeline/src/f1p/history/corrections.py`) |
| F1DB (CC BY 4.0) | fills Jolpica gaps, records, qualifying times | released per round, can lag a few days |
| OpenF1 (CC BY-NC-SA 4.0) | laps, stints, pits, positions, overtakes, weather | free for history only; during a session and for about 45 minutes after, the API needs a paid account, so the refresh runs after that. Non-commercial licence |
| FastF1 / F1 live timing archive | laps, sectors, tyres, positions, track maps | the archive is complete about 30 to 60 minutes after a session; FastF1 limits itself to 500 requests per hour, shared with the bulk download |
| F1 Fantasy public feeds | prices, points | overtakes, Driver of the Day and pit stop bands are reconstructed: about 2.6 points per driver and 4.0 per constructor per race off the official score |
| DHL pit stop award pages | pit stop times | published per race, sometimes a day late |
| F1 live timing (SignalR) | live tower, race control, weather | car positions need an F1TV subscription, so live positions are estimated from the timing feed (labelled "estimated") |
| F1 media CDN | headshots, team logos | F1's property; personal, non-commercial use only |

Credits text for the site: `site/CREDITS.md`.

## Weekend checklist

Nothing has to run on the PC. Before the weekend, check https://f1nsight.pages.dev shows the
coming race (stage `pre-weekend`) and that the last Refresh runs are green
(`gh run list --workflow refresh.yml`).

During the weekend the Refresh workflow runs about an hour after each session and again three
hours later; the forecast moves to `post-practice` after the last session before qualifying and
to `post-qualifying` after qualifying. To check a run: `gh run view <id> --log`; the summary is
printed by the Result step and the logs are kept as an artifact.

After the race:

1. The race and retry runs pick up results once Jolpica has them; the Monday 06:00 UTC run is
   forced. Check `/races/<season>/<round>` shows the results.
2. Within six hours of the results the Retrain workflow runs the gate (about 2 hours) and, on a
   promotion, starts a Refresh with the new model.
3. If a step failed: the summary names it. Steps are independent, so the rest of the data is
   still fresh; fix the cause and run `gh workflow run refresh.yml -f only=<step>`.

## Troubleshooting

- **"Another refresh is still running"** (exit 3): a refresh holds `logs/refresh.lock`. A lock
  whose process is gone is taken over automatically.
- **`f1.sqlite` cannot be replaced**: the history step falls back to copying into the open file
  with SQLite's backup API, so a running site or DB browser no longer blocks it.
- **FastF1 sessions stuck as pending**: the archive was incomplete; after 3 hours the session is
  written with whatever exists. `cd pipeline; uv run python -m f1p.fastf1.incremental --accept-partial`
  forces it.
- **Live page shows a finished session**: the live service was started with `--simulate`; restart
  it without that flag (`cd live; uv run python -m f1live`).
