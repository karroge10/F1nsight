# End of season 2026: holdout and refit

Run this after the last race of 2026 (round 23, 2026-12-06) once its results are in the data.
Nothing here may run earlier: the holdout (round 17 Singapore onward, 7 races) is scored once.

## 1. Refresh the data

    cd ml
    uv run python -m f1ml.features          # labels for every finished race

## 2. Score the holdout (one command)

    uv run python scripts/holdout/score.py --dry-run   # check only, prints the commands
    uv run python scripts/holdout/score.py             # the real run (GPU, two backtests)

The script refuses to run (exit 1, lists the races) while any 2026 race from round 17 on has no
results or no labels in the feature cache. Then it runs:

    F1ML_CHAIN=0 F1ML_GRIDTERM=0 python -m f1ml.backtest --seasons 2026 --first-race 202617 --sims 20000 --label holdout_baseline
    F1ML_CHAIN=1 F1ML_GRIDTERM=1 python -m f1ml.backtest --seasons 2026 --first-race 202617 --sims 20000 --label holdout
    python -m f1ml.scorecard holdout --against holdout_baseline

Training still uses every race before each target (walk-forward, retrain every 3 rounds, first
model fitted before round 17). Output: `ml/reports/scorecard/holdout.{json,md}` with RPS, NLL,
win, podium and points log loss per stage and the paired bootstrap against the baseline.
7 races give wide intervals: report the numbers, do not tune on them. Record the result at the
end of `research/fantasy-model-log.md`.

## 3. Refit on three full seasons

After the holdout is scored, 2026 becomes ordinary data.

- Selection run: 2024, 2025 and 2026 complete (71 races) instead of 2024 to 2026 R16. Rerun the
  published backtest so the site and the retrain gate compare on the full window:

      uv run python -m f1ml.backtest

  Update "Selection" in `evaluation-protocol.md` to "2024 to 2026 complete". From the first 2027
  race, decide whether to slide the window (`--seasons 2025 2026 2027`) or keep three full
  seasons fixed; write the choice into the protocol before running anything.
- Tuning split: move from 2019 to 2023 to 2019 to 2024 only if 2024 leaves the selection window;
  otherwise keep it. Either way the holdout for 2027 is declared in the protocol before round 1.
- Live model: `retrain-live.yml` keeps its due check (every 6 hours, plus the hourly cron
  Worker) and retrains after each new result. No change is needed for the season end; for one
  forced refit on all 2026 races: `gh workflow run retrain-live.yml`.
  The CPU timing trial `retrain.yml` stays manual (`gh workflow run retrain.yml`).
- Fantasy blend weights (`research/fantasy-backtest/run.ts`): walk-forward fits use only earlier
  seasons, so 2026 complete gives the 2027 fit three seasons. Re-export and rerun:

      cd pipeline && uv run python ../research/fantasy-backtest/export_history.py
      cd pipeline && uv run python ../research/fantasy-backtest/export_breakdown.py
      cd .. && npx tsx research/fantasy-backtest/run.ts

  Add 2027 to `SEASONS` only when it starts. Note the fitted weights (now 2026 drivers 0.75,
  constructors 0.79) in the README.
- Value of money: rejected because the points per $M slope flipped sign between 2024 (+3.9) and
  2025 (-2.3). With 2026 complete there is a third season to check whether the sign holds.
  Declare the test in the log first (slope c fitted on earlier seasons only, keep rule: no season
  significantly worse, sum over the last two seasons positive), then rerun `run.ts` with the value
  objective.
- Podium market (round 12 of the fantasy log): rejected on 15 to 30 races, but pooling Kalshi
  podium prices was better than our forecast at every stage, significantly only after
  qualifying. Rerun on the full 2025 and 2026 seasons with the same declared rule:
  `uv run python scripts/benchmark/collect_kalshi.py` (new races), then
  `uv run python scripts/exp_podium/pool.py` from `ml/`.
