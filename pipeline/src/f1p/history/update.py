"""Update the full F1 race history and rebuild the serve database.

Usage (from pipeline):  uv run python -m f1p.history.update

Steps, each one resumable:
1. download the public Jolpica CSV dump if the server has a newer one
2. fetch rounds finished after the dump from the live API (cached per round on disk)
3. rebuild data/processed/*.parquet from dump + cached API rounds
4. rebuild data/serve/f1.sqlite and copy SCHEMA.md next to it
5. run the verification checks and refresh raw/jolpica/README.md
"""

from __future__ import annotations

import shutil
import sys
import time
from datetime import date
from pathlib import Path

from f1p.history.dump import current_dump_info, ensure_dump
from f1p.history.f1db import current_f1db_info, enrich, ensure_f1db
from f1p.history.from_dump import load_dump_tables
from f1p.history.gap import fetch_gap
from f1p.history.raw_readme import write_f1db_readme, write_raw_readme
from f1p.history.serve import build_serve_db
from f1p.history.tables import build_processed, write_processed
from f1p.history.verify import coverage, verify
from f1p.paths import SERVE_DIR


def main() -> int:
    started = time.monotonic()
    today = date.today()

    print("1/5 Jolpica database dump")
    csv_dir = ensure_dump()
    dump_tables = load_dump_tables(csv_dir)
    dump_results = dump_tables["results"]
    round_keys = zip(dump_results["season"], dump_results["round"])
    covered_rounds = set(round_keys)
    last_dump_season = int(dump_results["season"].max())
    print(f"  dump covers {len(covered_rounds)} races up to season {last_dump_season}")

    print("2/5 rounds missing from the dump (live API)")
    gap = fetch_gap(covered_rounds, last_dump_season, today)
    gap_rounds = [_round_label(payload) for payload in gap["rounds"]]
    print(f"  API rounds used: {', '.join(gap_rounds) if gap_rounds else 'none'}")

    print("3/5 processed parquet tables (F1DB fills Jolpica gaps)")
    tables = build_processed(dump_tables, gap)
    f1db_dir = ensure_f1db()
    if f1db_dir is not None:
        fill_counts = enrich(tables, f1db_dir)
        print("  F1DB " + ", ".join(f"{name}={count}" for name, count in fill_counts.items()))
    row_counts = write_processed(tables)
    print("  " + ", ".join(f"{name}={count}" for name, count in row_counts.items()))

    print("4/5 serve database")
    db_path = build_serve_db()
    schema_doc = Path(__file__).with_name("SCHEMA.md")
    shutil.copyfile(schema_doc, SERVE_DIR / "SCHEMA.md")
    print(f"  wrote {db_path}")

    print("5/5 verification")
    failures = verify(tables, db_path)
    dump_info = current_dump_info()
    table_coverage = coverage(tables)
    write_raw_readme(dump_info, gap_rounds, table_coverage, today)
    f1db_info = current_f1db_info()
    write_f1db_readme(f1db_info, today)

    elapsed = time.monotonic() - started
    print(f"\nDone in {elapsed:.0f}s")
    return 1 if failures else 0


def _round_label(payload: dict) -> str:
    folder = Path(payload["folder"])
    return f"{folder.parent.name}/{folder.name}"


if __name__ == "__main__":
    sys.exit(main())
