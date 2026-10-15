"""Sanity check of the fitted grid term g at a 2024 and a 2026 cutoff (CPU, GBM only)."""
from f1ml import bundle, train
bundle.GRID_TERM = True
f = train.load_features()
params = train.load_params()
for cut in (202401, 202601):
    t = f[(f.raceId < cut) & (f.y_finish.notna() | f.y_dnf.notna())]
    stack = {s: {"race": [1.0, 0.0], "race_gbm_ratio": 1.0, "quali": [1.0, 0.0], "quali_gbm_ratio": 1.0,
                 "race_schedule": None, "quali_schedule": None} for s in ("pre-weekend", "post-practice", "post-qualifying")}
    bundle.long_window_schedules(t, params, stack)
    e = stack["post-qualifying"]
    print(cut, "g", round(e["grid_term"], 3), "schedule", [round(v, 3) for v in e["race_schedule"]], "bonus", [round(v, 3) for v in e["first_pick_grid_bonus"]])
