"""Load the processed tables and map F1DB / FastF1 / OpenF1 session data onto Jolpica ids.

Everything returned here is raw per-event data; nothing is aggregated across races, so there is
no point-in-time concern at this level. `features.py` is responsible for only looking backwards.
"""

from __future__ import annotations

import json
from functools import lru_cache

import numpy as np
import pandas as pd

from f1ml import paths

CORE_TABLES = (
    "races", "results", "qualifying", "sprint_results", "drivers", "constructors", "circuits",
    "driver_standings", "constructor_standings", "season_entries", "pit_stops",
)
PRACTICE_SESSIONS = ("FP1", "FP2", "FP3", "FP4")
F1DB_SESSION_FILES = {
    "FP1": "races-free-practice-1-results",
    "FP2": "races-free-practice-2-results",
    "FP3": "races-free-practice-3-results",
    "FP4": "races-free-practice-4-results",
    "SQ": "races-sprint-qualifying-results",
}
OPENF1_SESSION_NAMES = {
    "Practice 1": "FP1", "Practice 2": "FP2", "Practice 3": "FP3",
    "Sprint Qualifying": "SQ", "Sprint Shootout": "SQ", "Qualifying": "Q",
}

# Team lineages: a constructor id maps to the id its history continues under, so team form
# carries across renames (the car and factory stay, the name changes).
LINEAGE = {
    "toro_rosso": "rb", "alphatauri": "rb", "rb": "rb",
    "sauber": "audi", "alfa": "audi", "bmw_sauber": "audi", "audi": "audi",
    "renault": "alpine", "lotus_f1": "alpine", "alpine": "alpine", "benetton": "alpine",
    "jordan": "aston_martin", "midland": "aston_martin", "spyker": "aston_martin",
    "force_india": "aston_martin", "racing_point": "aston_martin", "aston_martin": "aston_martin",
    "stewart": "red_bull", "jaguar": "red_bull", "red_bull": "red_bull",
    "bar": "mercedes", "honda": "mercedes", "brawn": "mercedes", "mercedes": "mercedes",
    "minardi": "rb", "virgin": "manor", "marussia": "manor", "manor": "manor",
    "lotus_racing": "caterham", "caterham": "caterham",
}


def load_core() -> dict[str, pd.DataFrame]:
    """Core Jolpica/F1DB tables as pandas frames (cached per process)."""
    return dict(_load_core_cached())


def lineage_of(constructor_id: str) -> str:
    return LINEAGE.get(constructor_id, constructor_id)


def f1db_csv_dir():
    current_path = paths.F1DB_ROOT / "current.json"
    current_text = current_path.read_text(encoding="utf-8")
    current = json.loads(current_text)
    return paths.F1DB_ROOT / current["tag"] / "csv"


def session_results() -> pd.DataFrame:
    """Best lap per driver for practice and sprint qualifying sessions.

    Columns: raceId, driverId, session (FP1..FP4, SQ), timeMs, position, source.
    F1DB is the primary source (complete history up to its release); FastF1 laps and OpenF1
    session results fill sessions F1DB does not have yet (the race weekend in progress).
    """
    f1db = _f1db_sessions()
    fastf1 = _fastf1_sessions()
    openf1 = _openf1_sessions()
    archive = _livetiming_sessions()
    frames = [frame for frame in (f1db, fastf1, openf1, archive) if len(frame)]
    combined = pd.concat(frames, ignore_index=True)
    priorities = {"f1db": 0, "fastf1": 1, "openf1": 2, "livetiming": 3}
    combined["priority"] = combined["source"].map(priorities)
    combined = combined.sort_values(["raceId", "session", "driverId", "priority"])
    deduped = combined.drop_duplicates(["raceId", "session", "driverId"], keep="first")
    have_session = deduped.groupby(["raceId", "session"])["source"].transform("first")
    keep = deduped["source"] == have_session
    return deduped[keep].drop(columns="priority").reset_index(drop=True)


def driver_of_the_day() -> pd.DataFrame:
    """F1DB Driver of the Day results: raceId, driverId, dotdRank (1 = winner), dotdPct."""
    csv_dir = f1db_csv_dir()
    raw = pd.read_csv(csv_dir / "f1db-races-driver-of-the-day-results.csv")
    mapped = _map_f1db_rows(raw)
    mapped = mapped.rename(columns={"positionNumber": "dotdRank", "percentage": "dotdPct"})
    return mapped[["raceId", "driverId", "dotdRank", "dotdPct"]]


