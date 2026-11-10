"""Stale-lock takeover must hand the lock to exactly one of several racing processes."""

from __future__ import annotations

import json
import multiprocessing
from pathlib import Path

from f1p.locks import release, try_create

RACERS = 8
DEAD_PID = 999_999_999


def test_racing_takeover_has_one_winner(tmp_path: Path) -> None:
    lock = tmp_path / "refresh.lock"
    dead_owner = {"pid": DEAD_PID, "since": "2020-01-01T00:00:00+00:00"}
    lock.write_text(json.dumps(dead_owner), encoding="utf-8")
    start = multiprocessing.Event()
    results = multiprocessing.Queue()
    workers = [multiprocessing.Process(target=_race, args=(lock, start, results)) for _ in range(RACERS)]
    for worker in workers:
        worker.start()
    start.set()
    for worker in workers:
        worker.join(timeout=60)
    outcomes = [results.get(timeout=5) for _ in workers]
    assert outcomes.count(True) == 1, outcomes


def test_release_keeps_a_lock_owned_by_someone_else(tmp_path: Path) -> None:
    lock = tmp_path / "refresh.lock"
    other_owner = {"pid": DEAD_PID, "since": "2020-01-01T00:00:00+00:00"}
    lock.write_text(json.dumps(other_owner), encoding="utf-8")
    release(lock)
    assert lock.exists()


def _race(lock: Path, start, results) -> None:
    start.wait()
    try:
        won = try_create(lock, {"purpose": "test"})
    except Exception as error:  # surface a crash as a failed outcome, not a missing one
        results.put(repr(error))
        return
    results.put(won)
    # Hold it until the others have tried, so a late racer sees a live owner, not a free file.
    if won:
        import time
        time.sleep(3)
