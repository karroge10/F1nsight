# Year, regulation era, and condition evaluation

This report separates the current pipeline's saved production backtest from the v2 research evaluation. The v2 evaluation is experimental and is not the deployed model. The stack-window refit is incomplete, no GBM base models were retrained, and no model is promoted.

Research source: `ml\reports\v2\eval_v2.json`; 168 races from 2019 R1 through 2026 R16, with archived rain available for 168. Rain uses ERA5 precipitation in the race window; wet means at least 1 mm.

Metrics are equal-weight means across races. Post-qualifying log-loss difference is model minus the race-specific grid baseline. Negative values favor the model. Intervals bootstrap paired race differences with 5,000 resamples and seed 73021.

## Current pipeline backtest

Source: `data\predictions\backtest.json`, generated 2026-10-26T01:28:13Z; 66 races from 2024 R1 through 2026 R18. This is the current pipeline's saved backtest, not a verified live-publication audit. Rain is available for 64 races.

| Slice | Races | Wet | Sprint | PQ win LL | Grid LL | PQ minus grid, 95% interval | Winner accuracy | PQ Spearman |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| All | 66 | 9 | 18 | 1.185 | 1.519 | -0.334 [-0.811, 0.022] | 0.561 | 0.704 |
| 2024 | 24 | 4 | 6 | 1.501 | 1.932 | -0.431 [-1.426, 0.241] | 0.417 | 0.757 |
| 2025 | 24 | 3 | 6 | 0.964 | 1.085 | -0.120 [-0.334, 0.058] | 0.625 | 0.670 |
| 2026 | 18 | 2 | 6 | 1.059 | 1.549 | -0.489 [-1.617, 0.158] | 0.667 | 0.678 |
| Sprint | 18 | 3 | 18 | 1.511 | 2.229 | -0.718 [-2.020, 0.060] | 0.444 | 0.679 |
| No sprint | 48 | 6 | 0 | 1.063 | 1.253 | -0.190 [-0.653, 0.127] | 0.604 | 0.713 |
| Wet, ERA5 >= 1 mm | 9 | 9 | 3 | 1.098 | 2.547 | -1.449 [-3.819, -0.052] | 0.556 | 0.666 |
| Dry, ERA5 < 1 mm | 55 | 0 | 14 | 1.224 | 1.383 | -0.159 [-0.595, 0.127] | 0.545 | 0.703 |

## v2 research evaluation

| Slice | Races | Wet | Sprint | Pre-weekend win LL | Post-practice win LL | Post-qualifying win LL | Grid LL | PQ minus grid, 95% interval | PQ Spearman |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| All races | 168 | 19 | 29 | 1.558 | 1.521 | 1.197 | 1.646 | -0.448 [-0.758, -0.191] | 0.666 |
| 2019-2021 | 60 | 6 | 3 | 1.529 | 1.506 | 1.382 | 1.526 | -0.145 [-0.331, 0.038] | 0.659 |
| 2022-2025 | 92 | 11 | 21 | 1.505 | 1.489 | 1.089 | 1.720 | -0.631 [-1.138, -0.212] | 0.672 |
| 2026 partial | 16 | 2 | 5 | 1.977 | 1.760 | 1.128 | 1.665 | -0.537 [-1.816, 0.213] | 0.656 |
| 2019 | 21 | 2 | 0 | 1.612 | 1.652 | 1.106 | 1.316 | -0.210 [-0.441, 0.032] | 0.648 |
| 2020 | 17 | 3 | 0 | 1.441 | 1.417 | 1.492 | 1.671 | -0.179 [-0.515, 0.166] | 0.615 |
| 2021 | 22 | 1 | 3 | 1.519 | 1.435 | 1.559 | 1.615 | -0.056 [-0.428, 0.285] | 0.702 |
| 2022 | 22 | 4 | 3 | 1.470 | 1.481 | 1.122 | 2.132 | -1.009 [-2.272, -0.137] | 0.604 |
| 2023 | 22 | 0 | 6 | 0.668 | 0.720 | 0.347 | 1.776 | -1.430 [-2.603, -0.626] | 0.643 |
| 2024 | 24 | 4 | 6 | 2.162 | 1.963 | 1.733 | 1.932 | -0.198 [-1.288, 0.589] | 0.750 |
| 2025 | 24 | 3 | 6 | 1.646 | 1.729 | 1.095 | 1.081 | 0.014 [-0.206, 0.215] | 0.683 |
| 2026 | 16 | 2 | 5 | 1.977 | 1.760 | 1.128 | 1.665 | -0.537 [-1.824, 0.203] | 0.656 |
| Sprint | 29 | 4 | 29 | 1.787 | 1.971 | 1.764 | 2.099 | -0.335 [-1.280, 0.382] | 0.622 |
| No sprint | 139 | 15 | 0 | 1.511 | 1.427 | 1.079 | 1.551 | -0.472 [-0.798, -0.203] | 0.675 |
| Wet, ERA5 >= 1 mm | 19 | 19 | 4 | 1.161 | 1.287 | 1.022 | 1.866 | -0.844 [-2.081, 0.026] | 0.651 |
| Dry, ERA5 < 1 mm | 149 | 0 | 25 | 1.609 | 1.551 | 1.220 | 1.618 | -0.398 [-0.720, -0.141] | 0.668 |
| Sprint and wet | 4 | 4 | 4 | 1.202 | 1.850 | 1.373 | 4.126 | -2.753 [-8.163, 0.057] | 0.593 |

