# f1ml: race forecasts, fantasy projections, backtests

Everything runs locally and uses free data only (Jolpica, F1DB, FastF1, OpenF1, the F1 static
live timing archive, the official fantasy feeds). Models train on the local GPU (RTX 5070 Ti).
See `REPORT.md` for accuracy numbers and limitations.

## Commands (run from `ml`)

| Command | What it does | Time |
|---|---|---|
| `uv run python -m f1ml.features` | Rebuild `cache/features.parquet` (all races 2006+ and the next race) | about 1 to 2 min |
| `uv run python -m f1ml.train` | Train the final bundle with `models/params.json`, save `models/<version>/`, update `models/latest.json` | about 5 min |
| `uv run python -m f1ml.train --tune` | Optuna tuning first (time based CV on 2021 to 2023), then train | about 20 min |
| `uv run python -m f1ml.backtest` | Walk-forward 2024, 2025, 2026: history files, `backtest.json`, `reports/backtest_summary.json` | about 80 min |
| `uv run python -m f1ml.predict` | Rebuild features, detect the next race and stage, write `next.json` and `fantasy.json` | about 1 to 2 min |
| `uv run python -m f1ml.studies --ablation --adaptation` | Feature ablations and regulation-reset study, `reports/studies.json` | about 20 min |

`predict` is idempotent; run it again after each session of a race weekend. It picks the
latest stage whose inputs exist: `pre-weekend`, `post-practice` (practice laps, plus sprint
qualifying and sprint results when they ran before qualifying), `post-qualifying` (grid known).
Retrain (`f1ml.train`) after each race once Jolpica has the results.

`predict` also reads the race's Polymarket winner market (`market.py`) and pools it with the
model's win chances, about 80% market before the weekend and 65% after practice and after
qualifying (weights from `scripts/exp_market` and `scripts/exp_combo`). Without a usable market
the forecast is the model's own. Each fetch is archived in `data/raw/polymarket/`.

## Layout

| Module | Role |
|---|---|
| `data.py` | Load processed tables; map F1DB, FastF1, OpenF1 and live timing session data onto Jolpica ids |
| `livetiming.py` | Parse cached `livetiming.formula1.com/static` streams (best laps, qualifying), last fallback |
| `practice_pace.py` | Practice one-lap gap per session corrected for tyre compound, tyre age and track evolution (FastF1 laps, 2018 on) |
| `features.py` | Point-in-time feature builder (`History`), stage gating (`stage_frame`) |
| `dynpl.py` | Point-in-time Plackett-Luce driver and team strengths, a Kalman style filter over every past race (`dp_*` features) |
| `market.py` | Polymarket race winner prices and the logarithmic pool with the model's win chances |
| `gbm.py` | XGBoost rankers on the GPU, DNF logistic model |
| `nn.py` | Set transformer over the field, Plackett-Luce listwise loss, GPU |
| `plackett.py` | Plackett-Luce likelihoods, blend weights, position dependent temperature |
| `bundle.py` | Train all base models, stack them on held out races, save / load |
| `simulate.py` | GPU Monte Carlo of a weekend (quali, sprint, race, retirements) and the championship |
| `fantasy.py`, `fantasy_history.py`, `fantasy_rules.py` | Fantasy points per simulated world (rules from `pipeline/src/f1p/fantasy`), extras models, price changes |
| `forecast.py` | One race forecast: stage inputs, strengths, simulation, fantasy, title odds |
| `explain.py` | SHAP based `factors` and `reasons` |
| `export.py` | JSON payloads per `SPEC.md` |
| `backtest.py`, `studies.py`, `train.py`, `predict.py` | Entry points |

## Outputs

- `data/predictions/next.json`: SPEC prediction contract (plus `factors` per driver and constructor).
- `data/predictions/fantasy.json`: SPEC fantasy contract (assets, breakdown, scenarios, horizon).
- `data/predictions/history/<season>-<round>.json`: the post-qualifying forecast the model would
  have published, plus `otherStages`, `metrics` and `actual`.
- `data/predictions/backtest.json`: per race metrics, baselines, calibration, fantasy accuracy.
