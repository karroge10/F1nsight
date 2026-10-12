"""Convert cached Jolpica Ergast API JSON into the same tables as from_dump.py."""

from __future__ import annotations

import pandas as pd

SESSION_COLUMNS = {
    "FirstPractice": "fp1Utc",
    "SecondPractice": "fp2Utc",
    "ThirdPractice": "fp3Utc",
    "Qualifying": "qualifyingUtc",
    "SprintQualifying": "sprintQualifyingUtc",
    "SprintShootout": "sprintQualifyingUtc",
    "Sprint": "sprintUtc",
}


def races_from_schedule(schedule: list[dict]) -> pd.DataFrame:
    rows = [_race_row(race) for race in schedule]
    return pd.DataFrame(rows)


def circuits_from_schedule(schedule: list[dict]) -> pd.DataFrame:
    rows = [_circuit_row(race["Circuit"]) for race in schedule]
    return pd.DataFrame(rows).drop_duplicates("circuitId")


def results_from_api(race: dict, list_key: str, status_categories: dict[str, str]) -> pd.DataFrame:
    """Rows for `Results` (race) or `SprintResults` (sprint) of one race."""
    rows = []
    for item in race.get(list_key, []):
        row = _result_row(race, item, status_categories)
        rows.append(row)
    return pd.DataFrame(rows)


def qualifying_from_api(race: dict) -> pd.DataFrame:
    rows = []
    for item in race.get("QualifyingResults", []):
        rows.append({
            **_race_keys(race),
            "driverId": item["Driver"]["driverId"],
            "constructorId": item["Constructor"]["constructorId"],
            "number": _int_field(item, "number"),
            "position": _int_field(item, "position"),
            "q1Ms": _ms_field(item, "Q1"),
            "q2Ms": _ms_field(item, "Q2"),
            "q3Ms": _ms_field(item, "Q3"),
        })
    return pd.DataFrame(rows)


def laps_from_api(race: dict) -> pd.DataFrame:
    rows = []
    for lap in race.get("Laps", []):
        for timing in lap["Timings"]:
            rows.append({
                **_race_keys(race),
                "driverId": timing["driverId"],
                "lap": int(lap["number"]),
                "position": _int_field(timing, "position"),
                "timeMs": _ms_field(timing, "time"),
            })
    return pd.DataFrame(rows)


def pit_stops_from_api(race: dict) -> pd.DataFrame:
    rows = []
    for stop in race.get("PitStops", []):
        rows.append({
            **_race_keys(race),
            "driverId": stop["driverId"],
            "stop": int(stop["stop"]),
            "lap": _int_field(stop, "lap"),
            "localTime": stop.get("time"),
            "durationMs": _ms_field(stop, "duration"),
        })
    return pd.DataFrame(rows)


def driver_standings_from_api(standings_lists: list[dict]) -> pd.DataFrame:
    rows = []
    for standings in standings_lists:
        keys = _race_keys(standings)
        for item in standings.get("DriverStandings", []):
            constructor_ids = [team["constructorId"] for team in item.get("Constructors", [])]
            rows.append({
                **keys,
                "driverId": item["Driver"]["driverId"],
                "points": float(item["points"]),
                "position": _int_field(item, "position"),
                "positionText": item.get("positionText"),
                "wins": int(item["wins"]),
                "constructorIds": ",".join(constructor_ids),
            })
    return pd.DataFrame(rows)


def constructor_standings_from_api(standings_lists: list[dict]) -> pd.DataFrame:
    rows = []
    for standings in standings_lists:
        keys = _race_keys(standings)
        for item in standings.get("ConstructorStandings", []):
            rows.append({
                **keys,
                "constructorId": item["Constructor"]["constructorId"],
                "points": float(item["points"]),
                "position": _int_field(item, "position"),
                "positionText": item.get("positionText"),
                "wins": int(item["wins"]),
            })
    return pd.DataFrame(rows)


def drivers_from_api(races: list[dict]) -> pd.DataFrame:
    """Driver objects embedded in results, used for debutants not yet in the dump."""
    rows = {}
    for race in races:
        for list_key in ("Results", "SprintResults", "QualifyingResults"):
            for item in race.get(list_key, []):
                driver = item["Driver"]
                rows[driver["driverId"]] = _driver_row(driver)
    unique_rows = list(rows.values())
    return pd.DataFrame(unique_rows)


def constructors_from_api(races: list[dict]) -> pd.DataFrame:
    rows = {}
    for race in races:
        for list_key in ("Results", "SprintResults", "QualifyingResults"):
            for item in race.get(list_key, []):
                team = item["Constructor"]
                rows[team["constructorId"]] = {
                    "constructorId": team["constructorId"],
                    "name": team.get("name"),
                    "nationality": team.get("nationality"),
                    "url": team.get("url"),
                }
    unique_rows = list(rows.values())
    return pd.DataFrame(unique_rows)


