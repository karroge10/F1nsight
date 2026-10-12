"""Collect the grid penalties announced for the next race into data/processed/grid_penalties.parquet.

    uv run python -m f1p.penalties.update                        # the race refresh is heading for
    uv run python -m f1p.penalties.update --season 2026 --round 17
    uv run python -m f1p.penalties.update --no-fia               # race control + manual only

Sources, strongest first:
1. data/manual/grid_penalties.json: hand-written entries. An entry replaces every parsed entry
   for the same driver and session (race or sprint); kind "none" removes them.
2. FIA stewards' decisions (`f1p.penalties.fia`): the event's own documents, plus decisions taken
   in the previous event's race that move a driver back "at the next Race".
3. Race control messages (`f1p.penalties.race_control`), only for a driver and session the FIA
   documents say nothing about.

One row per decision: season, round, raceId, driverId, carNumber, kind (places, back_of_grid,
pit_lane), places, category (power_unit or other), appliesTo (race or sprint), source (fia,
race_control, manual), documentId, title, url, session, decision, publishedUtc. Several rows for
one driver add up (the ML side sums places). The file is only rewritten when its content
changes, so an unchanged file never triggers a new forecast. When fia.com cannot be reached the
FIA rows already in the file are kept and the exit code is 1.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone

import pandas as pd

from f1p import weekend
from f1p.paths import DATA_DIR, PROCESSED_DIR, RAW_DIR
from f1p.penalties import fia, race_control

OUTPUT_PATH = PROCESSED_DIR / "grid_penalties.parquet"
MANUAL_PATH = DATA_DIR / "manual" / "grid_penalties.json"
FIA_CACHE = RAW_DIR / "fia"
COLUMNS = ["season", "round", "raceId", "driverId", "carNumber", "kind", "places", "category",
           "appliesTo", "source", "documentId", "title", "url", "session", "decision",
           "publishedUtc"]
KINDS = ("places", "back_of_grid", "pit_lane")


def main() -> int:
    args = _parse_args()
    now = datetime.now(timezone.utc)
    race = weekend.find_race(args.season, args.round, now)
    if race is None:
        print("no upcoming race in data/processed/races.parquet")
        return 0
    races = pd.read_parquet(PROCESSED_DIR / "races.parquet")
    previous = previous_race(races, race)
    season = int(race["season"])
    round_number = int(race["round"])
    numbers = car_numbers(season)
    fia_error = None
    fia_rows: list[dict] = []
    if not args.no_fia:
        try:
            fia_rows = fia_penalties(race, previous, numbers)
        except Exception as exc:
            fia_error = f"{type(exc).__name__}: {exc}"
            print(f"warning: FIA documents unavailable ({fia_error}); keeping the FIA rows on file")
            fia_rows = _existing_rows(season, round_number, "fia")
    control_rows = race_control_penalties(races, race, previous, numbers)
    manual_rows = manual_entries(season, round_number, numbers)
    table = combine(fia_rows, control_rows, manual_rows, race)
    written = write_if_changed(table)
    _print_table(race, table, written)
    summary = {"race": f"{season} R{round_number}", "penalties": len(table), "written": written,
               "fiaError": fia_error}
    summary_text = json.dumps(summary)
    print(f"RESULT {summary_text}")
    return 1 if fia_error else 0


def fia_penalties(race: pd.Series, previous: pd.Series | None, numbers: dict) -> list[dict]:
    """Grid penalties from the FIA documents of this event and the previous event's race."""
    rows = []
    cache = _cache_dir(race)
    decisions = fia.event_decisions(int(race["season"]), str(race["raceName"]), cache)
    race_start = _iso(race["raceUtc"])
    for decision in decisions:
        if _for_following_event(decision, race_start):
            continue
        row = _decision_row(decision, race, numbers)
        rows.append(row)
    if previous is None:
        return rows
    previous_cache = _cache_dir(previous)
    previous_decisions = fia.event_decisions(int(previous["season"]), str(previous["raceName"]),
                                             previous_cache)
    previous_start = _iso(previous["raceUtc"])
    for decision in previous_decisions:
        if not _for_following_event(decision, previous_start):
            continue
        decision.applies_to = "race"
        row = _decision_row(decision, race, numbers)
        rows.append(row)
    return rows


