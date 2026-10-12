"""Merge dump and API data into the processed tables and write them as typed parquet."""

from __future__ import annotations

import warnings

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from f1p.history import from_api
from f1p.history.corrections import apply_race_fixes
from f1p.paths import processed_path

I16, I32, I64 = pa.int16(), pa.int32(), pa.int64()
F64, STR, BOOL = pa.float64(), pa.string(), pa.bool_()
DATE, TS = pa.date32(), pa.timestamp("ms")

RACE_KEYS = {"raceId": I32, "season": I16, "round": I16}
RESULT_COLUMNS = {
    **RACE_KEYS, "driverId": STR, "constructorId": STR, "number": I16, "grid": I16,
    "position": I16, "positionText": STR, "positionOrder": I16, "points": F64, "laps": I16,
    "timeMs": I64, "timeText": STR, "fastestLapRank": I16, "fastestLap": I16,
    "fastestLapTimeMs": I32, "fastestLapAvgSpeed": F64, "status": STR, "statusCategory": STR,
}
SCHEMAS: dict[str, dict[str, pa.DataType]] = {
    "seasons": {"season": I16, "url": STR, "rounds": I16, "completedRounds": I16},
    "races": {
        **RACE_KEYS, "raceName": STR, "circuitId": STR, "date": DATE, "time": STR,
        "raceUtc": TS, "timezone": STR, "hasSprint": BOOL, "hasResults": BOOL, "fp1Utc": TS,
        "fp2Utc": TS, "fp3Utc": TS, "qualifyingUtc": TS, "sprintQualifyingUtc": TS,
        "sprintUtc": TS, "circuitLayoutId": STR, "courseLengthKm": F64, "turns": I16,
        "url": STR,
    },
    "circuits": {
        "circuitId": STR, "circuitName": STR, "locality": STR, "country": STR,
        "countryCode": STR, "lat": F64, "lng": F64, "alt": I32, "url": STR,
    },
    "drivers": {
        "driverId": STR, "permanentNumber": I16, "code": STR, "givenName": STR,
        "familyName": STR, "fullName": STR, "dateOfBirth": DATE, "nationality": STR,
        "countryCode": STR, "url": STR,
    },
    "constructors": {
        "constructorId": STR, "name": STR, "nationality": STR, "countryCode": STR,
        "primaryColor": STR, "url": STR,
    },
    "results": RESULT_COLUMNS,
    "sprint_results": RESULT_COLUMNS,
    "qualifying": {
        **RACE_KEYS, "driverId": STR, "constructorId": STR, "number": I16, "position": I16,
        "q1Ms": I32, "q2Ms": I32, "q3Ms": I32, "source": STR,
    },
    "lap_times": {**RACE_KEYS, "driverId": STR, "lap": I16, "position": I16, "timeMs": I32},
    "pit_stops": {
        **RACE_KEYS, "driverId": STR, "stop": I16, "lap": I16, "localTime": STR,
        "durationMs": I32,
    },
    "driver_standings": {
        **RACE_KEYS, "driverId": STR, "points": F64, "position": I16, "positionText": STR,
        "wins": I16, "constructorIds": STR,
    },
    "constructor_standings": {
        **RACE_KEYS, "constructorId": STR, "points": F64, "position": I16,
        "positionText": STR, "wins": I16,
    },
    "season_entries": {
        "season": I16, "driverId": STR, "constructorId": STR, "role": STR, "races": I16,
        "firstRound": I16, "lastRound": I16, "carNumbers": STR,
    },
    "status": {"status": STR, "statusCategory": STR, "results": I32},
}
ROUND_TABLES = {
    "results": ["raceId", "driverId", "number"],
    "sprint_results": ["raceId", "driverId", "number"],
    "qualifying": ["raceId", "driverId", "number"],
    "lap_times": ["raceId", "driverId", "lap"],
    "pit_stops": ["raceId", "driverId", "stop"],
    "driver_standings": ["raceId", "driverId"],
    "constructor_standings": ["raceId", "constructorId"],
}


def build_processed(dump_tables: dict[str, pd.DataFrame], gap: dict) -> dict[str, pd.DataFrame]:
    """Combine the dump with the API gap rounds; dump rows win on any overlap."""
    status_categories = _status_categories(dump_tables)
    api_tables = _api_tables(gap, status_categories)
    tables: dict[str, pd.DataFrame] = {}

    for name, key in ROUND_TABLES.items():
        combined = _concat(dump_tables[name], api_tables[name])
        tables[name] = combined.drop_duplicates(key, keep="first")

    tables["races"] = _races(dump_tables["races"], gap["schedules"], tables["results"])
    tables["circuits"] = _append_missing(dump_tables["circuits"], api_tables["circuits"],
                                         "circuitId")
    tables["drivers"] = _append_missing(dump_tables["drivers"], api_tables["drivers"],
                                        "driverId")
    tables["constructors"] = _append_missing(dump_tables["constructors"],
                                             api_tables["constructors"], "constructorId")
    tables["seasons"] = _seasons(dump_tables["seasons"], tables["races"])
    tables["season_entries"] = _season_entries(dump_tables["season_entries"], tables["results"])
    tables["status"] = _status_table(tables["results"], tables["sprint_results"])
    for name in ("results", "sprint_results"):
        tables[name] = _with_time_text(tables[name])
    return tables


