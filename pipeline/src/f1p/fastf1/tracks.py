"""Fill in missing or incomplete <season>/<RR>_track.json files for races already downloaded.

    uv run python -m f1p.fastf1.tracks [--seasons 2024-2026]

A track file is redone when it is missing or has neither MultiViewer data (rotation, corners)
nor estimated corners, e.g. because MultiViewer was down during the download. Uses the FastF1 cache, so it costs only a few requests per race.
"""

import argparse
import json

from f1p.fastf1.common import SessionRef, get_session, is_done, read_expected, season_range, setup_fastf1, track_path
from f1p.fastf1.download import restore_request_history, save_request_history, wait_for_request_budget
from f1p.fastf1.extract import write_track


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seasons", nargs="*", default=["2018-2026"])
    args = parser.parse_args()
    setup_fastf1()
    restore_request_history()
    seasons = season_range(args.seasons)
    for season in seasons:
        for ref in read_expected(season):
            if ref.code != "R" or not is_done(ref) or not needs_track(ref):
                continue
            wait_for_request_budget(10)
            ok = rebuild_track(ref)
            save_request_history()
            print(f"{ref.key}: {'written' if ok else 'still missing'}")


def needs_track(ref: SessionRef) -> bool:
    path = track_path(ref.season, ref.round)
    if not path.exists():
        return True
    text = path.read_text(encoding="utf-8")
    track = json.loads(text)
    return track.get("rotation") is None and not track.get("cornersEstimated")


def rebuild_track(ref: SessionRef) -> bool:
    session = get_session(ref)
    session.load(laps=True, telemetry=True, weather=False, messages=False)
    return write_track(session, ref)


if __name__ == "__main__":
    main()
