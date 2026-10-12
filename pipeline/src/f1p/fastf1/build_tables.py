"""Merge the per-session FastF1 files into data/processed/ff1_*.parquet.

    uv run python -m f1p.fastf1.build_tables

Writes ff1_laps, ff1_weather, ff1_race_control, ff1_session_results and ff1_id_map, then the
per-session JSON files for the site (see session_export). Can run at any time while the download
is still going; it only reads sessions whose meta.json exists.

Holds data/raw/fastf1/build_tables.lock while writing, so concurrent rebuilds queue up.

Ids: driverId/constructorId are Jolpica (Ergast) ids. Lookup order per driver and event:
Jolpica race/sprint/qualifying entry by car number, then FastF1's own Ergast ids from the
session results, then the same car number elsewhere in the season, then the 3-letter code.
"""

import json

import numpy as np
import pandas as pd

from f1p.fastf1 import session_export
from f1p.fastf1.common import SESSION_ORDER, fastf1_root, td_to_seconds, write_parquet
from f1p.fastf1.locks import exclusive_lock
from f1p.paths import PROCESSED_DIR, processed_path

SESSION_RANK = {code: rank for rank, code in enumerate(SESSION_ORDER)}
SHARED_ID_MAP = "id_map"
ID_MAP_SOURCE = "fastf1"


# A second rebuild (refresh vs a manual run) waits this long for the first one to finish.
LOCK_WAIT_S = 30 * 60


def main() -> None:
    with exclusive_lock("build_tables", wait_s=LOCK_WAIT_S):
        build_all()


def build_all() -> None:
    sessions = _done_sessions()
    print(f"{len(sessions)} sessions with meta.json")
    results = build_session_results(sessions)
    id_lookup = IdLookup(results)
    results = id_lookup.apply(results)
    laps = build_laps(sessions)
    laps = id_lookup.apply(laps)
    weather = build_weather(sessions)
    race_control = build_race_control(sessions)
    id_map = id_lookup.season_map(results)

    outputs = {
        "ff1_session_results": results,
        "ff1_laps": laps,
        "ff1_weather": weather,
        "ff1_race_control": race_control,
        "ff1_id_map": id_map,
    }
    for name, frame in outputs.items():
        path = processed_path(name)
        write_parquet(frame, path)
        print(f"{name}: {len(frame):,} rows -> {path}")
    _write_shared_id_map(id_map)
    _print_mapping_gaps(laps)
    overtakes = session_export.read_overtakes()
    exported = session_export.export_all(results, laps, weather, overtakes)
    print(f"session JSON files: {exported}")


def build_laps(sessions: list[dict]) -> pd.DataFrame:
    frames = []
    for meta in sessions:
        raw = _read(meta, "laps.parquet")
        if raw.empty:
            continue
        frames.append(_convert_laps(raw, meta))
    laps = _concat(frames)
    if laps.empty:
        return laps
    keys = ["season", "round", "session", "driverNumber", "lapNumber"]
    before = len(laps)
    laps = laps.drop_duplicates(keys, keep="first")
    dropped = before - len(laps)
    if dropped:
        print(f"ff1_laps: dropped {dropped} duplicated laps")
    return _sorted(laps, ["driverNumber", "lapNumber"])


def build_session_results(sessions: list[dict]) -> pd.DataFrame:
    frames = []
    for meta in sessions:
        raw = _read(meta, "results.parquet")
        if raw.empty:
            continue
        frames.append(_convert_results(raw, meta))
    results = _concat(frames)
    return _sorted(results, ["position", "driverNumber"]) if not results.empty else results


