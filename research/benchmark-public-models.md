# Benchmark against public F1 forecasts (2026-10-15)

Selection split only: 2024 to 2026 R16. Singapore 2026 (R17) and later are holdout and are not scored.
Ours: `chain_bt` (current method) and `pub64` (previous method), from `ml/reports/scorecard/`.

## Sources

| Source | What it publishes | Coverage | Timing | Format, terms | Effort | Used |
|---|---|---|---|---|---|---|
| Kalshi `KXF1RACE` (race winner) | Per-driver price, hourly bid/ask candles | 2025 R1 to 2026 R17 (41 events), 33 of our races scored | Whole race week, so all three stages | Public read-only REST API, no login | Low | Yes |
| Kalshi `KXF1RACEPODIUM` | Per-driver podium price | 2025 R3 onward (39 events), 27 races scored | Whole race week | Same API | Low | Yes |
| Polymarket winner | Per-driver price history | 2024 to 2026, 43 races | Whole race week | Public Gamma and CLOB APIs (earlier study, reused) | Done | Yes |
| Polymarket podium | Per-driver podium price | 2026 only, a few races, 5 to 8 hourly points each | Mostly race day | Same API | Low | No: too thin to give a stage price |
| Kalshi top 5, top 10, pole, H2H | Exist as series | Not checked in depth | | Same API | Low | Not yet (top 10 could score pPoints) |
| Betfair exchange history | Full price history | All races | All stages | Needs account; detailed history is paid | High | No: login and paid |
| Oddsportal and similar odds archives | Closing bookmaker odds | Many races | Mostly closing price only | JS pages, terms forbid scraping | High | No: terms |
| SportsLine (CBS) model | Named picks and odds tables, self-reported tally (about 34 of 57 winners since 2023) | Most races | Pre-race | Paywalled picks, no per-driver probabilities | High | No: no numbers, paywall |
| mar-antaya/2025_f1_predictions (GitHub, MIT) | Scripts that rank drivers by predicted lap time | About 8 of 2025 races | Post-qualifying | Outputs not archived (posted on social media); rerunning code now is not a published forecast | Medium | No |
| Other GitHub, Kaggle, mintlify hobby models | One-off race predictions, accuracy on training data | A few races | Varies | No dated archive | High | No |

No public model with a dated per-race probability archive was found. The only real outside benchmarks are the two prediction markets.

## Method

Same stage windows as `scripts/exp_market/research.py`: pre-weekend is the 6 hours before FP1, post-practice is from 1 hour after the last practice until 30 minutes later or qualifying, post-qualifying is 2 to 3 hours after qualifying start. Kalshi price is the bid/ask midpoint of the last hourly candle ending inside the window. Winner prices are scaled to sum to 1 over the field, podium prices to sum to 3; unpriced drivers (at most 4 allowed) get a floor of 0.005 before scaling. Paired bootstrap over races, 4000 draws, seed 20261015. Difference is market minus ours: for log loss, a positive interval means we are better; for hit rates, a positive interval means the market is better.

## Results (current method)

| Source, target | Stage | Races | Log loss ours | Market | Diff 95% CI | Hit ours | Market | Diff 95% CI |
|---|---|---:|---:|---:|---|---:|---:|---|
| Kalshi win | pre-weekend | 27 | 1.560 | 1.664 | [-0.10, 0.31] | 0.30 | 0.41 | [-0.15, 0.37] |
| Kalshi win | post-practice | 25 | 1.512 | 1.631 | [-0.13, 0.37] | 0.36 | 0.44 | [-0.16, 0.32] |
| Kalshi win | post-qualifying | 30 | 0.997 | 1.043 | [-0.06, 0.16] | 0.63 | 0.53 | [-0.23, 0.00] |
| Kalshi podium | pre-weekend | 20 | 0.249 | 0.238 | [-0.029, 0.003] | 1.85 | 1.95 | [-0.10, 0.30] |
| Kalshi podium | post-practice | 15 | 0.242 | 0.235 | [-0.029, 0.015] | 1.87 | 2.00 | [-0.20, 0.47] |
| Kalshi podium | post-qualifying | 22 | 0.208 | 0.195 | [-0.031, 0.004] | 2.00 | 2.23 | [-0.05, 0.55] |
| Polymarket win | pre-weekend | 40 | 1.804 | 1.763 | [-0.23, 0.16] | 0.20 | 0.33 | [-0.08, 0.33] |
| Polymarket win | post-practice | 42 | 1.588 | 1.621 | [-0.14, 0.22] | 0.33 | 0.43 | [-0.07, 0.26] |
| Polymarket win | post-qualifying | 42 | 1.133 | 1.117 | [-0.13, 0.10] | 0.57 | 0.62 | [-0.07, 0.17] |

Hit is favourite-won rate for win, podium picks right (0 to 3) for podium.

Previous method (`pub64`), same races: pre-weekend win log loss 1.683 (Kalshi 1.664), 1.907 (Polymarket 1.763); post-practice 1.635 (Kalshi 1.631), 1.680 (Polymarket 1.621); favourite-won 0.15 and 0.20 against Kalshi 0.41 and 0.44, the Kalshi pre-weekend and post-practice favourite gap was significant for `pub64` ([0.00, 0.48] and [0.04, 0.44]). Post-qualifying forecasts are identical between the two methods. Full table: `ml/reports/benchmark/benchmark_scores.csv`.

## Verdict

- Win probabilities: the current method has lower win log loss than Kalshi at all three stages and than Polymarket after practice, and is close to Polymarket before the weekend and after qualifying. No difference is significant. The change from `pub64` to `chain_bt` closed the gap to the markets before qualifying (about 0.1 to 0.12 nats better than before).
- Picking the favourite: markets pick the winner more often before qualifying (about 0.41 to 0.44 against 0.30 to 0.36), not significant for the current method. After qualifying we are ahead of Kalshi (0.63 against 0.53, interval touches zero).
- Podium: Kalshi is ahead on podium log loss at every stage (about 0.007 to 0.013 lower), intervals mostly just over zero on our side, so close to significant. Kalshi also gets slightly more podium picks right. This is the clearest place we are behind.
- Overall: we are level with public markets on winner probabilities, and slightly behind on podium calibration. We cannot claim to beat the markets on this sample (20 to 42 races per comparison).

## Limits

- Coverage is partial: Kalshi stage prices were missing or incomplete in some races, and races without a usable price are dropped, so comparisons use different race sets per row.
- Hourly candles; the post-practice window is 30 minutes, so the price can be up to an hour old. Session end times are approximated, as in the earlier market study.
- Kalshi winner markets for 2025 opened on race-week Monday, so pre-weekend prices exist; some thin drivers have no quote and get the floor.
- Podium scaling to a sum of 3 removes the bookmaker margin crudely.
- Markets are not independent of public information, including other models; they are the strongest available outside benchmark, not a model.

## Reproduce

From `ml`: `uv run python scripts/benchmark/collect_kalshi.py` (raw responses cached in `data/raw/benchmarks/kalshi/`, 0.25 s between requests), then `uv run python scripts/benchmark/score.py`.
