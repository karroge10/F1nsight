"""Tests for the per-session JSON export (f1p.fastf1.session_export)."""

from __future__ import annotations

import json

import pandas as pd

from f1p.fastf1 import session_export


def _results(code: str) -> pd.DataFrame:
    rows = [
        {"driverNumber": 1, "code": "NOR", "driverId": "norris", "constructorId": "mclaren", "fullName": "Lando Norris",
         "teamName": "McLaren", "teamColor": "F47600", "position": 1, "classifiedPosition": "1", "gridPosition": 2,
         "q1S": 96.5, "q2S": 95.7, "q3S": 95.1, "timeS": 5400.5, "status": "Finished", "points": 25.0, "laps": 50.0},
        {"driverNumber": 3, "code": "VER", "driverId": "max_verstappen", "constructorId": "red_bull",
         "fullName": "Max Verstappen", "teamName": "Red Bull Racing", "teamColor": "4781D7", "position": 2,
         "classifiedPosition": "2", "gridPosition": 1, "q1S": 96.6, "q2S": 95.9, "q3S": None, "timeS": 2.3,
         "status": "Finished", "points": 18.0, "laps": 50.0},
    ]
    frame = pd.DataFrame(rows)
    frame["session"] = code
    frame["season"] = 2026
    frame["round"] = 16
    frame["eventName"] = "Bahrain Grand Prix"
    return frame


def _laps() -> pd.DataFrame:
    rows = [
        {"driverNumber": 1, "lapNumber": 1, "lapTimeS": None, "sector1S": None, "sector2S": 40.0, "sector3S": 41.0,
         "pitOutS": 100.0, "pitInS": None, "stint": 1, "compound": "MEDIUM", "tyreLife": 1, "position": 2,
         "deleted": False, "isPersonalBest": False, "speedST": 300.0},
        {"driverNumber": 1, "lapNumber": 2, "lapTimeS": 98.0, "sector1S": 26.0, "sector2S": 32.0, "sector3S": 40.0,
         "pitOutS": None, "pitInS": 300.0, "stint": 1, "compound": "MEDIUM", "tyreLife": 2, "position": 1,
         "deleted": False, "isPersonalBest": True, "speedST": 310.0},
        {"driverNumber": 1, "lapNumber": 3, "lapTimeS": 120.0, "sector1S": 30.0, "sector2S": 40.0, "sector3S": 50.0,
         "pitOutS": 322.5, "pitInS": None, "stint": 2, "compound": "SOFT", "tyreLife": 1, "position": 1,
         "deleted": False, "isPersonalBest": False, "speedST": 305.0},
        {"driverNumber": 3, "lapNumber": 1, "lapTimeS": 97.0, "sector1S": 25.0, "sector2S": 33.0, "sector3S": 39.0,
         "pitOutS": None, "pitInS": None, "stint": 1, "compound": "SOFT", "tyreLife": 3, "position": 2,
         "deleted": True, "isPersonalBest": False, "speedST": 320.0},
        {"driverNumber": 3, "lapNumber": 2, "lapTimeS": 97.5, "sector1S": 25.5, "sector2S": 33.0, "sector3S": 39.0,
         "pitOutS": None, "pitInS": None, "stint": 1, "compound": "SOFT", "tyreLife": 4, "position": 2,
         "deleted": False, "isPersonalBest": True, "speedST": 318.0},
    ]
    frame = pd.DataFrame(rows)
    frame["season"] = 2026
    frame["round"] = 16
    frame["session"] = "R"
    return frame


def _weather() -> pd.DataFrame:
    return pd.DataFrame({
        "season": [2026, 2026], "round": [16, 16], "session": ["R", "R"],
        "airTemp": [30.0, 32.0], "trackTemp": [0.0, 45.0], "humidity": [50.0, 60.0],
        "windSpeed": [1.0, 3.0], "rainfall": [False, False],
    })


def _overtakes() -> pd.DataFrame:
    return pd.DataFrame({"season": [2026], "round": [16], "session": ["R"], "driverId": ["norris"],
                         "overtakes": [3], "overtakesRaw": [7]})


def test_race_payload_has_classification_laps_stints_and_pit_stops():
    payload = session_export.session_payload(_results("R"), _laps(), _weather(), _overtakes())
    assert payload["code"] == "R"
    assert [d["driverId"] for d in payload["drivers"]] == ["norris", "max_verstappen"]
    assert payload["drivers"][0]["color"] == "#F47600"
    first = payload["classification"][0]
    assert first["driverId"] == "norris"
    assert first["timeMs"] == 5400500
    assert first["bestLapMs"] == 98000
    assert first["bestLapCompound"] == "M"
    # Verstappen's quicker lap 1 was deleted, so his best is lap 2.
    second = payload["classification"][1]
    assert second["bestLapMs"] == 97500 and second["bestLapNumber"] == 2
    norris_laps = payload["laps"]["norris"]
    assert norris_laps[0][8] & session_export.FLAG_PIT_OUT
    assert norris_laps[1][8] & (session_export.FLAG_PIT_IN | session_export.FLAG_PERSONAL_BEST)
    assert payload["stints"][0] == {"driverId": "max_verstappen", "stint": 1, "compound": "S", "lapStart": 1,
                                    "lapEnd": 2, "laps": 2, "tyreAgeAtStart": 2}
    assert payload["pitStops"] == [{"driverId": "norris", "stop": 1, "lap": 2, "durationMs": 22500}]
    assert payload["sectorBests"][0] == {"sector": 1, "driverId": "max_verstappen", "ms": 25500}
    assert payload["speedTrap"][0] == {"driverId": "max_verstappen", "kph": 320.0}
    assert payload["weather"]["trackTemp"] == [45.0, 45.0]
    assert payload["weather"]["rainfall"] is False
    assert payload["overtakes"] == [{"driverId": "norris", "count": 3, "raw": 7}]
    json.dumps(payload, allow_nan=False)


def test_practice_is_classified_by_best_lap():
    payload = session_export.session_payload(_results("FP1"), _laps(), _weather())
    order = [(r["driverId"], r["position"], r["bestLapMs"]) for r in payload["classification"]]
    assert order == [("max_verstappen", 1, 97500), ("norris", 2, 98000)]
    assert payload["classification"][0]["q1Ms"] is None


def test_qualifying_keeps_the_three_parts():
    payload = session_export.session_payload(_results("Q"), _laps(), _weather())
    first = payload["classification"][0]
    assert (first["q1Ms"], first["q2Ms"], first["q3Ms"]) == (96500, 95700, 95100)
    assert payload["classification"][1]["q3Ms"] is None


def test_export_all_writes_one_file_per_session(tmp_path, monkeypatch):
    monkeypatch.setattr(session_export, "SESSIONS_DIR", tmp_path)
    fantasy_rows = pd.DataFrame({"season": [2026], "round": [16], "session": ["Race"], "driverId": ["norris"],
                                 "driverNumber": [1], "overtakes": [3], "overtakesRaw": [7]})
    summary = session_export.export_all(_results("R"), _laps(), _weather(), fantasy_rows, force=True)
    assert summary == {"written": 1, "skipped": 0}
    written = tmp_path / "2026" / "16_R.json"
    payload = json.loads(written.read_text(encoding="utf-8"))
    assert payload["eventName"] == "Bahrain Grand Prix"
    assert payload["overtakes"][0]["count"] == 3
    again = session_export.export_all(_results("R"), _laps(), _weather())
    assert again["skipped"] == 1