def build_weather(sessions: list[dict]) -> pd.DataFrame:
    frames = []
    for meta in sessions:
        raw = _read(meta, "weather.parquet")
        if raw.empty:
            continue
        frame = pd.DataFrame({
            "timeS": td_to_seconds(raw["Time"]),
            "airTemp": raw["AirTemp"],
            "trackTemp": raw["TrackTemp"],
            "humidity": raw["Humidity"],
            "pressure": raw["Pressure"],
            "rainfall": raw["Rainfall"].astype("boolean"),
            "windDirection": raw["WindDirection"],
            "windSpeed": raw["WindSpeed"],
        })
        frames.append(_with_session_keys(frame, meta))
    weather = _concat(frames)
    return _sorted(weather, ["timeS"]) if not weather.empty else weather


def build_race_control(sessions: list[dict]) -> pd.DataFrame:
    frames = []
    for meta in sessions:
        raw = _read(meta, "race_control.parquet")
        if raw.empty:
            continue
        session_ms = raw["sessionTimeMs"] if "sessionTimeMs" in raw else pd.Series(pd.NA, index=raw.index)
        frame = pd.DataFrame({
            "timeUtc": pd.to_datetime(raw["Time"]),
            "sessionTimeMs": session_ms.astype("Int64"),
            "category": raw["Category"].astype("string"),
            "message": raw["Message"].astype("string"),
            "status": raw["Status"].astype("string"),
            "flag": raw["Flag"].astype("string"),
            "scope": raw["Scope"].astype("string"),
            "sector": pd.to_numeric(raw["Sector"], errors="coerce").astype("Int16"),
            "racingNumber": pd.to_numeric(raw["RacingNumber"], errors="coerce").astype("Int16"),
            "lap": pd.to_numeric(raw["Lap"], errors="coerce").astype("Int16"),
        })
        frames.append(_with_session_keys(frame, meta))
    messages = _concat(frames)
    return _sorted(messages, ["timeUtc"]) if not messages.empty else messages


class IdLookup:
    """Maps (season, round, session, driverNumber) to Jolpica driverId / constructorId."""

    def __init__(self, ff1_results: pd.DataFrame):
        self.jolpica_entries = _jolpica_entries()
        self.ff1_event = _ff1_event_ids(ff1_results)
        self.ff1_season = _ff1_season_ids(ff1_results)
        self.code_to_driver = _code_lookup()

    def apply(self, frame: pd.DataFrame) -> pd.DataFrame:
        if frame.empty:
            return frame
        keys = frame[["season", "round", "driverNumber", "code"]].drop_duplicates()
        resolved = self._resolve(keys)
        frame = frame.drop(columns=["driverId", "constructorId"], errors="ignore")
        merged = frame.merge(resolved, on=["season", "round", "driverNumber", "code"], how="left")
        merged = _move_after(merged, ["driverId", "constructorId"], "team")
        return merged

    def season_map(self, results: pd.DataFrame) -> pd.DataFrame:
        """One row per season, car number and code: the FastF1 view of the shared id map."""
        if results.empty:
            return results
        columns = ["season", "driverNumber", "code", "driverId", "constructorId", "fullName", "teamName"]
        rows = results[columns].dropna(subset=["code"])
        grouped = rows.groupby(["season", "driverNumber", "code"], dropna=False)
        id_map = grouped.agg(
            driverId=("driverId", _mode),
            constructorId=("constructorId", _mode),
            constructorIds=("constructorId", _unique_join),
            fullName=("fullName", _mode),
            teamName=("teamName", _mode),
            sessions=("driverId", "size"),
        ).reset_index()
        id_map["source"] = ID_MAP_SOURCE
        return id_map.sort_values(["season", "driverNumber"]).reset_index(drop=True)

    def _resolve(self, keys: pd.DataFrame) -> pd.DataFrame:
        resolved = keys.merge(self.jolpica_entries, on=["season", "round", "driverNumber"], how="left")
        event_ids = self.ff1_event.rename(columns={"driverId": "ff1DriverId", "constructorId": "ff1ConstructorId"})
        resolved = resolved.merge(event_ids, on=["season", "round", "driverNumber"], how="left")
        season_ids = self.ff1_season.rename(columns={"driverId": "seasonDriverId", "constructorId": "seasonConstructorId"})
        resolved = resolved.merge(season_ids, on=["season", "driverNumber"], how="left")
        code_ids = self.code_to_driver.rename(columns={"driverId": "codeDriverId"})
        resolved = resolved.merge(code_ids, on="code", how="left")

        driver = resolved["driverId"].fillna(resolved["ff1DriverId"])
        driver = driver.fillna(resolved["seasonDriverId"])
        driver = driver.fillna(resolved["codeDriverId"])
        constructor = resolved["constructorId"].fillna(resolved["ff1ConstructorId"])
        constructor = constructor.fillna(resolved["seasonConstructorId"])
        return pd.DataFrame({
            "season": resolved["season"],
            "round": resolved["round"],
            "driverNumber": resolved["driverNumber"],
            "code": resolved["code"],
            "driverId": driver.astype("string"),
            "constructorId": constructor.astype("string"),
        })


