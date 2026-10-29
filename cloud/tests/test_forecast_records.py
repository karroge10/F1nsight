import copy
import json
import math
import sqlite3

import pytest

from cloud import forecast_records as records


def forecast():
    return {"generatedAt": "2026-10-24T23:00:00Z", "model": {"version": "v1"},
            "race": {"season": 2026, "round": 18, "date": "2026-10-25T20:00:00Z",
                     "stage": "post-qualifying", "inputsUsed": ["FP1", "Q"]},
            "drivers": [{"driverId": "a", "pWin": 0.6}, {"driverId": "b", "pWin": 0.4}],
            "probabilitySources": {"model": {"a": 0.5, "b": 0.5}, "market": {"a": 0.8, "b": 0.2}}}


def record(payload=None, verified="2026-10-24T23:10:00Z"):
    payload = payload or forecast()
    return {"forecast": payload, "forecastHash": records.digest(payload), "verifiedAt": verified}


def marker(payload):
    attrs = " ".join(f'data-forecast-{key}="{value}"' for key, value in records.identity(payload).items())
    return f'<span hidden id="forecast-publication" {attrs}></span>'


def test_verification_rejects_stale_html_even_when_json_is_current():
    payload = forecast()
    stale = copy.deepcopy(payload)
    stale["model"]["version"] = "old"
    with pytest.raises(ValueError, match="home page"):
        records.check_site("https://example.com", payload,
                           lambda url: json.dumps(payload) if "/forecast.json" in url else marker(stale))


def test_verification_rejects_wrong_probabilities_with_same_identity():
    payload = forecast()
    stale = copy.deepcopy(payload)
    stale["drivers"][0]["pWin"] = 0.7
    with pytest.raises(ValueError, match="differs"):
        records.check_site("https://example.com", payload, lambda url: json.dumps(stale))


def test_successful_verification_archives_once_and_preserves_first_publication(monkeypatch, tmp_path):
    monkeypatch.setattr(records, "ROOT", tmp_path)
    records.write(records.forecast_path(), forecast())
    calls = []
    def fetch(url):
        calls.append(url)
        return json.dumps(forecast()) if "/forecast.json" in url else marker(forecast())
    path = records.verify("https://example.com", fetcher=fetch)
    original = path.read_bytes()
    records.verify("https://example.com", fetcher=fetch)
    assert path.read_bytes() == original
    assert len(calls) == 4
    assert records.read(tmp_path / "logs/publication-verified.json")["forecastHash"] == records.digest(forecast())


def test_failed_verification_does_not_archive_or_acknowledge(monkeypatch, tmp_path):
    monkeypatch.setattr(records, "ROOT", tmp_path)
    records.write(records.forecast_path(), forecast())
    with pytest.raises(ValueError):
        records.verify("https://example.com", attempts=1, fetcher=lambda url: "{}")
    assert not list((tmp_path / "data/published").glob("*/*.json"))
    assert not (tmp_path / "logs/publication-verified.json").exists()


def test_evaluation_excludes_post_start_publications_and_uses_last_pre_start_stage():
    first = record()
    last = record(verified="2026-10-25T19:00:00Z")
    late = record(verified="2026-10-25T20:01:00Z")
    actual = {202618: [{"driverId": "a", "position": 1}, {"driverId": "b", "position": 2}]}
    result = records.evaluate([first, late, last], actual)[0]
    stage = result["stages"]["post-qualifying"]
    assert stage["verifiedAt"] == last["verifiedAt"]
    assert stage["scores"]["published"]["logLoss"] == pytest.approx(-math.log(0.6))
    assert stage["scores"]["market"]["brier"] == pytest.approx(0.08)
    assert records.evaluate([late], actual)[0]["status"] == "no-published-pre-race-forecast"


def test_evaluation_does_not_invent_model_or_market_for_legacy_forecasts():
    payload = forecast()
    del payload["probabilitySources"]
    actual = {202618: [{"driverId": "a", "position": 1}, {"driverId": "b", "position": 2}]}
    report = records.evaluate([record(payload)], actual)
    scores = report[0]["stages"]["post-qualifying"]["scores"]
    assert scores["model"] is None and scores["market"] is None
    assert scores["published"] is not None
    assert records.aggregate(report)["post-qualifying"]["pairedRaces"] == 0


def test_tampered_archive_fails_evaluation():
    saved = record()
    saved["forecast"]["drivers"][0]["pWin"] = 0.9
    with pytest.raises(ValueError, match="hash check"):
        records.evaluate([saved], {202618: [{"driverId": "a", "position": 1}]})


def test_unknown_race_start_is_reported_without_guessing_or_blocking_other_races():
    payload = forecast()
    payload["race"]["date"] = "2026-10-25"
    actual = {202618: [{"driverId": "a", "position": 1}, {"driverId": "b", "position": 2}]}
    report = records.evaluate([record(payload)], actual)[0]
    assert report["stages"] == {}
    assert report["excludedForecasts"][0]["reason"] == "unknown-race-start"


@pytest.mark.parametrize("values", [{"a": float("nan"), "b": 0.5}, {"a": 0.2, "b": 0.2}, {"a": 1.0}])
def test_invalid_probability_distributions_are_not_scored(values):
    assert records.score(values, "a", ["a", "b"]) is None


def test_report_reads_official_results_and_keeps_missing_snapshots_explicit(monkeypatch, tmp_path):
    monkeypatch.setattr(records, "ROOT", tmp_path)
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    db = tmp_path / "data/serve/f1.sqlite"
    db.parent.mkdir(parents=True)
    with sqlite3.connect(db) as connection:
        connection.execute("CREATE TABLE results (raceId INTEGER, driverId TEXT, position INTEGER, positionOrder INTEGER)")
        connection.executemany("INSERT INTO results VALUES (?, ?, ?, ?)",
                               [(202618, "a", 1, 1), (202618, "b", None, 2), (202617, "a", 1, 1)])
    saved = record()
    records.write(tmp_path / "data/published/2026-18/hash.json", saved)
    payload = records.report()
    by_race = {race["raceId"]: race for race in payload["races"]}
    assert by_race[202618]["stages"]["post-qualifying"]["scores"]["model"]["winnerProbability"] == 0.5
    assert by_race[202617]["status"] == "no-published-pre-race-forecast"
    assert payload["aggregate"]["post-qualifying"]["pairedRaces"] == 1
    assert "No verified pre-race forecast" in (tmp_path / "data/reports/published-forecasts.md").read_text()
