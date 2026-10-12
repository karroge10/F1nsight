"""Estimated positions (anonymous timing only) against the real Position.z of recorded sessions.

    uv run python scripts/validate_estimator.py 2026:14:R --ref 2026:14:Q
    uv run python scripts/validate_estimator.py 2025:18:R 2026:11:R --ref auto --delay 3000

`--ref auto` uses the latest earlier session of the same weekend that has positions (what the
live service would have), `--ref prev` the same circuit's race one season earlier.
Prints median and p95 error in metres per category, and how often nearby cars are in the right
order on track.
"""

import argparse
import asyncio
import json
import sys
import time

from f1live import config
from f1live.archive import ArchiveClient, ArchiveSession, build_recording
from f1live.reference import CircuitReference, build_reference, merge_missing
from f1live.validation import evaluate

TOPICS = [topic for topic in config.ARCHIVE_TOPICS if topic != "CarData.z"]
SESSION_ORDER = ["FP1", "FP2", "FP3", "SQ", "S", "Q", "R"]


async def main() -> None:
    args = parse_args()
    archive = ArchiveClient()
    report = []
    try:
        for spec in args.targets:
            season, round_number, code = parse_spec(spec)
            target = await archive.find_session(season, round_number, code)
            if target is None:
                print(f"{spec}: not in the archive", file=sys.stderr)
                continue
            reference_session = await pick_reference(archive, target, args.ref)
            if reference_session is None:
                print(f"{spec}: no reference session", file=sys.stderr)
                continue
            reference = await reference_for(archive, reference_session)
            if args.ref == "auto":
                previous = await pick_reference(archive, target, "prev")
                older = await reference_for(archive, previous) if previous is not None else None
                reference = merge_missing(reference, older)
            recording = await load(archive, target)
            for delay in args.delay:
                started = time.perf_counter()
                result = evaluate(recording, reference, render_delay_ms=delay, step_ms=args.step)
                summary = result.summary()
                summary["target"] = spec
                summary["reference"] = reference_session.path
                summary["delayMs"] = delay
                summary["seconds"] = round(time.perf_counter() - started, 1)
                report.append(summary)
                print_summary(summary)
    finally:
        await archive.close()
    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("targets", nargs="+", metavar="SEASON:ROUND:SESSION")
    parser.add_argument("--ref", default="auto", help="auto, prev, or SEASON:ROUND:SESSION")
    parser.add_argument("--delay", type=int, nargs="+", default=[config.LIVE_RENDER_DELAY_MS])
    parser.add_argument("--step", type=int, default=1000, help="comparison step in ms of feed time")
    parser.add_argument("--json", help="write the summaries to this file")
    return parser.parse_args()


def parse_spec(spec: str) -> tuple[int, int, str]:
    season, round_number, code = spec.split(":")
    return int(season), int(round_number), code.upper()


async def pick_reference(archive: ArchiveClient, target: ArchiveSession, mode: str) -> ArchiveSession | None:
    if mode not in ("auto", "prev"):
        season, round_number, code = parse_spec(mode)
        return await archive.find_session(season, round_number, code)
    if mode == "auto":
        weekend = [
            session for session in await archive.list_sessions(target.season)
            if session.meeting_key == target.meeting_key and session.end_utc < target.start_utc
        ]
        if weekend:
            return max(weekend, key=lambda session: session.start_utc)
    earlier = await archive.list_sessions(target.season - 1)
    races = [session for session in earlier if session.circuit_key == target.circuit_key and session.code == "R"]
    return races[-1] if races else None


async def reference_for(archive: ArchiveClient, session: ArchiveSession) -> CircuitReference:
    cache = config.ESTIMATOR_CACHE_DIR / "validation" / (session.path.strip("/").replace("/", "__") + ".json")
    if cache.exists():
        text = cache.read_text(encoding="utf-8")
        raw = json.loads(text)
        return CircuitReference.from_json(raw)
    recording = await load(archive, session)
    reference = build_reference(
        recording.messages, recording.positions, recording.final_state, session.circuit_key, session.path
    )
    if reference is None:
        raise RuntimeError(f"could not build a reference from {session.path}")
    cache.parent.mkdir(parents=True, exist_ok=True)
    payload = reference.to_json()
    text = json.dumps(payload)
    cache.write_text(text, encoding="utf-8")
    return reference


async def load(archive: ArchiveClient, session: ArchiveSession):
    raw = await archive.load_raw_feed(session, TOPICS)
    return await asyncio.to_thread(build_recording, raw)


def print_summary(summary: dict) -> None:
    print(f"\n{summary['target']}  reference {summary['reference']}  delay {summary['delayMs']} ms  ({summary['seconds']} s)")
    for key, value in summary.items():
        if isinstance(value, dict):
            print(f"  {key:12s} n={value['n']:7d}  median {value['median']:6.1f} m  p95 {value['p95']:7.1f} m"
                  f"  <=50m {value['within50']:.2f}  <=100m {value['within100']:.2f}")
    print(f"  neighbour order correct {summary['neighbourOrder']}, all neighbours right {summary['fullOrder']},"
          f" cars shown {summary['shown']}")
    print(f"  truth: inconsistent with timing {summary['truthInconsistent']},"
          f" repeated moving samples {summary['truthRepeated']}")


if __name__ == "__main__":
    asyncio.run(main())
