"""Fill known Jolpica gaps from F1DB (https://github.com/f1db/f1db, CC BY 4.0).

Jolpica (Ergast) lacks fastest laps before 2004 and qualifying before 2003 (1994 to 2002 only
partially), and has a few races whose qualifying order is known but every lap time is missing
(2025 Miami). F1DB has all of these, plus circuit layouts. F1DB rows only fill gaps; Jolpica
values are never overwritten.

F1DB uses its own ids ("lewis-hamilton"), so they are mapped onto Jolpica ids by matching
race results on (season, round, car number), the most common pairing wins.
"""

from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

import httpx
import pandas as pd

from f1p.paths import raw_dir

RELEASE_URL = "https://api.github.com/repos/f1db/f1db/releases/latest"
ASSET_NAME = "f1db-csv.zip"


def ensure_f1db() -> Path | None:
    """Download the latest F1DB CSV release if it is new; return its csv folder."""
    root = raw_dir("f1db")
    current_path = root / "current.json"
    current = _read_json(current_path)
    release = _latest_release()

    if release is None:
        if current is None:
            print("  F1DB unreachable and nothing on disk, skipping the supplement")
            return None
        print("  F1DB unreachable, keeping the release already on disk")
        return root / current["tag"] / "csv"

    csv_dir = root / release["tag"] / "csv"
    if current and current["tag"] == release["tag"] and csv_dir.exists():
        print(f"  F1DB {release['tag']} is current")
        return csv_dir

    print(f"  downloading F1DB {release['tag']}")
    _download_and_extract(release["url"], root / release["tag"])
    release_text = json.dumps(release, indent=2)
    current_path.write_text(release_text, encoding="utf-8")
    for child in root.iterdir():
        if child.is_dir() and child.name != release["tag"]:
            shutil.rmtree(child)
    return csv_dir


def current_f1db_info() -> dict | None:
    current_path = raw_dir("f1db") / "current.json"
    return _read_json(current_path)


def enrich(tables: dict[str, pd.DataFrame], csv_dir: Path) -> dict[str, int]:
    """Fill fastest laps, qualifying and circuit layouts in place; return fill counts."""
    f1db_races = _read(csv_dir, "races")
    race_results = _read(csv_dir, "races-race-results")
    fastest_laps = _read(csv_dir, "races-fastest-laps")
    qualifying = _read(csv_dir, "races-qualifying-results")
    f1db_drivers = _read(csv_dir, "drivers")

    driver_map = _id_map(race_results, tables["results"], "driverId")
    birth_matches = _driver_map_by_birth(f1db_drivers, tables["drivers"], driver_map)
    driver_map.update(birth_matches)
    constructor_map = _id_map(race_results, tables["results"], "constructorId")

    filled_laps = _fill_fastest_laps(tables, fastest_laps, driver_map)
    timed_quali = _fill_qualifying_times(tables, qualifying, driver_map)
    added_quali, skipped_quali = _fill_qualifying(tables, qualifying, driver_map,
                                                  constructor_map)
    layout_races = _add_layouts(tables, f1db_races)
    return {
        "fastestLapRowsFilled": filled_laps,
        "qualifyingTimesFilled": timed_quali,
        "qualifyingRowsAdded": added_quali,
        "qualifyingRowsUnmapped": skipped_quali,
        "racesWithLayout": layout_races,
    }


def _fill_fastest_laps(tables: dict[str, pd.DataFrame], fastest_laps: pd.DataFrame,
                       driver_map: dict[str, str]) -> int:
    results = tables["results"]
    has_jolpica = results.groupby("raceId")["fastestLapRank"].apply(lambda s: (s == 1).any())
    races_missing = set(has_jolpica[~has_jolpica].index)

    lap_numbers = _car_numbers(fastest_laps["driverNumber"])
    lap_drivers = fastest_laps["driverId"].map(driver_map)
    laps = fastest_laps.assign(
        raceId=fastest_laps["year"] * 100 + fastest_laps["round"],
        driverId=lap_drivers,
        number=lap_numbers,
    )
    laps = laps[laps["raceId"].isin(races_missing) & laps["driverId"].notna()]
    laps = laps.drop_duplicates(["raceId", "driverId", "number"])
    fill = laps[["raceId", "driverId", "number", "positionNumber", "lap", "timeMillis"]]

    merged = results.merge(fill, on=["raceId", "driverId", "number"], how="left")
    target = merged["fastestLapRank"].isna() & merged["positionNumber"].notna()
    merged.loc[target, "fastestLapRank"] = merged.loc[target, "positionNumber"]
    merged.loc[target, "fastestLap"] = merged.loc[target, "lap"]
    merged.loc[target, "fastestLapTimeMs"] = merged.loc[target, "timeMillis"]
    tables["results"] = merged.drop(columns=["positionNumber", "lap", "timeMillis"])
    return int(target.sum())