def race_control_penalties(races: pd.DataFrame, race: pd.Series, previous: pd.Series | None,
                           numbers: dict) -> list[dict]:
    """Grid penalties posted by race control this weekend (before the race) or in the last race."""
    season = int(race["season"])
    round_number = int(race["round"])
    messages = race_control.weekend_messages(races, season, round_number)
    candidates = messages[messages["session"] != "R"]
    if previous is not None:
        previous_messages = race_control.weekend_messages(races, int(previous["season"]),
                                                          int(previous["round"]))
        previous_race_messages = previous_messages[previous_messages["session"] == "R"]
        candidates = pd.concat([candidates, previous_race_messages], ignore_index=True)
    rows = []
    for record in candidates.itertuples(index=False):
        parsed = race_control.parse_message(record.message)
        if parsed is None:
            continue
        driver_id = numbers.get(parsed["carNumber"])
        posted = _iso(record.timeUtc)
        rows.append(_row(race, driver_id, parsed["carNumber"], parsed["kind"], parsed["places"],
                         "other", parsed["appliesTo"], "race_control", None, record.message, None,
                         str(record.session), record.message, posted))
    return rows


def manual_entries(season: int, round_number: int, numbers: dict) -> list[dict]:
    """Entries of data/manual/grid_penalties.json for this race (kind "none" removes)."""
    if not MANUAL_PATH.exists():
        return []
    text = MANUAL_PATH.read_text(encoding="utf-8")
    payload = json.loads(text)
    rows = []
    for entry in payload.get("penalties", []):
        if int(entry.get("season", 0)) != season or int(entry.get("round", 0)) != round_number:
            continue
        car_number = entry.get("carNumber")
        driver_id = entry.get("driverId") or numbers.get(car_number)
        kind = entry.get("kind", "places")
        note = entry.get("note", "")
        rows.append({
            "season": season, "round": round_number, "raceId": season * 100 + round_number,
            "driverId": driver_id, "carNumber": car_number, "kind": kind,
            "places": entry.get("places"), "category": entry.get("category", "other"),
            "appliesTo": entry.get("appliesTo", "race"), "source": "manual", "documentId": None,
            "title": note, "url": None, "session": None, "decision": note, "publishedUtc": None,
        })
    return rows


def combine(fia_rows: list[dict], control_rows: list[dict], manual_rows: list[dict],
            race: pd.Series) -> pd.DataFrame:
    """FIA rows, race control rows for drivers the FIA did not penalise, manual rows on top."""
    fia_keys = {_key(row) for row in fia_rows}
    control_kept = [row for row in control_rows if _key(row) not in fia_keys]
    control_kept = _unique(control_kept)
    manual_keys = {_key(row) for row in manual_rows}
    parsed = [row for row in fia_rows + control_kept if _key(row) not in manual_keys]
    manual_kept = [row for row in manual_rows if row["kind"] in KINDS]
    rows = parsed + manual_kept
    rows = [row for row in rows if row["driverId"]]
    table = pd.DataFrame(rows, columns=COLUMNS)
    for column in ("season", "round", "raceId", "carNumber", "places", "documentId"):
        table[column] = pd.to_numeric(table[column], errors="coerce").astype("Int64")
    for column in COLUMNS:
        if column not in ("season", "round", "raceId", "carNumber", "places", "documentId"):
            table[column] = table[column].astype("string")
    return table.sort_values(["appliesTo", "driverId", "documentId"]).reset_index(drop=True)


def write_if_changed(table: pd.DataFrame) -> bool:
    """Write the parquet only when the rows differ from what is on disk."""
    if OUTPUT_PATH.exists():
        existing = pd.read_parquet(OUTPUT_PATH)
        same_shape = list(existing.columns) == list(table.columns) and len(existing) == len(table)
        existing_text = existing.astype(str)
        table_text = table.astype(str)
        if same_shape and existing_text.equals(table_text):
            return False
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp_path = OUTPUT_PATH.with_suffix(".tmp")
    table.to_parquet(temp_path, index=False)
    temp_path.replace(OUTPUT_PATH)
    return True


def previous_race(races: pd.DataFrame, race: pd.Series) -> pd.Series | None:
    """The race held before this one (any season), or None for the first race on record."""
    earlier = races[races["raceUtc"] < race["raceUtc"]].sort_values("raceUtc")
    return None if earlier.empty else earlier.iloc[-1]


