from datetime import datetime, timedelta, timezone

import pandas as pd

from f1ml import weather


def test_live_refresh_retains_each_forecast_and_respects_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(weather, "RAW", tmp_path)
    now = datetime(2026, 10, 20, 12, tzinfo=timezone.utc)
    race = pd.Series({"raceId": 202618, "raceUtc": pd.Timestamp("2026-10-25 19:00"),
                      "lat": 30.1, "lng": -97.6})
    payloads = iter([{"hourly": {"precipitation": [1.0]}},
                     {"hourly": {"precipitation": [2.0]}}])
    monkeypatch.setattr(weather, "_get", lambda *args: next(payloads))
    assert weather._fetch_forecast(race, now)
    assert not weather._fetch_forecast(race, now + timedelta(hours=1))
    assert weather._fetch_forecast(race, now + timedelta(hours=3))
    snapshots = sorted((tmp_path / "forecast-history" / "202618").glob("*.json"))
    assert len(snapshots) == 2
    saved = [weather._load(path) for path in snapshots]
    assert [p["hourly"]["precipitation"] for p in saved] == [[1.0], [2.0]]
    assert weather._load(tmp_path / "forecast" / "202618.json") == saved[1]


def test_existing_forecast_is_preserved_before_replacement(tmp_path, monkeypatch):
    monkeypatch.setattr(weather, "RAW", tmp_path)
    now = datetime(2026, 10, 20, 12, tzinfo=timezone.utc)
    old = {"fetchedAt": (now - timedelta(hours=4)).isoformat(), "hourly": {}}
    weather._save(tmp_path / "forecast" / "202618.json", old)
    race = pd.Series({"raceId": 202618, "raceUtc": pd.Timestamp("2026-10-25 19:00"),
                      "lat": 30.1, "lng": -97.6})
    monkeypatch.setattr(weather, "_get", lambda *args: {"hourly": {}})
    assert weather._fetch_forecast(race, now)
    snapshots = sorted((tmp_path / "forecast-history" / "202618").glob("*.json"))
    assert len(snapshots) == 2
    assert weather._load(snapshots[0]) == old