def circuit_meta() -> pd.DataFrame:
    """Per Jolpica circuitId: F1DB type (STREET/RACE/ROAD), latest length and turns."""
    csv_dir = f1db_csv_dir()
    f1db_races = pd.read_csv(csv_dir / "f1db-races.csv", low_memory=False)
    circuits = pd.read_csv(csv_dir / "f1db-circuits.csv")
    core = load_core()
    races = core["races"][["season", "round", "circuitId"]]
    keyed = f1db_races.rename(columns={"year": "season", "circuitId": "f1dbCircuitId"})
    joined = races.merge(keyed[["season", "round", "f1dbCircuitId", "courseLength", "turns"]],
                         on=["season", "round"], how="left")
    latest = joined.sort_values(["season", "round"]).drop_duplicates("circuitId", keep="last")
    circuit_types = circuits.rename(columns={"id": "f1dbCircuitId", "type": "circuitType"})
    meta = latest.merge(circuit_types[["f1dbCircuitId", "circuitType"]], on="f1dbCircuitId",
                        how="left")
    return meta[["circuitId", "f1dbCircuitId", "circuitType", "courseLength", "turns"]]


def long_run_pace() -> pd.DataFrame:
    """Fuel and tyre corrected long run pace per driver per practice session (FastF1 laps).

    Columns: raceId, driverId, session, longRunS (median corrected lap), longRunLaps,
    degSlope (s per lap of tyre age within the driver's long stints, fuel corrected).
    Covers every season FastF1 has (2018 on). Empty when FastF1 has not delivered practice laps
    yet; features degrade to NaN.
    """
    columns = ["raceId", "driverId", "session", "longRunS", "longRunLaps", "degSlope"]
    laps = _read_optional("ff1_laps")
    if laps is None or not len(laps):
        return pd.DataFrame(columns=columns)
    practice = laps[laps["session"].isin(PRACTICE_SESSIONS)].copy()
    practice = practice[practice["lapTimeS"].notna() & practice["driverId"].notna()]
    practice = practice[practice["pitInS"].isna() & practice["pitOutS"].isna()]
    green = practice["trackStatus"].fillna("1").astype(str) == "1"
    not_deleted = ~practice["deleted"].fillna(False).astype(bool)
    practice = practice[green & not_deleted]
    practice["raceId"] = practice["season"].astype(int) * 100 + practice["round"].astype(int)
    rows = []
    for key, session_laps in practice.groupby(["raceId", "session"]):
        session_rows = _long_runs_for_session(key[0], key[1], session_laps)
        rows.extend(session_rows)
    return pd.DataFrame(rows, columns=columns)


def live_starting_grid() -> pd.DataFrame:
    """OpenF1 starting grids (raceId, driverId, grid) for races Jolpica has no result for yet."""
    grid = _read_optional("openf1_starting_grid")
    if grid is None or not len(grid):
        return pd.DataFrame(columns=["raceId", "driverId", "grid"])
    located = _locate_openf1(grid)
    located = located[located["session_name"] == "Race"]
    located = located.rename(columns={"position": "grid"})
    return located[["raceId", "driverId", "grid"]]


def live_qualifying() -> pd.DataFrame:
    """Qualifying classification from FastF1 / OpenF1 when Jolpica does not have it yet.

    Columns: raceId, driverId, position, q1Ms, q2Ms, q3Ms.
    """
    frames = []
    ff1 = _read_optional("ff1_session_results")
    if ff1 is not None and len(ff1):
        quali = ff1[(ff1["session"] == "Q") & ff1["driverId"].notna()].copy()
        quali["raceId"] = quali["season"].astype(int) * 100 + quali["round"].astype(int)
        for column, source in (("q1Ms", "q1S"), ("q2Ms", "q2S"), ("q3Ms", "q3S")):
            quali[column] = quali[source] * 1000.0
        frames.append(quali[["raceId", "driverId", "position", "q1Ms", "q2Ms", "q3Ms"]])
    openf1 = _read_optional("openf1_session_result")
    if openf1 is not None and len(openf1):
        located = _locate_openf1(openf1)
        located = located[located["session_name"] == "Qualifying"].copy()
        durations = located["duration"].map(_openf1_duration_list)
        for index, column in enumerate(("q1Ms", "q2Ms", "q3Ms")):
            located[column] = durations.map(lambda values, i=index: _nth_ms(values, i))
        frames.append(located[["raceId", "driverId", "position", "q1Ms", "q2Ms", "q3Ms"]])
    archive = _livetiming_qualifying()
    if len(archive):
        frames.append(archive)
    if not frames:
        return pd.DataFrame(columns=["raceId", "driverId", "position", "q1Ms", "q2Ms", "q3Ms"])
    combined = pd.concat(frames, ignore_index=True)
    combined = combined.dropna(subset=["position"])
    return combined.drop_duplicates(["raceId", "driverId"], keep="first")