def _fill_qualifying_times(tables: dict[str, pd.DataFrame], qualifying: pd.DataFrame,
                           driver_map: dict[str, str]) -> int:
    """Times for knockout era races where Jolpica has the order but not a single lap time.

    Only whole races are filled: a single driver without times is usually a qualifying
    disqualification, where the official classification voids the times on purpose.
    """
    existing = tables["qualifying"]
    knockout = existing[existing["season"] >= 2006]
    has_time = knockout[["q1Ms", "q2Ms", "q3Ms"]].notna().any(axis=1)
    timed_races = has_time.groupby(knockout["raceId"]).any()
    untimed_races = set(timed_races[~timed_races].index)
    if not untimed_races:
        return 0

    race_ids = qualifying["year"] * 100 + qualifying["round"]
    mapped_drivers = qualifying["driverId"].map(driver_map)
    times = pd.DataFrame({
        "raceId": race_ids,
        "driverId": mapped_drivers,
        "f1dbQ1": qualifying["q1Millis"],
        "f1dbQ2": qualifying["q2Millis"],
        "f1dbQ3": qualifying["q3Millis"],
    })
    times = times[times["raceId"].isin(untimed_races) & times["driverId"].notna()]
    times = times.drop_duplicates(["raceId", "driverId"])

    merged = existing.merge(times, on=["raceId", "driverId"], how="left")
    target = merged["raceId"].isin(untimed_races) & merged["f1dbQ1"].notna()
    for column, source in (("q1Ms", "f1dbQ1"), ("q2Ms", "f1dbQ2"), ("q3Ms", "f1dbQ3")):
        merged.loc[target, column] = merged.loc[target, source]
    tables["qualifying"] = merged.drop(columns=["f1dbQ1", "f1dbQ2", "f1dbQ3"])

    filled_races = sorted(merged.loc[target, "raceId"].unique().tolist())
    still_empty = sorted(untimed_races - set(filled_races))
    print(f"  qualifying times from F1DB for races {filled_races}, still without times: "
          f"{still_empty or 'none'}")
    return int(target.sum())


def _fill_qualifying(tables: dict[str, pd.DataFrame], qualifying: pd.DataFrame,
                     driver_map: dict[str, str],
                     constructor_map: dict[str, str]) -> tuple[int, int]:
    """Add F1DB qualifying for races that have no Jolpica qualifying rows at all."""
    existing = tables["qualifying"].assign(source="jolpica")
    finished_races = set(tables["races"].loc[tables["races"]["hasResults"], "raceId"])
    covered = set(existing["raceId"])

    rows = qualifying.assign(raceId=qualifying["year"] * 100 + qualifying["round"])
    rows = rows[rows["raceId"].isin(finished_races) & ~rows["raceId"].isin(covered)]
    rows = rows[rows["positionNumber"].notna()]
    mapped_drivers = rows["driverId"].map(driver_map)
    mapped_constructors = rows["constructorId"].map(constructor_map)
    is_mapped = mapped_drivers.notna() & mapped_constructors.notna()

    car_numbers = _car_numbers(rows["driverNumber"])
    q1_times = rows["q1Millis"].fillna(rows["timeMillis"])
    added = pd.DataFrame({
        "raceId": rows["raceId"],
        "season": rows["year"],
        "round": rows["round"],
        "driverId": mapped_drivers,
        "constructorId": mapped_constructors,
        "number": car_numbers,
        "position": rows["positionNumber"],
        "q1Ms": q1_times,
        "q2Ms": rows["q2Millis"],
        "q3Ms": rows["q3Millis"],
        "source": "f1db",
    })[is_mapped]
    combined = pd.concat([existing, added], ignore_index=True)
    combined = combined.drop_duplicates(["raceId", "driverId", "number"])
    tables["qualifying"] = combined.sort_values(["season", "round", "position"]).reset_index(
        drop=True)
    return len(added), int((~is_mapped).sum())