def write_processed(tables: dict[str, pd.DataFrame]) -> dict[str, int]:
    """Write every table to data/processed/<name>.parquet with an explicit schema."""
    row_counts = {}
    for name, frame in tables.items():
        arrow_table = to_arrow(name, frame)
        path = processed_path(name)
        temp_path = path.with_suffix(".parquet.tmp")
        pq.write_table(arrow_table, temp_path, compression="zstd")
        temp_path.replace(path)
        row_counts[name] = arrow_table.num_rows
    return row_counts


def to_arrow(name: str, frame: pd.DataFrame) -> pa.Table:
    columns = SCHEMAS[name]
    arrays = []
    for column, arrow_type in columns.items():
        empty_column = pd.Series([None] * len(frame))
        values = frame[column] if column in frame.columns else empty_column
        array = _to_array(values, arrow_type)
        arrays.append(array)
    fields = list(columns.items())
    schema = pa.schema(fields)
    return pa.Table.from_arrays(arrays, schema=schema)


def _to_array(values: pd.Series, arrow_type: pa.DataType) -> pa.Array:
    if arrow_type == DATE:
        converted = pd.to_datetime(values).dt.date
        return pa.array(converted, type=arrow_type, from_pandas=True)
    if arrow_type == TS:
        converted = pd.to_datetime(values)
        return pa.array(converted, type=arrow_type, from_pandas=True)
    if pa.types.is_integer(arrow_type):
        converted = pd.array(values, dtype="Int64")
        return pa.array(converted, type=arrow_type, from_pandas=True)
    if arrow_type == STR:
        is_present = values.notna()
        converted = values.astype(object).where(is_present, None)
        as_text = [None if item is None else str(item) for item in converted]
        return pa.array(as_text, type=arrow_type)
    return pa.array(values, type=arrow_type, from_pandas=True)


def _api_tables(gap: dict, status_categories: dict[str, str]) -> dict[str, pd.DataFrame]:
    parts: dict[str, list[pd.DataFrame]] = {name: [] for name in ROUND_TABLES}
    embedded_races: list[dict] = []
    for payload in gap["rounds"]:
        for race in payload["results"]:
            race_rows = from_api.results_from_api(race, "Results", status_categories)
            parts["results"].append(race_rows)
            embedded_races.append(race)
        for race in payload["sprint"]:
            sprint_rows = from_api.results_from_api(race, "SprintResults", status_categories)
            parts["sprint_results"].append(sprint_rows)
            embedded_races.append(race)
        for race in payload["qualifying"]:
            quali_rows = from_api.qualifying_from_api(race)
            parts["qualifying"].append(quali_rows)
            embedded_races.append(race)
        for race in payload["laps"]:
            lap_rows = from_api.laps_from_api(race)
            parts["lap_times"].append(lap_rows)
        for race in payload["pitstops"]:
            stop_rows = from_api.pit_stops_from_api(race)
            parts["pit_stops"].append(stop_rows)
        driver_rows = from_api.driver_standings_from_api(payload["driverstandings"])
        parts["driver_standings"].append(driver_rows)
        team_rows = from_api.constructor_standings_from_api(payload["constructorstandings"])
        parts["constructor_standings"].append(team_rows)

    tables = {name: _concat(*frames) for name, frames in parts.items()}
    all_schedule_races = [race for races in gap["schedules"].values() for race in races]
    tables["circuits"] = from_api.circuits_from_schedule(all_schedule_races)
    tables["drivers"] = from_api.drivers_from_api(embedded_races)
    tables["constructors"] = from_api.constructors_from_api(embedded_races)
    return tables