def _convert_laps(raw: pd.DataFrame, meta: dict) -> pd.DataFrame:
    driver_number = _driver_number(raw["DriverNumber"])
    frame = pd.DataFrame({
        "driverNumber": driver_number.astype("Int16"),
        "code": raw["Driver"].astype("string"),
        "team": raw["Team"].astype("string"),
        "lapNumber": raw["LapNumber"].astype("Int16"),
        "timeS": td_to_seconds(raw["Time"]),
        "lapTimeS": td_to_seconds(raw["LapTime"]),
        "sector1S": td_to_seconds(raw["Sector1Time"]),
        "sector2S": td_to_seconds(raw["Sector2Time"]),
        "sector3S": td_to_seconds(raw["Sector3Time"]),
        "sector1SessionS": td_to_seconds(raw["Sector1SessionTime"]),
        "sector2SessionS": td_to_seconds(raw["Sector2SessionTime"]),
        "sector3SessionS": td_to_seconds(raw["Sector3SessionTime"]),
        "lapStartS": td_to_seconds(raw["LapStartTime"]),
        "lapStartDate": _optional_column(raw, "LapStartDate"),
        "pitOutS": td_to_seconds(raw["PitOutTime"]),
        "pitInS": td_to_seconds(raw["PitInTime"]),
        "stint": raw["Stint"].astype("Int16"),
        "compound": raw["Compound"].astype("string"),
        "tyreLife": raw["TyreLife"].astype("Float32"),
        "freshTyre": raw["FreshTyre"].astype("boolean"),
        "speedI1": raw["SpeedI1"].astype("Float32"),
        "speedI2": raw["SpeedI2"].astype("Float32"),
        "speedFL": raw["SpeedFL"].astype("Float32"),
        "speedST": raw["SpeedST"].astype("Float32"),
        "isPersonalBest": raw["IsPersonalBest"].astype("boolean"),
        "position": raw["Position"].astype("Int16"),
        "trackStatus": raw["TrackStatus"].astype("string"),
        "deleted": raw["Deleted"].astype("boolean"),
        "deletedReason": raw["DeletedReason"].astype("string"),
        "fastF1Generated": raw["FastF1Generated"].astype("boolean"),
        "isAccurate": raw["IsAccurate"].astype("boolean"),
    })
    return _with_session_keys(frame, meta)


