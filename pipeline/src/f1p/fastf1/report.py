"""Coverage report for the FastF1 download: writes PROGRESS.md and README.md in data/raw/fastf1/.

    uv run python -m f1p.fastf1.report      # regenerate both files and print the summary
"""

import json
import shutil
from datetime import datetime, timezone

from f1p.fastf1.common import FIRST_SEASON, SESSION_ORDER, fastf1_root, read_expected, read_manifest
from f1p.paths import FASTF1_CACHE_DIR

# FastF1 allows 500 uncached requests per hour and a session needs about 14.
SESSIONS_PER_HOUR = 34
# Sessions whose position data covers less than this share of the replay window are listed as gaps.
THIN_POSITIONS = 0.9
# Rough size of a season not listed yet, for the remaining-time estimate.
SESSIONS_PER_UNSTARTED_SEASON = 110


def main() -> None:
    summary = write_progress()
    print(summary)


def write_progress() -> str:
    """Regenerate PROGRESS.md and README.md from meta.json files and the manifest."""
    rows = coverage_rows()
    gaps = gap_rows()
    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y-%m-%d %H:%M UTC")
    table = _coverage_table(rows)
    remaining = sum(row["remaining"] for row in rows)
    eta_hours = remaining / SESSIONS_PER_HOUR
    disk = _disk_summary()
    progress = PROGRESS_TEMPLATE.format(
        stamp=stamp,
        table=table,
        remaining=remaining,
        eta=f"{eta_hours:.1f}",
        disk=disk,
        gaps=_gap_table(gaps),
    )
    root = fastf1_root()
    progress_path = root / "PROGRESS.md"
    progress_path.write_text(progress, encoding="utf-8")
    readme = README_TEMPLATE.format(stamp=stamp, table=table, gaps=_gap_table(gaps))
    readme_path = root / "README.md"
    readme_path.write_text(readme, encoding="utf-8")
    return f"{table}\nremaining {remaining} sessions (~{eta_hours:.1f} h), {disk}"


def coverage_rows() -> list[dict]:
    manifest = read_manifest()
    root = fastf1_root()
    current = datetime.now(timezone.utc).year
    rows = []
    for season in range(current, FIRST_SEASON - 1, -1):
        expected = read_expected(season)
        metas = _season_metas(season)
        done_keys = {meta["key"] for meta in metas}
        unavailable = [ref for ref in expected if _status(manifest, ref.key) == "unavailable" and ref.key not in done_keys]
        failed = [ref for ref in expected if _status(manifest, ref.key) == "failed" and ref.key not in done_keys]
        by_code = {code: 0 for code in SESSION_ORDER}
        for meta in metas:
            by_code[meta["session"]] = by_code.get(meta["session"], 0) + 1
        with_positions = sum(1 for meta in metas if meta.get("hasPositions"))
        tracks = len(list((root / str(season)).glob("*_track.json")))
        expected_count = len(expected)
        skipped = len(unavailable)
        remaining = max(expected_count - len(metas) - skipped, 0)
        if not expected:
            remaining = SESSIONS_PER_UNSTARTED_SEASON
        rows.append({
            "season": season,
            "expected": expected_count,
            "done": len(metas),
            "byCode": by_code,
            "positions": with_positions,
            "tracks": tracks,
            "unavailable": skipped,
            "failed": len(failed),
            "remaining": remaining,
        })
    return rows


def gap_rows() -> list[dict]:
    """Sessions with no data, failures, and done sessions with missing parts."""
    manifest = read_manifest()
    gaps = _thin_position_rows()
    for key, record in sorted(manifest.items(), reverse=True):
        status = record["status"]
        if status == "done" and not record.get("missing"):
            continue
        detail = record.get("problem") or f"missing {', '.join(record.get('missing') or [])}"
        gaps.append({
            "key": key,
            "event": record.get("event_name", ""),
            "session": record.get("name", ""),
            "status": "partial" if status == "done" else status,
            "detail": detail,
        })
    return gaps