def team_colors_2026() -> dict[str, str]:
    """Team colour table for the 2026 grid (constructors.primaryColor, fixed fallbacks)."""
    fallback = {
        "mercedes": "#00D7B6", "ferrari": "#ED1131", "red_bull": "#4781D7",
        "mclaren": "#F47600", "aston_martin": "#229971", "alpine": "#00A1E8",
        "williams": "#1868DB", "rb": "#6C98FF", "haas": "#9C9FA2", "audi": "#FF2D00",
        "cadillac": "#AAAAAD",
    }
    core = load_core()
    constructors = core["constructors"]
    known = constructors.dropna(subset=["primaryColor"])
    colors = dict(zip(known["constructorId"], known["primaryColor"]))
    for constructor_id, color in fallback.items():
        colors.setdefault(constructor_id, color)
    return colors


# ----------------------------------------------------------------------------------------------
# helpers


@lru_cache(maxsize=1)
def _load_core_cached() -> tuple:
    tables = {}
    for name in CORE_TABLES:
        path = paths.processed(name)
        tables[name] = pd.read_parquet(path)
    return tuple(tables.items())


def _read_optional(name: str) -> pd.DataFrame | None:
    path = paths.processed(name)
    if not path.exists():
        return None
    try:
        return pd.read_parquet(path)
    except Exception as error:  # a table being rewritten by another agent
        print(f"  warning: could not read {name}: {error}")
        return None


@lru_cache(maxsize=1)
def _race_numbers() -> pd.DataFrame:
    """(season, round, number) -> driverId from results, qualifying and sprint entries."""
    core = load_core()
    frames = []
    for name in ("results", "qualifying", "sprint_results"):
        table = core[name][["season", "round", "number", "driverId"]]
        frames.append(table)
    numbers = pd.concat(frames, ignore_index=True).dropna(subset=["number"])
    numbers["number"] = numbers["number"].astype(int)
    return numbers.drop_duplicates(["season", "round", "number"])


@lru_cache(maxsize=1)
def _f1db_driver_map() -> dict:
    """F1DB driver id -> Jolpica driverId (most common pairing on season/round/number)."""
    csv_dir = f1db_csv_dir()
    race_results = pd.read_csv(csv_dir / "f1db-races-race-results.csv", low_memory=False)
    keys = pd.DataFrame({
        "season": race_results["year"],
        "round": race_results["round"],
        "number": pd.to_numeric(race_results["driverNumber"], errors="coerce"),
        "f1dbId": race_results["driverId"],
    }).dropna(subset=["number"])
    keys["number"] = keys["number"].astype(int)
    numbers = _race_numbers()
    pairs = keys.merge(numbers, on=["season", "round", "number"])
    counts = pairs.groupby(["f1dbId", "driverId"]).size().reset_index(name="n")
    best = counts.sort_values("n", ascending=False).drop_duplicates("f1dbId")
    return dict(zip(best["f1dbId"], best["driverId"]))


def _map_f1db_rows(raw: pd.DataFrame) -> pd.DataFrame:
    """Attach raceId and Jolpica driverId to F1DB per-driver session rows."""
    frame = raw.copy()
    frame["season"] = frame["year"]
    frame["raceId"] = frame["year"] * 100 + frame["round"]
    numeric_numbers = pd.to_numeric(frame["driverNumber"], errors="coerce")
    frame["number"] = numeric_numbers.astype("Int64")
    numbers = _race_numbers().rename(columns={"driverId": "byNumber"})
    numbers["number"] = numbers["number"].astype("Int64")
    frame = frame.merge(numbers, on=["season", "round", "number"], how="left")
    driver_map = _f1db_driver_map()
    by_id = frame["driverId"].map(driver_map)
    fallback = "f1db:" + frame["driverId"].astype(str)
    frame["driverId"] = frame["byNumber"].fillna(by_id).fillna(fallback)
    return frame


