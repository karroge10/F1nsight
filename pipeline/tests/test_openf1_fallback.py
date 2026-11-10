"""Tests for the OpenF1 stand-in exports (f1p.openf1.fallback) and their replacement by FastF1."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import numpy as np
import pandas as pd
import pytest

from f1p.fastf1 import session_export, telemetry_export
from f1p.fastf1.common import SessionRef
from f1p.openf1 import fallback

LAP_START = datetime(2026, 11, 7, 19, 0, tzinfo=timezone.utc)


def _rows(seconds: np.ndarray, **channels: np.ndarray) -> list[dict]:
    rows = []
    for index, offset in enumerate(seconds):
        moment = LAP_START + timedelta(seconds=float(offset))
        row = {"date": moment.isoformat()}
        for name, values in channels.items():
            row[name] = float(values[index])
        rows.append(row)
    return rows


def _constant_lap(speed_kph: float = 180.0, lap_seconds: float = 80.0):
    """A car at constant speed on a circle: car_data at 3.7 Hz, location at 4 Hz, padded 1 s."""
    car_t = np.arange(-1.0, lap_seconds + 1.0, 1 / 3.7)
    speed = np.full(car_t.size, speed_kph)
    car = _rows(car_t, speed=speed, throttle=np.full(car_t.size, 100.0), brake=np.zeros(car_t.size),
                n_gear=np.full(car_t.size, 6.0))
    location_t = np.arange(-1.0, lap_seconds + 1.0, 0.25)
    angle = location_t / lap_seconds * 2 * np.pi
    location = _rows(location_t, x=1000 * np.cos(angle), y=1000 * np.sin(angle))
    return car, location


def test_resample_integrates_speed_into_distance_on_the_shared_grid():
    car, location = _constant_lap(speed_kph=180.0, lap_seconds=80.0)

    resampled = fallback.resample_lap(car, location, LAP_START.timestamp(), 80.0)

    assert resampled is not None
    assert resampled["length"] == pytest.approx(50 * 80.0, rel=0.002)  # 180 km/h is 50 m/s
    assert len(resampled["speed"]) == telemetry_export.POINTS
    assert set(resampled["speed"]) == {180}
    assert set(resampled["gear"]) == {6}
    assert set(resampled["brake"]) == {0}
    assert resampled["x"][0] == pytest.approx(1000, abs=2)
    assert resampled["x"][telemetry_export.POINTS // 2] == pytest.approx(-1000, abs=15)


def test_resample_maps_openf1_brake_percent_to_on_off():
    car, location = _constant_lap()
    for row in car[150:200]:
        row["brake"] = 100.0

    resampled = fallback.resample_lap(car, location, LAP_START.timestamp(), 80.0)

    assert set(resampled["brake"]) == {0, 1}


def test_resample_refuses_a_lap_the_samples_do_not_cover():
    car, location = _constant_lap(lap_seconds=80.0)
    short = [row for row in car if row["date"] < (LAP_START + timedelta(seconds=60)).isoformat()]

    assert fallback.resample_lap(short, location, LAP_START.timestamp(), 80.0) is None


def test_fastest_lap_skips_laps_faster_than_the_official_best():
    laps = [
        {"driver_number": 1, "lap_number": 3, "lap_duration": 87.0, "date_start": "2026-11-07T19:00:00+00:00"},
        {"driver_number": 1, "lap_number": 5, "lap_duration": 87.47, "date_start": "2026-11-07T19:05:00+00:00"},
        {"driver_number": 1, "lap_number": 6, "lap_duration": None, "date_start": "2026-11-07T19:07:00+00:00"},
    ]

    assert fallback.fastest_lap(laps, 1, 87.47)["lap_number"] == 5
    assert fallback.fastest_lap(laps, 1, None)["lap_number"] == 3


def test_session_report_from_openf1_tables_has_lap_starts_and_quali_parts(tmp_path, monkeypatch):
    folder = tmp_path / "11408"
    folder.mkdir()
    (folder / "stints.json").write_text(json.dumps([
        {"driver_number": 1, "stint_number": 1, "lap_start": 1, "lap_end": 3, "compound": "SOFT", "tyre_age_at_start": 2},
    ]))
    monkeypatch.setattr(fallback, "driver_ids", lambda season, round_number: {1: {"driverId": "norris", "constructorId": "mclaren"}})
    target = {"season": 2026, "round": 20, "code": "Q", "eventName": "Brazilian Grand Prix",
              "start": "2026-11-07T18:00:00+00:00", "folder": folder}
    drivers = [{"driver_number": 1, "name_acronym": "NOR", "first_name": "Lando", "last_name": "Norris",
                "team_name": "McLaren", "team_colour": "F47600"}]
    results = [{"driver_number": 1, "position": 1, "duration": [90.9, 89.2, 87.47], "number_of_laps": 3}]
    laps = [
        {"driver_number": 1, "lap_number": 1, "date_start": "2026-11-07T18:01:00+00:00", "lap_duration": None,
         "is_pit_out_lap": True},
        {"driver_number": 1, "lap_number": 2, "date_start": "2026-11-07T18:03:00+00:00", "lap_duration": 87.47,
         "duration_sector_1": 25.0, "duration_sector_2": 40.0, "duration_sector_3": 22.47, "st_speed": 320},
        {"driver_number": 1, "lap_number": 3, "date_start": "2026-11-07T18:04:27.470+00:00", "lap_duration": 95.0},
    ]

    payload = fallback.session_payload(target, laps, drivers, results)

    assert payload["source"] == "openf1"
    assert payload["drivers"][0]["driverId"] == "norris"
    assert payload["lapStarts"]["norris"] == [60000, 180000, 267470]
    row = payload["classification"][0]
    assert (row["q3Ms"], row["bestLapMs"], row["bestLapCompound"]) == (87470, 87470, "S")
    assert payload["laps"]["norris"][1][6] == 4  # tyre life: 2 laps old at the start, second lap
    assert payload["speedTrap"] == [{"driverId": "norris", "kph": 320.0}]


def test_fastf1_telemetry_replaces_an_openf1_stand_in(monkeypatch, tmp_path):
    start = datetime.now(timezone.utc) - timedelta(days=3)
    ref = SessionRef(2026, 20, "Q", "Qualifying", "Brazilian Grand Prix", start.isoformat())
    stand_in = {"season": 2026, "round": 20, "code": "Q", "eventName": "Brazil", "sessionName": "Qualifying",
                "source": "openf1", "drivers": [{"code": "NOR"}]}
    path = tmp_path / "2026" / "20_Q.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(stand_in))
    monkeypatch.setattr(telemetry_export, "TELEMETRY_DIR", tmp_path)
    monkeypatch.setattr(telemetry_export, "read_expected", lambda season: [ref])
    monkeypatch.setattr(telemetry_export, "completed_sessions", lambda *args: [])
    monkeypatch.setattr(telemetry_export, "setup_online", Mock())
    monkeypatch.setattr(telemetry_export.fastf1.Cache, "offline_mode", Mock())

    monkeypatch.setattr(telemetry_export, "session_payload", lambda ref: None)
    summary = telemetry_export.export([2026], ["Q"], backfill_days=14)
    assert summary["pending"] == [ref.key]
    assert json.loads(path.read_text())["source"] == "openf1"
    assert json.loads((tmp_path / "index.json").read_text())["sessions"][0]["source"] == "openf1"

    fastf1_payload = {**stand_in, "drivers": [{"code": "VER"}]}
    del fastf1_payload["source"]
    monkeypatch.setattr(telemetry_export, "session_payload", lambda ref: fastf1_payload)
    assert telemetry_export.export([2026], ["Q"], backfill_days=14)["written"] == 1
    assert json.loads(path.read_text()) == fastf1_payload
    assert "source" not in json.loads((tmp_path / "index.json").read_text())["sessions"][0]


def test_fastf1_session_report_replaces_an_openf1_stand_in_only_with_laps(monkeypatch, tmp_path):
    monkeypatch.setattr(session_export, "SESSIONS_DIR", tmp_path)
    path = tmp_path / "2026" / "16_R.json"
    path.parent.mkdir(parents=True)
    stand_in = {"source": "openf1", "lapStarts": {"norris": [1000]}}
    path.write_text(json.dumps(stand_in))
    results = _results()
    no_laps = pd.DataFrame(columns=["season", "round", "session", "driverNumber", "lapNumber", "lapTimeS", "sector1S",
                                    "sector2S", "sector3S", "deleted", "pitInS", "pitOutS", "isPersonalBest",
                                    "compound", "tyreLife", "position", "stint", "lapStartS", "speedST"])
    weather = pd.DataFrame(columns=["season", "round", "session", "airTemp", "trackTemp", "humidity", "windSpeed",
                                    "rainfall"])

    session_export.export_all(results, no_laps, weather)
    assert json.loads(path.read_text()) == stand_in

    laps = no_laps.copy()
    laps.loc[0] = [2026, 16, "R", 1, 1, 98.0, 30.0, 30.0, 38.0, False, None, None, True, "SOFT", 1, 1, 1, 50.0, 300.0]
    session_export.export_all(results, laps, weather)
    written = json.loads(path.read_text())
    assert "source" not in written
    assert written["lapStarts"] == {"norris": [50000]}


def test_fallback_only_targets_sessions_without_a_usable_file(monkeypatch, tmp_path):
    monkeypatch.setattr(session_export, "SESSIONS_DIR", tmp_path / "sessions")
    monkeypatch.setattr(telemetry_export, "TELEMETRY_DIR", tmp_path / "telemetry")
    complete = session_export.session_path(2026, 20, "Q")
    complete.parent.mkdir(parents=True)
    complete.write_text(json.dumps({"lapStarts": {"norris": [1000]}}))
    empty = session_export.session_path(2026, 20, "FP1")
    empty.write_text(json.dumps({"lapStarts": {}}))

    assert not fallback.session_needs_report(2026, 20, "Q")
    assert fallback.session_needs_report(2026, 20, "FP1")
    assert fallback.session_needs_report(2026, 20, "R")


def test_a_network_error_leaves_the_session_pending(monkeypatch):
    target = {"label": "2026/20_Q", "start": "2026-11-07T18:00:00+00:00"}
    monkeypatch.setattr(fallback, "missing_sessions", lambda now, days: [target])

    def broken(client, target):
        raise RuntimeError("giving up on laps")

    monkeypatch.setattr(fallback, "fill_session", broken)

    summary = fallback.run(datetime.now(timezone.utc), 45, 60)

    assert summary["pending"] == ["2026/20_Q"]
    assert summary["telemetry"] == [] and summary["sessions"] == []


def _results() -> pd.DataFrame:
    return pd.DataFrame([{
        "season": 2026, "round": 16, "session": "R", "eventName": "Bahrain Grand Prix", "driverNumber": 1,
        "code": "NOR", "driverId": "norris", "constructorId": "mclaren", "fullName": "Lando Norris",
        "teamName": "McLaren", "teamColor": "F47600", "position": 1, "classifiedPosition": "1", "gridPosition": 1,
        "q1S": None, "q2S": None, "q3S": None, "timeS": 5400.0, "status": "Finished", "points": 25.0, "laps": 1,
    }])
