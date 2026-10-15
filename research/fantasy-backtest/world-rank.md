# Estimated world rank (F1 Fantasy global league)

Checked 2026-10-14. Result: **not enough public data for an estimate.** No rank is shown on the
site as a number; it shows "n/a" with this explanation.

## What was found

| season | item | value | source | date |
|---|---|---|---|---|
| 2025 | teams in the global league | "over 2.7 million teams" | https://www.fanamp.com/articles/f1-fantasy-gavin-de-souza-game-tips-and-silverstone-race-experience | 2026-08-06 |
| 2025 | champion | Gavin De Souza, total not stated | same article, https://www.fanamp.com/fantasy | 2026-08-06 |
| 2024 | teams in the global league | "over 2 million" (also 2023) | formula1.com (coordinator search) | 2026-10-14 |
| 2024 | champion, total | not found | searches of formula1.com, motorsportmagazine.com, fanamp.com | 2026-10-14 |
| 2026 | anything | not found (season running) | | |

Not found for any season: winner's total, points at rank 100 / 1,000 / 10,000, top 1% or 10%
cutoffs, median or average player score. The game's global leaderboard needs a login; Reddit
r/fantasyF1 threads (where players post points and rank) could not be fetched from here.

## Context only (not comparable)

2022 global winner scored 4,766 points (formula1.com, "F1 Fantasy Wrapped 2022"). Different game
version, scoring and season length, so it is not used as an anchor.

## Reference shown instead: the average player

`run.ts` computes an ownership-weighted average player per round from `selectedPct` in
`data/processed/fantasy_prices.parquet` (exported by `export_ownership.py`): each active asset's
points x its ownership share, drivers scaled to exactly 5 picks and constructors to 2 (raw driver
shares sum to 437 to 504%), plus the most-owned driver's points once as the Boost (boost ownership
is not published). No transfer penalties, no chips. Coverage: every round of 2024 (community
source mzafram2001/f1-fantasy), 2025 (same) and 2026 R1-17 (official).

| season | average player | ours | margin |
|---|---|---|---|
| 2024 | 3068 | 4802 | +1734 |
| 2025 | 3018 | 5306 | +2288 |
| 2026 R1-17 | 2511 | 4191 | +1680 |

This is the score of the ownership-average team, not the median player, and it skips chips, so
it understates real average scores somewhat.

## Why no range either

A log-rank interpolation needs at least two (points, rank) anchors per season. With zero
anchors, any range would be invented. To fill this in: log in to fantasy.formula1.com, read the
points at ranks 1, 100, 1,000, 10,000, 100,000 and the player count for each season, put them in
`WORLD_RANK_ANCHORS` in `run.ts` and rerun; the site picks it up from `backtest.json`.

## Caveat for any future estimate

Our totals are official game points from real prices and results, but the strategy starts at
round 1, never uses Final Fix or No Negative (not scorable from our data), and plays the other
four chips by the engine's advice. Real players use all six chips, so a rank estimate from these
totals would be pessimistic.

## 2026 leader reference

The owner reported the 2026 global leader at 4994 points after round 17 (2026-10-14). It is in
`WORLD_LEADER` in `run.ts` and the site shows our share of it (4191 = 83.9%). One point is not
enough for a rank, so the rank itself stays unestimated.
