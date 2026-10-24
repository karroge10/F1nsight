"""Download the sessions of the current race weekend that have just finished, then rebuild ff1_*.

Run from pipeline (the refresh does this after every session):
    uv run python -m f1p.fastf1.incremental                 # sessions of the last 10 days
    uv run python -m f1p.fastf1.incremental --accept-partial # keep incomplete archives too
    uv run python -m f1p.fastf1.incremental --no-build      # skip the table rebuild

Unlike the bulk download (sessions count as done 4 h after their start) a session is tried
SESSION_GRACE after its scheduled end, which is when the free live timing archive usually has
it. If the archive is still incomplete (no laps or results, or no positions for a race) the
session is left for the next run, unless it ended more than PARTIAL_AFTER ago.

Safe next to a running bulk download: every session is claimed with a lock file first
(`locks.session_claim`), the tables are rebuilt under `build_tables.lock`, and the bulk download's
log and request history are not touched. The last output line is `RESULT {json}` for the refresh.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timedelta, timezone

import fastf1

from f1p.fastf1 import build_tables
from f1p.fastf1.common import (
    SessionRef,
    append_manifest,
    fastf1_root,
    get_session,
    is_done,
    logger,
    read_expected,
    season_schedule,
    setup_fastf1,
    write_expected,
)
from f1p.fastf1.download import _missing_parts
from f1p.fastf1.extract import write_session
from f1p.fastf1.locks import fastf1_processes, session_claim
from f1p.paths import processed_path

LOOKBACK = timedelta(days=10)
SESSION_GRACE = timedelta(minutes=35)
PARTIAL_AFTER = timedelta(hours=3)
# Scheduled length per session code, generous (red flags, the 2 h race limit).
SESSION_LENGTH = {
    "FP1": timedelta(minutes=60),
    "FP2": timedelta(minutes=60),
    "FP3": timedelta(minutes=60),
    "SQ": timedelta(minutes=45),
    "S": timedelta(minutes=60),
    "Q": timedelta(minutes=60),
    "R": timedelta(minutes=150),
}
SESSION_NAMES = {
    "Practice 1": "FP1",
    "Practice 2": "FP2",
    "Practice 3": "FP3",
    "Sprint Shootout": "SQ",
    "Sprint Qualifying": "SQ",
    "Sprint": "S",
    "Qualifying": "Q",
    "Race": "R",
}
CORE_PARTS = {"laps", "results"}


def main() -> int:
    args = _parse_args()
    _setup_logging()
    setup_fastf1()
    now = datetime.now(timezone.utc)
    bulk = fastf1_processes("f1p.fastf1.download")
    if bulk:
        pid_texts = [str(row["pid"]) for row in bulk]
        pids = ", ".join(pid_texts)
        logger.info("Bulk download running (pid %s): only claimed sessions are touched", pids)
    refs = finished_sessions(now)
    _remember_expected(refs)
    result = {"new": [], "pending": [], "skipped": [], "failed": [], "built": False}
    for ref in refs:
        if is_done(ref):
            continue
        status = download_one(ref, now, args.accept_partial)
        bucket = {"done": "new", "pending": "pending", "claimed": "skipped"}.get(status, "failed")
        result[bucket].append(ref.key)
    if not args.no_build and tables_stale():
        build_tables.main()
        result["built"] = True
    logger.info("Incremental FastF1: %s", result)
    result_text = json.dumps(result)
    print("RESULT " + result_text, flush=True)
    return 1 if result["failed"] else 0


def finished_sessions(now: datetime) -> list[SessionRef]:
    """Sessions that started within LOOKBACK and ended at least SESSION_GRACE ago."""
    refs = []
    for season in sorted({now.year, (now - LOOKBACK).year}):
        schedule = season_schedule(season)
        for _, event in schedule.iterrows():
            event_refs = _event_refs(season, event, now)
            refs.extend(event_refs)
    return refs


def download_one(ref: SessionRef, now: datetime, accept_partial: bool) -> str:
    """Load and write one session. Returns done, pending, claimed or failed."""
    with session_claim(ref) as claimed:
        if not claimed or is_done(ref):
            logger.info("%s: claimed by another process, skipping", ref.key)
            return "claimed"
        try:
            session = get_session(ref)
            session.load(laps=True, telemetry=ref.wants_positions, weather=True, messages=True)
        except Exception as exc:
            problem = f"{type(exc).__name__}: {exc}"
            logger.warning("%s: load failed: %s", ref.key, problem)
            append_manifest(ref, "failed", attempts=1, problem=problem, source="incremental")
            return "failed"
        problems = _missing_parts(session, ref)
        if _should_wait(ref, problems, now, accept_partial):
            logger.info("%s: archive incomplete (%s), will retry on the next refresh", ref.key, problems)
            return "pending"
        meta = write_session(session, ref)
    append_manifest(ref, "done", attempts=1, missing=problems, counts=meta["counts"], source="incremental")
    logger.info("%s done: %s%s", ref.key, meta["counts"], f" (missing {problems})" if problems else "")
    return "done"


def tables_stale() -> bool:
    """True when a session finished writing after ff1_laps.parquet was last built."""
    laps_path = processed_path("ff1_laps")
    if not laps_path.exists():
        return True
    built_at = laps_path.stat().st_mtime
    for meta_path in fastf1_root().glob("*/*/meta.json"):
        if meta_path.stat().st_mtime > built_at:
            return True
    return False


def _event_refs(season: int, event, now: datetime) -> list[SessionRef]:
    refs = []
    now_naive = now.replace(tzinfo=None)
    for slot in range(1, 6):
        name = event.get(f"Session{slot}")
        code = SESSION_NAMES.get(name)
        start = event.get(f"Session{slot}DateUtc")
        if code is None or start is None or str(start) == "NaT":
            continue
        ends_at = start + SESSION_LENGTH[code] + SESSION_GRACE
        if start < now_naive - LOOKBACK or ends_at > now_naive:
            continue
        ref = SessionRef(
            season=season,
            round=int(event["RoundNumber"]),
            code=code,
            name=name,
            event_name=str(event["EventName"]),
            start_utc=start.isoformat(),
        )
        refs.append(ref)
    return refs


def _should_wait(ref: SessionRef, problems: list[str], now: datetime, accept_partial: bool) -> bool:
    if not problems or accept_partial:
        return False
    if CORE_PARTS.issubset(problems):
        return True
    start = datetime.fromisoformat(ref.start_utc).replace(tzinfo=timezone.utc)
    ended_at = start + SESSION_LENGTH[ref.code]
    if now - ended_at > PARTIAL_AFTER:
        return False
    core_missing = CORE_PARTS.intersection(problems)
    return bool(core_missing) or "positions" in problems


def _remember_expected(refs: list[SessionRef]) -> None:
    """Add these sessions to <season>/expected.json so the progress report counts them."""
    for season in sorted({ref.season for ref in refs}):
        known = read_expected(season)
        keys = {ref.key for ref in known}
        added = [ref for ref in refs if ref.season == season and ref.key not in keys]
        if added:
            merged = known + added
            write_expected(season, merged)


def _setup_logging() -> None:
    log_path = fastf1_root() / "incremental.log"
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setFormatter(formatter)
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)
    logger.setLevel(logging.INFO)
    logger.addHandler(file_handler)
    logger.addHandler(console)
    fastf1.set_log_level("WARNING")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--accept-partial", action="store_true", help="write sessions with incomplete archives")
    parser.add_argument("--no-build", action="store_true", help="do not rebuild data/processed/ff1_*")
    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(main())
