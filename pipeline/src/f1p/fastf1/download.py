"""Bulk download of every completed FastF1 session (2018 onwards), most recent season first.

Run from v2/pipeline:
    uv run python -m f1p.fastf1.download                      # 2026 down to 2018
    uv run python -m f1p.fastf1.download --seasons 2024-2026  # a subset
    uv run python -m f1p.fastf1.download --sessions R S       # only some session codes
    uv run python -m f1p.fastf1.download --retry-unavailable  # try "no data" sessions again

Resumable and idempotent: a session is done when its meta.json exists; every attempt is
appended to data/raw/fastf1/manifest.jsonl. FastF1 allows 500 uncached requests per hour;
we wait for budget before each session instead of tripping that limit.
"""

import argparse
import json
import logging
import shutil
import sys
import time
from datetime import datetime, timezone

import fastf1
from fastf1.exceptions import RateLimitExceededError
from fastf1.req import _CallsPerIntervalLimitRaise, _SessionWithRateLimiting

from f1p.fastf1 import build_tables, report
from f1p.fastf1.common import (
    FIRST_SEASON,
    SessionRef,
    append_manifest,
    completed_sessions,
    fastf1_root,
    get_session,
    is_done,
    logger,
    read_manifest,
    season_range,
    setup_fastf1,
    write_expected,
)
from f1p.fastf1.extract import write_session
from f1p.fastf1.locks import session_claim
from f1p.paths import FASTF1_CACHE_DIR

MAX_ATTEMPTS = 4
BACKOFF_BASE_S = 60
# Requests one session load can make (about 15 with telemetry), with headroom.
REQUESTS_PER_SESSION = 25
# Disk guards (GB): prune re-downloadable telemetry pickles, then stop if still too big.
PRUNE_ABOVE_GB = 80
STOP_ABOVE_GB = 95
MIN_FREE_GB = 40
PROGRESS_EVERY = 10
UNAVAILABLE = "unavailable"
REQUEST_HISTORY_NAME = "request_history.json"


def main() -> None:
    args = _parse_args()
    setup_logging()
    setup_fastf1()
    seasons = _seasons(args)
    logger.info("FastF1 %s, seasons %s, sessions %s", fastf1.__version__, seasons, args.sessions or "all")
    if not _disk_ok():
        sys.exit(2)
    restore_request_history()
    manifest = read_manifest()
    processed = 0
    for season in seasons:
        processed_before = processed
        refs = _season_refs(season, args.sessions)
        logger.info("Season %s: %d completed sessions", season, len(refs))
        for ref in refs:
            if not _should_process(ref, manifest, args.retry_unavailable):
                continue
            if not _disk_ok():
                logger.error("Disk guard tripped, stopping. Free space or raise the limits, then resume.")
                report.write_progress()
                rebuild_tables("disk guard stop")
                sys.exit(2)
            with session_claim(ref) as claimed:
                if not claimed or is_done(ref):
                    logger.info("%s: handled by another process (refresh), skipping", ref.key)
                    continue
                status = process_session(ref)
            save_request_history()
            manifest[ref.key] = {"status": status}
            processed += 1
            if processed % PROGRESS_EVERY == 0:
                report.write_progress()
        report.write_progress()
        if processed > processed_before:
            rebuild_tables(f"season {season} complete")
    logger.info("All requested seasons processed (%d sessions this run).", processed)
    rebuild_tables("end of run")


