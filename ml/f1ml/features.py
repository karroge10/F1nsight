"""Point-in-time feature pipeline.

Every feature row is built for a *target* (a race and its entrants) with a *cutoff* raceId:
form, standings, reliability and circuit history only read events with raceId < cutoff, so a
row can never see its own result or any later race. Weekend inputs (practice, sprint,
qualifying, grid) come from the target race itself and are gated by forecast stage in
`stage_frame`, which blanks every column a stage is not allowed to see.

Run `uv run python -m f1ml.features` to rebuild `cache/features.parquet` (all races 2006 to the
latest completed round plus the next race). Re-run it whenever new FastF1 / OpenF1 data lands.
"""

from __future__ import annotations

import argparse
import time
from dataclasses import dataclass

import numpy as np
import pandas as pd

from f1ml import data, paths, penalties, practice_pace

FIRST_TRAIN_SEASON = 2006
HISTORY_START_SEASON = 2000
ERA_STARTS = (2006, 2009, 2014, 2017, 2022, 2026)
STAGES = ("pre-weekend", "post-practice", "post-qualifying")
MODERN_POINTS = np.array([25, 18, 15, 12, 10, 8, 6, 4, 2, 1], dtype=float)
GAP_CLIP = 4.0
# Weight of rows from before the current regulation era in the exponentially weighted driver and
# team form (1 = no discount). Chosen on the 2014, 2017 and 2022 resets, see `studies --reset`.
ERA_DISCOUNT = 1.0
# Half-life (races) of the season-to-date field retirement rate; None = flat season mean. A
# half-life of 6 was tested on the 2024-26 scorecard (label dnf6) and was neutral, so it is off.
SEASON_DNF_HALFLIFE = None
DEG_CLIP = 0.3
# Weight of each practice session in fp_best_gap (FP1 runs are more varied: set-up work, test
# items, rookies, so it says less about the weekend than FP2 and FP3).
SESSION_WEIGHTS = {"fp1_gap": 0.5, "fp2_gap": 1.0, "fp3_gap": 1.0, "FP4": 1.0}

CONTEXT_COLS = [
    "season", "round", "n_rounds", "season_progress", "rounds_since_reset", "reset_season",
    "field", "has_sprint", "c_street", "c_speed", "c_length", "c_turns", "c_grid_corr",
    "c_pole_win", "c_dnf_rate", "c_abs_change", "c_visits", "s_dnf_rate",
]
DRIVER_COLS = [
    "d_fin_e3", "d_fin_e10", "d_q_e3", "d_q_e10", "d_qgap_e3", "d_qgap_e10", "d_pts_e5",
    "d_fin_s", "d_q_s", "d_qgap_s", "d_n_s", "d_fin_ps", "d_qgap_ps", "d_acc_rate",
    "d_starts", "d_age", "d_tm_qgap_e", "d_tm_fin_e", "d_gain_e", "d_circ_tm", "d_circ_gain",
    "d_circ_fin", "d_circ_visits", "d_champ_pos", "d_champ_share", "d_last_fin", "d_last_dnf",
    "d_team_races", "d_sprint_fin_e", "d_dnf_e",
]
TEAM_COLS = [
    "t_qgap_e3", "t_qgap_e8", "t_qgap_s", "t_qgap_ps", "t_fin_e3", "t_fin_e8", "t_fin_s",
    "t_pts_e5", "t_mech_s", "t_mech_e", "t_n_s", "t_champ_pos", "t_cluster_qgap", "t_dnf_s",
]
PRACTICE_COLS = [
    "fp_n", "fp1_gap", "fp2_gap", "fp3_gap", "fp_best_gap", "fp_last_gap", "fp_mean_rank",
    "fp_team_best_gap", "fp_tm_delta", "fp_vs_form", "lr_gap", "lr_rank", "lr_deg",
]
SPRINT_COLS = ["sq_pos", "sq_gap", "sp_fin", "sp_dnf", "sp_gain"]
QUALI_COLS = ["grid", "q_pos", "q_gap", "grid_pen", "pitlane", "q_tm_delta", "q_vs_form"]
EVENT_FLOAT_COLS = ["finish_c", "quali_pos", "quali_gap", "season", "pts_modern", "dnf_acc",
                    "tm_qgap_delta", "tm_fin_delta", "gain", "sprint_fin", "dnf"]
TEAM_FLOAT_COLS = ["best_qgap", "best_fin", "points", "mech_rate", "season", "dnf_rate"]
PRE_COLS = CONTEXT_COLS + DRIVER_COLS + TEAM_COLS
LABEL_COLS = ["y_finish", "y_classified", "y_dnf", "y_dsq", "y_quali", "y_grid", "y_points",
              "y_sprint_finish", "y_sprint_dnf"]
