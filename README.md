# F1nsight

A personal Formula 1 site that runs on this PC and costs nothing: a race forecast trained on the
local GPU, an F1 Fantasy planner, live timing with a moving track map (and replays of any recent
session), and the full stats archive since 1950. Every source is free and public; where a feature
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

All from the `v2` folder in PowerShell unless noted.

| What | Command |
| --- | --- |
| Start everything and open the browser | `.\start.ps1` (live service on 8765, site on 3000; reuses a running dev server; `-Rebuild` forces a fresh build) |
| Refresh after a session or race | `.\refresh.ps1` (`-Force`, `-Only fastf1,predict`, `-Skip openf1`) |
| Schedule this weekend's refreshes | `.\scripts\schedule-weekend.ps1` (`-List`, `-Remove`, `-RemoveAll`, `-Season 2026 -Round 18`) |
| Retrain, promote only if not worse | `.\scripts\retrain-gate.ps1 -Now` (or `cd ml; uv run python scripts/retrain_if_better.py`) |
| Forecast only | `cd ml; uv run python -m f1ml.predict` |
| Full history rebuild | `cd pipeline; uv run python -m f1p.history.update` |
| FastF1 bulk download (resumable) | `cd pipeline; uv run python -m f1p.fastf1.download` |
| FastF1 tables | `cd pipeline; uv run python -m f1p.fastf1.build_tables` |
| Site dev server | `cd site; npm run dev` |
| Live service | `cd live; uv run python -m f1live` |

### The refresh

`refresh.ps1` runs `python -m f1p.refresh`, which runs five steps in order, each as its own
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
5. **predict**: `f1ml.predict` (picks the stage by itself: pre-weekend, post-practice,
   post-qualifying) when any input changed since the last forecast; checks that `next.json` was
   rewritten.

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
0.0061, measured over three seeds of the 5 ranker, 10 network ensemble); then it copies the staged backtest and history files
into `data/predictions/` and runs `f1ml.predict`. Otherwise the current model stays. The decision
and metrics are in `ml/reports/retrain_gate.json`, the run log in `logs/retrain-<time>.log`.
Takes about 1.5 hours (backtest about 80 minutes).

## Scheduled tasks (Windows Task Scheduler)

Created by `scripts\schedule-weekend.ps1` and `scripts\retrain-gate.ps1 -Register`. They run as
the current user while logged on and start as soon as possible if the PC was off or asleep.
Singapore Grand Prix 2026 (round 17, sprint weekend), local time is UTC+4:

| Task | Local | UTC | After |
| --- | --- | --- | --- |
| `F1nsight-refresh-FP1` | Fri 09 Oct 14:30 | 10:30 | FP1 08:30 to 09:30 UTC |
| `F1nsight-refresh-FP1-retry` | Fri 09 Oct 17:30 | 13:30 | |
| `F1nsight-refresh-SQ` | Fri 09 Oct 18:15 | 14:15 | Sprint qualifying 12:30 to 13:15 UTC |
| `F1nsight-refresh-SQ-retry` | Fri 09 Oct 21:15 | 17:15 | |
| `F1nsight-refresh-Sprint` | Sat 10 Oct 15:00 | 11:00 | Sprint 09:00 UTC |
| `F1nsight-refresh-Sprint-retry` | Sat 10 Oct 18:00 | 14:00 | |
| `F1nsight-refresh-Quali` | Sat 10 Oct 19:00 | 15:00 | Qualifying 13:00 to 14:00 UTC |
| `F1nsight-refresh-Quali-retry` | Sat 10 Oct 22:00 | 18:00 | |
| `F1nsight-refresh-Race` | Sun 11 Oct 19:15 | 15:15 | Race 12:00 UTC, about 2 h |
| `F1nsight-refresh-Race-retry` | Sun 11 Oct 22:15 | 18:15 | |
| `F1nsight-refresh-weekly` | Mondays 10:00 | 06:00 | `refresh.ps1 -Force`, then registers the next weekend's tasks |
| `F1nsight-retrain-gate` | every 6 h | | runs the retrain gate once per new race result, so after every race weekend |

