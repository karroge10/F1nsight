# Integration follow-ups (coordinator notes)

Collected from agent reports; handle in the final integration and test pass.

- History: `races.raceUtc` for Las Vegas 2024 is a day early (should be 2024-11-24 06:00 UTC).
  Check every night race / date-line-crossing event for the same bug (Las Vegas 2023/2025,
  Singapore is fine?). Fix in `pipeline/src/f1p/history/`.
- History: no qualifying lap times for 2025 Miami; Jolpica lists 11 drivers in Q3 for 2026 Miami.
- Fantasy: free-data-only fantasy scoring error is about 2.6 pts/driver and 4.0 pts/constructor
  per race (overtakes, DOTD, pit bands are reconstructed). The site should say so where it shows
  fantasy predictions.
- OpenF1 licence is CC BY-NC-SA 4.0 (non-commercial): credit it in the site footer/about page.
  F1DB is CC BY 4.0: credit it. Jolpica: credit it. DHL pit stop data: credit it.
- After the ML agent finishes: re-check title odds and per-race sharpness (owner saw Antonelli
  100% / Russell 0.5% title, Russell 9% win, top-3 expected P8.2; leader expected only ~8
  pts/round vs 20 actual). Confirm the fix landed and the site shows ">99%" / "<1%".
- Windows scheduled tasks `F1v2-probe-SGP-FP1` (Fri 2026-10-09 12:25 local = 08:25 UTC) and
  `F1v2-probe-SGP-SQ` (16:25 local) run the static-archive live probe. Afterwards read
  `data/raw/livetiming/probe/*.jsonl` verdicts and remove both tasks
  (`Unregister-ScheduledTask -TaskName F1v2-probe-* -Confirm:$false`).
- One post-race refresh command that runs everything in order (history, openf1, fantasy,
  fastf1 incremental, ml features/predict) for after each session/race.

## Status after the integration and QA pass (2026-10-07)

- Las Vegas and other session times: fixed at build time in `pipeline/src/f1p/history/corrections.py`
  (2023 and 2024 Las Vegas, 2024 Sao Paulo rain delay, 2026 Miami race start, 2026 Monaco
  timezone, 2005/2006 local clock stored as UTC); `verify.py` now checks session order and local
  weekdays for every round. Done.
- 2025 Miami qualifying times: filled from F1DB (`f1db._fill_qualifying_times`). Done.
- 2026 Miami 11 drivers in Q3: real reclassification (Hadjar disqualified, Hulkenberg promoted to
  10th with no Q3 time); only 9 Q3 times in the data, nothing derived was wrong. Closed.
- Fantasy accuracy note and the OpenF1 / F1DB / Jolpica / DHL credits: text in `site/CREDITS.md`,
  placement in the footer and about page is with the designer. Open (UI).
- Title odds and sharpness: next.json now has Antonelli pTitle 0.996 (renders ">99%"), leader
  expected 16 points for the round. Exact 0 probabilities rendered as "0%" in the title odds;
  `formatPercent` now clamps them to "<1%". Done.
- Probe tasks `F1v2-probe-SGP-*`: removed on 2026-10-13. Closed.
- One refresh command: `refresh.ps1` / `python -m f1p.refresh`, scheduled per session by
  `scripts/schedule-weekend.ps1`. Done, see `README.md`.

## Hosting (done 2026-10-13)

Everything runs free in the cloud with the PC off; details in README.md, "Cloud runs".

- **Site:** static export on Cloudflare Pages, https://f1nsight.pages.dev.
- **Refresh, forecast, retrain:** GitHub Actions; state in the GitHub release `state` (not R2).
  Retraining starts from the refresh that brings a new race's results.
- **Timing:** the Cloudflare Worker `f1nsight-cron` dispatches the workflows on time; GitHub's own
  schedules are a backup.
- **Live service (f1live):** not hosted. The hosted live page only plays the replays built into
  the site; live timing during a session needs the service (planned: Oracle Cloud Always Free VM).

## Backlog (owner's priorities, 2026-10-13)

- **Model: be better than the other public F1 prediction models.** Work through
  `research/prediction-model-roadmap.md`, judging every change by `research/evaluation-protocol.md`.
  First experiment: team strength counts the team-mate's results, which underrates a strong
  driver in a weak second car (Verstappen); try the team's best car instead. To claim "better than
  others" we also need their numbers: archive an outside benchmark each weekend (betting market
  prices, for example Polymarket's public API) and score it next to ours.
- **Fantasy: redesign.** The owner does not like the current fantasy implementation (feature and
  page); revisit after the model work.
- **Live timing on the hosted site:** host f1live (see Hosting).
- **Austin (2026 R18, 23 to 25 Oct):** first race weekend fully in the cloud. Afterwards check that
  every planned run, the penalty news checks and the post-race retrain fired on time.
