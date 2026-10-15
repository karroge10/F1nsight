"""Writes data/raw/jolpica/README.md describing sources, coverage and known gaps."""

from __future__ import annotations

from datetime import date

from f1p.history.dump import DUMP_DOWNLOAD_URL, DUMPS_OVERVIEW_URL
from f1p.history.api import BASE_URL
from f1p.paths import raw_dir

KNOWN_GAPS = """\
- Qualifying: Jolpica has none before 1994 and only part of 1994 to 2002. Every race without
  Jolpica qualifying is filled from F1DB (`qualifying.source = 'f1db'`, best time in `q1Ms`).
  About 16 F1DB rows are skipped: drivers who never started a Grand Prix (failed to qualify
  every time) have no Jolpica id.
- Fastest laps: Jolpica has them from 2004 only. Earlier races are filled from F1DB: the
  fastest lap holder for 1950 to 1979 (rank 1 only, ties included) and the full fastest lap
  order from 1980. F1DB has no lap number for some early races.
- Lap times: 1996 onwards only. Pit stops: 2011 onwards only.
- Constructor standings start in 1958 (the constructors' championship did not exist before).
- Points are as awarded per race; historical dropped scores are applied only in the
  championship standings tables, not in `results.points`.

## Corrections applied at build time

- Race calendar (`f1p/history/corrections.py`, applied to `races` for dump and API alike):
  2023 Las Vegas FP1 to qualifying and every 2024 Las Vegas session were one day early;
  2024 Sao Paulo qualifying and race kept the timetable from before the rain delay; the 2026
  Miami race start was not moved to 17:00 UTC; the 2026 Monaco race had the
  America/New_York timezone; 2005 and 2006 race starts were the local clock labelled UTC.
  The build prints a note when the source already matches a fix, so it can be dropped.
- Qualifying: 2025 Miami has the order but no lap times in Jolpica (and none in FastF1);
  the times come from F1DB. Single drivers without times (qualifying disqualifications such
  as Hadjar at 2026 Miami) stay empty on purpose.
- 2026 Miami: Jolpica lists 11 Q3 entries because Hulkenberg was promoted to 10th after
  Hadjar's disqualification; he set no Q3 time, so `qualifying` has 9 Q3 times and is right.
"""


def write_raw_readme(dump_info: dict | None, gap_rounds: list[str], table_coverage: dict,
                     today: date) -> None:
    lines = [
        "# Jolpica-F1 raw data",
        "",
        f"Last updated {today.isoformat()} by `uv run python -m f1p.history.update` "
        "(run from `pipeline`).",
        "",
        "## Sources",
        "",
        "1. Public Jolpica-F1 CSV database dump (native Jolpica schema, 14 day delayed tier).",
        f"   - overview: {DUMPS_OVERVIEW_URL}",
        f"   - download: {DUMP_DOWNLOAD_URL}",
    ]
    if dump_info:
        lines += [
            f"   - in use: `dump/{dump_info['folder']}/` uploaded {dump_info['uploaded_at']}, "
            f"sha256 `{dump_info['file_hash']}`",
        ]
    lines += [
        f"2. Jolpica Ergast compatible API ({BASE_URL}) for rounds finished after the dump.",
        "   Cached per round in `api/<season>/<round>/` (results, sprint, qualifying, laps,",
        "   pitstops, driverstandings, constructorstandings, plus `_meta.json`). A round is",
        "   re-fetched until it has been fetched at least 3 days after the race, then frozen.",
        "   `api/<season>/schedule.json` is the season calendar, refreshed once a day.",
        f"   - rounds taken from the API in the last run: {', '.join(gap_rounds) or 'none'}",
        "3. F1DB (see `../f1db/README.md`) fills the fastest lap and qualifying gaps.",
        "",
        "When a newer dump covers a round that was cached from the API, the dump wins.",
        "",
        "## Coverage (processed tables)",
        "",
        "| table | seasons | rows | races |",
        "|---|---|---|---|",
    ]
    for name, info in table_coverage.items():
        lines.append(f"| {name} | {info['firstSeason']} to {info['lastSeason']} | "
                     f"{info['rows']} | {info['races']} |")
    lines += ["", "## Known gaps", "", KNOWN_GAPS]
    readme_path = raw_dir("jolpica") / "README.md"
    readme_path.write_text("\n".join(lines), encoding="utf-8")


def write_f1db_readme(f1db_info: dict | None, today: date) -> None:
    lines = [
        "# F1DB raw data",
        "",
        "Source: https://github.com/f1db/f1db (CC BY 4.0, credit F1DB on the site).",
        "Release lookup: https://api.github.com/repos/f1db/f1db/releases/latest, asset "
        "`f1db-csv.zip`, downloaded again only when the release tag changes.",
        "",
    ]
    if f1db_info:
        lines.append(f"In use: `{f1db_info['tag']}/` published {f1db_info['publishedAt']}, "
                     f"checked {today.isoformat()}.")
    lines += [
        "",
        "Used only to fill gaps in the Jolpica data (never to overwrite it):",
        "- `races-fastest-laps`: fastest laps for races before 2004",
        "- `races-qualifying-results`: qualifying for races Jolpica has none for (before 2003)",
        "- `races`: circuit layout id, lap length and turns per race",
        "",
        "F1DB ids are mapped onto Jolpica ids by matching race entries on (season, round, car",
        "number); drivers who never started a race are matched on surname and birth date.",
        "Coverage: every championship race since 1950, release tags follow `v<season>.<round>`.",
    ]
    readme_path = raw_dir("f1db") / "README.md"
    readme_text = "\n".join(lines)
    readme_path.write_text(readme_text, encoding="utf-8")