Because the weekly task re-registers the per-session tasks for the next race (same names,
overwritten), the schedule keeps itself current. List, inspect and remove:

```powershell
.\scripts\schedule-weekend.ps1 -List                     # next run, last run, last result
Get-ScheduledTask -TaskName 'F1nsight-*'                 # same, plain
Start-ScheduledTask -TaskName 'F1nsight-refresh-FP1'     # run one now
.\scripts\schedule-weekend.ps1 -Remove                   # per-session tasks only
.\scripts\retrain-gate.ps1 -Unregister                   # the retrain gate task
.\scripts\schedule-weekend.ps1 -RemoveAll                # every F1nsight task
```

The separate `F1v2-probe-SGP-FP1` / `F1v2-probe-SGP-SQ` tasks (static archive probe) are not
managed here.

## Cloud refresh (GitHub Actions)

`.github/workflows/refresh.yml` runs the same refresh, forecast and upload on GitHub's servers
(free for a public repo), so the hosted site updates with the PC off. Retraining stays on the PC.

- **State**: the data a refresh builds on is kept as assets of the GitHub release `state`
  (`cloud/state.py`): `logs/refresh_state.json`, `data/processed`, `data/serve`,
  `data/predictions`, the current model (`ml/models/latest.json`, its folder, `params.json`,
  the backtest rows in `ml/reports`) and `data/raw` without logs. Each group is one tar.gz; only
  groups whose files changed are uploaded again. `data/fastf1_cache` is not kept: the refresh
  downloads the sessions it needs.
- **Run**: pull the state, `python -m f1p.refresh` (Linux, CPU forecast), site images, build,
  `check-export.mjs`, `wrangler pages deploy` from the repo root, push the changed groups.
  Secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- **Schedule** (commented out until it goes live): every 30 minutes the gate runs
  `python -m f1p.weekend --due`, which runs the refresh only when one of the PC task times
  (session end + 1 h, a retry 3 h later, race morning, Monday 06:00 UTC forced) passed since
  the last cloud run.
- **Models from the PC**: after a promotion `scripts\retrain-gate.ps1` pushes the groups
  `model` and `predictions`; the next cloud run sees the new `latest.json` and forecasts with it.
  With `-PullState` the gate first pulls the cloud's data, for a PC that no longer refreshes.

| What | Command |
| --- | --- |
| Run it now | `gh workflow run refresh.yml` (`-f force=true`, `-f only=fastf1,predict`, `-f publish=false`) |
| Watch it | `gh run watch` or `gh run view --log` |
| State per group, local and remote | `pipeline\.venv\Scripts\python.exe cloud\state.py status` |
| Push the PC's data (first seed) | `pipeline\.venv\Scripts\python.exe cloud\state.py push --all` |
| Get the cloud's data on the PC | `pipeline\.venv\Scripts\python.exe cloud\state.py pull` |

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

Before the weekend (Wednesday or Thursday):

1. `.\start.ps1` and check the forecast page shows the coming race (stage `pre-weekend`).
2. `.\scripts\schedule-weekend.ps1 -List`: the per-session tasks show this weekend's dates. If
   not, run `.\scripts\schedule-weekend.ps1`.
3. Leave the PC on (or asleep, the tasks catch up when it wakes) and logged in.

During the weekend, nothing to do. After each session a task runs the refresh; the forecast
moves to `post-practice` after the last session before qualifying and to `post-qualifying` after
qualifying. To check a run: `logs\refresh-last.json`, or the newest `logs\refresh-*.log`.
To run one by hand: `.\refresh.ps1`.

After the race:

1. The race and retry tasks pick up results once Jolpica has them; the Monday weekly task runs
   `refresh.ps1 -Force` regardless. Check `/races/<season>/<round>` shows the results and the home
   page track record has the race.
2. Retrain when it is worth it (new results, more FastF1 data): `.\scripts\retrain-gate.ps1 -Now`
   (about 1.5 hours, GPU). It keeps the current model unless the new one is at least as good.
3. If a step failed: read the summary at the end of the log. Steps are independent, so the rest
   of the data is still fresh; fix the cause and run `.\refresh.ps1 -Only <step>`.

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
