"""Safety car, virtual safety car and red flag history per race, and circuit chaos rates.

    uv run python -m f1ml.chaos        # validate the lap time detector against race control

Race control messages (OpenF1) only exist from 2023, so neutralisations are detected from the
Jolpica lap times (1996+): a lap where the field's median lap time is far above the race's
green-flag pace is a safety car, VSC or red flag lap. Consecutive slow laps form one episode;
the opening lap is ignored. Where OpenF1 race control exists it overrides the detector.

`circuit_rates(cutoff)` gives point in time circuit rates (only races before the cutoff),
shrunk towards the field average, for the simulation's chaos scaling.
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd

from f1ml import paths

SLOW_RATIO = 1.18
SHRINK_VISITS = 3.0
CIRCUIT_MEMORY = 12


def main() -> None:
    detected = race_neutralisations()
    official = _race_control_episodes()
    joined = detected.merge(official, on="raceId", how="inner", suffixes=("_laps", "_rc"))
    hit = (joined["any_laps"] == joined["any_rc"]).mean()
    print(f"lap detector vs race control (2023+, {len(joined)} races): any-episode agreement "
          f"{hit:.3f}; detector rate {joined['any_laps'].mean():.3f}, "
          f"race control rate {joined['any_rc'].mean():.3f}")
    table = race_table()
    by_season = table.groupby(table["raceId"] // 100)["any"].mean().round(2)
    print("share of races with a neutralisation by season:", by_season.tail(12).to_dict())
    rates = circuit_rates(202617)
    print(rates.sort_values("sc_rate", ascending=False).head(12).to_string())


@lru_cache(maxsize=1)
def race_table() -> pd.DataFrame:
    """raceId, circuitId, episodes, any (0/1): detector, overridden by race control."""
    detected = race_neutralisations()
    official = _race_control_episodes()
    table = detected.merge(official, on="raceId", how="left")
    has_official = table["any_rc"].notna()
    table["any"] = np.where(has_official, table["any_rc"], table["any_laps"])
    table["episodes"] = np.where(has_official, table["episodes_rc"], table["episodes_laps"])
    races = pd.read_parquet(paths.processed("races"))[["raceId", "circuitId"]]
    table = table.merge(races, on="raceId", how="left")
    return table[["raceId", "circuitId", "episodes", "any"]].sort_values("raceId")


def circuit_rates(cutoff: int) -> pd.DataFrame:
    """Per circuit: share of its last visits (before cutoff) with a neutralisation, shrunk."""
    table = race_table()
    past = table[table["raceId"] < cutoff]
    recent = past[past["raceId"] >= (cutoff // 100 - 15) * 100]
    prior = float(recent["any"].mean()) if len(recent) else 0.5
    last_visits = past.groupby("circuitId").tail(CIRCUIT_MEMORY)
    grouped = last_visits.groupby("circuitId")["any"]
    counts = grouped.count()
    sums = grouped.sum()
    rate = (sums + SHRINK_VISITS * prior) / (counts + SHRINK_VISITS)
    frame = pd.DataFrame({"sc_rate": rate, "visits": counts}).reset_index()
    frame["prior"] = prior
    return frame


def circuit_rate(cutoff: int, circuit_id: str) -> tuple[float, float]:
    """(shrunk circuit rate, field prior) for one circuit; the prior when never visited."""
    rates = circuit_rates(cutoff)
    rows = rates[rates["circuitId"] == circuit_id]
    prior = float(rates["prior"].iloc[0]) if len(rates) else 0.5
    if not len(rows):
        return prior, prior
    return float(rows["sc_rate"].iloc[0]), prior


@lru_cache(maxsize=1)
def race_neutralisations() -> pd.DataFrame:
    """Lap time detector: raceId, episodes_laps, any_laps."""
    laps = pd.read_parquet(paths.processed("lap_times"), columns=["raceId", "lap", "timeMs"])
    laps = laps[laps["timeMs"].notna() & (laps["lap"] > 1)]
    per_lap = laps.groupby(["raceId", "lap"])["timeMs"].median().reset_index()
    green = per_lap.groupby("raceId")["timeMs"].transform(lambda s: s.quantile(0.3))
    per_lap["slow"] = per_lap["timeMs"] > green * SLOW_RATIO
    rows = []
    for race_id, race_laps in per_lap.groupby("raceId"):
        slow = race_laps.sort_values("lap")["slow"].to_numpy()
        starts = slow & ~np.concatenate([[False], slow[:-1]])
        episodes = int(starts.sum())
        rows.append((int(race_id), episodes, int(episodes > 0)))
    return pd.DataFrame(rows, columns=["raceId", "episodes_laps", "any_laps"])


# ----------------------------------------------------------------------------------------------
# helpers


@lru_cache(maxsize=1)
def _race_control_episodes() -> pd.DataFrame:
    """OpenF1 race control (2023+): raceId, episodes_rc, any_rc from SC / VSC / red flags."""
    columns = ["raceId", "episodes_rc", "any_rc"]
    path = paths.processed("openf1_race_control")
    if not path.exists():
        return pd.DataFrame(columns=columns)
    control = pd.read_parquet(path)
    race = control[control["session_name"] == "Race"].copy()
    message = race["message"].fillna("")
    deployed = message.str.contains("SAFETY CAR DEPLOYED") | message.str.startswith("RED FLAG")
    sessions = pd.read_parquet(paths.processed("openf1_sessions"))
    sessions = sessions[sessions["session_name"] == "Race"][["session_key", "date_start"]]
    races = pd.read_parquet(paths.processed("races"))[["raceId", "season", "date"]]
    races["date"] = pd.to_datetime(races["date"])
    sessions["day"] = pd.to_datetime(sessions["date_start"]).dt.tz_localize(None).dt.normalize()
    keyed = sessions.merge(races, left_on="day", right_on="date", how="inner")
    counts = race[deployed].groupby("session_key").size().rename("episodes_rc")
    keyed = keyed.merge(counts, on="session_key", how="left")
    keyed["episodes_rc"] = keyed["episodes_rc"].fillna(0).astype(int)
    keyed["any_rc"] = (keyed["episodes_rc"] > 0).astype(int)
    return keyed[columns].drop_duplicates("raceId")


if __name__ == "__main__":
    main()
