"""Tests for the refresh tooling: lock files, the weekend task plan, the incremental FastF1 wait
rule and the refresh step selection.

Run from pipeline without touching the shared venv:
    uv run --no-sync --with pytest python -m pytest tests -q
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from f1p import locks, refresh, weekend
from f1p.fastf1 import incremental
from f1p.fastf1.common import SessionRef


def test_lock_blocks_while_owner_lives_and_releases(tmp_path):
    path = tmp_path / "x.lock"
    with locks.file_lock(path, purpose="test"):
        owner = locks.read_owner(path)
        assert owner["pid"] == os.getpid()
        assert locks.try_create(path, {}) is False
        with pytest.raises(locks.LockBusy):
            with locks.file_lock(path, wait_s=0):
                pass
    assert not path.exists()


def test_stale_lock_of_dead_process_is_taken_over(tmp_path):
    path = tmp_path / "stale.lock"
    stale = json.dumps({"pid": 999999, "since": "2026-01-01T00:00:00+00:00"})
    path.write_text(stale, encoding="utf-8")
    assert locks.pid_alive(999999) is False
    assert locks.try_create(path, {"purpose": "test"}) is True
    assert locks.read_owner(path)["pid"] == os.getpid()


def test_weekend_plan_for_singapore_2026():
    race = pd.Series({
        "season": 2026, "round": 17, "raceName": "Singapore Grand Prix",
        "fp1Utc": pd.Timestamp("2026-10-09 08:30"), "fp2Utc": pd.NaT, "fp3Utc": pd.NaT,
        "sprintQualifyingUtc": pd.Timestamp("2026-10-09 12:30"),
        "sprintUtc": pd.Timestamp("2026-10-10 09:00"),
        "qualifyingUtc": pd.Timestamp("2026-10-10 13:00"),
        "raceUtc": pd.Timestamp("2026-10-11 12:00"),
    })
    plan = weekend.refresh_plan(race)
    runs = {task["name"]: task["runAtUtc"] for task in plan["tasks"]}
    assert runs["F1nsight-refresh-FP1"] == "2026-10-09 10:30"
    assert runs["F1nsight-refresh-FP1-retry"] == "2026-10-09 13:30"
    assert runs["F1nsight-refresh-SQ"] == "2026-10-09 14:15"
    assert runs["F1nsight-refresh-Sprint"] == "2026-10-10 11:00"
    assert runs["F1nsight-refresh-Quali"] == "2026-10-10 15:00"
    assert runs["F1nsight-refresh-Race"] == "2026-10-11 15:15"
    assert runs["F1nsight-refresh-Race-retry"] == "2026-10-11 18:15"
    assert runs["F1nsight-refresh-RaceMorning"] == "2026-10-11 09:00"
    assert "F1nsight-refresh-FP2" not in runs


def test_pending_archives_trigger_periodic_retry_without_another_session():
    now = datetime(2026, 10, 24, 5, tzinfo=timezone.utc)
    state = {"fastf1": {"pendingSessions": {"2026/18_FP2": "2026-10-23T23:00:00+00:00"},
                        "lastAttempt": "2026-10-24T02:00:00+00:00"}}
    assert weekend.pending_retry_due(state, now)
    state["fastf1"]["lastAttempt"] = "2026-10-24T04:00:00+00:00"
    assert not weekend.pending_retry_due(state, now)
    state["fastf1"]["pendingSessions"] = {"2026/17_R": "2026-10-12T00:00:00+00:00"}
    assert not weekend.pending_retry_due(state, now)


def test_first_refresh_comes_after_incremental_counts_the_session_as_ended():
    for _, label, length in weekend.SESSIONS:
        code = {"Sprint": "S", "Quali": "Q", "Race": "R"}.get(label, label)
        after_end = weekend.REFRESH_AFTER_END.get(label, weekend.DEFAULT_AFTER_END)
        refresh_at = length + after_end
        ended_for_incremental = incremental.SESSION_LENGTH[code] + incremental.SESSION_GRACE
        assert refresh_at >= ended_for_incremental, label


def test_incremental_waits_for_incomplete_archive_only_for_a_while():
    start = datetime(2026, 10, 9, 8, 30, tzinfo=timezone.utc)
    ref = SessionRef(2026, 17, "FP1", "Practice 1", "Singapore Grand Prix", start.replace(tzinfo=None).isoformat())
    soon = start + timedelta(hours=2)
    late = start + timedelta(hours=5)
    assert incremental._should_wait(ref, ["laps"], soon, accept_partial=False) is True
    assert incremental._should_wait(ref, ["weather"], soon, accept_partial=False) is False
    assert incremental._should_wait(ref, ["laps"], late, accept_partial=False) is True
    assert incremental._should_wait(ref, ["laps"], soon, accept_partial=True) is False


def test_refresh_step_selection():
    args = argparse.Namespace(only="fastf1,predict", skip=None)
    assert refresh._selected_steps(args) == ["fastf1", "predict"]
    args = argparse.Namespace(only=None, skip="openf1")
    assert refresh._selected_steps(args) == ["history", "official_results", "fantasy", "fastf1", "penalties", "weather", "predict"]
    args = argparse.Namespace(only="penalties,predict", skip=None)
    assert refresh._selected_steps(args) == ["penalties", "predict"]
    with pytest.raises(SystemExit):
        refresh._step_list("history,nope")


def test_refresh_reads_the_incremental_result_line():
    output = "log line\nRESULT {\"new\": [\"2026/17_FP1\"], \"pending\": [], \"built\": true}\n"
    assert refresh._result_line(output)["new"] == ["2026/17_FP1"]
    assert refresh._result_line("no result") == {}