def _thin_position_rows() -> list[dict]:
    rows = []
    for meta_path in sorted(fastf1_root().glob("*/*/meta.json"), reverse=True):
        text = meta_path.read_text(encoding="utf-8")
        meta = json.loads(text)
        coverage = meta.get("positionsCoverage")
        if coverage is None or coverage >= THIN_POSITIONS:
            continue
        rows.append({
            "key": meta["key"],
            "event": meta["eventName"],
            "session": meta["sessionName"],
            "status": "thin positions",
            "detail": f"positions for {coverage:.0%} of the replay window",
        })
    return rows


def _season_metas(season: int) -> list[dict]:
    folder = fastf1_root() / str(season)
    metas = []
    for path in sorted(folder.glob("*/meta.json")):
        text = path.read_text(encoding="utf-8")
        metas.append(json.loads(text))
    return metas


def _status(manifest: dict, key: str) -> str | None:
    record = manifest.get(key)
    return record["status"] if record else None


def _coverage_table(rows: list[dict]) -> str:
    header = "| season | expected | done | " + " | ".join(SESSION_ORDER) + " | positions | tracks | no data | failed | remaining |"
    divider = "|" + "---|" * (len(SESSION_ORDER) + 8)
    lines = [header, divider]
    for row in rows:
        if row["expected"] == 0 and row["done"] == 0:
            empty_cells = " |" * (len(SESSION_ORDER) + 6)
            lines.append(f"| {row['season']} | not started |{empty_cells}")
            continue
        codes = " | ".join(str(row["byCode"].get(code, 0)) for code in SESSION_ORDER)
        lines.append(
            f"| {row['season']} | {row['expected']} | {row['done']} | {codes} | {row['positions']} | "
            f"{row['tracks']} | {row['unavailable']} | {row['failed']} | {row['remaining']} |"
        )
    return "\n".join(lines)


def _gap_table(gaps: list[dict]) -> str:
    if not gaps:
        return "None so far."
    lines = ["| session | event | name | status | detail |", "|---|---|---|---|---|"]
    for gap in gaps:
        detail = str(gap["detail"]).replace("|", "/")
        lines.append(f"| {gap['key']} | {gap['event']} | {gap['session']} | {gap['status']} | {detail} |")
    return "\n".join(lines)


def _disk_summary() -> str:
    raw_gb = _dir_size_gb(fastf1_root())
    cache_gb = _dir_size_gb(FASTF1_CACHE_DIR)
    usage = shutil.disk_usage(FASTF1_CACHE_DIR)
    free_gb = usage.free / 1e9
    return f"raw/fastf1 {raw_gb:.1f} GB, fastf1_cache {cache_gb:.1f} GB, drive free {free_gb:.0f} GB"


def _dir_size_gb(path) -> float:
    if not path.exists():
        return 0.0
    total = 0
    for item in path.rglob("*"):
        if item.is_file():
            stat = item.stat()
            total += stat.st_size
    return total / 1e9


PROGRESS_TEMPLATE = """# FastF1 download progress

Updated {stamp}. Regenerate with `uv run python -m f1p.fastf1.report` (from `v2/pipeline`).

{table}

Remaining: {remaining} sessions, about {eta} h at FastF1's 500 requests/hour limit.
Disk: {disk}.

## Check and resume

- Is it running? `Get-Process python` (PowerShell) or look at the tail of `download.log` here.
- Resume or continue after a stop: from `v2/pipeline` run
  `uv run python -m f1p.fastf1.download` (finished sessions are skipped, newest season first).
- Only some seasons: `--seasons 2018-2021`. Retry "no data" sessions: `--retry-unavailable`.
- Rebuild the merged tables at any time: `uv run python -m f1p.fastf1.build_tables`.
- Failures and partial sessions are appended to `failures.log` and `manifest.jsonl`.

## Gaps

{gaps}
"""