def _races(dump_races: pd.DataFrame, schedules: dict[int, list[dict]],
           results: pd.DataFrame) -> pd.DataFrame:
    """Dump calendar, with seasons fetched from the API replaced by the live schedule.

    Known calendar errors in either source are corrected afterwards (see corrections.py).
    """
    api_frames = [from_api.races_from_schedule(races) for races in schedules.values() if races]
    races = dump_races
    if api_frames:
        api_races = _concat(*api_frames)
        timezones = dump_races[["season", "circuitId", "timezone"]].drop_duplicates(
            ["season", "circuitId"])
        api_races = api_races.merge(timezones, on=["season", "circuitId"], how="left")
        kept = dump_races[~dump_races["season"].isin(api_races["season"].unique())]
        races = _concat(kept, api_races)
    races = races.sort_values(["season", "round"]).reset_index(drop=True)
    races = apply_race_fixes(races)
    finished_race_ids = set(results["raceId"].unique())
    races["hasResults"] = races["raceId"].isin(finished_race_ids)
    return races


def _seasons(dump_seasons: pd.DataFrame, races: pd.DataFrame) -> pd.DataFrame:
    per_season = races.groupby("season").agg(rounds=("round", "count"),
                                             completedRounds=("hasResults", "sum"))
    seasons = per_season.reset_index().merge(dump_seasons, on="season", how="left")
    fallback_urls = "https://en.wikipedia.org/wiki/" + seasons["season"].astype(str) + \
        "_Formula_One_World_Championship"
    seasons["url"] = seasons["url"].fillna(fallback_urls)
    return seasons


def _season_entries(roster: pd.DataFrame, results: pd.DataFrame) -> pd.DataFrame:
    """Roster per season plus race counts; drivers who raced but are not rostered are added."""
    starts = results.groupby(["season", "driverId", "constructorId"]).agg(
        races=("raceId", "nunique"), firstRound=("round", "min"), lastRound=("round", "max"),
        carNumbers=("number", _join_numbers)).reset_index()
    keys = ["season", "driverId", "constructorId"]
    merged = roster.merge(starts, on=keys, how="outer")
    merged["races"] = merged["races"].fillna(0)
    return merged.sort_values(keys).reset_index(drop=True)


def _status_table(results: pd.DataFrame, sprint_results: pd.DataFrame) -> pd.DataFrame:
    combined = _concat(results, sprint_results)
    grouped = combined.groupby(["status", "statusCategory"], dropna=False).size()
    table = grouped.reset_index(name="results").sort_values("results", ascending=False)
    return table.drop_duplicates("status")


def _status_categories(dump_tables: dict[str, pd.DataFrame]) -> dict[str, str]:
    combined = _concat(dump_tables["results"], dump_tables["sprint_results"])
    counts = combined.groupby(["status", "statusCategory"]).size().reset_index(name="n")
    top = counts.sort_values("n", ascending=False).drop_duplicates("status")
    return dict(zip(top["status"], top["statusCategory"]))


def _with_time_text(results: pd.DataFrame) -> pd.DataFrame:
    """Ergast style finish time: winner as h:mm:ss.sss, others as a +gap."""
    winners = results[results["positionOrder"] == 1][["raceId", "timeMs"]]
    winner_times = winners.dropna().drop_duplicates("raceId").rename(
        columns={"timeMs": "winnerMs"})
    merged = results.merge(winner_times, on="raceId", how="left")
    texts = [
        _finish_text(time_ms, winner_ms)
        for time_ms, winner_ms in zip(merged["timeMs"], merged["winnerMs"])
    ]
    merged["timeText"] = texts
    return merged.drop(columns=["winnerMs"])


def _finish_text(time_ms, winner_ms) -> str | None:
    if pd.isna(time_ms) or pd.isna(winner_ms):
        return None
    time_ms = int(time_ms)
    winner_ms = int(winner_ms)
    if time_ms == winner_ms:
        return _clock(time_ms)
    if time_ms < winner_ms:
        return None
    return "+" + _clock(time_ms - winner_ms)


def _clock(total_ms: int) -> str:
    hours, rest = divmod(total_ms, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    seconds, millis = divmod(rest, 1000)
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}.{millis:03d}"
    if minutes:
        return f"{minutes}:{seconds:02d}.{millis:03d}"
    return f"{seconds}.{millis:03d}"


def _append_missing(base: pd.DataFrame, extra: pd.DataFrame, key: str) -> pd.DataFrame:
    if extra.empty:
        return base
    missing = extra[~extra[key].isin(base[key])]
    return _concat(base, missing).sort_values(key).reset_index(drop=True)


def _join_numbers(numbers: pd.Series) -> str:
    unique_numbers = sorted({int(number) for number in numbers.dropna()})
    return ",".join(str(number) for number in unique_numbers)


def _concat(*frames: pd.DataFrame) -> pd.DataFrame:
    non_empty = [frame for frame in frames if frame is not None and not frame.empty]
    if not non_empty:
        return pd.DataFrame()
    with warnings.catch_warnings():
        # API frames carry all-NA columns (e.g. countryCode); their dtype is cast later anyway
        warnings.simplefilter("ignore", FutureWarning)
        return pd.concat(non_empty, ignore_index=True)