def car_numbers(season: int) -> dict[int, str]:
    """Car number -> driverId for a season: FastF1 id map first, season entries as fallback."""
    numbers: dict[int, str] = {}
    entries = pd.read_parquet(PROCESSED_DIR / "season_entries.parquet",
                              columns=["season", "driverId", "carNumbers"])
    season_entries = entries[entries["season"] == season]
    for record in season_entries.itertuples(index=False):
        if record.carNumbers is None or record.carNumbers != record.carNumbers:
            continue
        for number in re.findall(r"\d+", str(record.carNumbers)):
            numbers[int(number)] = record.driverId
    id_map_path = PROCESSED_DIR / "id_map.parquet"
    if id_map_path.exists():
        id_map = pd.read_parquet(id_map_path, columns=["season", "driverNumber", "driverId"])
        known = id_map[(id_map["season"] == season) & id_map["driverId"].notna()
                       & (id_map["driverId"].astype(str) != "nan")]
        for record in known.itertuples(index=False):
            numbers[int(record.driverNumber)] = str(record.driverId)
    return numbers


# ----------------------------------------------------------------------------------------------
# helpers


def _for_following_event(decision: fia.Decision, race_start: str) -> bool:
    """A "next Race" decision taken in or after this event's race moves to the following event."""
    if not decision.next_event:
        return False
    if decision.session.lower() == "race":
        return True
    published = decision.document.published_utc
    return published is not None and published >= race_start


def _decision_row(decision: fia.Decision, race: pd.Series, numbers: dict) -> dict:
    driver_id = numbers.get(decision.car_number)
    document = decision.document
    return _row(race, driver_id, decision.car_number, decision.kind, decision.places,
                decision.category, decision.applies_to, "fia", document.number, document.title,
                document.url, decision.session, decision.decision_text, document.published_utc)


def _row(race: pd.Series, driver_id, car_number, kind, places, category, applies_to, source,
         document_id, title, url, session, decision, published) -> dict:
    season = int(race["season"])
    round_number = int(race["round"])
    return {"season": season, "round": round_number, "raceId": season * 100 + round_number,
            "driverId": driver_id, "carNumber": car_number, "kind": kind, "places": places,
            "category": category, "appliesTo": applies_to, "source": source,
            "documentId": document_id, "title": title, "url": url, "session": session,
            "decision": decision, "publishedUtc": published}


def _key(row: dict) -> tuple:
    return row["driverId"], row["appliesTo"]


def _unique(rows: list[dict]) -> list[dict]:
    """One race control row per driver, session, kind and places (sources repeat messages)."""
    seen = set()
    kept = []
    for row in rows:
        key = (row["driverId"], row["appliesTo"], row["kind"], row["places"])
        if key in seen:
            continue
        seen.add(key)
        kept.append(row)
    return kept


def _existing_rows(season: int, round_number: int, source: str) -> list[dict]:
    if not OUTPUT_PATH.exists():
        return []
    table = pd.read_parquet(OUTPUT_PATH)
    rows = table[(table["season"] == season) & (table["round"] == round_number)
                 & (table["source"] == source)]
    records = rows.astype(object).where(rows.notna(), None)
    return records.to_dict("records")


def _cache_dir(race: pd.Series):
    slug = re.sub(r"[^a-z0-9]+", "_", str(race["raceName"]).lower()).strip("_")
    return FIA_CACHE / str(int(race["season"])) / f"{int(race['round']):02d}_{slug}"


def _iso(value) -> str | None:
    if value is None or value != value:
        return None
    stamp = pd.Timestamp(value)
    if stamp.tzinfo is None:
        stamp = stamp.tz_localize("UTC")
    return stamp.tz_convert("UTC").isoformat(timespec="minutes")


def _print_table(race: pd.Series, table: pd.DataFrame, written: bool) -> None:
    state = "written" if written else "unchanged"
    print(f"{int(race['season'])} R{int(race['round'])} {race['raceName']}: {len(table)} grid "
          f"penalties ({state}, {OUTPUT_PATH.name})")
    for record in table.itertuples(index=False):
        amount = f"+{record.places}" if record.kind == "places" else record.kind
        document = "" if pd.isna(record.documentId) else f" doc {record.documentId}"
        print(f"  {record.driverId:16s} car {record.carNumber}  {amount:12s} {record.appliesTo:6s} "
              f"{record.source}{document}: {record.title}")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--season", type=int)
    parser.add_argument("--round", type=int)
    parser.add_argument("--no-fia", action="store_true", help="skip fia.com (race control and manual only)")
    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(main())