def process_session(ref: SessionRef) -> str:
    """Load one session with retries and write its files. Returns the manifest status."""
    attempt = 0
    last_problem = None
    while attempt < MAX_ATTEMPTS:
        wait_for_request_budget(REQUESTS_PER_SESSION)
        started = time.time()
        try:
            session = get_session(ref)
            session.load(laps=True, telemetry=ref.wants_positions, weather=True, messages=True)
        except RateLimitExceededError as exc:
            logger.warning("%s: rate limit (%s), waiting for budget", ref.key, exc)
            wait_for_request_budget(REQUESTS_PER_SESSION * 2)
            continue
        except Exception as exc:
            attempt += 1
            last_problem = f"{type(exc).__name__}: {exc}"
            logger.warning("%s: load failed (attempt %d/%d): %s", ref.key, attempt, MAX_ATTEMPTS, last_problem)
            _backoff(attempt)
            continue

        attempt += 1
        problems = _missing_parts(session, ref)
        if "laps" in problems and "results" in problems:
            last_problem = "no laps and no results"
            if attempt >= 2:
                logger.warning("%s: no data after %d attempts, marking unavailable", ref.key, attempt)
                append_manifest(ref, UNAVAILABLE, attempts=attempt, problem=last_problem)
                _log_failure(ref, UNAVAILABLE, last_problem)
                return UNAVAILABLE
            _backoff(attempt)
            continue
        if problems and attempt < 2:
            logger.info("%s: missing %s, retrying once", ref.key, problems)
            _backoff(attempt)
            continue
        try:
            meta = write_session(session, ref)
        except Exception as exc:
            last_problem = f"write failed: {type(exc).__name__}: {exc}"
            logger.exception("%s: %s", ref.key, last_problem)
            continue
        elapsed = time.time() - started
        append_manifest(ref, "done", attempts=attempt, missing=problems, counts=meta["counts"], seconds=round(elapsed, 1))
        if problems:
            _log_failure(ref, "partial", f"missing {problems}")
        logger.info("%s done in %.0fs: %s%s", ref.key, elapsed, meta["counts"], f" (missing {problems})" if problems else "")
        return "done"

    append_manifest(ref, "failed", attempts=attempt, problem=last_problem)
    _log_failure(ref, "failed", last_problem)
    return "failed"


def rebuild_tables(reason: str) -> None:
    """Rebuild data/processed/ff1_*.parquet so downstream jobs see every finished session.

    Safe while nothing else writes: build_tables only reads sessions whose meta.json exists,
    and every file is written to a temp name and renamed into place.
    """
    started = time.time()
    logger.info("Rebuilding merged tables (%s)", reason)
    try:
        build_tables.main()
    except Exception:
        logger.exception("Merged table rebuild failed (%s); run f1p.fastf1.build_tables by hand", reason)
        return
    elapsed = time.time() - started
    finished_at = datetime.now()
    logger.info("Merged tables rebuilt at %s in %.0f s (%s)", finished_at.strftime("%Y-%m-%d %H:%M:%S"), elapsed, reason)


def wait_for_request_budget(needed: int) -> None:
    """Sleep until FastF1's own per-hour request limiters have room for `needed` more calls."""
    while True:
        wait_s = 0.0
        now = time.time()
        for limiter in _hourly_limiters():
            wait_s = max(wait_s, _limiter_wait(limiter, needed, now))
        if wait_s <= 0:
            return
        resume_at = datetime.fromtimestamp(now + wait_s)
        logger.info("Request budget exhausted, sleeping %.0f s (until %s)", wait_s, resume_at.strftime("%H:%M:%S"))
        time.sleep(wait_s)


def restore_request_history() -> None:
    """Reload request timestamps of the last hour so a restart cannot exceed the hourly limit."""
    path = fastf1_root() / REQUEST_HISTORY_NAME
    if not path.exists():
        return
    text = path.read_text(encoding="utf-8")
    saved = json.loads(text)
    now = time.time()
    for limiter in _hourly_limiters():
        stamps = saved.get(limiter._info, [])
        recent = [stamp for stamp in stamps if stamp > now - limiter._interval]
        limiter._timestamps.extend(recent)
    logger.info("Restored request history: %s", {key: len(value) for key, value in saved.items()})


def save_request_history() -> None:
    history = {limiter._info: list(limiter._timestamps) for limiter in _hourly_limiters()}
    path = fastf1_root() / REQUEST_HISTORY_NAME
    text = json.dumps(history)
    path.write_text(text, encoding="utf-8")


def setup_logging() -> None:
    root = fastf1_root()
    log_path = root / "download.log"
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setFormatter(formatter)
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)
    logger.setLevel(logging.INFO)
    logger.addHandler(file_handler)
    logger.addHandler(console)
    fastf1_logger = logging.getLogger("fastf1")
    fastf1_logger.addHandler(file_handler)


def _missing_parts(session, ref: SessionRef) -> list[str]:
    missing = []
    checks = [("laps", "laps"), ("results", "results"), ("weather", "weather_data"), ("race_control", "race_control_messages")]
    if ref.wants_positions:
        checks.append(("positions", "pos_data"))
    for label, attribute in checks:
        try:
            value = getattr(session, attribute)
        except Exception:
            missing.append(label)
            continue
        if value is None or len(value) == 0:
            missing.append(label)
    return missing


def _hourly_limiters() -> list[_CallsPerIntervalLimitRaise]:
    found = []
    for limiters in _SessionWithRateLimiting._RATE_LIMITS.values():
        for limiter in limiters:
            if isinstance(limiter, _CallsPerIntervalLimitRaise):
                found.append(limiter)
    return found