README_TEMPLATE = """# FastF1 raw data (2018 onwards)

Downloaded with FastF1 (live timing archive of formula1.com plus Jolpica/Ergast for results and
the MultiViewer API for corners) by `uv run python -m f1p.fastf1.download`. Merged tables are
built by `uv run python -m f1p.fastf1.build_tables` into `data/processed/ff1_*.parquet`.
Coverage updated {stamp}.

## Layout

`<season>/<RR>_<code>/` per session, codes FP1 FP2 FP3 SQ (Sprint Shootout 2023, Sprint
Qualifying 2024+) S (Sprint, 2021+) Q R:

- `laps.parquet` FastF1 `Session.laps` as is (timedeltas, session clock).
- `results.parquet` FastF1 `Session.results` (`DriverId`/`TeamId` are Ergast ids where FastF1
  could match them; practice sessions often have none).
- `weather.parquet`, `track_status.parquet`, `session_status.parquet` (session clock `Time`).
- `race_control.parquet` race control messages (`Time` is wall clock UTC; `sessionTimeMs` added
  where the session clock offset is known, i.e. sessions with positions).
- `positions.parquet` (R, S, and Q/SQ from 2023): `t` ms session time on a 250 ms grid
  (4 Hz, multiples of 250), `driverNumber`, `x`, `y` (decimetres, FastF1 coordinates), `status`
  (OnTrack, OffTrack, InPit from lap pit in/out times). Linear interpolation across feed holes up
  to 2 s, or longer if the car did not move; otherwise the tick is left out (no row means no
  position, hide the car). Window: first "Started" minus 2 min to last "Finished" plus 5 min.
- `timing.parquet` (R, S): one row per driver per lap for a timing tower: position, gap to
  leader and interval at the line (seconds, `lapsDown` for lapped cars), lap and sector times,
  compound, tyre age, stint, pit in/out flags and times, pit stop count, track status.
  `lapEndMs` is when the timing feed logged the lap; `lineCrossMs` is the 4 Hz tick where the
  car was closest to the timing line (from positions). They normally agree within 0.3 s, but the
  timing feed sometimes lags by several seconds (e.g. parts of 2026 R16), so replays should
  place lap events at `lineCrossMs` when it is set.
- `timing_stream.parquet` (R, S): the official live tower feed (position, gap, interval as shown,
  plus parsed seconds/laps) at each change, `t` ms session time.
- `meta.json` written last; its presence marks the session as done. Includes the session clock
  offset `t0Date` (UTC wall time of session time 0), counts and the replay window.

`<season>/<RR>_track.json` per race weekend: outline polyline from the race's fastest lap
(decimetres), sector boundary points, `rotation` (degrees, for drawing), corners, marshal lights
and sectors from `Session.get_circuit_info()` (MultiViewer, falling back to up to three earlier
seasons of the same circuit). Circuits MultiViewer does not know (new or returning venues) get
`rotation: null` and corners estimated from speed minima of the reference lap
(`cornersEstimated: true`, angle 0).

All session-clock times (`t`, lap `Time`, `PitInTime`, weather `Time`, track status `Time`)
share one origin, so positions, timing and messages line up directly.

## Coverage

{table}

## Gaps

{gaps}

## Notes

- Telemetry (car data and positions) is only loaded for sessions that get `positions.parquet`;
  practice sessions and pre-2023 qualifying are laps/weather/messages/results only.
- The FastF1 cache in `data/fastf1_cache` keeps parsed pickles (raw HTTP caching is off to save
  disk); large car/position pickles may be pruned by the disk guard and are re-downloadable.
- Bookkeeping: `manifest.jsonl` (every attempt), `failures.log`, `download.log`,
  `<season>/expected.json` (completed sessions per the schedule at download time).
"""


if __name__ == "__main__":
    main()