def parse_time_ms(text: str | None) -> int | None:
    """Parse Ergast time strings like '1:32.123', '24.036', '1:02:03.4' into milliseconds."""
    if not text:
        return None
    parts = text.split(":")
    seconds = float(parts[-1])
    multiplier = 60
    for part in reversed(parts[:-1]):
        seconds += int(part) * multiplier
        multiplier *= 60
    return round(seconds * 1000)


def _race_row(race: dict) -> dict:
    race_time = race.get("time")
    row = {
        **_race_keys(race),
        "raceName": race["raceName"],
        "circuitId": race["Circuit"]["circuitId"],
        "date": pd.Timestamp(race["date"]),
        "time": race_time.rstrip("Z") if race_time else None,
        "raceUtc": _session_utc(race),
        "hasSprint": "Sprint" in race,
        "url": race.get("url"),
    }
    for key, column in SESSION_COLUMNS.items():
        if key in race:
            row[column] = _session_utc(race[key])
    return row


def _session_utc(session: dict) -> pd.Timestamp | None:
    if not session.get("time"):
        return None
    stamp = f"{session['date']} {session['time'].rstrip('Z')}"
    return pd.Timestamp(stamp)


def _circuit_row(circuit: dict) -> dict:
    location = circuit.get("Location", {})
    return {
        "circuitId": circuit["circuitId"],
        "circuitName": circuit.get("circuitName"),
        "locality": location.get("locality"),
        "country": location.get("country"),
        "lat": _float_field(location, "lat"),
        "lng": _float_field(location, "long"),
        "url": circuit.get("url"),
    }


def _driver_row(driver: dict) -> dict:
    given_name = driver.get("givenName", "")
    family_name = driver.get("familyName", "")
    return {
        "driverId": driver["driverId"],
        "permanentNumber": _int_field(driver, "permanentNumber"),
        "code": driver.get("code"),
        "givenName": given_name,
        "familyName": family_name,
        "fullName": f"{given_name} {family_name}".strip(),
        "dateOfBirth": pd.Timestamp(driver["dateOfBirth"]) if driver.get("dateOfBirth") else None,
        "nationality": driver.get("nationality"),
        "url": driver.get("url"),
    }


def _result_row(race: dict, item: dict, status_categories: dict[str, str]) -> dict:
    position_text = item.get("positionText")
    is_classified = position_text is not None and position_text.isdigit()
    fastest_lap = item.get("FastestLap", {})
    fastest_lap_time = fastest_lap.get("Time", {})
    time_block = item.get("Time", {})
    status = item.get("status")
    average_speed = fastest_lap.get("AverageSpeed", {}).get("speed")
    return {
        **_race_keys(race),
        "driverId": item["Driver"]["driverId"],
        "constructorId": item["Constructor"]["constructorId"],
        "number": _int_field(item, "number"),
        "grid": _int_field(item, "grid"),
        "position": _int_field(item, "position") if is_classified else None,
        "positionText": position_text,
        "positionOrder": _int_field(item, "position"),
        "points": _float_field(item, "points") or 0.0,
        "laps": _int_field(item, "laps"),
        "timeMs": _int_field(time_block, "millis") if is_classified else None,
        "fastestLapRank": _int_field(fastest_lap, "rank"),
        "fastestLap": _int_field(fastest_lap, "lap"),
        "fastestLapTimeMs": _ms_field(fastest_lap_time, "time"),
        "fastestLapAvgSpeed": _to_float(average_speed),
        "status": status,
        "statusCategory": _status_category(status, position_text, status_categories),
    }


def _status_category(status: str | None, position_text: str | None,
                     status_categories: dict[str, str]) -> str | None:
    if position_text == "D":
        return "disqualified"
    if position_text == "W":
        return "dns"
    if status in status_categories:
        return status_categories[status]
    if status == "Finished":
        return "finished"
    if status and (status.startswith("+") or status == "Lapped"):
        return "lapped"
    return "retired"


def _race_keys(race: dict) -> dict:
    season = int(race["season"])
    race_round = int(race["round"])
    return {"raceId": season * 100 + race_round, "season": season, "round": race_round}


def _int_field(item: dict, key: str) -> int | None:
    value = item.get(key)
    return _to_int(value)


def _float_field(item: dict, key: str) -> float | None:
    value = item.get(key)
    return _to_float(value)


def _ms_field(item: dict, key: str) -> int | None:
    text = item.get(key)
    return parse_time_ms(text)


def _to_int(value) -> int | None:
    if value is None or value == "":
        return None
    return int(value)


def _to_float(value) -> float | None:
    if value is None or value == "":
        return None
    return float(value)