def _f1db_sessions() -> pd.DataFrame:
    csv_dir = f1db_csv_dir()
    frames = []
    for session, file_stem in F1DB_SESSION_FILES.items():
        raw = pd.read_csv(csv_dir / f"f1db-{file_stem}.csv", low_memory=False)
        mapped = _map_f1db_rows(raw)
        if session == "SQ":
            best = mapped[["q1Millis", "q2Millis", "q3Millis"]].min(axis=1)
            mapped["timeMs"] = best
        else:
            mapped["timeMs"] = mapped["timeMillis"]
        mapped["session"] = session
        mapped["position"] = mapped["positionNumber"]
        frames.append(mapped[["raceId", "driverId", "session", "timeMs", "position"]])
    combined = pd.concat(frames, ignore_index=True)
    combined["source"] = "f1db"
    return combined


def _fastf1_sessions() -> pd.DataFrame:
    laps = _read_optional("ff1_laps")
    columns = ["raceId", "driverId", "session", "timeMs", "position", "source"]
    if laps is None or not len(laps):
        return pd.DataFrame(columns=columns)
    wanted = ("FP1", "FP2", "FP3", "SQ")
    session_laps = laps[laps["session"].isin(wanted) & laps["driverId"].notna()].copy()
    not_deleted = ~session_laps["deleted"].fillna(False).astype(bool)
    session_laps = session_laps[not_deleted & session_laps["lapTimeS"].notna()]
    session_laps["raceId"] = (session_laps["season"].astype(int) * 100
                              + session_laps["round"].astype(int))
    best = session_laps.groupby(["raceId", "session", "driverId"], as_index=False)["lapTimeS"].min()
    best["timeMs"] = best["lapTimeS"] * 1000.0
    best["position"] = best.groupby(["raceId", "session"])["timeMs"].rank(method="first")
    best["source"] = "fastf1"
    return best[columns]


def _openf1_sessions() -> pd.DataFrame:
    columns = ["raceId", "driverId", "session", "timeMs", "position", "source"]
    results = _read_optional("openf1_session_result")
    if results is None or not len(results):
        return pd.DataFrame(columns=columns)
    located = _locate_openf1(results)
    located["session"] = located["session_name"].map(OPENF1_SESSION_NAMES)
    located = located[located["session"].isin(("FP1", "FP2", "FP3", "SQ"))].copy()
    durations = located["duration"].map(_openf1_duration_list)
    located["timeMs"] = durations.map(_best_ms)
    located["source"] = "openf1"
    return located[columns]


def _livetiming_sessions() -> pd.DataFrame:
    from f1ml import livetiming

    core = load_core()
    races = core["races"][core["races"]["season"] >= 2023]
    return livetiming.best_laps(races, _season_numbers())


def _livetiming_qualifying() -> pd.DataFrame:
    from f1ml import livetiming

    core = load_core()
    races = core["races"][core["races"]["season"] >= 2023]
    return livetiming.qualifying(races, _season_numbers())


def _locate_openf1(frame: pd.DataFrame) -> pd.DataFrame:
    """Attach raceId (by session date within the race weekend) and driverId (car number)."""
    sessions = _read_optional("openf1_sessions")
    if sessions is None:
        return frame.iloc[0:0].assign(raceId=pd.Series(dtype=int), driverId=pd.Series(dtype=str))
    core = load_core()
    races = core["races"][["raceId", "season", "round", "date"]].copy()
    races["date"] = pd.to_datetime(races["date"])
    starts = sessions[["session_key", "date_start"]].copy()
    starts["day"] = pd.to_datetime(starts["date_start"]).dt.tz_localize(None).dt.normalize()
    merged = frame.merge(starts[["session_key", "day"]], on="session_key", how="left")
    race_ids = []
    for season, day in zip(merged["season"], merged["day"]):
        race_id = _race_for_day(races, season, day)
        race_ids.append(race_id)
    merged["raceId"] = race_ids
    merged = merged.dropna(subset=["raceId"])
    merged["raceId"] = merged["raceId"].astype(int)
    merged["round"] = merged["raceId"] % 100
    numbers = _race_numbers()
    latest_numbers = _season_numbers()
    merged = merged.rename(columns={"driver_number": "number"})
    merged = merged.merge(numbers, on=["season", "round", "number"], how="left")
    with_latest = merged.merge(latest_numbers, on=["season", "number"], how="left",
                               suffixes=("", "_latest"))
    fallback = pd.Series(with_latest["driverId_latest"].to_numpy(), index=merged.index)
    merged["driverId"] = merged["driverId"].fillna(fallback)
    return merged.dropna(subset=["driverId"])


