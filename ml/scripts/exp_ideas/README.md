# Isolated team-feature experiments

Run from v2/ml. Production columns come from the saved features_bestcar.parquet snapshot.

- F1ML_FASTFORM=1 adds team gap and finish form, a detected two-race gap shift and time since the latest shift. Prior history receives 0.25 weight after a detected shift, and pre-reset history receives 0.25 weight in reset seasons. A five-race half-life and 0.25 percentage-point threshold were selected on 2019-2023 next-gap prediction only.
- F1ML_SIMILARITY=1 adds kernel-weighted team qualifying residuals and effective support. Similarity uses static course length, turn count and street status. A bandwidth of 0.5 and six pseudo-observations of shrinkage were selected on 2019-2023 only. Recent residuals have a fixed 12-race half-life.

Both switches default OFF. F1ML_DYNPL is separate and unchanged. Turning an idea on requires building a compatible feature file and retraining, because it adds model columns.

Reproduction:

1. uv run python -m scripts.exp_ideas.analyze
2. uv run python -m scripts.exp_ideas.tune
3. powershell -NoProfile -ExecutionPolicy Bypass -File scripts/exp_ideas/launch.ps1
4. After both jobs complete: uv run python -m scripts.exp_ideas.report

The launcher refuses to duplicate existing tasks. Each scheduled runner builds features with --out, isolates new columns on the saved baseline, checks cutoff invariance, removes 2026 R17+, runs the locked backtest and scorecard, writes runtime metadata, then unregisters itself. Every native-command exit code is checked. The five-hour execution limit applies to the entire job.

The protocol comparison is over 64 paired races. The saved exp_bestcar scorecard has 65 races, so use the paired comparison fields and summary.json rather than subtracting its standalone 65-race means. No baseline rerun is performed.

Probability exp(-mean win log loss) is a geometric mean. Summary.json includes arithmetic winner probability separately to avoid confusing it with the requested statistic. RPS has separate before/after bootstrap intervals and a paired interval of the difference. Acceptance protects pre-weekend and post-qualifying RPS and NLL; the 0.002 season guardrail is checked at every stage. Neutral experiments remain disabled because a neutral result alone does not justify changing production.

The inherited circuit-speed feature uses all loaded fastest laps. These experiments retain that baseline limitation for comparability and do not add it to the similarity kernel. Current static circuit metadata is not historically versioned.
