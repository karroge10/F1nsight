"""Fantasy-style overtake counts reconstructed from free OpenF1 historical data.

The game awards +1 per overtake when "one driver legally passes another on track,
and the driver passed was not entering or in the pit lane or suffering a car failure
or going unreasonably slow". F1's own counts are not published. OpenF1 /overtakes
lists every position swap (pit cycles and timing flicker included, about 2.2x the
official count), so three filters are applied:

1. pit: drop passes on a car between PIT_BEFORE_S before its pit entry and
   PIT_AFTER_S after it left the pit lane (OpenF1 /pit),
2. flicker: drop A-passes-B when B passes A back within FLICKER_S (both rows),
3. failure: drop passes on a car that did not finish, from FAILURE_S before its last
   OpenF1 /position record (a slow or stopping car).

On 2026 rounds 1 to 16 (454 driver sessions) this gives mean 4.57 vs official 4.49
per driver session, MAE 1.73, 80% within 2 (raw OpenF1: mean 9.97, MAE 5.5).

Output: data/processed/fantasy_overtakes.parquet
(season, round, session, driverNumber, driverId, overtakesRaw, overtakes).
"""

import pandas as pd

from f1p.paths import processed_path

PIT_BEFORE_S = 20
PIT_AFTER_S = 60
FLICKER_S = 10
FAILURE_S = 180
DEFAULT_LANE_S = 25.0


def build() -> pd.DataFrame:
    """Rebuild fantasy_overtakes.parquet for every season OpenF1 covers."""
    passes = _table("openf1_overtakes")
    pits = _table("openf1_pit")
    sessions = _table("openf1_sessions")
    session_results = _table("openf1_session_result")
    positions = _table("openf1_position")
    race_sessions = race_session_rounds(sessions)
    passes = passes[passes["session_key"].isin(race_sessions)]

    filtered = _drop_pit_passes(passes, pits)
    filtered = _drop_flicker(filtered)
    filtered = _drop_failing_cars(filtered, session_results, positions)

    raw_counts = _count(passes, "overtakesRaw")
    kept_counts = _count(filtered, "overtakes")
    counts = raw_counts.merge(kept_counts, on=["session_key", "driverNumber"], how="left")
    counts["overtakes"] = counts["overtakes"].fillna(0).astype(int)
    counts = _attach_rounds(counts, race_sessions)
    counts = _attach_driver_ids(counts)
    columns = ["season", "round", "session", "driverNumber", "driverId", "overtakesRaw", "overtakes"]
    counts = counts[columns].sort_values(["season", "round", "session", "driverNumber"])
    path = processed_path("fantasy_overtakes")
    counts.to_parquet(path, index=False)
    return counts


def race_session_rounds(sessions: pd.DataFrame) -> dict:
    """OpenF1 race/sprint session_key -> (season, round, 'Race' | 'Sprint').

    Rounds come from data/processed/races.parquet: the meeting's race start is
    matched to the nearest raceUtc within 30 hours (races.raceUtc is a day off for
    Las Vegas 2024; races are always a week or more apart).
    """
    races = _table("races")
    out = {}
    for meeting_key, meeting in sessions.groupby("meeting_key"):
        race_rows = meeting[meeting["session_name"] == "Race"]
        if race_rows.empty:
            continue
        start = race_rows["date_start"].iloc[0]
        round_info = _match_round(races, start)
        if round_info is None:
            continue
        for row in meeting.itertuples():
            if row.session_name in ("Race", "Sprint"):
                out[row.session_key] = (*round_info, row.session_name)
    return out


def _match_round(races: pd.DataFrame, start) -> tuple[int, int] | None:
    start_naive = start.tz_convert("UTC").tz_localize(None)
    gap = (races["raceUtc"] - start_naive).abs()
    best = gap.idxmin()
    if gap.loc[best] > pd.to_timedelta(30, unit="h"):
        return None
    return int(races.loc[best, "season"]), int(races.loc[best, "round"])