## Stack training window comparison

The script refits only the v2 meta-stack using its prior N seasons of the same cached point-in-time out-of-sample base-model scores, then tests identical races. Each window uses 5,000 simulations per race. This tests the stack's history window, not the GBM base-model training history.

The 3/5/10 season stack sweep was canceled after 150 seconds during the first configuration. Window 3 completed scoring 64 saved holdout race IDs, but its metrics were not persisted before cancellation. Windows 5 and 10 did not complete.

No window performance metrics were persisted, so this sweep supports no choice of stack history or deployment recommendation.

## Reading this result

The era groups are proxies for broad regulation periods: 2019-2021, 2022-2025, and the partial 2026 season. They are not causal estimates of regulation effects. Calendar-year changes in entrants, circuits, sprint format, training history, and data coverage are mixed together.

The period boundaries follow FIA/F1 descriptions of the 2022 ground-effect technical rules and the new 2026 chassis and power-unit package: [FIA 2022 technical regulations](https://www.fia.com/sites/default/files/2022_formula_1_technical_regulations_-_iss_6_-_2021-09-13_0.pdf), [FIA 2026 regulations overview](https://www.fia.com/news/new-era-competition-fia-showcases-future-focused-formula-1-regulations-2026-and-beyond). The FIA also approved 2026 amendments after pre-season testing and early rounds, so the partial 2026 group is not a single immutable ruleset: [FIA 2026 amendments](https://api.fia.com/news/fia-statement-amendments-2026-f1-regulations).

The feature pipeline already exposes regulation-reset proxies: `ERA_STARTS=(2006, 2009, 2014, 2017, 2022, 2026)`, `rounds_since_reset`, and `reset_season`. Its current `ERA_DISCOUNT=1.0` leaves optional pre-era form downweighting off. No direct power-unit or aerodynamic design feature represents the technical rule changes. Hyperparameters were tuned on 2021-2023, so 2019-2023 results are development diagnostics; 2024-2026 is the cleaner post-tuning holdout window.

Condition slices overlap the era slices and each other. Sprint counts are explicit. Weather uses realized ERA5 precipitation, not the forecast the model received, so wet/dry grouping is for post-hoc robustness checks only. Sprint-and-wet is especially small and should not be read as a stable performance estimate.

This experiment does not compare alternative GBM base-model training histories, and it does not establish that adding older years or a specific era improves a new base model. Those require rerunning the same candidate under frozen time-based train/validation splits.

Rebuild the report and saved-data breakdown without starting the long stack refit with `uv run python -m scripts.exp_year_condition --skip-windows` from `ml/`.

For each stage, the JSON also records winner accuracy, Brier score, MAE, and per-slice sample counts.
