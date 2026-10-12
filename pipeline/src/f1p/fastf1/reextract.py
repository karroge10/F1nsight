"""Rewrite the per-session files of already downloaded sessions from the FastF1 cache.

    uv run python -m f1p.fastf1.reextract --seasons 2026 [--sessions R S Q SQ]

Use after changing extraction code (positions, timing, tracks). Stop the bulk download first:
both processes share FastF1's hourly request budget, which is tracked in request_history.json.
Each session costs one or two requests (results from Jolpica); telemetry comes from the cache
unless the disk guard pruned it, in which case it is downloaded again.
"""

import argparse

from f1p.fastf1.common import is_done, logger, read_expected, season_range, setup_fastf1
from f1p.fastf1.download import process_session, restore_request_history, save_request_history, setup_logging


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seasons", nargs="*", required=True)
    parser.add_argument("--sessions", nargs="*", help="session codes, default all")
    args = parser.parse_args()
    setup_logging()
    setup_fastf1()
    restore_request_history()
    seasons = season_range(args.seasons)
    for season in seasons:
        for ref in read_expected(season):
            if args.sessions and ref.code not in args.sessions:
                continue
            if not is_done(ref):
                continue
            logger.info("Re-extracting %s", ref.key)
            process_session(ref)
            save_request_history()


if __name__ == "__main__":
    main()
