"""Announced grid penalties and the starting grid they produce.

The pipeline step `f1p.penalties.update` writes data/processed/grid_penalties.parquet: one row
per decision (driverId, kind places / back_of_grid / pit_lane, places, category, appliesTo race
or sprint). Here they are summed per driver and session and turned into a grid, the way the FIA
forms it from the qualifying order:

1. Drivers without a penalty keep their qualifying order.
2. A driver with an N-place penalty slots in just behind the car that qualified N places
   behind him.
3. Drivers whose penalty runs past the end of the field, back-of-grid penalties and power unit
   penalties above PU_BACK_OF_GRID places line up behind everyone else, in qualifying order.
4. Pit lane starters come last, in qualifying order.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from f1ml import paths

TABLE = "grid_penalties"
PU_BACK_OF_GRID = 15
BACK_OF_GRID_KEY = 1000.0
PIT_LANE_KEY = 2000.0


@dataclass
class GridPenalties:
    """Penalties of one session, one entry per driver in race frame order."""

    places: np.ndarray  # grid places to drop (0 = none)
    back: np.ndarray  # starts at the back of the grid
    pit_lane: np.ndarray  # starts from the pit lane
    labels: list  # short text per driver ("+40 places", "back of grid", "pit lane") or None
    categories: list  # "power_unit", "other" or None

    def penalised(self) -> np.ndarray:
        return (self.places > 0) | self.back | self.pit_lane


def load(race_id: int) -> pd.DataFrame:
    """Rows of grid_penalties.parquet for one race (empty when there are none)."""
    path = paths.processed(TABLE)
    if not path.exists():
        return pd.DataFrame(columns=["raceId", "driverId", "kind", "places", "category",
                                     "appliesTo"])
    table = pd.read_parquet(path)
    return table[table["raceId"] == race_id].reset_index(drop=True)


def for_frame(table: pd.DataFrame | None, driver_ids, applies_to: str) -> GridPenalties | None:
    """Penalties of one session aligned with `driver_ids`, or None when nobody has one."""
    if table is None or not len(table):
        return None
    rows = table[table["appliesTo"] == applies_to]
    if not len(rows):
        return None
    ids = list(driver_ids)
    count = len(ids)
    places = np.zeros(count)
    back = np.zeros(count, dtype=bool)
    pit_lane = np.zeros(count, dtype=bool)
    categories: list = [None] * count
    for index, driver_id in enumerate(ids):
        mine = rows[rows["driverId"] == driver_id]
        if not len(mine):
            continue
        kinds = set(mine["kind"].astype(str))
        numeric = pd.to_numeric(mine["places"], errors="coerce").fillna(0)
        places[index] = float(numeric[mine["kind"] == "places"].sum())
        back[index] = "back_of_grid" in kinds
        pit_lane[index] = "pit_lane" in kinds
        power_unit = (mine["category"].astype(str) == "power_unit").any()
        categories[index] = "power_unit" if power_unit else "other"
        if power_unit and places[index] > PU_BACK_OF_GRID:
            back[index] = True
    if not (places.any() or back.any() or pit_lane.any()):
        return None
    labels = [_label(p, b, pl) for p, b, pl in zip(places, back, pit_lane)]
    return GridPenalties(places, back, pit_lane, labels, categories)


def apply(qualifying: np.ndarray, penalties: GridPenalties | None) -> np.ndarray:
    """Starting positions 1..n from qualifying positions 1..n, shape (drivers,) or (sims, drivers)."""
    order = np.asarray(qualifying, dtype=float)
    if penalties is None:
        return order.astype(np.int64)
    drivers = order.shape[-1]
    places = penalties.places
    keys = order + places + 0.5 * (places > 0)
    beyond = (places > 0) & (keys > drivers)
    back = beyond | penalties.back
    keys = np.where(back, BACK_OF_GRID_KEY + order, keys)
    keys = np.where(penalties.pit_lane, PIT_LANE_KEY + order, keys)
    ranking = np.argsort(keys, axis=-1, kind="stable")
    grid = np.empty_like(ranking)
    positions = np.arange(1, drivers + 1)
    filled = np.broadcast_to(positions, ranking.shape)
    np.put_along_axis(grid, ranking, filled, axis=-1)
    return grid.astype(np.int64)


def describe(penalties: GridPenalties, index: int, applies_to: str) -> str:
    """One sentence for the explanation of driver `index`."""
    session = "the sprint" if applies_to == "sprint" else "the Grand Prix"
    reason = " (power unit)" if penalties.categories[index] == "power_unit" else ""
    if penalties.pit_lane[index]:
        return f"Starts {session} from the pit lane{reason}."
    places = int(penalties.places[index])
    if places and penalties.back[index]:
        return f"{places}-place grid penalty for {session}{reason}: starts from the back."
    if penalties.back[index]:
        return f"Starts {session} from the back of the grid{reason}."
    return f"{places}-place grid penalty for {session}{reason}."


# ----------------------------------------------------------------------------------------------
# helpers


def _label(places: float, back: bool, pit_lane: bool) -> str | None:
    if pit_lane:
        return "pit lane"
    if places > 0:
        return f"+{places:.0f} places"
    if back:
        return "back of grid"
    return None