def _limiter_wait(limiter: _CallsPerIntervalLimitRaise, needed: int, now: float) -> float:
    window_start = now - limiter._interval
    recent = [stamp for stamp in limiter._timestamps if stamp > window_start]
    capacity = limiter._timestamps.maxlen - 1
    free = capacity - len(recent)
    if free >= needed:
        return 0.0
    must_expire = needed - free
    expire_index = min(must_expire, len(recent)) - 1
    oldest_needed = recent[expire_index]
    return oldest_needed + limiter._interval - now + 1.0


def _season_refs(season: int, codes: list[str] | None) -> list[SessionRef]:
    for attempt in range(1, MAX_ATTEMPTS + 1):
        wait_for_request_budget(5)
        try:
            refs = completed_sessions(season)
            break
        except Exception as exc:
            logger.warning("Season %s schedule failed (attempt %d): %s", season, attempt, exc)
            _backoff(attempt)
    else:
        return []
    write_expected(season, refs)
    if codes:
        refs = [ref for ref in refs if ref.code in codes]
    # Most recent first, so the newest data is usable as early as possible.
    return sorted(refs, key=lambda ref: ref.start_utc, reverse=True)


def _should_process(ref: SessionRef, manifest: dict, retry_unavailable: bool) -> bool:
    if is_done(ref):
        return False
    previous = manifest.get(ref.key)
    if previous and previous["status"] == UNAVAILABLE and not retry_unavailable:
        return False
    return True


def _disk_ok() -> bool:
    usage = shutil.disk_usage(FASTF1_CACHE_DIR)
    free_gb = usage.free / 1e9
    used_gb = _fastf1_footprint_gb()
    if used_gb > PRUNE_ABOVE_GB:
        freed = _prune_telemetry_cache()
        logger.warning("FastF1 data at %.1f GB, pruned %.1f GB of telemetry pickles", used_gb, freed)
        used_gb = _fastf1_footprint_gb()
    if free_gb < MIN_FREE_GB or used_gb > STOP_ABOVE_GB:
        logger.error("Disk guard: free %.1f GB (min %d), FastF1 data %.1f GB (max %d)", free_gb, MIN_FREE_GB, used_gb, STOP_ABOVE_GB)
        return False
    return True


def _fastf1_footprint_gb() -> float:
    raw_bytes = _dir_size(fastf1_root())
    cache_bytes = _dir_size(FASTF1_CACHE_DIR)
    return (raw_bytes + cache_bytes) / 1e9


def _prune_telemetry_cache() -> float:
    """Delete car/position pickles. Sessions are only loaded once and kept as parquet, so these
    are just a convenience for re-extraction and can be downloaded again."""
    freed = 0
    pickles = sorted(FASTF1_CACHE_DIR.glob("*/*/*/car_data.ff1pkl"))
    pickles += sorted(FASTF1_CACHE_DIR.glob("*/*/*/position_data.ff1pkl"))
    for path in pickles:
        size = path.stat().st_size
        path.unlink(missing_ok=True)
        freed += size
    return freed / 1e9


def _dir_size(path) -> int:
    if not path.exists():
        return 0
    total = 0
    for item in path.rglob("*"):
        if item.is_file():
            stat = item.stat()
            total += stat.st_size
    return total


def _backoff(attempt: int) -> None:
    delay = BACKOFF_BASE_S * 2 ** (attempt - 1)
    logger.info("Backing off %d s", delay)
    time.sleep(delay)


def _log_failure(ref: SessionRef, status: str, problem: str | None) -> None:
    now = datetime.now(timezone.utc)
    stamp = now.isoformat(timespec="seconds")
    path = fastf1_root() / "failures.log"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"{stamp}\t{ref.key}\t{ref.event_name}\t{ref.name}\t{status}\t{problem}\n")


def _seasons(args) -> list[int]:
    if args.seasons:
        return season_range(args.seasons)
    current = datetime.now(timezone.utc).year
    return list(range(current, FIRST_SEASON - 1, -1))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seasons", nargs="*", help="seasons or ranges, e.g. 2026 2022-2024 (default: current..2018)")
    parser.add_argument("--sessions", nargs="*", help="session codes to include: FP1 FP2 FP3 SQ S Q R")
    parser.add_argument("--retry-unavailable", action="store_true", help="retry sessions marked as having no data")
    return parser.parse_args()


if __name__ == "__main__":
    main()
