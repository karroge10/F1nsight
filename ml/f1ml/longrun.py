"""Practice long-run pace for model v2, from three free lap sources.

    uv run python -m f1ml.longrun        # coverage and a sanity check per source

Sources per (race, session), first one with laps wins: FastF1 (`ff1_laps`), OpenF1 practice laps
(`openf1_laps`, 2023+), the F1 live timing archive (`livetiming.practice_laps`, the weekend in
progress). v1's `data.long_run_pace` is left untouched so the published model's inputs do not
move; v2 reads `race_long_runs()` instead.

Correction, per session:
1. clean laps: no pit in/out lap, green, not deleted, within 110% of the session's best lap;
2. stints of at least 5 clean laps; laps slower than 103% of the stint median are dropped
   (traffic, mistakes);
3. one pooled within-stint slope per session (stint fixed effects): fuel burn and tyre wear
   together. Every lap is moved to a common stint lap index, so a long stint and a short stint
   are compared at the same point instead of at their own average;
4. compound offsets from drivers who ran both compounds (median paired difference to MEDIUM);
5. driver pace = lap weighted mean of corrected stint means; gap in % to the best driver.
The race's main long-run session is the one with the most drivers on a long run.
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd

from f1ml import data, openf1_laps, paths

MIN_STINT = 5
BEST_RATIO = 1.10
STINT_RATIO = 1.03
REFERENCE_LAP = 5.0
SOURCE_ORDER = ("fastf1", "openf1", "livetiming")


def main() -> None:
    table = race_long_runs()
    coverage = table.groupby(table["raceId"] // 100)["raceId"].nunique().to_dict()
    print("races with long runs by season:", coverage)
    print(table.groupby("source")["raceId"].nunique().to_dict())
    latest = table[table["raceId"] == table["raceId"].max()].sort_values("lr2_gap")
    print(latest.head(12).to_string())


@lru_cache(maxsize=1)
def race_long_runs() -> pd.DataFrame:
    """raceId, driverId, session, source, lr2_s, lr2_laps, lr2_gap (%), lr2_team_gap (%)."""
    laps = practice_laps()
    columns = ["raceId", "driverId", "session", "source", "lr2_s", "lr2_laps", "lr2_gap",
               "lr2_team_gap"]
    if not len(laps):
        return pd.DataFrame(columns=columns)
    rows = []
    for (race_id, session, source), session_laps in laps.groupby(["raceId", "session",
                                                                   "source"]):
        paces = session_long_runs(session_laps)
        for driver_id, (pace, count) in paces.items():
            rows.append((race_id, driver_id, session, source, pace, count))
    runs = pd.DataFrame(rows, columns=["raceId", "driverId", "session", "source", "lr2_s",
                                       "lr2_laps"])
    counts = runs.groupby(["raceId", "session"]).size().rename("drivers").reset_index()
    counts = counts.sort_values(["raceId", "drivers", "session"], ascending=[True, False, False])
    main_sessions = counts.drop_duplicates("raceId")[["raceId", "session"]]
    main = runs.merge(main_sessions, on=["raceId", "session"])
    best = main.groupby("raceId")["lr2_s"].transform("min")
    main["lr2_gap"] = ((main["lr2_s"] / best - 1.0) * 100.0).clip(upper=4.0)
    teams = _teams()
    main = main.merge(teams, on=["raceId", "driverId"], how="left")
    team_mean = main.groupby(["raceId", "constructorId"])["lr2_gap"].transform("mean")
    main["lr2_team_gap"] = team_mean.fillna(main["lr2_gap"])
    return main[columns].reset_index(drop=True)


def practice_laps() -> pd.DataFrame:
    """Practice laps of every source, one source per (raceId, session)."""
    frames = []
    fastf1 = _fastf1_laps()
    if len(fastf1):
        frames.append(fastf1.assign(source="fastf1"))
    openf1 = openf1_laps.practice_laps()
    if len(openf1):
        frames.append(openf1.assign(source="openf1"))
    archive = _livetiming_laps()
    if len(archive):
        frames.append(archive.assign(source="livetiming"))
    if not frames:
        return pd.DataFrame()
    laps = pd.concat(frames, ignore_index=True)
    laps["priority"] = laps["source"].map({s: i for i, s in enumerate(SOURCE_ORDER)})
    best_source = laps.groupby(["raceId", "session"])["priority"].transform("min")
    return laps[laps["priority"] == best_source].drop(columns="priority")


def session_long_runs(laps: pd.DataFrame) -> dict:
    """driverId -> (corrected long-run pace in s, laps used) for one session."""
    clean = _clean(laps)
    stints = _stints(clean)
    if not len(stints):
        return {}
    slope = _pooled_slope(stints)
    stints["corrected"] = stints["lapTimeS"] - slope * (stints["k"] - REFERENCE_LAP)
    offsets = _compound_offsets(stints)
    stints["corrected"] = stints["corrected"] - stints["compound"].map(offsets).fillna(0.0)
    result = {}
    for driver_id, driver_laps in stints.groupby("driverId"):
        per_stint = driver_laps.groupby("stint_key")["corrected"].agg(["mean", "size"])
        weights = per_stint["size"].to_numpy(dtype=float)
        pace = float((per_stint["mean"] * weights).sum() / weights.sum())
        result[driver_id] = (pace, int(weights.sum()))
    return result


# ----------------------------------------------------------------------------------------------
# helpers


def _clean(laps: pd.DataFrame) -> pd.DataFrame:
    usable = laps[laps["lapTimeS"].notna() & laps["driverId"].notna()].copy()
    usable = usable[usable["pitInS"].isna() & usable["pitOutS"].isna()]
    green = usable["trackStatus"].fillna("1").astype(str) == "1"
    not_deleted = ~usable["deleted"].fillna(False).astype(bool)
    usable = usable[green & not_deleted]
    if not len(usable):
        return usable
    best = usable["lapTimeS"].min()
    return usable[usable["lapTimeS"] < best * BEST_RATIO]


def _stints(clean: pd.DataFrame) -> pd.DataFrame:
    if not len(clean):
        return clean
    frame = clean.copy()
    frame["stint"] = frame["stint"].fillna(-1)
    frame["stint_key"] = frame["driverId"].astype(str) + ":" + frame["stint"].astype(str)
    sizes = frame.groupby("stint_key")["lapTimeS"].transform("size")
    frame = frame[sizes >= MIN_STINT]
    if not len(frame):
        return frame
    median = frame.groupby("stint_key")["lapTimeS"].transform("median")
    frame = frame[frame["lapTimeS"] < median * STINT_RATIO]
    sizes = frame.groupby("stint_key")["lapTimeS"].transform("size")
    frame = frame[sizes >= MIN_STINT].copy()
    frame = frame.sort_values(["stint_key", "lapNumber"])
    first = frame.groupby("stint_key")["lapNumber"].transform("min")
    frame["k"] = (frame["lapNumber"] - first).astype(float)
    return frame


def _pooled_slope(stints: pd.DataFrame) -> float:
    """Within-stint slope of lap time on lap index (stint fixed effects), clipped to sane."""
    lap_dev = stints["lapTimeS"] - stints.groupby("stint_key")["lapTimeS"].transform("mean")
    k_dev = stints["k"] - stints.groupby("stint_key")["k"].transform("mean")
    denominator = float((k_dev ** 2).sum())
    if denominator < 1e-9:
        return 0.0
    slope = float((lap_dev * k_dev).sum() / denominator)
    return float(np.clip(slope, -0.15, 0.25))


def _compound_offsets(stints: pd.DataFrame) -> dict:
    """Compound -> seconds versus MEDIUM, from drivers who ran both (else overall medians)."""
    pace = stints.groupby(["driverId", "compound"])["corrected"].mean().unstack()
    offsets = {}
    overall = stints.groupby("compound")["corrected"].median()
    reference = "MEDIUM" if "MEDIUM" in pace else (pace.columns[0] if len(pace.columns) else None)
    if reference is None:
        return offsets
    for compound in pace.columns:
        if compound == reference:
            offsets[compound] = 0.0
            continue
        paired = (pace[compound] - pace[reference]).dropna()
        if len(paired) >= 2:
            offsets[compound] = float(paired.median())
        elif compound in overall and reference in overall:
            offsets[compound] = float(overall[compound] - overall[reference])
    return offsets


def _fastf1_laps() -> pd.DataFrame:
    laps = data._read_optional("ff1_laps")
    if laps is None or not len(laps):
        return pd.DataFrame()
    practice = laps[laps["session"].isin(("FP1", "FP2", "FP3"))].copy()
    practice["raceId"] = practice["season"].astype(int) * 100 + practice["round"].astype(int)
    columns = ["season", "round", "raceId", "session", "driverId", "lapNumber", "lapTimeS",
               "pitInS", "pitOutS", "stint", "compound", "tyreLife", "trackStatus", "deleted"]
    return practice[columns]


def _livetiming_laps() -> pd.DataFrame:
    from f1ml import livetiming

    core = data.load_core()
    races = core["races"][core["races"]["season"] >= 2023]
    numbers = data._season_numbers()
    return livetiming.practice_laps(races, numbers)


@lru_cache(maxsize=1)
def _teams() -> pd.DataFrame:
    path = paths.FEATURES_PATH
    frame = pd.read_parquet(path, columns=["raceId", "driverId", "constructorId"])
    return frame


if __name__ == "__main__":
    main()