def _convert_results(raw: pd.DataFrame, meta: dict) -> pd.DataFrame:
    driver_number = _driver_number(raw["DriverNumber"])
    frame = pd.DataFrame({
        "driverNumber": driver_number.astype("Int16"),
        "code": raw["Abbreviation"].astype("string"),
        "team": raw["TeamName"].astype("string"),
        "ff1DriverId": _blank_to_na(raw["DriverId"]),
        "ff1TeamId": _blank_to_na(raw["TeamId"]),
        "broadcastName": raw["BroadcastName"].astype("string"),
        "firstName": raw["FirstName"].astype("string"),
        "lastName": raw["LastName"].astype("string"),
        "fullName": raw["FullName"].astype("string"),
        "teamName": raw["TeamName"].astype("string"),
        "teamColor": raw["TeamColor"].astype("string"),
        "countryCode": raw["CountryCode"].astype("string"),
        "headshotUrl": raw["HeadshotUrl"].astype("string"),
        "position": raw["Position"].astype("Float32").astype("Int16"),
        "classifiedPosition": raw["ClassifiedPosition"].astype("string"),
        "gridPosition": raw["GridPosition"].astype("Float32").astype("Int16"),
        "q1S": td_to_seconds(raw["Q1"]),
        "q2S": td_to_seconds(raw["Q2"]),
        "q3S": td_to_seconds(raw["Q3"]),
        "timeS": td_to_seconds(raw["Time"]),
        "status": raw["Status"].astype("string"),
        "points": raw["Points"].astype("Float32"),
        "laps": raw["Laps"].astype("Float32"),
    })
    return _with_session_keys(frame, meta)


def _driver_number(values: pd.Series) -> pd.Series:
    """Car numbers as numbers; feed sentinels such as 65535 (2020 British GP FP1, Perez) become NA."""
    numbers = pd.to_numeric(values, errors="coerce")
    return numbers.where(numbers.between(0, 999))


def _with_session_keys(frame: pd.DataFrame, meta: dict) -> pd.DataFrame:
    keys = pd.DataFrame({
        "season": np.full(len(frame), meta["season"], dtype=np.int16),
        "round": np.full(len(frame), meta["round"], dtype=np.int16),
        "session": meta["session"],
        "eventName": meta["eventName"],
    }, index=frame.index)
    return pd.concat([keys, frame], axis=1)


def _jolpica_entries() -> pd.DataFrame:
    """(season, round, car number) -> ids from Jolpica race, sprint and qualifying results."""
    frames = []
    for name in ("results", "sprint_results", "qualifying"):
        path = PROCESSED_DIR / f"{name}.parquet"
        if not path.exists():
            continue
        table = pd.read_parquet(path, columns=["season", "round", "number", "driverId", "constructorId"])
        frames.append(table[table["season"] >= 2018])
    if not frames:
        print("Jolpica processed tables not found, ids come from FastF1 only")
        return pd.DataFrame(columns=["season", "round", "driverNumber", "driverId", "constructorId"])
    entries = pd.concat(frames, ignore_index=True)
    numbers = pd.to_numeric(entries["number"], errors="coerce")
    entries["driverNumber"] = numbers.astype("Int16")
    entries["season"] = entries["season"].astype("int16")
    entries["round"] = entries["round"].astype("int16")
    entries = entries.dropna(subset=["driverNumber"])
    entries = entries.drop_duplicates(["season", "round", "driverNumber"])
    return entries[["season", "round", "driverNumber", "driverId", "constructorId"]]


def _ff1_event_ids(results: pd.DataFrame) -> pd.DataFrame:
    columns = ["season", "round", "driverNumber", "driverId", "constructorId"]
    if results.empty:
        return pd.DataFrame(columns=columns)
    ids = results.rename(columns={"ff1DriverId": "driverId", "ff1TeamId": "constructorId"})
    ids = ids.dropna(subset=["driverId"])
    ids = ids.drop_duplicates(["season", "round", "driverNumber"])
    return ids[columns]


def _ff1_season_ids(results: pd.DataFrame) -> pd.DataFrame:
    columns = ["season", "driverNumber", "driverId", "constructorId"]
    if results.empty:
        return pd.DataFrame(columns=columns)
    ids = results.rename(columns={"ff1DriverId": "driverId", "ff1TeamId": "constructorId"})
    ids = ids.dropna(subset=["driverId"])
    grouped = ids.groupby(["season", "driverNumber"])
    season_ids = grouped.agg(driverId=("driverId", _mode), constructorId=("constructorId", _mode))
    return season_ids.reset_index()[columns]