def _add_layouts(tables: dict[str, pd.DataFrame], f1db_races: pd.DataFrame) -> int:
    layouts = pd.DataFrame({
        "season": f1db_races["year"],
        "round": f1db_races["round"],
        "circuitLayoutId": f1db_races["circuitLayoutId"],
        "courseLengthKm": f1db_races["courseLength"],
        "turns": f1db_races["turns"],
    })
    races = tables["races"].drop(columns=["circuitLayoutId", "courseLengthKm", "turns"],
                                 errors="ignore")
    tables["races"] = races.merge(layouts, on=["season", "round"], how="left")
    return int(tables["races"]["circuitLayoutId"].notna().sum())


def _id_map(f1db_results: pd.DataFrame, results: pd.DataFrame, id_column: str) -> dict[str, str]:
    """Map F1DB ids to Jolpica ids via shared (season, round, car number) race entries."""
    car_numbers = _car_numbers(f1db_results["driverNumber"])
    f1db_keys = pd.DataFrame({
        "season": f1db_results["year"],
        "round": f1db_results["round"],
        "number": car_numbers,
        "f1dbId": f1db_results[id_column],
    })
    jolpica_keys = results[["season", "round", "number", id_column]].rename(
        columns={id_column: "jolpicaId"})
    pairs = f1db_keys.merge(jolpica_keys, on=["season", "round", "number"])
    counts = pairs.groupby(["f1dbId", "jolpicaId"]).size().reset_index(name="n")
    best = counts.sort_values("n", ascending=False).drop_duplicates("f1dbId")
    return dict(zip(best["f1dbId"], best["jolpicaId"]))


def _driver_map_by_birth(f1db_drivers: pd.DataFrame, drivers: pd.DataFrame,
                         known: dict[str, str]) -> dict[str, str]:
    """Drivers who never started a race (DNQ only) are matched on surname and birth date."""
    unknown = f1db_drivers[~f1db_drivers["id"].isin(known.keys())]
    left = pd.DataFrame({
        "f1dbId": unknown["id"],
        "surname": unknown["lastName"].str.lower(),
        "dob": pd.to_datetime(unknown["dateOfBirth"], errors="coerce"),
    })
    right = pd.DataFrame({
        "jolpicaId": drivers["driverId"],
        "surname": drivers["familyName"].str.lower(),
        "dob": pd.to_datetime(drivers["dateOfBirth"], errors="coerce"),
    })
    matched = left.merge(right, on=["surname", "dob"]).drop_duplicates("f1dbId", keep=False)
    return dict(zip(matched["f1dbId"], matched["jolpicaId"]))


def _car_numbers(values: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(values, errors="coerce")
    return numeric.astype("Int64")


def _read_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    return json.loads(text)


def _read(csv_dir: Path, name: str) -> pd.DataFrame:
    return pd.read_csv(csv_dir / f"f1db-{name}.csv", low_memory=False)


def _latest_release() -> dict | None:
    try:
        response = httpx.get(RELEASE_URL, timeout=60, follow_redirects=True)
        response.raise_for_status()
    except httpx.HTTPError as error:
        print(f"  F1DB release lookup failed: {error}")
        return None
    release = response.json()
    for asset in release.get("assets", []):
        if asset["name"] == ASSET_NAME:
            return {"tag": release["tag_name"], "publishedAt": release.get("published_at"),
                    "url": asset["browser_download_url"]}
    return None


def _download_and_extract(url: str, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    zip_path = target / ASSET_NAME
    with httpx.stream("GET", url, follow_redirects=True, timeout=300) as response:
        response.raise_for_status()
        with zip_path.open("wb") as handle:
            for chunk in response.iter_bytes():
                handle.write(chunk)
    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(target / "csv")
