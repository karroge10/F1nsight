# Why the model forecast lost to form (diagnosis)

Data: every active asset in every scored round, forecast `fantasyAtLock` (post-practice, before
qualifying) vs the real fantasy points. Form = `formForecast` (0.5 x last 3 + 0.5 x season mean).
Numbers from `diagnosis.json` (rerun `run.ts`). Per-round Spearman = rank correlation inside each
round, averaged.

## The forecast itself is better than form, every season

| season | kind | n | MAE model | MAE form | Spearman model | Spearman form | bias model | slope actual~model |
|---|---|---|---|---|---|---|---|---|
| 2024 | drivers | 479 | 8.63 | 9.23 | 0.62 | 0.61 | +1.34 | 1.08 |
| 2024 | constructors | 240 | 14.33 | 14.73 | 0.72 | 0.69 | +2.61 | 1.13 |
| 2025 | drivers | 479 | 10.02 | 11.39 | 0.52 | 0.48 | +1.32 | 1.02 |
| 2025 | constructors | 240 | 17.06 | 18.05 | 0.65 | 0.60 | +2.39 | 1.07 |
| 2026 | drivers | 374 | 11.59 | 12.52 | 0.56 | 0.55 | +0.67 | 1.30 |
| 2026 | constructors | 187 | 18.75 | 19.22 | 0.76 | 0.73 | +1.93 | 1.29 |

So the points ranking is not where form wins.

## Systematic issues

- **Team value.** This is the gap. Final team value, 1-race optimiser: model 122.0 / 118.8 / 116.2,
  form 122.8 / 137.5 / 130.9 (2024 / 2025 / 2026). Form chases assets that just scored well, and
  those are the ones whose price rises, so form compounds an extra 15 to 19M of budget in 2025 and
  2026. The model forecast predicts points only and the expected objective ignores price changes.
  2024 is level because the 2024 lock files have no expected price change and the 2024 price rule differs.
- **Under-dispersion.** Driver forecasts have SD 8.1 to 9.1 vs actual 15.9 to 18.7 (form 11 to 14).
  In 2026 the slope of actual on forecast is 1.30: the forecast is too flat. With a fixed 5+2
  team an affine rescale per kind does not change the best team, so calibration alone changed
  nothing (identical totals); it only matters against the -10 transfer penalty.
- **DNFs and bad races.** Rows with actual < 0 (105 to 116 a season): model MAE 24.8 to 26.1,
  form 21.7 to 22.8, correlation near 0 for both. Non-finish risk is priced in too softly, which is
  most of the overall +1.1 to +1.8 points optimism per asset. On rows with actual >= 0 the model is
  pessimistic (-2.2 / -2.9 / -5.0).
- **Sprint weekends.** Model bias +1.9 to +3.3 vs form -2.8 to -4.4; MAE model still lower
  (12.1 / 14.2 / 15.5 vs 13.2 / 15.0 / 15.7), Pearson level. Not the main problem.
- **Season start.** Rounds 1 to 3: model clearly better (2025 MAE 12.3 vs 15.8).
- **Missing components (overtakes etc.).** Not measurable from these files (no component
  breakdown in the lock forecast); the positive-row pessimism above is consistent with
  missing upside such as overtake and fastest-lap points.
- **3-race plan = 1-race in 2024.** The only leak-free horizon is this round's forecast repeated,
  and 2024 lock files carry no price change, so every future round looks the same and lookahead
  has nothing to act on. With no carry-over of free transfers it differs only through price changes
  (2025 and 2026, where it differs slightly).

## What followed (see README for every total)

- Blend with form (weight fitted on earlier seasons) recovers part of the team value growth.
- The `value` objective (points plus expected team value change) helped 2026 (+306) but hurt
  2025 (-91), so the walk-forward choice did not adopt it.
