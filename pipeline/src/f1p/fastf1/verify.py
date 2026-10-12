"""Sanity checks for the FastF1 download and processed tables (prints a text report).

    uv run python -m f1p.fastf1.verify [--positions 2025/11_R]
"""

import argparse
import json

import numpy as np
import pandas as pd

from f1p.fastf1.common import fastf1_root, track_path
from f1p.paths import processed_path

NORMAL_RACE_LAPS = (900, 1500)
# 400 km/h is about 28 m per 250 ms tick; anything far above is a teleport.
MAX_TICK_JUMP_DM = 450


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--positions", help="session key to inspect, e.g. 2025/11_R (default: latest race)")
    args = parser.parse_args()
    metas = _metas()
    print_session_counts(metas)
    print_race_lap_counts(metas)
    print_duplicate_laps()
    key = args.positions or _latest_race_key(metas)
    if key:
        print_positions_check(key)


def print_session_counts(metas: list[dict]) -> None:
    frame = pd.DataFrame(metas)
    if frame.empty:
        print("No sessions yet")
        return
    table = pd.crosstab(frame["season"], frame["session"])
    table["total"] = table.sum(axis=1)
    with_positions = frame[frame["hasPositions"]].groupby("season").size()
    table["withPositions"] = with_positions
    print("== Sessions per season ==")
    print(table.sort_index(ascending=False).to_string())


def print_race_lap_counts(metas: list[dict]) -> None:
    races = [meta for meta in metas if meta["session"] == "R"]
    rows = [{"key": meta["key"], "event": meta["eventName"], "laps": meta["counts"].get("laps", 0)} for meta in races]
    frame = pd.DataFrame(rows)
    if frame.empty:
        return
    low, high = NORMAL_RACE_LAPS
    print("\n== Laps per race ==")
    print(frame["laps"].describe().round(0).to_string())
    unusual = frame[(frame["laps"] < low) | (frame["laps"] > high)]
    print(f"Races outside {low}..{high} laps: {len(unusual)} of {len(frame)}")
    if not unusual.empty:
        print(unusual.sort_values("key").to_string(index=False))


def print_duplicate_laps() -> None:
    path = processed_path("ff1_laps")
    if not path.exists():
        print("\nff1_laps.parquet not built yet")
        return
    laps = pd.read_parquet(path, columns=["season", "round", "session", "driverNumber", "lapNumber", "driverId", "constructorId"])
    keys = ["season", "round", "session", "driverNumber", "lapNumber"]
    duplicated = laps.duplicated(keys).sum()
    unmapped_driver = laps["driverId"].isna().sum()
    unmapped_team = laps["constructorId"].isna().sum()
    print(f"\n== ff1_laps == rows {len(laps):,}, duplicated keys {duplicated}, "
          f"missing driverId {unmapped_driver}, missing constructorId {unmapped_team}")


def print_positions_check(key: str) -> None:
    folder = fastf1_root() / key
    positions = pd.read_parquet(folder / "positions.parquet")
    meta_text = (folder / "meta.json").read_text(encoding="utf-8")
    meta = json.loads(meta_text)
    print(f"\n== Positions {key} ({meta['eventName']}) ==")
    print(f"rows {len(positions):,}, ticks {positions['t'].nunique():,}, drivers {positions['driverNumber'].nunique()}")
    off_grid = (positions["t"] % 250 != 0).sum()
    print(f"t range {positions['t'].min()}..{positions['t'].max()} ms, ticks not on the 250 ms grid: {off_grid}")
    print(f"x range {positions['x'].min()}..{positions['x'].max()}, y range {positions['y'].min()}..{positions['y'].max()} (dm)")
    status_counts = positions["status"].value_counts()
    print(f"status {status_counts.to_dict()}")

    middle = (positions["t"].min() + positions["t"].max()) // 2
    middle -= middle % 250
    at_middle = positions[positions["t"] == middle]
    on_track = at_middle[at_middle["status"] == "OnTrack"]
    print(f"mid-session tick {middle}: {len(at_middle)} cars with a position, {len(on_track)} on track")

    coverage = positions.groupby("driverNumber")["t"].count()
    total_ticks = positions["t"].nunique()
    share = (coverage / total_ticks).round(3)
    print(f"per-driver tick coverage min {share.min()}, median {share.median()}")

    jumps = _tick_jumps(positions)
    big = (jumps > MAX_TICK_JUMP_DM).sum()
    print(f"consecutive-tick moves: p50 {np.percentile(jumps, 50):.0f} dm, p99 {np.percentile(jumps, 99):.0f} dm, "
          f"max {jumps.max():.0f} dm, moves > {MAX_TICK_JUMP_DM} dm: {big}")
    _print_finish_line_alignment(key, positions, meta)


def _print_finish_line_alignment(key: str, positions: pd.DataFrame, meta: dict) -> None:
    """Cars should be at the timing line when their lap ends: checks clocks are aligned."""
    timing_path = fastf1_root() / key / "timing.parquet"
    track_file = track_path(meta["season"], meta["round"])
    if not timing_path.exists() or not track_file.exists():
        return
    timing = pd.read_parquet(timing_path)
    if "lineCrossMs" in timing:
        lag_ms = timing["lapEndMs"] - timing["lineCrossMs"]
        lag = lag_ms.astype("float64") / 1000.0
        found = timing["lineCrossMs"].notna().sum()
        print(f"timing feed lag behind positions (s): p5 {lag.quantile(0.05):.2f}, median {lag.median():.2f}, "
              f"p95 {lag.quantile(0.95):.2f}; line crossing found for {found} of {len(timing)} laps")
    track_text = track_file.read_text(encoding="utf-8")
    track = json.loads(track_text)
    finish = next(point for point in track["sectors"] if point["sector"] == 0)
    timing = timing.dropna(subset=["lapEndMs"])
    timing["t"] = (timing["lapEndMs"] // 250 * 250).astype("int64")
    timing["driverNumber"] = timing["driverNumber"].astype("int16")
    joined = timing.merge(positions, on=["t", "driverNumber"], how="inner")
    distance = np.hypot(joined["x"] - finish["x"], joined["y"] - finish["y"]) / 10.0
    print(f"distance from the timing line at lap end (m): median {distance.median():.0f}, "
          f"p90 {distance.quantile(0.9):.0f} over {len(joined)} laps")


def _tick_jumps(positions: pd.DataFrame) -> np.ndarray:
    ordered = positions.sort_values(["driverNumber", "t"])
    same_driver = ordered["driverNumber"].diff() == 0
    next_tick = ordered["t"].diff() == 250
    dx = ordered["x"].diff()
    dy = ordered["y"].diff()
    moves = np.hypot(dx, dy)
    valid = same_driver & next_tick
    return moves[valid].to_numpy()


def _metas() -> list[dict]:
    metas = []
    for path in fastf1_root().glob("*/*/meta.json"):
        text = path.read_text(encoding="utf-8")
        metas.append(json.loads(text))
    return metas


def _latest_race_key(metas: list[dict]) -> str | None:
    races = [meta for meta in metas if meta["session"] == "R" and meta.get("hasPositions")]
    if not races:
        return None
    latest = max(races, key=lambda meta: meta["startUtc"])
    return latest["key"]


if __name__ == "__main__":
    main()
