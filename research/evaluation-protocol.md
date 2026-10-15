# Evaluation protocol (locked 2026-10-08)

Every model change is judged with the same walk-forward run and the same scores, written down
before the change is measured.

## Run

- `uv run python -m f1ml.backtest --label <name>` from `ml`: walk-forward over 2024, 2025 and
  2026 R1 to R16 (64 races), retrain every 3 rounds on races before the target only, 20,000
  simulations per stage, seed = raceId. `--label` runs write only
  `ml/reports/scorecard/<name>_*.parquet` and never touch `data/predictions`.
- `uv run python -m f1ml.scorecard <name> --against <baseline>` writes
  `ml/reports/scorecard/<name>.{json,md}` with a paired bootstrap over races.
- A run without `--label` is the published backtest (history files for the site) and is scored
  as label `published`.

## Scores

Per race and stage, then averaged over races: ranked probability score of the position
distribution (RPS), negative log likelihood of the realised outcome under the simulator's own
model (retirements plus the Plackett-Luce order of classified cars, `nll`), win log loss, podium and
points binary log loss, Spearman of expected position, MAE of expected championship points.
Pooled: expected calibration error and logistic calibration slope for win, podium and points,
expected points by predicted bin with case counts. Fantasy: driver and constructor MAE at the
team lock and after qualifying, p10 to p90 coverage.

Title odds are scored separately (`uv run python -m f1ml.title_odds`): title log loss of the
eventual champion, CRPS and 80% coverage of each driver's realised remaining points, PIT.

## Splits

- Tuning (hyper-parameters, drift sizes, era discount): 2019 to 2023 (resets: 2014, 2017, 2022).
- Selection (compare candidate changes): 2024 to 2026 R16, the scorecard run above.
- Holdout: 2026 round 17 (Singapore) onward, scored once after the season.

## Accept rule

A change is kept when, on the selection run, post-qualifying and pre-weekend RPS and NLL do not
get worse (paired 95% interval of the mean difference not entirely on the worse side) and at
least one of them improves, with no season worse by more than 0.002 RPS. A change that is neutral
within noise can be kept only with a stated reason (for example: it adds data coverage the
model needs later, or it removes a known structural error). 64 races give wide intervals, so
"neutral" is the common outcome and is reported as such.

End of season: holdout scoring and the three-season refit are in `research/end-of-season.md`.
