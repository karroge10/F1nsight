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


def test_main_defers_exhausted_rate_limit_without_changing_cache(tmp_path, monkeypatch, capsys):
    import urllib.error
    import json

    target = tmp_path / "forecast/202621.json"
    weather._save(target, {"fetchedAt": "2026-11-14T16:00:00+00:00", "hourly": {}})
    before = target.read_bytes()
    monkeypatch.setattr(weather.time, "sleep", lambda _: None)

    def limited(*args, **kwargs):
        raise urllib.error.HTTPError("https://api.open-meteo.com", 429, "Too Many Requests", {}, None)

    monkeypatch.setattr(weather.urllib.request, "urlopen", limited)
    monkeypatch.setattr(weather, "download", lambda: weather._get(weather.FORECAST_URL, {}))
    weather.main()
    output = capsys.readouterr().out
    result = json.loads(next(line[7:] for line in output.splitlines() if line.startswith("RESULT ")))
    assert result["deferred"] is True
    assert target.read_bytes() == before


def test_main_does_not_hide_other_http_failures(monkeypatch):
    import urllib.error
    import pytest

    def failed():
        raise urllib.error.HTTPError("https://api.open-meteo.com", 403, "Forbidden", {}, None)

    monkeypatch.setattr(weather, "download", failed)
    with pytest.raises(urllib.error.HTTPError):
        weather.main()


def test_main_defers_when_open_meteo_is_unreachable(monkeypatch, capsys):
    import json
    import urllib.error

    def unreachable():
        raise urllib.error.URLError("_ssl.c:983: The handshake operation timed out")

    monkeypatch.setattr(weather, "download", unreachable)
    weather.main()
    output = capsys.readouterr().out
    result = json.loads(next(line[7:] for line in output.splitlines() if line.startswith("RESULT ")))
    assert result["deferred"] is True
