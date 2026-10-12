"""Build data/serve/f1.sqlite from the processed parquet tables.

The database is written to a temp file and swapped in at the end, so a reader never sees a
half built file. Schema documentation lives in data/serve/SCHEMA.md (see schema_doc.py).
"""

from __future__ import annotations

import os
import sqlite3
import time
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from f1p.history.tables import SCHEMAS
from f1p.paths import SERVE_DIR, processed_path

DB_NAME = "f1.sqlite"
RENAME_ATTEMPTS = 4
PRIMARY_KEYS = {
    "seasons": ["season"],
    "races": ["raceId"],
    "circuits": ["circuitId"],
    "drivers": ["driverId"],
    "constructors": ["constructorId"],
    "lap_times": ["raceId", "driverId", "lap"],
    "pit_stops": ["raceId", "driverId", "stop"],
    "driver_standings": ["raceId", "driverId"],
    "constructor_standings": ["raceId", "constructorId"],
    "season_entries": ["season", "driverId", "constructorId"],
    "status": ["status"],
}
INDEXES = [
    "create unique index ux_races_season_round on races(season, round)",
    "create index ix_races_circuit on races(circuitId)",
    "create index ix_results_race on results(raceId)",
    "create index ix_results_driver on results(driverId, season)",
    "create index ix_results_constructor on results(constructorId, season)",
    "create index ix_results_position on results(position)",
    "create index ix_sprint_race on sprint_results(raceId)",
    "create index ix_sprint_driver on sprint_results(driverId)",
    "create index ix_sprint_constructor on sprint_results(constructorId)",
    "create index ix_quali_race on qualifying(raceId)",
    "create index ix_quali_driver on qualifying(driverId)",
    "create index ix_laps_driver on lap_times(driverId, raceId)",
    "create index ix_pits_driver on pit_stops(driverId)",
    "create index ix_dstand_driver on driver_standings(driverId, season)",
    "create index ix_dstand_season on driver_standings(season, round)",
    "create index ix_cstand_constructor on constructor_standings(constructorId, season)",
    "create index ix_cstand_season on constructor_standings(season, round)",
    "create index ix_entries_constructor on season_entries(constructorId, season)",
]


def build_serve_db() -> Path:
    """Create f1.sqlite with base tables, derived tables and views; return its path."""
    SERVE_DIR.mkdir(parents=True, exist_ok=True)
    final_path = SERVE_DIR / DB_NAME
    temp_path = SERVE_DIR / f"{DB_NAME}.tmp"
    if temp_path.exists():
        temp_path.unlink()

    con = sqlite3.connect(temp_path)
    con.execute("pragma journal_mode = off")
    con.execute("pragma synchronous = off")
    for name in SCHEMAS:
        _load_table(con, name)
    for statement in INDEXES:
        con.execute(statement)
    sql_path = Path(__file__).with_name("serve.sql")
    derived_sql = sql_path.read_text(encoding="utf-8")
    con.executescript(derived_sql)
    con.execute("analyze")
    con.commit()
    con.execute("vacuum")
    con.close()

    _swap_in(temp_path, final_path)
    return final_path


def _load_table(con: sqlite3.Connection, name: str) -> None:
    columns = SCHEMAS[name]
    column_defs = [f'"{column}" {_sqlite_type(arrow_type)}' for column, arrow_type in
                   columns.items()]
    primary_key = PRIMARY_KEYS.get(name)
    if primary_key:
        key_list = ", ".join(f'"{column}"' for column in primary_key)
        column_defs.append(f"primary key ({key_list})")
    con.execute(f'create table "{name}" ({", ".join(column_defs)})')

    parquet_path = processed_path(name)
    arrow_table = pq.read_table(parquet_path)
    rows = _sqlite_rows(arrow_table, columns)
    placeholders = ", ".join("?" for _ in columns)
    con.executemany(f'insert into "{name}" values ({placeholders})', rows)


def _sqlite_rows(arrow_table: pa.Table, columns: dict[str, pa.DataType]) -> list[tuple]:
    """Convert to python values: dates as ISO text, timestamps as ISO UTC, bools as 0/1."""
    converted_columns = []
    for column, arrow_type in columns.items():
        values = arrow_table.column(column).to_pylist()
        if arrow_type == pa.date32():
            values = [value.isoformat() if value else None for value in values]
        elif pa.types.is_timestamp(arrow_type):
            values = [value.strftime("%Y-%m-%dT%H:%M:%SZ") if value else None for value in values]
        elif arrow_type == pa.bool_():
            values = [None if value is None else int(value) for value in values]
        converted_columns.append(values)
    return list(zip(*converted_columns))


def _sqlite_type(arrow_type: pa.DataType) -> str:
    if pa.types.is_integer(arrow_type) or arrow_type == pa.bool_():
        return "INTEGER"
    if pa.types.is_floating(arrow_type):
        return "REAL"
    return "TEXT"


def _swap_in(temp_path: Path, final_path: Path) -> None:
    """Replace the live database with the new build.

    An atomic rename is tried first. On Windows it fails while any reader (the site, a DB
    browser) holds the file open, because SQLite opens files without delete sharing; then the
    new content is copied into the open file with SQLite's online backup API, which readers
    pick up on their next query.
    """
    for attempt in range(RENAME_ATTEMPTS):
        try:
            os.replace(temp_path, final_path)
            return
        except PermissionError:
            time.sleep(1 + attempt)
    print(f"  {final_path.name} is open in another process; copying into it in place")
    _copy_in_place(temp_path, final_path)
    temp_path.unlink()


def _copy_in_place(temp_path: Path, final_path: Path) -> None:
    source = sqlite3.connect(temp_path)
    target = sqlite3.connect(final_path, timeout=60)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()
