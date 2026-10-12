"""Compound and track evolution corrected one-lap pace per driver per practice session.

    uv run python -m f1ml.practice_pace            # fitted offsets for the latest sessions

A raw practice best lap mixes car pace with the tyre it was set on and with when in the session
it was set: a Medium-only run looks slow next to Soft runs, and laps late in the session are
faster on a rubbered-in track. Per (race, practice session) with lap data (FastF1, 2018 on):

1. push laps: timed, not deleted, no pit in or out lap, no red flag or safety car during the
   lap, within 107% of the session's best lap; only slick compounds;
2. per driver and compound the best push lap; compounds whose best is more than 2.5% slower
   than the driver's own best are long-run laps, not push attempts, and are left out;
3. a fixed effects fit on log lap time (in %): driver effect + compound offset (Soft = 0) +
   track evolution slope over the session + tyre age slope. Each coefficient is shrunk towards a
   prior (the median of every 2018 to 2025 session fit), so a session where nobody ran two
   compounds still gets a sensible correction instead of none;
4. the driver's fastest lap is moved to Soft, fresh tyres and the end of the session; the gap is
   in % to the fastest corrected driver. Only the fastest lap is corrected (not the fastest
   after correction): slower laps on other compounds are often run with more fuel early in the
   session, and correcting them too would reward a heavy run instead of a push lap;
5. drivers with fewer than 3 push laps get no value for the session (a missing value is better
   than a gap that only reflects traffic, a red flag or an aborted run).

Sessions without lap data keep the raw best lap gap (`features._build_weekend`).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from f1ml import data

PRACTICE = ("FP1", "FP2", "FP3", "FP4")
SLICKS = ("SOFT", "MEDIUM", "HARD")
PUSH_RATIO = 1.07
PUSH_SPREAD_PCT = 2.5
MIN_PUSH_LAPS = 3
MIN_DRIVERS = 8
# Track status codes during the lap: 4 safety car, 5 red flag, 6 and 7 virtual safety car. A
# yellow (2) alone does not void a lap: a lap set through a yellow is deleted anyway.
NEUTRALISED = "[4567]"
TYRE_AGE_CAP = 12.0
# Priors (in % of lap time) and their strength in pseudo observations. Medians of the per
# session fits on 2018 to 2025 FastF1 practice (see `main`): Medium and Hard over Soft, the
# change from the start to the end of a session, and the cost of one lap of tyre age.
PRIOR = {"MEDIUM": 0.69, "HARD": 1.09, "evolution": -0.51, "age": 0.02}
PRIOR_WEIGHT = {"MEDIUM": 2.0, "HARD": 2.0, "evolution": 4.0, "age": 20.0}
OFFSET_LIMITS = {"MEDIUM": (0.0, 2.0), "HARD": (0.0, 3.5)}
COLUMNS = ["raceId", "session", "driverId", "pace_gap", "pace_rank", "push_laps", "compound"]


def main() -> None:
    laps = session_laps()
    rows = []
    for (race_id, session), group in laps.groupby(["raceId", "session"]):
        fit = fit_session(group, use_prior=False)
        if fit is None:
            continue
        coefficients = dict(fit["coefficients"])
        for compound in ("MEDIUM", "HARD"):
            if fit["support"][compound] < 3:
                coefficients[compound] = np.nan
        rows.append({"raceId": race_id, "session": session, **coefficients})
    fits = pd.DataFrame(rows)
    seasons = fits["raceId"] // 100
    history = fits[seasons <= 2025]
    print("unshrunk session fits, medians 2018-2025:")
    print(history.drop(columns=["raceId", "session"]).median().round(3).to_string())
    latest = corrected_gaps(laps[laps["raceId"] == laps["raceId"].max()])
    print(latest.sort_values(["session", "pace_gap"]).to_string())


def corrected_gaps(laps: pd.DataFrame) -> pd.DataFrame:
    """Corrected gap (%) and rank per (raceId, session, driverId) from practice laps.

    `laps` needs raceId, session, driverId, lapTimeS, lapStartS, pitInS, pitOutS, compound,
    tyreLife, trackStatus, deleted. compound is the tyre of the driver's fastest lap.
    """
    frames = []
    for (race_id, session), group in laps.groupby(["raceId", "session"]):
        fit = fit_session(group, use_prior=True)
        if fit is None:
            continue
        drivers = fit["drivers"]
        drivers.insert(0, "session", session)
        drivers.insert(0, "raceId", race_id)
        frames.append(drivers)
    if not frames:
        return pd.DataFrame(columns=COLUMNS)
    return pd.concat(frames, ignore_index=True)[COLUMNS]


def session_laps() -> pd.DataFrame:
    """FastF1 practice laps with raceId (empty frame when FastF1 has none)."""
    laps = data._read_optional("ff1_laps")
    if laps is None or not len(laps):
        return pd.DataFrame()
    practice = laps[laps["session"].isin(PRACTICE) & laps["driverId"].notna()].copy()
    practice["raceId"] = practice["season"].astype(int) * 100 + practice["round"].astype(int)
    return practice


def fit_session(laps: pd.DataFrame, use_prior: bool) -> dict | None:
    """Fixed effects fit of one session; None when too few drivers have push laps."""
    push = _push_laps(laps)
    if push["driverId"].nunique() < MIN_DRIVERS:
        return None
    best = _best_per_compound(push)
    design, names, drivers = _design(best)
    target = best["y"].to_numpy(dtype=float)
    if use_prior:
        design, target = _add_prior_rows(design, target, names)
    solution, *_ = np.linalg.lstsq(design, target, rcond=None)
    coefficients = dict(zip(names, solution[len(drivers):]))
    coefficients = _clip_offsets(coefficients)
    corrected = _correct(best, coefficients)
    per_driver = _driver_rows(corrected, push)
    support = _paired_drivers(best)
    return {"coefficients": coefficients, "drivers": per_driver, "support": support}


# ----------------------------------------------------------------------------------------------
# helpers


def _push_laps(laps: pd.DataFrame) -> pd.DataFrame:
    timed = laps[laps["lapTimeS"].notna() & laps["driverId"].notna()]
    timed = timed[timed["pitInS"].isna() & timed["pitOutS"].isna()]
    status = timed["trackStatus"].fillna("1").astype(str)
    green = ~status.str.contains(NEUTRALISED, regex=True)
    not_deleted = ~timed["deleted"].fillna(False).astype(bool)
    slick = timed["compound"].isin(SLICKS)
    usable = timed[green & not_deleted & slick].copy()
    if not len(usable):
        return usable
    session_best = usable["lapTimeS"].min()
    usable = usable[usable["lapTimeS"] < session_best * PUSH_RATIO].copy()
    start = usable["lapStartS"].min()
    span = usable["lapStartS"].max() - start
    elapsed = usable["lapStartS"] - start
    usable["progress"] = (elapsed / span).fillna(0.5) if span > 0 else 0.5
    tyre_life = usable["tyreLife"].fillna(1.0)
    usable["age"] = (tyre_life - 1.0).clip(0.0, TYRE_AGE_CAP)
    log_ratio = np.log(usable["lapTimeS"] / session_best)
    usable["y"] = 100.0 * log_ratio
    return usable


def _best_per_compound(push: pd.DataFrame) -> pd.DataFrame:
    order = push.sort_values("y")
    best = order.drop_duplicates(["driverId", "compound"]).copy()
    driver_best = best.groupby("driverId")["y"].transform("min")
    return best[best["y"] - driver_best <= PUSH_SPREAD_PCT].reset_index(drop=True)


def _design(best: pd.DataFrame):
    drivers = sorted(best["driverId"].unique())
    driver_index = {driver: i for i, driver in enumerate(drivers)}
    names = ["MEDIUM", "HARD", "evolution", "age"]
    design = np.zeros((len(best), len(drivers) + len(names)))
    rows = np.arange(len(best))
    columns = best["driverId"].map(driver_index).to_numpy()
    design[rows, columns] = 1.0
    base = len(drivers)
    design[:, base] = (best["compound"] == "MEDIUM").to_numpy(dtype=float)
    design[:, base + 1] = (best["compound"] == "HARD").to_numpy(dtype=float)
    design[:, base + 2] = best["progress"].to_numpy(dtype=float)
    design[:, base + 3] = best["age"].to_numpy(dtype=float)
    return design, names, drivers


def _add_prior_rows(design: np.ndarray, target: np.ndarray, names: list):
    """Ridge towards the prior: one weighted pseudo observation per coefficient."""
    base = design.shape[1] - len(names)
    extra_rows = np.zeros((len(names), design.shape[1]))
    extra_target = np.zeros(len(names))
    for i, name in enumerate(names):
        weight = np.sqrt(PRIOR_WEIGHT[name])
        extra_rows[i, base + i] = weight
        extra_target[i] = weight * PRIOR[name]
    stacked_design = np.vstack([design, extra_rows])
    stacked_target = np.concatenate([target, extra_target])
    return stacked_design, stacked_target


def _paired_drivers(best: pd.DataFrame) -> dict:
    """Per non-Soft compound: drivers with a push lap on it and on another compound."""
    compounds = best.groupby("driverId")["compound"].agg(set)
    multi = compounds[compounds.map(len) >= 2]
    return {name: int(sum(name in found for found in multi)) for name in ("MEDIUM", "HARD")}


def _clip_offsets(coefficients: dict) -> dict:
    clipped = dict(coefficients)
    for name, (low, high) in OFFSET_LIMITS.items():
        clipped[name] = float(np.clip(coefficients[name], low, high))
    clipped["HARD"] = max(clipped["HARD"], clipped["MEDIUM"])
    return clipped


def _correct(best: pd.DataFrame, coefficients: dict) -> pd.DataFrame:
    """Move every best lap to Soft, fresh tyres and the end of the session."""
    frame = best.copy()
    compound_offset = frame["compound"].map({"SOFT": 0.0, "MEDIUM": coefficients["MEDIUM"],
                                             "HARD": coefficients["HARD"]})
    evolution = coefficients["evolution"] * (frame["progress"] - 1.0)
    age = coefficients["age"] * frame["age"]
    frame["corrected"] = frame["y"] - compound_offset - evolution - age
    return frame


def _driver_rows(corrected: pd.DataFrame, push: pd.DataFrame) -> pd.DataFrame:
    counts = push.groupby("driverId").size().rename("push_laps")
    order = corrected.sort_values("y")
    best = order.drop_duplicates("driverId").set_index("driverId")
    best = best.join(counts)
    best = best[best["push_laps"] >= MIN_PUSH_LAPS]
    fastest = best["corrected"].min()
    gap_pct = (np.exp((best["corrected"] - fastest) / 100.0) - 1.0) * 100.0
    result = pd.DataFrame({
        "driverId": best.index,
        "pace_gap": gap_pct.to_numpy(),
        "pace_rank": best["corrected"].rank(method="min").to_numpy(),
        "push_laps": best["push_laps"].to_numpy(dtype=int),
        "compound": best["compound"].to_numpy(),
    })
    return result.reset_index(drop=True)


if __name__ == "__main__":
    main()
