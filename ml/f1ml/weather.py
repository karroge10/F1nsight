"""Race weekend weather from Open-Meteo (free, no key).

    uv run python -m f1ml.weather            # download what is missing, print a summary

Three sources, all hourly at the circuit coordinates from `circuits`:

- archive (ERA5 reanalysis, archive-api.open-meteo.com): what actually happened, every race
  since 2006. Used for training rows and for wet-race labels (driver wet skill). Never used as
  an input for the race being forecast.
- previous runs (previous-runs-api.open-meteo.com, February 2024 onwards): the forecast as it
  stood 1, 2 and 4 days ahead. This is what a forecaster would have known at each stage, so
  the backtest uses it for 2024+ races.
- forecast (api.open-meteo.com): the live forecast for the upcoming race, refetched when older
  than 3 hours.

Raw JSON goes to data/raw/openmeteo/<source>/<raceId>.json (resumable, idempotent).
`race_weather()` returns one row per race with the window sums used by the model.
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from f1ml import paths

RAW = paths.RAW_DIR / "openmeteo"
FIRST_SEASON = 2006
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
PREVIOUS_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_VARS = "precipitation,rain,temperature_2m,wind_speed_10m,relative_humidity_2m"
PREVIOUS_LEADS = (1, 2, 4)
PREVIOUS_FIRST_DATE = pd.Timestamp("2024-02-15")
ARCHIVE_LAG_DAYS = 6
FORECAST_MAX_AGE_HOURS = 3
# Hours of the race window: the hour before the start (wet track at the start) to two hours in.
RACE_WINDOW = (0, 3)
LEAD_BY_STAGE = {"pre-weekend": 4, "post-practice": 2, "post-qualifying": 1}


def main() -> None:
    counts = download()
    print("downloaded:", counts)
    table = race_weather()
    wet = table[table["rain_actual"] >= 0.5]
    print(f"{len(table)} races, {len(wet)} with >= 0.5 mm in the race window (ERA5)")
    print(wet.tail(25)[["raceId", "circuitId", "rain_actual", "rain_fc1"]].to_string())
    _write_readme(table)


def download(now: datetime | None = None) -> dict:
    """Fetch every missing file. Returns counts per source."""
    now = now or datetime.now(timezone.utc)
    today = pd.Timestamp(now.date())
    races = _races()
    counts = {"archive": 0, "previous": 0, "forecast": 0}
    for row in races.itertuples():
        race_day = pd.Timestamp(row.raceUtc.date())
        if race_day <= today - timedelta(days=ARCHIVE_LAG_DAYS):
            fetched = _fetch_archive(row)
            counts["archive"] += int(fetched)
        if PREVIOUS_FIRST_DATE <= race_day <= today:
            fetched = _fetch_previous(row)
            counts["previous"] += int(fetched)
    upcoming = races[races["raceUtc"] >= pd.Timestamp(now.replace(tzinfo=None))]
    if len(upcoming):
        nearest = upcoming.sort_values("raceUtc").iloc[0]
        days_ahead = (pd.Timestamp(nearest["raceUtc"]) - today).days
        if days_ahead <= 14:
            fetched = _fetch_forecast(nearest, now)
            counts["forecast"] += int(fetched)
    return counts


def race_weather() -> pd.DataFrame:
    """One row per race with weather sums over the race window (mm, degC, km/h).

    rain_actual: ERA5 precipitation in the race window. rain_quali: same for qualifying.
    rain_fc1 / rain_fc2 / rain_fc4: forecast issued 1 / 2 / 4 days before (2024+).
    rain_live / rain_live_prob: the live forecast for the upcoming race (sum, max probability).
    """
    races = _races()
    rows = []
    for row in races.itertuples():
        record = {"raceId": int(row.raceId), "circuitId": row.circuitId}
        archive = _load(RAW / "archive" / f"{row.raceId}.json")
        if archive is not None:
            record.update(_archive_summary(archive, row))
        previous = _load(RAW / "previous" / f"{row.raceId}.json")
        if previous is not None:
            record.update(_previous_summary(previous, row))
        live = _load(RAW / "forecast" / f"{row.raceId}.json")
        if live is not None:
            record.update(_live_summary(live, row))
        rows.append(record)
    table = pd.DataFrame(rows)
    for column in ("rain_actual", "rain_quali", "temp_actual", "wind_actual", "rain_fc1",
                   "rain_fc2", "rain_fc4", "rain_live", "rain_live_prob", "rain_live_quali"):
        if column not in table:
            table[column] = np.nan
    return table


def forecast_rain(table: pd.DataFrame, race_id: int, stage: str) -> float:
    """Rain (mm in the race window) a forecaster knew at this stage, NaN when unknown.

    The live forecast wins for the upcoming race; otherwise the archived forecast with the
    stage's lead time (1 day after qualifying, 2 after practice, 4 before the weekend).
    """
    rows = table[table["raceId"] == race_id]
    if not len(rows):
        return np.nan
    row = rows.iloc[0]
    if row["rain_live"] == row["rain_live"]:
        return float(row["rain_live"])
    lead = LEAD_BY_STAGE[stage]
    value = row.get(f"rain_fc{lead}", np.nan)
    return float(value) if value == value else np.nan


# ----------------------------------------------------------------------------------------------
# helpers


def _races() -> pd.DataFrame:
    races = pd.read_parquet(paths.processed("races"))
    circuits = pd.read_parquet(paths.processed("circuits"))[["circuitId", "lat", "lng"]]
    races = races[races["season"] >= FIRST_SEASON].merge(circuits, on="circuitId", how="left")
    races["raceUtc"] = pd.to_datetime(races["raceUtc"])
    races["qualifyingUtc"] = pd.to_datetime(races["qualifyingUtc"])
    return races.sort_values("raceId").reset_index(drop=True)


def _fetch_archive(row) -> bool:
    target = RAW / "archive" / f"{row.raceId}.json"
    if target.exists():
        return False
    start = (row.raceUtc - timedelta(days=2)).strftime("%Y-%m-%d")
    end = (row.raceUtc + timedelta(days=1)).strftime("%Y-%m-%d")
    query = {"latitude": row.lat, "longitude": row.lng, "start_date": start, "end_date": end,
             "hourly": ARCHIVE_VARS, "timezone": "UTC"}
    payload = _get(ARCHIVE_URL, query)
    _save(target, payload)
    return True


def _fetch_previous(row) -> bool:
    target = RAW / "previous" / f"{row.raceId}.json"
    if target.exists():
        return False
    day = row.raceUtc.strftime("%Y-%m-%d")
    end = (row.raceUtc + timedelta(days=1)).strftime("%Y-%m-%d")
    variables = ["precipitation"] + [f"precipitation_previous_day{lead}"
                                     for lead in PREVIOUS_LEADS]
    query = {"latitude": row.lat, "longitude": row.lng, "start_date": day, "end_date": end,
             "hourly": ",".join(variables), "timezone": "UTC"}
    payload = _get(PREVIOUS_URL, query)
    _save(target, payload)
    return True


def _fetch_forecast(race, now: datetime) -> bool:
    target = RAW / "forecast" / f"{int(race['raceId'])}.json"
    existing = _load(target)
    if existing is not None:
        fetched_at = datetime.fromisoformat(existing["fetchedAt"])
        age_hours = (now - fetched_at).total_seconds() / 3600.0
        if age_hours < FORECAST_MAX_AGE_HOURS:
            return False
    race_utc = pd.Timestamp(race["raceUtc"])
    start = (race_utc - timedelta(days=2)).strftime("%Y-%m-%d")
    end = (race_utc + timedelta(days=1)).strftime("%Y-%m-%d")
    query = {"latitude": race["lat"], "longitude": race["lng"], "start_date": start,
             "end_date": end, "timezone": "UTC",
             "hourly": "precipitation,precipitation_probability,temperature_2m,wind_speed_10m"}
    payload = _get(FORECAST_URL, query)
    payload["fetchedAt"] = now.isoformat()
    _save(target, payload)
    return True


def _archive_summary(payload: dict, row) -> dict:
    hourly = _hourly_frame(payload)
    race_hours = _window(hourly, row.raceUtc)
    quali_hours = _window(hourly, row.qualifyingUtc)
    summary = {
        "rain_actual": _sum(race_hours, "precipitation"),
        "rain_actual_max": _max(race_hours, "precipitation"),
        "temp_actual": _mean(race_hours, "temperature_2m"),
        "wind_actual": _mean(race_hours, "wind_speed_10m"),
        "humidity_actual": _mean(race_hours, "relative_humidity_2m"),
        "rain_quali": _sum(quali_hours, "precipitation"),
    }
    return summary


def _previous_summary(payload: dict, row) -> dict:
    hourly = _hourly_frame(payload)
    race_hours = _window(hourly, row.raceUtc)
    summary = {}
    for lead in PREVIOUS_LEADS:
        summary[f"rain_fc{lead}"] = _sum(race_hours, f"precipitation_previous_day{lead}")
    return summary


def _live_summary(payload: dict, row) -> dict:
    hourly = _hourly_frame(payload)
    race_hours = _window(hourly, row.raceUtc)
    quali_hours = _window(hourly, row.qualifyingUtc)
    return {"rain_live": _sum(race_hours, "precipitation"),
            "rain_live_quali": _sum(quali_hours, "precipitation"),
            "rain_live_prob": _max(race_hours, "precipitation_probability"),
            "temp_live": _mean(race_hours, "temperature_2m"),
            "live_fetched_at": payload.get("fetchedAt")}


def _hourly_frame(payload: dict) -> pd.DataFrame:
    hourly = payload.get("hourly") or {}
    frame = pd.DataFrame(hourly)
    if "time" in frame:
        frame["time"] = pd.to_datetime(frame["time"])
    return frame


def _window(hourly: pd.DataFrame, start) -> pd.DataFrame:
    """Hourly rows covering the session window (values are sums of the preceding hour)."""
    if start is None or pd.isna(start) or "time" not in hourly:
        return hourly.iloc[0:0]
    floor = pd.Timestamp(start).floor("h")
    first = floor + timedelta(hours=RACE_WINDOW[0])
    last = floor + timedelta(hours=RACE_WINDOW[1])
    return hourly[(hourly["time"] >= first) & (hourly["time"] <= last)]


def _sum(frame: pd.DataFrame, column: str) -> float:
    if column not in frame or frame[column].isna().all():
        return np.nan
    return float(frame[column].sum())


def _max(frame: pd.DataFrame, column: str) -> float:
    if column not in frame or frame[column].isna().all():
        return np.nan
    return float(frame[column].max())


def _mean(frame: pd.DataFrame, column: str) -> float:
    if column not in frame or frame[column].isna().all():
        return np.nan
    return float(frame[column].mean())


def _get(url: str, query: dict, attempts: int = 4) -> dict:
    encoded = urllib.parse.urlencode(query)
    full_url = f"{url}?{encoded}"
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(full_url, timeout=60) as response:
                body = response.read().decode("utf-8")
            time.sleep(0.15)
            return json.loads(body)
        except Exception as error:  # rate limit or network hiccup: back off and retry
            if attempt == attempts - 1:
                raise
            wait = 5.0 * (attempt + 1)
            print(f"  open-meteo retry in {wait:.0f}s: {error}")
            time.sleep(wait)
    return {}


def _save(target, payload: dict) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload)
    target.write_text(text, encoding="utf-8")


def _load(target) -> dict | None:
    if not target.exists():
        return None
    text = target.read_text(encoding="utf-8")
    return json.loads(text)


def _write_readme(table: pd.DataFrame) -> None:
    archive = int(table["rain_actual"].notna().sum())
    previous = int(table["rain_fc1"].notna().sum())
    live = int(table["rain_live"].notna().sum())
    text = f"""# Open-Meteo weather (free, no key)

Written by `f1ml.weather` (run `uv run python -m f1ml.weather` from `v2/ml`). Hourly weather at
each circuit's coordinates (`circuits.lat/lng`), UTC.

| folder | API | coverage | files |
|---|---|---|---|
| archive/ | ERA5 reanalysis, archive-api.open-meteo.com | every race 2006+ older than {ARCHIVE_LAG_DAYS} days | {archive} |
| previous/ | previous model runs, previous-runs-api.open-meteo.com: forecast issued 1, 2, 4 days before | races from February 2024 | {previous} |
| forecast/ | live forecast, api.open-meteo.com (refetched when older than {FORECAST_MAX_AGE_HOURS} h) | the next race within 14 days | {live} |

Each file holds race day -2 to race day +1. The race window is the hour before the start to two
hours after it. ERA5 is a coarse (0.25 degree) reanalysis: short convective showers can be missed,
so it is a noisy wet-race label. Archived forecasts are only used where a forecaster would have
had them (the backtest uses the lead time of each forecast stage).
"""
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / "README.md").write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
