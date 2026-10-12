"""Turn raw OpenF1 JSON into data/processed/openf1_<endpoint>.parquet.

Run from v2/pipeline:
    uv run python -m f1p.openf1.process
"""

import json
from pathlib import Path

import pandas as pd

from f1p.openf1.download import MEETING_ENDPOINTS, RACE_ENDPOINTS, SEASON_ENDPOINTS
from f1p.paths import processed_path, raw_dir

CONTEXT_COLUMNS = ["season", "meeting_key", "session_key", "session_name", "session_type", "circuit_short_name"]
DATETIME_COLUMNS = ["date", "date_start", "date_end"]
SESSION_ENDPOINTS = MEETING_ENDPOINTS + RACE_ENDPOINTS


def main() -> None:
    root = raw_dir("openf1")
    season_dirs = sorted(p for p in root.iterdir() if p.is_dir() and p.name.isdigit())
    sessions = load_season_table(season_dirs, "sessions")
    context = sessions[CONTEXT_COLUMNS]

    for endpoint in SEASON_ENDPOINTS:
        frame = load_season_table(season_dirs, endpoint)
        _save(frame, endpoint)

    for endpoint in SESSION_ENDPOINTS:
        frame = load_session_table(season_dirs, endpoint, context)
        _save(frame, endpoint)


def load_season_table(season_dirs: list[Path], endpoint: str) -> pd.DataFrame:
    frames = []
    for season_dir in season_dirs:
        rows = _read_rows(season_dir / f"{endpoint}.json")
        frame = pd.DataFrame(rows)
        frame.insert(0, "season", int(season_dir.name))
        frames.append(frame)
    combined = pd.concat(frames, ignore_index=True)
    return _parse_dates(combined)


def load_session_table(season_dirs: list[Path], endpoint: str, context: pd.DataFrame) -> pd.DataFrame:
    frames = []
    for season_dir in season_dirs:
        for path in sorted(season_dir.glob(f"*/{endpoint}.json")):
            rows = _read_rows(path)
            if not rows:
                continue
            frame = pd.DataFrame(rows)
            frame["session_key"] = int(path.parent.name)
            frames.append(frame)
    if not frames:
        return pd.DataFrame(columns=CONTEXT_COLUMNS)
    data = pd.concat(frames, ignore_index=True)
    data = data.drop(columns=[c for c in ("meeting_key",) if c in data.columns])
    merged = context.merge(data, on="session_key", how="inner")
    return _parse_dates(merged)


def _read_rows(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    return json.loads(text)


def _parse_dates(frame: pd.DataFrame) -> pd.DataFrame:
    for column in DATETIME_COLUMNS:
        if column in frame.columns:
            frame[column] = pd.to_datetime(frame[column], utc=True, format="ISO8601")
    return frame


def _normalise_mixed_columns(frame: pd.DataFrame) -> pd.DataFrame:
    """Columns mixing types (e.g. gap '+1 LAP' vs 1.23, or a list of Q1/Q2/Q3 times vs a scalar)
    cannot be stored natively; numbers+text become text, anything with lists becomes JSON text."""
    for column in frame.columns[frame.dtypes == object]:
        values = frame[column].dropna()
        kinds = set(values.map(_value_kind))
        if len(kinds) <= 1:
            continue
        if "list" in kinds or "dict" in kinds:
            frame[column] = frame[column].map(_to_json_text)
        else:
            frame[column] = frame[column].map(_to_text)
    return frame


def _value_kind(value: object) -> str:
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "dict"
    if isinstance(value, str):
        return "str"
    return "number"


def _to_json_text(value: object) -> object:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    return json.dumps(value)


def _to_text(value: object) -> object:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    return str(value)


def _save(frame: pd.DataFrame, endpoint: str) -> None:
    frame = _normalise_mixed_columns(frame)
    target = processed_path(f"openf1_{endpoint}")
    frame.to_parquet(target, index=False)
    sessions = frame["session_key"].nunique() if "session_key" in frame.columns else 0
    print(f"openf1_{endpoint}: {len(frame)} rows, {sessions} sessions -> {target}", flush=True)


if __name__ == "__main__":
    main()
