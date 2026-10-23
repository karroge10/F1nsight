import json
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest

from f1p import refresh
from f1p.fastf1 import telemetry_export
from f1p.fastf1.common import SessionRef


def test_online_backfill_recovers_missing_export_without_parsed_cache(monkeypatch, tmp_path):
    now = datetime.now(timezone.utc)
    recent = SessionRef(2026, 17, "R", "Race", "Singapore Grand Prix", (now - timedelta(days=12)).isoformat())
    old = SessionRef(2026, 16, "R", "Race", "Previous race", (now - timedelta(days=25)).isoformat())
    future = SessionRef(2026, 18, "R", "Race", "Next race", (now + timedelta(days=2)).isoformat())
    payload = {"season": 2026, "round": 17, "code": "R", "eventName": recent.event_name,
               "sessionName": "Race", "drivers": [{"code": "VER"}]}
    loader = Mock(return_value=payload)
    monkeypatch.setattr(telemetry_export, "TELEMETRY_DIR", tmp_path)
    monkeypatch.setattr(telemetry_export, "read_expected", lambda season: [old, recent, future])
    monkeypatch.setattr(telemetry_export, "session_payload", loader)
    monkeypatch.setattr(telemetry_export, "setup_online", Mock())
    monkeypatch.setattr(telemetry_export.fastf1.Cache, "offline_mode", Mock())

    summary = telemetry_export.export([2026], ["R"], backfill_days=14)

    assert summary["written"] == 1
    loader.assert_called_once_with(recent)
    assert json.loads((tmp_path / "2026" / "17_R.json").read_text()) == payload
    assert json.loads((tmp_path / "index.json").read_text())["sessions"][0]["round"] == 17

    assert telemetry_export.export([2026], ["R"], backfill_days=14)["written"] == 0
    loader.assert_called_once_with(recent)


def test_backfill_reports_unavailable_recent_telemetry(monkeypatch, tmp_path):
    start = datetime.now(timezone.utc) - timedelta(days=2)
    ref = SessionRef(2026, 17, "Q", "Qualifying", "Singapore Grand Prix", start.isoformat())
    monkeypatch.setattr(telemetry_export, "TELEMETRY_DIR", tmp_path)
    monkeypatch.setattr(telemetry_export, "read_expected", lambda season: [ref])
    monkeypatch.setattr(telemetry_export, "session_payload", lambda ref: None)
    monkeypatch.setattr(telemetry_export, "setup_online", Mock())
    monkeypatch.setattr(telemetry_export.fastf1.Cache, "offline_mode", Mock())

    summary = telemetry_export.export([2026], ["Q"], backfill_days=14)

    assert summary["failed"] == [ref.key]
    assert not (tmp_path / "2026" / "17_Q.json").exists()


def test_backfill_exports_just_downloaded_session_without_waiting_four_hours(monkeypatch, tmp_path):
    now = datetime.now(timezone.utc)
    completed = SessionRef(2026, 17, "Q", "Qualifying", "Singapore", (now - timedelta(hours=2)).isoformat())
    pending = SessionRef(2026, 17, "R", "Race", "Singapore", (now - timedelta(hours=1)).isoformat())
    loader = Mock(return_value={"season": 2026, "round": 17, "code": "Q", "eventName": "Singapore",
                                "sessionName": "Qualifying", "drivers": [{"code": "VER"}]})
    monkeypatch.setattr(telemetry_export, "TELEMETRY_DIR", tmp_path)
    monkeypatch.setattr(telemetry_export, "read_expected", lambda season: [completed, pending])
    monkeypatch.setattr(telemetry_export, "is_done", lambda ref: ref == completed)
    monkeypatch.setattr(telemetry_export, "session_payload", loader)
    monkeypatch.setattr(telemetry_export, "setup_online", Mock())

    assert telemetry_export.export([2026], ["Q", "R"], backfill_days=14)["written"] == 1
    loader.assert_called_once_with(completed)


def test_backfill_cli_does_not_require_cached_season(monkeypatch):
    exporter = Mock(return_value={"written": 0, "failed": ["2026/17_R"]})
    monkeypatch.setattr(telemetry_export, "export", exporter)
    monkeypatch.setattr(telemetry_export, "latest_cached_season", Mock(side_effect=AssertionError))
    monkeypatch.setattr(telemetry_export.sys, "argv", ["telemetry_export", "--backfill-days", "14"])

    with pytest.raises(SystemExit, match="1"):
        telemetry_export.main()

    assert datetime.now(timezone.utc).year in exporter.call_args.args[0]
    assert exporter.call_args.args[3] == 14


def test_online_backfill_initializes_an_empty_cache(monkeypatch, tmp_path):
    monkeypatch.setattr(telemetry_export, "FASTF1_CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(telemetry_export, "TELEMETRY_DIR", tmp_path / "telemetry")

    assert telemetry_export.export([], [], backfill_days=14)["written"] == 0
    assert (tmp_path / "cache").is_dir()


def test_refresh_requests_online_telemetry_backfill(monkeypatch):
    runner = refresh.StepRunner(Mock(), {}, False)
    run_module = Mock(return_value="")
    monkeypatch.setattr(runner, "_run_module", run_module)

    runner.step_fastf1(refresh.StepResult("fastf1"))

    assert run_module.call_args.args[1:] == (
        "pipeline", "f1p.fastf1.telemetry_export", "--backfill-days", "14"
    )