META_COLS = ["raceId", "cutoff", "driverId", "constructorId", "team", "circuitId", "number",
             "sprint_pre_q"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--era-discount", type=float, default=ERA_DISCOUNT)
    parser.add_argument("--out", help="write here instead of the cache (experiments)")
    args = parser.parse_args()
    paths.ensure_dirs()
    started = time.time()
    table = build_feature_table(args.era_discount)
    target = args.out or paths.FEATURES_PATH
    table.to_parquet(target, index=False)
    elapsed = time.time() - started
    races = table["raceId"].nunique()
    print(f"features: {len(table)} rows, {races} races, {elapsed:.1f}s -> {target}")
    coverage = table.groupby("season")[["fp_best_gap", "lr_gap", "q_gap"]].apply(
        lambda frame: frame.notna().mean()).round(2)
    print("weekend feature coverage by season (share of rows):")
    print(coverage.tail(8).to_string())


def build_feature_table(era_discount: float = ERA_DISCOUNT) -> pd.DataFrame:
    """Features for every race since 2006 that has results, plus the next race if scheduled."""
    history = History.load(era_discount)
    targets = history.historical_targets(FIRST_TRAIN_SEASON)
    next_target = history.next_target()
    if next_target is not None:
        targets.append(next_target)
    return history.features(targets)


def stage_columns(stage: str) -> list[str]:
    """Feature columns a model for this stage is trained on."""
    if stage == "pre-weekend":
        return list(PRE_COLS)
    if stage == "post-practice":
        return PRE_COLS + PRACTICE_COLS + SPRINT_COLS
    return PRE_COLS + PRACTICE_COLS + SPRINT_COLS + QUALI_COLS


def stage_frame(frame: pd.DataFrame, stage: str) -> pd.DataFrame:
    """Copy of the frame with the columns a stage may not see set to NaN.

    Sprint results only count as post-practice evidence when the sprint ran before the main
    qualifying (2024+ format); before that the sprint followed qualifying.
    """
    gated = frame.copy()
    if stage == "pre-weekend":
        gated[PRACTICE_COLS + SPRINT_COLS + QUALI_COLS] = np.nan
    elif stage == "post-practice":
        gated[QUALI_COLS] = np.nan
        late_sprint = gated["sprint_pre_q"] != 1
        gated.loc[late_sprint, SPRINT_COLS] = np.nan
    return gated


def stage_available(frame: pd.DataFrame) -> list[str]:
    """Stages whose inputs exist for a single race frame (used by predict)."""
    available = ["pre-weekend"]
    has_practice = frame["fp_best_gap"].notna().any()
    has_early_sprint = frame["sp_fin"].notna().any() and (frame["sprint_pre_q"] == 1).any()
    if has_practice or has_early_sprint:
        available.append("post-practice")
    if frame["q_pos"].notna().sum() >= len(frame) // 2:
        available.append("post-qualifying")
    return available


@dataclass
class Target:
    race_id: int
    cutoff: int
    season: int
    round: int
    circuit_id: str
    entrants: pd.DataFrame  # driverId, constructorId, number


class History:
    """Indexed event history; every query takes a cutoff raceId and only looks before it."""

    def __init__(self, events, team_races, circuit_races, weekend, races, standings, drivers,
                 era_discount: float = ERA_DISCOUNT):
        self.era_discount = era_discount
        self.events = events
        self.team_races = team_races
        self.circuit_races = circuit_races
        self.weekend = weekend
        self.races = races
        driver_standings, constructor_standings = standings
        self.driver_standings = _split_by_race(driver_standings, "driverId")
        self.constructor_standings = _split_by_race(constructor_standings, "constructorId")
        self.previous_round_cache = {}
        self.drivers = drivers
        self.driver_rows = _index_by(events, "driverId")
        self.team_rows = _index_by(team_races, "team")
        self.circuit_rows = _index_by(circuit_races, "circuitId")
        self.driver_circuit_rows = _index_by(events, ["driverId", "circuitId"])
        self.event_race = events["raceId"].to_numpy()
        self.event_arrays = _float_arrays(events, EVENT_FLOAT_COLS)
        self.event_team = events["team"].to_numpy()
        self.team_arrays = _float_arrays(team_races, TEAM_FLOAT_COLS)
        self.team_cluster = team_races["cluster"].to_numpy()
        self.team_race = team_races["raceId"].to_numpy()
        self.circuit_race = circuit_races["raceId"].to_numpy()

    @classmethod
    def load(cls, era_discount: float = ERA_DISCOUNT) -> "History":
        core = data.load_core()
        races = _races_frame(core)
        events = _build_events(core, races)
        weekend = _build_weekend(core, races, events)
        team_races = _build_team_races(events)
        team_races["cluster"] = team_races["raceId"].map(races["cluster"])
        circuit_races = _build_circuit_races(events, races)
        standings = (core["driver_standings"], core["constructor_standings"])
        drivers = core["drivers"].set_index("driverId")
        return cls(events, team_races, circuit_races, weekend, races, standings, drivers,
                   era_discount)

    def historical_targets(self, first_season: int) -> list[Target]:
        targets = []
        done = self.events[self.events["season"] >= first_season]
        for race_id, entrants in done.groupby("raceId", sort=True):
            race = self.races.loc[race_id]
            frame = entrants[["driverId", "constructorId", "number"]].reset_index(drop=True)
            target = Target(int(race_id), int(race_id), int(race["season"]), int(race["round"]),
                            race["circuitId"], frame)
            targets.append(target)
        return targets

    def next_target(self) -> Target | None:
        """The first scheduled race without results, with its expected entrants."""
        pending = self.races[~self.races["hasResults"]]
        if not len(pending):
            return None
        race = pending.sort_index().iloc[0]
        race_id = int(race.name)
        entrants = self.expected_entrants(race_id)
        return Target(race_id, race_id, int(race["season"]), int(race["round"]),
                      race["circuitId"], entrants)

    def future_targets(self, cutoff: int, entrants: pd.DataFrame) -> list[Target]:
        """Remaining races of the cutoff's season (including the cutoff race), same entrants."""
        season = cutoff // 100
        future = self.races[(self.races["season"] == season) & (self.races.index >= cutoff)]
        targets = []
        for race_id, race in future.sort_index().iterrows():
            target = Target(int(race_id), cutoff, season, int(race["round"]), race["circuitId"],
                            entrants)
            targets.append(target)
        return targets

    def expected_entrants(self, race_id: int) -> pd.DataFrame:
        """Entrants of a race: its qualifying list if known, else the latest race line up."""
        weekend_rows = self.weekend[(self.weekend["raceId"] == race_id)
                                    & self.weekend["q_pos"].notna()]
        latest_race = self.event_race[self.event_race < race_id].max()
        lineup = self.events[self.events["raceId"] == latest_race]
        lineup = lineup[["driverId", "constructorId", "number"]]
        if len(weekend_rows) >= 18:
            known = weekend_rows[["driverId"]].merge(lineup, on="driverId", how="left")
            return known.reset_index(drop=True)
        return lineup.reset_index(drop=True)

    def features(self, targets: list[Target]) -> pd.DataFrame:
        frames = []
        for target in targets:
            frame = self._target_features(target)
            frames.append(frame)
        table = pd.concat(frames, ignore_index=True)
        return table

    # ------------------------------------------------------------------------------------------

    def _target_features(self, target: Target) -> pd.DataFrame:
        entrants = target.entrants.copy()
        entrants["team"] = entrants["constructorId"].map(data.lineage_of)
        race = self.races.loc[target.race_id]
        context = self._context(target, race, len(entrants))
        rows = []
        for driver_id, team in zip(entrants["driverId"], entrants["team"]):
            row = dict(context)
            driver_features = self._driver_features(driver_id, target, race)
            team_features = self._team_features(team, target)
            row.update(driver_features)
            row.update(team_features)
            rows.append(row)
        frame = pd.DataFrame(rows)
        frame["raceId"] = target.race_id
        frame["cutoff"] = target.cutoff
        frame["driverId"] = entrants["driverId"].to_numpy()
        frame["constructorId"] = entrants["constructorId"].to_numpy()
        frame["team"] = entrants["team"].to_numpy()
        frame["number"] = entrants["number"].to_numpy()
        frame["circuitId"] = target.circuit_id
        if target.cutoff == target.race_id:
            frame = self._attach_weekend(frame, target.race_id)
            frame = self._attach_labels(frame, target.race_id)
        else:
            empty_cols = PRACTICE_COLS + SPRINT_COLS + QUALI_COLS + LABEL_COLS
            for column in empty_cols:
                frame[column] = np.nan
            frame["sprint_pre_q"] = 0
        frame["fp_vs_form"] = frame["fp_best_gap"] - frame["d_qgap_e3"]
        frame["q_vs_form"] = frame["q_gap"] - frame["d_qgap_e3"]
        return frame

    def _context(self, target: Target, race, field: int) -> dict:
        n_rounds = int(race["n_rounds"])
        era_start = max(start for start in ERA_STARTS if start <= target.season)
        rounds_since = self._rounds_between(era_start * 100, target.race_id)
        circuit = self._circuit_features(target.circuit_id, target.cutoff)
        context = {
            "season": target.season,
            "round": target.round,
            "n_rounds": n_rounds,
            "season_progress": target.round / n_rounds,
            "rounds_since_reset": min(rounds_since, 60),
            "reset_season": int(target.season in ERA_STARTS),
            "field": field,
            "has_sprint": int(bool(race["hasSprint"])),
            "c_street": int(race["circuitType"] == "STREET"),
            "c_speed": race["c_speed"],
            "c_length": race["courseLengthKm"],
            "c_turns": race["turns"],
        }
        context.update(circuit)
        context["s_dnf_rate"] = self._season_dnf_rate(target.season, target.cutoff)
        return context

    def _season_dnf_rate(self, season: int, cutoff: int) -> float:
        """Field retirement rate of the season so far (recent races weigh more, half-life
        SEASON_DNF_HALFLIFE races), shrunk to last season with 3 races."""
        race_ids = self.circuit_race
        rates = self.circuit_races["dnf_rate"].to_numpy()
        current = (race_ids > season * 100) & (race_ids < cutoff)
        previous = (race_ids > (season - 1) * 100) & (race_ids < season * 100)
        prior = float(rates[previous].mean()) if previous.any() else 0.12
        season_rates = rates[current]
        ages = np.arange(len(season_rates))[::-1].astype(float)
        weights = np.ones(len(season_rates))
        if SEASON_DNF_HALFLIFE is not None:
            weights = np.power(0.5, ages / SEASON_DNF_HALFLIFE)
        total = float((weights * season_rates).sum())
        return (total + 3.0 * prior) / (float(weights.sum()) + 3.0)

    def _rounds_between(self, start_race_id: int, race_id: int) -> int:
        index = self.races.index.to_numpy()
        between = (index >= start_race_id) & (index < race_id)
        return int(between.sum())

    def _circuit_features(self, circuit_id: str, cutoff: int) -> dict:
        rows = self._before(self.circuit_rows.get(circuit_id), self.circuit_race, cutoff, 10)
        if rows is None:
            return {"c_grid_corr": np.nan, "c_pole_win": np.nan, "c_dnf_rate": np.nan,
                    "c_abs_change": np.nan, "c_visits": 0}
        past = self.circuit_races.iloc[rows]
        return {
            "c_grid_corr": _nanmean(past["grid_corr"]),
            "c_pole_win": _nanmean(past["pole_win"]),
            "c_dnf_rate": _nanmean(past["dnf_rate"]),
            "c_abs_change": _nanmean(past["abs_change"]),
            "c_visits": len(past),
        }

    def _driver_features(self, driver_id: str, target: Target, race) -> dict:
        features = dict.fromkeys(DRIVER_COLS, np.nan)
        features["d_starts"] = 0
        features["d_circ_visits"] = 0
        features["d_n_s"] = 0
        features["d_team_races"] = 0
        birth = self._birth(driver_id)
        if birth is not None:
            features["d_age"] = (race["date"] - birth).days / 365.25
        driver_rows = self.driver_rows.get(driver_id)
        rows = self._before(driver_rows, self.event_race, target.cutoff, 40)
        if rows is None:
            return features
        ev = self.event_arrays
        ages = np.arange(len(rows))[::-1].astype(float)
        finish = ev["finish_c"][rows]
        quali = ev["quali_pos"][rows]
        qgap = ev["quali_gap"][rows]
        seasons = ev["season"][rows]
        era = self._era_weights(seasons, target.season)
        features["d_fin_e3"] = _ewm(finish, ages, 3, era)
        features["d_fin_e10"] = _ewm(finish, ages, 10, era)
        features["d_q_e3"] = _ewm(quali, ages, 3, era)
        features["d_q_e10"] = _ewm(quali, ages, 10, era)
        features["d_qgap_e3"] = _ewm(qgap, ages, 3, era)
        features["d_qgap_e10"] = _ewm(qgap, ages, 10, era)
        features["d_pts_e5"] = _ewm(ev["pts_modern"][rows], ages, 5, era)
        features["d_acc_rate"] = _ewm(ev["dnf_acc"][rows], ages, 20)
        features["d_dnf_e"] = _ewm(ev["dnf"][rows], ages, 10)
        features["d_tm_qgap_e"] = _ewm(ev["tm_qgap_delta"][rows], ages, 6)
        features["d_tm_fin_e"] = _ewm(ev["tm_fin_delta"][rows], ages, 6)
        features["d_gain_e"] = _ewm(ev["gain"][rows], ages, 10)
        features["d_sprint_fin_e"] = _ewm(ev["sprint_fin"][rows], ages, 4)
        all_rows = self._before(driver_rows, self.event_race, target.cutoff, None)
        features["d_starts"] = len(all_rows)
        features["d_last_fin"] = finish[-1]
        features["d_last_dnf"] = ev["dnf"][rows][-1]
        this_season = seasons == target.season
        previous_season = seasons == target.season - 1
        features["d_n_s"] = int(this_season.sum())
        features["d_fin_s"] = _nanmean(finish[this_season])
        features["d_q_s"] = _nanmean(quali[this_season])
        features["d_qgap_s"] = _nanmean(qgap[this_season])
        features["d_fin_ps"] = _nanmean(finish[previous_season])
        features["d_qgap_ps"] = _nanmean(qgap[previous_season])
        constructor_id = self._team_of(target, driver_id)
        team = data.lineage_of(constructor_id)
        features["d_team_races"] = int((self.event_team[rows] == team).sum())
        circuit_key = (driver_id, target.circuit_id)
        circuit_rows = self._before(self.driver_circuit_rows.get(circuit_key), self.event_race,
                                    target.cutoff, 6)
        if circuit_rows is not None:
            features["d_circ_tm"] = _nanmean(ev["tm_fin_delta"][circuit_rows])
            features["d_circ_gain"] = _nanmean(ev["gain"][circuit_rows])
            features["d_circ_fin"] = _nanmean(ev["finish_c"][circuit_rows])
            features["d_circ_visits"] = len(circuit_rows)
        standing = self._driver_standing(driver_id, target)
        features.update(standing)
        return features

    def _team_features(self, team: str, target: Target) -> dict:
        features = dict.fromkeys(TEAM_COLS, np.nan)
        features["t_n_s"] = 0
        rows = self._before(self.team_rows.get(team), self.team_race, target.cutoff, 40)
        if rows is None:
            return features
        tr = self.team_arrays
        ages = np.arange(len(rows))[::-1].astype(float)
        qgap = tr["best_qgap"][rows]
        finish = tr["best_fin"][rows]
        mech = tr["mech_rate"][rows]
        seasons = tr["season"][rows]
        era = self._era_weights(seasons, target.season)
        features["t_qgap_e3"] = _ewm(qgap, ages, 3, era)
        features["t_qgap_e8"] = _ewm(qgap, ages, 8, era)
        features["t_fin_e3"] = _ewm(finish, ages, 3, era)
        features["t_fin_e8"] = _ewm(finish, ages, 8, era)
        features["t_pts_e5"] = _ewm(tr["points"][rows], ages, 5, era)
        features["t_mech_e"] = _ewm(mech, ages, 15)
        this_season = seasons == target.season
        previous_season = seasons == target.season - 1
        features["t_n_s"] = int(this_season.sum())
        features["t_qgap_s"] = _nanmean(qgap[this_season])
        features["t_fin_s"] = _nanmean(finish[this_season])
        features["t_mech_s"] = _nanmean(mech[this_season])
        features["t_dnf_s"] = _nanmean(tr["dnf_rate"][rows][this_season])
        features["t_qgap_ps"] = _nanmean(qgap[previous_season])
        clusters = self.team_cluster[rows]
        features["t_cluster_qgap"] = self._cluster_delta(qgap, seasons, clusters, target)
        features["t_champ_pos"] = self._team_standing(team, target)
        return features

    def _cluster_delta(self, qgap, seasons, clusters, target: Target) -> float:
        """Team quali gap at circuits of the target's type minus its overall gap (same era)."""
        cluster = self.races.loc[target.race_id, "cluster"]
        era_start = max(start for start in ERA_STARTS if start <= target.season)
        in_era = (seasons >= era_start) & ~np.isnan(qgap)
        same = in_era & (clusters == cluster)
        if same.sum() < 1 or in_era.sum() < 3:
            return np.nan
        return float(qgap[same].mean() - qgap[in_era].mean())

    def _driver_standing(self, driver_id: str, target: Target) -> dict:
        previous = self._previous_round_id(target)
        if previous is None:
            return {"d_champ_pos": np.nan, "d_champ_share": np.nan}
        standings = self.driver_standings.get(previous)
        if standings is None:
            return {"d_champ_pos": np.nan, "d_champ_share": np.nan}
        leader = standings["points"].max()
        if driver_id not in standings.index:
            return {"d_champ_pos": len(standings) + 1, "d_champ_share": 0.0}
        points = standings.at[driver_id, "points"]
        share = float(points / leader) if leader > 0 else 0.0
        position = float(standings.at[driver_id, "position"])
        return {"d_champ_pos": position, "d_champ_share": share}

    def _team_standing(self, team: str, target: Target) -> float:
        previous = self._previous_round_id(target)
        if previous is None:
            return np.nan
        standings = self.constructor_standings.get(previous)
        if standings is None:
            return np.nan
        lineages = standings.index.map(data.lineage_of)
        row = standings[lineages == team]
        if not len(row):
            return float(len(standings) + 1)
        return float(row["position"].iloc[0])

    def _previous_round_id(self, target: Target) -> int | None:
        """Latest completed round of the target season before the cutoff."""
        key = (target.season, target.cutoff)
        if key in self.previous_round_cache:
            return self.previous_round_cache[key]
        season_start = target.season * 100
        earlier = self.event_race[(self.event_race < target.cutoff)
                                  & (self.event_race > season_start)]
        previous = int(earlier.max()) if len(earlier) else None
        self.previous_round_cache[key] = previous
        return previous

    def _team_of(self, target: Target, driver_id: str) -> str:
        match = target.entrants[target.entrants["driverId"] == driver_id]
        return match["constructorId"].iloc[0]

    def _birth(self, driver_id: str):
        if driver_id not in self.drivers.index:
            return None
        birth = self.drivers.loc[driver_id, "dateOfBirth"]
        if pd.isna(birth):
            return None
        return pd.Timestamp(birth)

    def _attach_weekend(self, frame: pd.DataFrame, race_id: int) -> pd.DataFrame:
        weekend = self.weekend[self.weekend["raceId"] == race_id]
        weekend_cols = [c for c in PRACTICE_COLS + SPRINT_COLS + QUALI_COLS if c in weekend]
        keep = ["driverId"] + [c for c in weekend_cols if c not in
                                                ("fp_vs_form", "q_vs_form")]
        merged = frame.merge(weekend[keep], on="driverId", how="left")
        for column in PRACTICE_COLS + SPRINT_COLS + QUALI_COLS:
            if column not in merged:
                merged[column] = np.nan
        race = self.races.loc[race_id]
        sprint_pre_q = int(bool(race["hasSprint"]) and race["season"] >= 2024)
        merged["sprint_pre_q"] = sprint_pre_q
        return _relative_weekend(merged)

    def _attach_labels(self, frame: pd.DataFrame, race_id: int) -> pd.DataFrame:
        rows = self.events[self.events["raceId"] == race_id]
        labels = rows[["driverId", "finish", "classified", "dnf", "dsq", "quali_pos", "grid_raw",
                       "points", "sprint_fin", "sprint_dnf"]]
        labels = labels.rename(columns={
            "finish": "y_finish", "classified": "y_classified", "dnf": "y_dnf", "dsq": "y_dsq",
            "quali_pos": "y_quali", "grid_raw": "y_grid", "points": "y_points",
            "sprint_fin": "y_sprint_finish", "sprint_dnf": "y_sprint_dnf",
        })
        merged = frame.merge(labels, on="driverId", how="left")
        if not len(rows):
            weekend = self.weekend[self.weekend["raceId"] == race_id][["driverId", "q_pos"]]
            merged = merged.drop(columns="y_quali").merge(
                weekend.rename(columns={"q_pos": "y_quali"}), on="driverId", how="left")
        return merged

    def _era_weights(self, seasons: np.ndarray, season: int) -> np.ndarray | None:
        """Form weight per row: ERA discount for rows from before the target's regulation era."""
        if self.era_discount >= 1.0:
            return None
        era_start = max(start for start in ERA_STARTS if start <= season)
        return np.where(seasons < era_start, self.era_discount, 1.0)

    @staticmethod
    def _before(rows, race_ids, cutoff, limit):
        """Row positions (sorted) whose raceId is below the cutoff, the last `limit` of them."""
        if rows is None:
            return None
        values = race_ids[rows]
        count = int(np.searchsorted(values, cutoff, side="left"))
        if count == 0:
            return None
        start = 0 if limit is None else max(0, count - limit)
        return rows[start:count]


# ----------------------------------------------------------------------------------------------
# table construction helpers


def _races_frame(core) -> pd.DataFrame:
    races = core["races"].copy()
    races["date"] = pd.to_datetime(races["date"])
    counts = races.groupby("season")["round"].transform("max")
    races["n_rounds"] = counts
    meta = data.circuit_meta()
    races = races.merge(meta[["circuitId", "circuitType"]], on="circuitId", how="left")
    speeds = _circuit_speeds(core, races)
    races = races.merge(speeds, on="circuitId", how="left")
    races["cluster"] = np.where(races["circuitType"] == "STREET", "street",
                                np.where(races["c_speed"] >= 225, "fast", "medium"))
    return races.set_index("raceId").sort_index()


def _circuit_speeds(core, races) -> pd.DataFrame:
    """Typical race lap speed per circuit (km/h) from fastest laps since 2014."""
    results = core["results"]
    fastest = results[(results["fastestLapRank"] == 1) & (results["season"] >= 2014)]
    fastest = fastest[["raceId", "fastestLapTimeMs"]].merge(
        races[["raceId", "circuitId", "courseLengthKm"]], on="raceId")
    hours = fastest["fastestLapTimeMs"] / 3.6e6
    fastest["speed"] = fastest["courseLengthKm"] / hours
    speeds = fastest.groupby("circuitId", as_index=False)["speed"].median()
    return speeds.rename(columns={"speed": "c_speed"})


def _build_events(core, races) -> pd.DataFrame:
    """One row per driver per completed race with the event-level measurements."""
    results = core["results"]
    results = results[results["season"] >= HISTORY_START_SEASON].copy()
    results["team"] = results["constructorId"].map(data.lineage_of)
    results["circuitId"] = results["raceId"].map(races["circuitId"])
    results["finish"] = results["positionOrder"].astype(float)
    results["classified"] = results["position"].notna().astype(int)
    results["dsq"] = (results["statusCategory"] == "disqualified").astype(int)
    results["dnf"] = ((results["classified"] == 0) & (results["dsq"] == 0)).astype(int)
    results["dnf_mech"] = ((results["classified"] == 0)
                           & (results["statusCategory"] == "retired")).astype(int)
    results["dnf_acc"] = ((results["classified"] == 0)
                          & (results["statusCategory"] == "accident")).astype(int)
    results["finish_c"] = results["finish"].where(results["classified"] == 1)
    finish_index = results["finish"].astype(int) - 1
    in_points = (finish_index < 10) & (results["classified"] == 1)
    safe_index = finish_index.clip(0, 9)
    results["pts_modern"] = np.where(in_points, MODERN_POINTS[safe_index], 0.0)
    results["grid_raw"] = results["grid"].astype(float)
    field = results.groupby("raceId")["driverId"].transform("count")
    results["field"] = field
    grid_effective = results["grid_raw"].where(results["grid_raw"] > 0, field)
    results["gain"] = (grid_effective - results["finish"]).where(results["classified"] == 1)

    qualifying = core["qualifying"][["raceId", "driverId", "position", "q1Ms", "q2Ms", "q3Ms"]]
    qualifying = qualifying.drop_duplicates(["raceId", "driverId"])
    quali_gaps = _quali_gaps(qualifying)
    events = results.merge(quali_gaps, on=["raceId", "driverId"], how="left")
    sprint = _sprint_frame(core)
    events = events.merge(sprint, on=["raceId", "driverId"], how="left")
    events = events.sort_values(["raceId", "positionOrder"]).reset_index(drop=True)
    events = _teammate_deltas(events)
    columns = ["raceId", "season", "round", "circuitId", "driverId", "constructorId", "team",
               "number", "finish", "finish_c", "classified", "dnf", "dnf_mech", "dnf_acc", "dsq",
               "pts_modern", "points", "grid_raw", "gain", "field", "quali_pos", "quali_gap",
               "sprint_fin", "sprint_grid", "sprint_dnf", "tm_qgap_delta", "tm_fin_delta"]
    return events[columns]


def _quali_gaps(qualifying: pd.DataFrame) -> pd.DataFrame:
    """Qualifying position and gap (%) to the fastest time of the deepest common segment."""
    frame = qualifying.copy()
    gaps = []
    for column in ("q1Ms", "q2Ms", "q3Ms"):
        best = frame.groupby("raceId")[column].transform("min")
        gap = (frame[column] / best - 1.0) * 100.0
        gaps.append(gap)
    stacked = np.vstack([gap.to_numpy(dtype=float) for gap in gaps])
    with np.errstate(all="ignore"):
        best_gap = np.nanmin(np.where(np.isnan(stacked), np.inf, stacked), axis=0)
    best_gap = np.where(np.isinf(best_gap), np.nan, best_gap)
    frame["quali_gap"] = np.clip(best_gap, 0.0, GAP_CLIP + 1.0)
    frame["quali_pos"] = frame["position"].astype(float)
    return frame[["raceId", "driverId", "quali_pos", "quali_gap"]]


def _sprint_frame(core) -> pd.DataFrame:
    sprint = core["sprint_results"].copy()
    sprint["sprint_fin"] = sprint["positionOrder"].astype(float)
    sprint["sprint_grid"] = sprint["grid"].astype(float)
    sprint["sprint_dnf"] = sprint["position"].isna().astype(float)
    return sprint[["raceId", "driverId", "sprint_fin", "sprint_grid", "sprint_dnf"]]


def _teammate_deltas(events: pd.DataFrame) -> pd.DataFrame:
    """Driver minus team-mate quali gap and classified finish, per race."""
    grouped = events.groupby(["raceId", "constructorId"])
    team_qgap_sum = grouped["quali_gap"].transform("sum")
    team_qgap_count = grouped["quali_gap"].transform("count")
    mate_qgap = (team_qgap_sum - events["quali_gap"]) / (team_qgap_count - 1)
    events["tm_qgap_delta"] = (events["quali_gap"] - mate_qgap).where(team_qgap_count == 2)
    team_fin_sum = grouped["finish_c"].transform("sum")
    team_fin_count = grouped["finish_c"].transform("count")
    mate_fin = (team_fin_sum - events["finish_c"]) / (team_fin_count - 1)
    events["tm_fin_delta"] = (events["finish_c"] - mate_fin).where(team_fin_count == 2)
    return events


def _build_team_races(events: pd.DataFrame) -> pd.DataFrame:
    grouped = events.groupby(["raceId", "team"], as_index=False)
    team_races = grouped.agg(
        season=("season", "first"), circuitId=("circuitId", "first"),
        best_qgap=("quali_gap", "min"), best_fin=("finish_c", "min"),
        points=("pts_modern", "sum"), mech=("dnf_mech", "sum"), cars=("driverId", "count"),
        dnfs=("dnf", "sum"),
    )
    team_races["mech_rate"] = team_races["mech"] / team_races["cars"]
    team_races["dnf_rate"] = team_races["dnfs"] / team_races["cars"]
    return team_races.sort_values(["raceId", "team"]).reset_index(drop=True)


def _build_circuit_races(events: pd.DataFrame, races: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for race_id, race_events in events.groupby("raceId"):
        classified = race_events[(race_events["classified"] == 1) & (race_events["grid_raw"] > 0)]
        grid_corr = np.nan
        if len(classified) >= 5:
            grid_corr = classified["grid_raw"].corr(classified["finish"], method="spearman")
        abs_change = float(np.abs(classified["grid_raw"] - classified["finish"]).mean())
        pole = race_events[race_events["grid_raw"] == 1]
        pole_win = float((pole["finish"] == 1).any()) if len(pole) else np.nan
        dnf_rate = float(race_events["dnf"].mean())
        circuit_id = races.loc[race_id, "circuitId"]
        rows.append((race_id, circuit_id, grid_corr, pole_win, dnf_rate, abs_change))
    columns = ["raceId", "circuitId", "grid_corr", "pole_win", "dnf_rate", "abs_change"]
    return pd.DataFrame(rows, columns=columns).sort_values("raceId").reset_index(drop=True)


def _build_weekend(core, races, events) -> pd.DataFrame:
    """Weekend inputs per (raceId, driverId), including races in progress.

    Practice: one-lap gap (%) per FP session held before the main qualifying, compound and
    track evolution corrected where lap data exists (`practice_pace`), raw best lap otherwise.
    Sprint:
    sprint qualifying and sprint race result. Qualifying: position, gap, grid.
    """
    sessions = data.session_results()
    sessions = sessions[sessions["raceId"] >= HISTORY_START_SEASON * 100].copy()
    best = sessions.groupby(["raceId", "session"])["timeMs"].transform("min")
    sessions["gap"] = ((sessions["timeMs"] / best - 1.0) * 100.0).clip(upper=GAP_CLIP)
    sessions["rank"] = sessions.groupby(["raceId", "session"])["timeMs"].rank(method="min")
    practice_laps = practice_pace.session_laps()
    corrected = practice_pace.corrected_gaps(practice_laps)
    practice = _practice_features(sessions, races, corrected)
    sprint_quali = sessions[sessions["session"] == "SQ"][["raceId", "driverId", "rank", "gap"]]
    sprint_quali = sprint_quali.rename(columns={"rank": "sq_pos", "gap": "sq_gap"})
    long_runs = _long_run_features()
    quali = _weekend_quali(core, events)
    sprint = _sprint_frame(core).rename(columns={"sprint_fin": "sp_fin", "sprint_dnf": "sp_dnf"})
    sprint["sp_gain"] = sprint["sprint_grid"] - sprint["sp_fin"]
    sprint = sprint.drop(columns="sprint_grid")
    keys = pd.concat([frame[["raceId", "driverId"]] for frame in
                      (practice, sprint_quali, quali, sprint)], ignore_index=True)
    weekend = keys.drop_duplicates().reset_index(drop=True)
    for frame in (practice, sprint_quali, long_runs, quali, sprint):
        weekend = weekend.merge(frame, on=["raceId", "driverId"], how="left")
    return weekend


def _practice_features(sessions: pd.DataFrame, races: pd.DataFrame,
                       corrected: pd.DataFrame) -> pd.DataFrame:
    practice = sessions[sessions["session"].str.startswith("FP")].copy()
    practice = practice[~practice["driverId"].str.startswith("f1db:")]
    seasons = practice["raceId"] // 100
    sprint_flags = practice["raceId"].map(races["hasSprint"]).fillna(False).astype(bool)
    after_quali = sprint_flags & (seasons <= 2022) & (practice["session"] == "FP2")
    practice = practice[~after_quali]
    practice = _apply_corrected(practice, corrected)
    wide = practice.pivot_table(index=["raceId", "driverId"], columns="session", values="gap",
                                aggfunc="min")
    wide = wide.rename(columns={"FP1": "fp1_gap", "FP2": "fp2_gap", "FP3": "fp3_gap"})
    for column in ("fp1_gap", "fp2_gap", "fp3_gap"):
        if column not in wide:
            wide[column] = np.nan
    gap_cols = [c for c in wide.columns if c.endswith("_gap") or c == "FP4"]
    weights = pd.Series({c: SESSION_WEIGHTS[c] for c in gap_cols})
    present = wide[gap_cols].notna()
    weight_sum = present.mul(weights, axis=1).sum(axis=1)
    weighted = wide[gap_cols].fillna(0.0).mul(weights, axis=1).sum(axis=1)
    wide["fp_best_gap"] = (weighted / weight_sum).where(weight_sum > 0)
    wide["fp_n"] = present.sum(axis=1)
    last_gap = wide[["fp1_gap", "fp2_gap", "fp3_gap"]].ffill(axis=1).iloc[:, -1]
    wide["fp_last_gap"] = last_gap
    ranks = practice.groupby(["raceId", "driverId"])["rank"].mean().rename("fp_mean_rank")
    wide = wide.join(ranks).reset_index()
    return wide[["raceId", "driverId", "fp_n", "fp1_gap", "fp2_gap", "fp3_gap", "fp_best_gap",
                 "fp_last_gap", "fp_mean_rank"]]


def _long_run_features() -> pd.DataFrame:
    """Long run gap (%) and relative tyre degradation in each race's main long run session
    (most drivers with long runs). lr_deg: the driver's degradation slope minus the field's
    median slope in that session (s per lap of tyre age; negative = kinder to the tyres).

    Comparing across sessions is meaningless (fuel loads, track evolution, time of day), so
    only one session per race is used, normally FP2.
    """
    long_runs = data.long_run_pace()
    columns = ["raceId", "driverId", "lr_gap", "lr_rank", "lr_deg"]
    if not len(long_runs):
        return pd.DataFrame(columns=columns)
    counts = long_runs.groupby(["raceId", "session"]).size().rename("drivers").reset_index()
    counts = counts.sort_values(["raceId", "drivers", "session"], ascending=[True, False, False])
    main_sessions = counts.drop_duplicates("raceId")[["raceId", "session"]]
    main = long_runs.merge(main_sessions, on=["raceId", "session"])
    best = main.groupby("raceId")["longRunS"].transform("min")
    main["lr_gap"] = ((main["longRunS"] / best - 1.0) * 100.0).clip(upper=GAP_CLIP)
    main["lr_rank"] = main.groupby("raceId")["longRunS"].rank(method="min")
    field_slope = main.groupby("raceId")["degSlope"].transform("median")
    main["lr_deg"] = (main["degSlope"] - field_slope).clip(-DEG_CLIP, DEG_CLIP)
    return main[columns]


def _weekend_quali(core, events) -> pd.DataFrame:
    """Qualifying position, gap and grid; live sources fill races Jolpica does not have yet.

    Before any official grid exists (no Jolpica result, no live starting grid) the grid is the
    qualifying order with the announced grid penalties applied (`penalties`).
    """
    jolpica = core["qualifying"][["raceId", "driverId", "position", "q1Ms", "q2Ms", "q3Ms"]]
    live = data.live_qualifying()
    known = set(jolpica["raceId"].unique())
    live = live[~live["raceId"].isin(known)]
    combined = pd.concat([jolpica, live], ignore_index=True)
    combined = combined.drop_duplicates(["raceId", "driverId"])
    gaps = _quali_gaps(combined).rename(columns={"quali_pos": "q_pos", "quali_gap": "q_gap"})
    grid = events[["raceId", "driverId", "grid_raw", "field"]]
    live_grid = data.live_starting_grid()
    gaps = gaps.merge(grid, on=["raceId", "driverId"], how="left")
    gaps = gaps.merge(live_grid.rename(columns={"grid": "live_grid"}),
                      on=["raceId", "driverId"], how="left")
    official = gaps["grid_raw"].notna() | gaps["live_grid"].notna()
    fallback_grid = gaps["live_grid"].fillna(gaps["q_pos"])
    gaps["grid_raw"] = gaps["grid_raw"].fillna(fallback_grid)
    gaps = _announced_grid(gaps, official)
    field = gaps.groupby("raceId")["driverId"].transform("count")
    gaps["field"] = gaps["field"].fillna(field)
    gaps["pitlane"] = (gaps["grid_raw"] == 0).astype(float)
    gaps["grid"] = gaps["grid_raw"].where(gaps["grid_raw"] > 0, gaps["field"])
    gaps["grid_pen"] = gaps["grid"] - gaps["q_pos"]
    return gaps[["raceId", "driverId", "q_pos", "q_gap", "grid", "grid_pen", "pitlane"]]


def _announced_grid(gaps: pd.DataFrame, official: pd.Series) -> pd.DataFrame:
    """grid_raw from qualifying plus announced penalties for races without an official grid.

    Pit lane starters get grid_raw 0, the same marker the official results use.
    """
    gaps = gaps.copy()
    for race_id, rows in gaps.groupby("raceId"):
        if official.loc[rows.index].any():
            continue
        announced = penalties.load(int(race_id))
        race_penalties = penalties.for_frame(announced, rows["driverId"], "race")
        if race_penalties is None:
            continue
        qualifying = _rank_values(rows["q_pos"])
        grid = penalties.apply(qualifying, race_penalties)
        grid_raw = np.where(race_penalties.pit_lane, 0, grid)
        gaps.loc[rows.index, "grid_raw"] = grid_raw
    return gaps


def _rank_values(values: pd.Series) -> np.ndarray:
    """1..n positions from values (missing last, ties keep row order)."""
    filled = values.to_numpy(dtype=float)
    filled = np.where(np.isnan(filled), 1e6, filled)
    order = np.argsort(filled, kind="stable")
    ranks = np.empty(len(filled), dtype=np.int64)
    ranks[order] = np.arange(1, len(filled) + 1)
    return ranks


def _relative_weekend(frame: pd.DataFrame) -> pd.DataFrame:
    """Team and team-mate relative practice / qualifying measures within the race."""
    team_best = frame.groupby("team")["fp_best_gap"].transform("min")
    frame["fp_team_best_gap"] = team_best
    for source, target in (("fp_best_gap", "fp_tm_delta"), ("q_gap", "q_tm_delta")):
        total = frame.groupby("team")[source].transform("sum")
        count = frame.groupby("team")[source].transform("count")
        mate = (total - frame[source]) / (count - 1)
        frame[target] = (frame[source] - mate).where(count == 2)
    return frame


def _apply_corrected(practice: pd.DataFrame, corrected: pd.DataFrame) -> pd.DataFrame:
    """Swap raw best lap gap and rank for the corrected ones in sessions with lap data.

    In those sessions a driver without enough push laps gets no gap (not the raw one).
    """
    if not len(corrected):
        return practice
    keys = ["raceId", "session", "driverId"]
    pace = corrected[keys + ["pace_gap", "pace_rank"]]
    merged = practice.merge(pace, on=keys, how="left")
    covered = corrected[["raceId", "session"]].drop_duplicates().assign(covered=True)
    merged = merged.merge(covered, on=["raceId", "session"], how="left")
    in_covered = merged["covered"].fillna(False).astype(bool)
    clipped_gap = merged["pace_gap"].clip(upper=GAP_CLIP)
    merged["gap"] = merged["gap"].where(~in_covered, clipped_gap)
    merged["rank"] = merged["rank"].where(~in_covered, merged["pace_rank"])
    return merged.drop(columns=["pace_gap", "pace_rank", "covered"])


def _float_arrays(frame: pd.DataFrame, columns) -> dict:
    return {column: frame[column].to_numpy(dtype=float) for column in columns}


def _split_by_race(standings: pd.DataFrame, key: str) -> dict:
    recent = standings[standings["season"] >= HISTORY_START_SEASON]
    result = {}
    for race_id, rows in recent.groupby("raceId"):
        result[int(race_id)] = rows.set_index(key)
    return result


def _index_by(frame: pd.DataFrame, keys) -> dict:
    """Map key -> np.array of row positions, already sorted by raceId."""
    grouped = frame.groupby(keys, sort=False).indices
    result = {}
    for key, positions in grouped.items():
        race_ids = frame["raceId"].to_numpy()[positions]
        order = np.argsort(race_ids, kind="stable")
        result[key] = positions[order]
    return result


def _ewm(values: np.ndarray, ages: np.ndarray, halflife: float,
         scale: np.ndarray | None = None) -> float:
    mask = ~np.isnan(values)
    if not mask.any():
        return np.nan
    weights = np.power(0.5, ages[mask] / halflife)
    if scale is not None:
        weights = weights * scale[mask]
    total = weights.sum()
    return float((weights * values[mask]).sum() / total)


def _nanmean(series) -> float:
    values = np.asarray(series, dtype=float)
    finite = values[~np.isnan(values)]
    if not len(finite):
        return np.nan
    return float(finite.mean())


if __name__ == "__main__":
    main()