def _drop_pit_passes(passes: pd.DataFrame, pits: pd.DataFrame) -> pd.DataFrame:
    lane = pits["pit_duration"].fillna(DEFAULT_LANE_S)
    lane_delta = pd.to_timedelta(lane, unit="s")
    windows = pd.DataFrame({
        "session_key": pits["session_key"],
        "overtaken_driver_number": pits["driver_number"],
        "window_start": pits["date"] - pd.to_timedelta(PIT_BEFORE_S, unit="s"),
        "window_end": pits["date"] + lane_delta + pd.to_timedelta(PIT_AFTER_S, unit="s"),
    })
    indexed = passes.reset_index()
    joined = indexed.merge(windows, on=["session_key", "overtaken_driver_number"], how="inner")
    inside = (joined["date"] >= joined["window_start"]) & (joined["date"] <= joined["window_end"])
    bad = set(joined.loc[inside, "index"])
    keep = ~passes.index.isin(bad)
    return passes[keep]


def _drop_flicker(passes: pd.DataFrame) -> pd.DataFrame:
    """Remove pairs A>B then B>A within FLICKER_S seconds (timing noise, not passes)."""
    ordered = passes.sort_values(["session_key", "date"])
    window = pd.to_timedelta(FLICKER_S, unit="s")
    drop = set()
    for _, session in ordered.groupby("session_key"):
        pending: dict[tuple[int, int], list] = {}
        for row in session.itertuples():
            reverse_key = (row.overtaken_driver_number, row.overtaking_driver_number)
            candidates = pending.get(reverse_key, [])
            while candidates and row.date - candidates[0][1] > window:
                candidates.pop(0)
            if candidates:
                earlier_index, _ = candidates.pop(0)
                drop.add(earlier_index)
                drop.add(row.Index)
                continue
            key = (row.overtaking_driver_number, row.overtaken_driver_number)
            pending.setdefault(key, []).append((row.Index, row.date))
    keep = ~ordered.index.isin(drop)
    return ordered[keep]


def _drop_failing_cars(passes, session_results, positions) -> pd.DataFrame:
    retired_mask = session_results["dnf"] | session_results["dns"]
    retired = session_results.loc[retired_mask, ["session_key", "driver_number"]]
    grouped = positions.groupby(["session_key", "driver_number"])["date"]
    last_seen = grouped.max().rename("last_seen").reset_index()
    retired = retired.merge(last_seen, on=["session_key", "driver_number"], how="left")
    retired = retired.rename(columns={"driver_number": "overtaken_driver_number"})
    joined = passes.merge(retired, on=["session_key", "overtaken_driver_number"], how="left")
    cutoff = joined["last_seen"] - pd.to_timedelta(FAILURE_S, unit="s")
    failing = joined["last_seen"].notna() & (joined["date"] >= cutoff)
    keep = ~failing.to_numpy()
    return passes[keep]


def _count(passes: pd.DataFrame, name: str) -> pd.DataFrame:
    grouped = passes.groupby(["session_key", "overtaking_driver_number"]).size()
    counts = grouped.rename(name).reset_index()
    return counts.rename(columns={"overtaking_driver_number": "driverNumber"})


def _attach_rounds(counts: pd.DataFrame, race_sessions: dict) -> pd.DataFrame:
    info = counts["session_key"].map(race_sessions)
    counts["season"] = info.str[0]
    counts["round"] = info.str[1]
    counts["session"] = info.str[2]
    return counts


def _attach_driver_ids(counts: pd.DataFrame) -> pd.DataFrame:
    """Car number -> driverId per round from processed race and sprint results."""
    race = _table("results")
    sprint = _table("sprint_results")
    columns = ["season", "round", "number", "driverId"]
    numbers = pd.concat([race[columns], sprint[columns]]).dropna()
    numbers = numbers.drop_duplicates(["season", "round", "number"])
    numbers["number"] = numbers["number"].astype(int)
    numbers = numbers.rename(columns={"number": "driverNumber"})
    return counts.merge(numbers, on=["season", "round", "driverNumber"], how="left")


def _table(name: str) -> pd.DataFrame:
    path = processed_path(name)
    return pd.read_parquet(path)


def main() -> None:
    counts = build()
    summary = counts.groupby(["season", "session"])["overtakes"].agg(["count", "mean"])
    print(summary.round(2).to_string())


if __name__ == "__main__":
    main()