def _code_lookup() -> pd.DataFrame:
    """3-letter code -> driverId where the code is unique among drivers active since 2014."""
    path = PROCESSED_DIR / "drivers.parquet"
    if not path.exists():
        return pd.DataFrame(columns=["code", "driverId"])
    drivers = pd.read_parquet(path, columns=["driverId", "code"])
    drivers = drivers.dropna(subset=["code"])
    counts = drivers["code"].value_counts()
    unique_codes = counts[counts == 1].index
    drivers = drivers[drivers["code"].isin(unique_codes)]
    drivers["code"] = drivers["code"].astype("string")
    return drivers[["code", "driverId"]]


def _write_shared_id_map(id_map: pd.DataFrame) -> None:
    """Create the shared id_map.parquet if missing; only refresh it while FastF1 still owns it."""
    path = processed_path(SHARED_ID_MAP)
    if path.exists():
        existing = pd.read_parquet(path)
        owned = "source" in existing and (existing["source"] == ID_MAP_SOURCE).all()
        if not owned:
            print(f"{path.name} exists and was written by another source, left untouched")
            return
    write_parquet(id_map, path)
    print(f"{path.name}: {len(id_map):,} rows (FastF1 view)")


def _print_mapping_gaps(laps: pd.DataFrame) -> None:
    if laps.empty:
        return
    missing = laps[laps["driverId"].isna() | laps["constructorId"].isna()]
    if missing.empty:
        print("ids: every lap mapped to driverId and constructorId")
        return
    sample = missing[["season", "round", "session", "driverNumber", "code", "team"]].drop_duplicates()
    print(f"ids: {len(missing):,} laps without a full mapping, {len(sample)} driver-sessions:")
    print(sample.head(30).to_string(index=False))


def _done_sessions() -> list[dict]:
    root = fastf1_root()
    metas = []
    for path in root.glob("*/*/meta.json"):
        text = path.read_text(encoding="utf-8")
        meta = json.loads(text)
        meta["dir"] = path.parent
        metas.append(meta)
    metas.sort(key=lambda meta: (meta["season"], meta["round"], SESSION_RANK.get(meta["session"], 99)))
    return metas


def _read(meta: dict, name: str) -> pd.DataFrame:
    path = meta["dir"] / name
    if not path.exists():
        return pd.DataFrame()
    return pd.read_parquet(path)


def _concat(frames: list[pd.DataFrame]) -> pd.DataFrame:
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def _sorted(frame: pd.DataFrame, extra: list[str]) -> pd.DataFrame:
    frame["sessionRank"] = frame["session"].map(SESSION_RANK)
    ordered = frame.sort_values(["season", "round", "sessionRank", *extra], kind="stable")
    ordered = ordered.drop(columns=["sessionRank"])
    return ordered.reset_index(drop=True)


def _move_after(frame: pd.DataFrame, columns: list[str], anchor: str) -> pd.DataFrame:
    others = [column for column in frame.columns if column not in columns]
    position = others.index(anchor) + 1 if anchor in others else len(others)
    ordered = others[:position] + columns + others[position:]
    return frame[ordered]


def _optional_column(raw: pd.DataFrame, name: str) -> pd.Series:
    if name in raw:
        return raw[name]
    return pd.Series(pd.NaT, index=raw.index, dtype="datetime64[ns]")


def _blank_to_na(values: pd.Series) -> pd.Series:
    text = values.astype("string")
    stripped = text.str.strip()
    return stripped.mask(stripped == "")


def _mode(values: pd.Series):
    present = values.dropna()
    if present.empty:
        return pd.NA
    counts = present.value_counts()
    return counts.index[0]


def _unique_join(values: pd.Series) -> str:
    present = values.dropna()
    unique = present.unique()
    return ",".join(sorted(unique))


if __name__ == "__main__":
    main()