def _season_numbers() -> pd.DataFrame:
    """Latest known driverId per (season, car number), for weekends with no Jolpica rows yet."""
    numbers = _race_numbers().sort_values(["season", "round"])
    latest = numbers.drop_duplicates(["season", "number"], keep="last")
    return latest[["season", "number", "driverId"]]


def _race_for_day(races: pd.DataFrame, season, day):
    if pd.isna(day):
        return None
    same_season = races[races["season"] == season]
    delta_days = (same_season["date"] - day).dt.days
    in_weekend = same_season[(delta_days >= 0) & (delta_days <= 4)]
    if not len(in_weekend):
        return None
    return int(in_weekend["raceId"].iloc[0])


def _openf1_duration_list(value) -> list:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return []
    text = str(value).strip()
    if text.startswith("["):
        cleaned = text.strip("[]")
        parts = [part.strip() for part in cleaned.split(",") if part.strip()]
        return [_to_float(part) for part in parts]
    return [_to_float(text)]


def _to_float(text: str) -> float:
    try:
        return float(text)
    except ValueError:
        return np.nan


def _best_ms(values: list) -> float:
    finite = [v for v in values if v == v]
    if not finite:
        return np.nan
    return min(finite) * 1000.0


def _nth_ms(values: list, index: int) -> float:
    if index >= len(values) or values[index] != values[index]:
        return np.nan
    return values[index] * 1000.0


def _long_runs_for_session(race_id: int, session: str, laps: pd.DataFrame) -> list:
    """Median corrected lap of each driver's long runs (stints of at least 5 clean laps).

    Corrections: fuel burn (0.06 s per lap of the session lap number, laps later in the
    session are faster with less fuel, so later laps are made slower), tyre age (0.05 s per
    lap of tyre life) and compound offsets estimated from the session itself. The degradation
    slope is the driver's own within-stint slope of the fuel corrected lap on tyre age.
    """
    rows = []
    session_best = laps["lapTimeS"].min()
    clean = laps[laps["lapTimeS"] < session_best * 1.12].copy()
    if not len(clean):
        return rows
    clean["tyreLife"] = clean["tyreLife"].fillna(1.0)
    clean["corrected"] = clean["lapTimeS"] + 0.06 * clean["lapNumber"] - 0.05 * clean["tyreLife"]
    compound_median = clean.groupby("compound")["corrected"].median()
    reference = compound_median.get("MEDIUM", compound_median.median())
    offsets = compound_median - reference
    clean["corrected"] = clean["corrected"] - clean["compound"].map(offsets).fillna(0.0)
    clean["fuelCorrected"] = clean["lapTimeS"] + 0.06 * clean["lapNumber"]
    for driver_id, driver_laps in clean.groupby("driverId"):
        long_laps = []
        kept_stints = []
        for _, stint in driver_laps.groupby("stint"):
            if len(stint) < 5:
                continue
            threshold = stint["corrected"].median() * 1.02
            kept = stint[stint["corrected"] < threshold]
            long_laps.extend(kept["corrected"].tolist())
            kept_stints.append(kept)
        if len(long_laps) >= 5:
            median = float(np.median(long_laps))
            count = len(long_laps)
            slope = _degradation_slope(kept_stints)
            rows.append((race_id, driver_id, session, median, count, slope))
    return rows


def _degradation_slope(stints: list) -> float:
    """Pooled within-stint slope (s per lap of tyre age) of the fuel corrected lap time."""
    lap_parts = []
    age_parts = []
    for stint in stints:
        age = stint["tyreLife"].to_numpy(dtype=float)
        lap = stint["fuelCorrected"].to_numpy(dtype=float)
        if len(age) < 3:
            continue
        age_parts.append(age - age.mean())
        lap_parts.append(lap - lap.mean())
    if not age_parts:
        return np.nan
    age_dev = np.concatenate(age_parts)
    lap_dev = np.concatenate(lap_parts)
    if len(age_dev) < 8:
        return np.nan
    denominator = float((age_dev ** 2).sum())
    if denominator < 1e-9:
        return np.nan
    return float((age_dev * lap_dev).sum() / denominator)
