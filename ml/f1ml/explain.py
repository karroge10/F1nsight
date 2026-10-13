"""Structured explanations per driver and constructor from TreeSHAP of the GBM race ranker.

Contributions are made relative to the field (driver minus field average) because a ranker
only cares about differences between entrants. Related features are summed into groups; the
groups with the largest absolute relative contribution become the factors:

    {"kind": "quali_pace", "label": "One-lap pace", "value": "+0.09% to pole",
     "impact": 0.21, "detail": "Has qualified 0.09% off pole on average lately."}

`impact` is in model score units (positive helps). `reasons` are the `detail` sentences.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from f1ml import features as feat
from f1ml import gbm, penalties

MAX_FACTORS = 4
MIN_IMPACT = 0.003
GROUPS = {
    "grid": ["grid", "q_pos", "q_gap", "grid_pen", "pitlane", "q_tm_delta", "q_vs_form"],
    "practice_pace": ["fp_n", "fp1_gap", "fp2_gap", "fp3_gap", "fp_best_gap", "fp_last_gap",
                      "fp_mean_rank", "fp_team_best_gap", "fp_tm_delta", "fp_vs_form"],
    "race_pace": ["lr_gap", "lr_rank", "lr_deg"],
    "sprint": ["sq_pos", "sq_gap", "sp_fin", "sp_dnf", "sp_gain"],
    "form": ["d_fin_e3", "d_fin_e10", "d_pts_e5", "d_fin_s", "d_last_fin", "d_fin_ps",
             "d_sprint_fin_e", "dp_driver", "dp_total", "dp_sd"],
    "quali_pace": ["d_q_e3", "d_q_e10", "d_qgap_e3", "d_qgap_e10", "d_q_s", "d_qgap_s",
                   "d_qgap_ps"],
    "championship": ["d_champ_pos", "d_champ_share", "t_champ_pos"],
    "team": ["t_qgap_e3", "t_qgap_e8", "t_qgap_s", "t_qgap_ps", "t_fin_e3", "t_fin_e8",
             "t_fin_s", "t_pts_e5", "t_n_s", "dp_team"],
    "track_type": ["t_cluster_qgap"],
    "track_history": ["d_circ_tm", "d_circ_gain", "d_circ_fin", "d_circ_visits"],
    "teammate": ["d_tm_qgap_e", "d_tm_fin_e"],
    "racecraft": ["d_gain_e"],
    "reliability": ["t_mech_s", "t_mech_e", "d_acc_rate", "d_last_dnf"],
    "experience": ["d_starts", "d_age", "d_team_races", "d_n_s"],
}
FIXED_FACTORS = (
    ("recentFinish", "Avg finish when classified", "form"),
    ("qualiGap", "One-lap gap to pole", "quali_pace"),
    ("teamGap", "Team's best-car gap to pole", "team"),
    ("championship", "Championship position", "championship"),
    ("trackHistory", "Track history here", "track_history"),
    ("reliability", "Reliability (own retirement rate)", "reliability"),
)
TEAM_GROUPS = ("team", "reliability", "track_type", "practice_pace", "grid", "form",
               "race_pace", "quali_pace")
CLUSTER_NAMES = {"street": "street", "fast": "high-speed", "medium": "medium-speed"}


def explain_race(booster, frame: pd.DataFrame, stage: str, cluster: str,
                 grid_penalties: dict | None = None) -> dict:
    """Factors and reasons for every driver row and every constructor of a race frame.

    grid_penalties: the forecast's announced penalties (`RaceForecast.grid_penalties`); a
    penalised driver always gets a "Grid penalty" factor first (`penalty_factors`).
    """
    gated = feat.stage_frame(frame, stage)
    impacts = group_impacts(booster, gated, stage)
    announced = grid_penalties or {}
    group_names = list(GROUPS)
    grid_group = group_names.index("grid")
    drivers = []
    key_factors = []
    for row_index in range(len(frame)):
        row = gated.iloc[row_index]
        factors = _top_factors(impacts[row_index], row, cluster, GROUPS)
        grid_impact = float(impacts[row_index][grid_group])
        factors = penalty_factors(factors, announced, row_index, row, grid_impact)
        drivers.append(factors)
        fixed = fixed_factors(row, impacts[row_index])
        key_factors.append(fixed)
    constructors = {}
    team_ids = frame["constructorId"].to_numpy()
    for team in dict.fromkeys(team_ids):
        members = np.where(team_ids == team)[0]
        mean_impacts = impacts[members].mean(axis=0)
        rows = gated.iloc[members]
        factors = _top_team_factors(mean_impacts, rows, cluster)
        constructors[team] = factors
    return {"drivers": drivers, "constructors": constructors, "keyFactors": key_factors}


def penalty_factors(factors: list[dict], announced: dict, index: int, row: pd.Series,
                    grid_impact: float) -> list[dict]:
    """Put announced grid penalties first in a driver's factors, in every stage.

    announced: {"race": GridPenalties | None, "sprint": ..., "shift": array | None} from the
    forecast. Before qualifying the impact is the strength shift the penalty caused; after
    qualifying it is the SHAP impact of the grid group and the value is the starting slot.
    """
    added = []
    for session, label in (("race", "Grid penalty"), ("sprint", "Sprint grid penalty")):
        session_penalties = announced.get(session)
        if session_penalties is None or not session_penalties.penalised()[index]:
            continue
        value = session_penalties.labels[index]
        impact = 0.0
        if session == "race" and _has(row, "grid"):
            value = f"P{row['grid']:.0f}"
            impact = grid_impact
        elif session == "race" and announced.get("shift") is not None:
            impact = float(announced["shift"][index])
        detail = penalties.describe(session_penalties, index, session)
        factor = _factor("grid", label, value, detail)
        factor["impact"] = round(impact, 3)
        added.append(factor)
    if not added:
        return factors
    if added[0]["label"] == "Grid penalty":
        factors = [factor for factor in factors if factor["kind"] != "grid"]
    combined = added + factors
    return combined[:MAX_FACTORS]


def fixed_factors(row: pd.Series, impacts: np.ndarray) -> list[dict]:
    """The same six factors for every driver, always in this order (FIXED_FACTORS).

    Each entry: key, label, value (number or null), unit, text (short formatted value),
    detail (sentence), impact (field-relative SHAP of the feature group, + helps), and extra
    numeric fields where useful (seconds for the pace gaps, visits for track history).
    Seconds are approximate: the % gap times the circuit's typical race lap (length / speed).
    """
    names = list(GROUPS)
    lap_seconds = _typical_lap_seconds(row)
    entries = []
    for key, label, group in FIXED_FACTORS:
        entry = {"key": key, "label": label, "value": None, "unit": None, "text": "no data",
                 "detail": "No data yet."}
        entry.update(_fixed_value(key, row, lap_seconds))
        impact = float(impacts[names.index(group)])
        entry["impact"] = round(impact, 3)
        entries.append(entry)
    return entries


def group_impacts(booster, gated: pd.DataFrame, stage: str) -> np.ndarray:
    """(rows, groups) field-relative SHAP contribution of each feature group."""
    stage_columns = feat.stage_columns(stage)
    columns = gbm.trained_columns(booster, stage_columns)
    contributions = gbm.contributions(booster, gated, columns)[:, :-1]
    relative = contributions - contributions.mean(axis=0, keepdims=True)
    index = {name: i for i, name in enumerate(columns)}
    names = list(GROUPS)
    values = np.zeros((len(gated), len(names)))
    for g, name in enumerate(names):
        members = [index[c] for c in GROUPS[name] if c in index]
        if members:
            values[:, g] = relative[:, members].sum(axis=1)
    return values


def reasons_from(factors: list[dict]) -> list[str]:
    return [factor["detail"] for factor in factors[:3]]


# ----------------------------------------------------------------------------------------------
# helpers


def _top_factors(impacts: np.ndarray, row: pd.Series, cluster: str, groups: dict) -> list:
    names = list(GROUPS)
    order = np.argsort(-np.abs(impacts))
    factors = []
    for g in order:
        name = names[g]
        if name not in groups or abs(impacts[g]) < MIN_IMPACT:
            continue
        factor = _driver_factor(name, row, cluster)
        if factor is None or any(f["label"] == factor["label"] for f in factors):
            continue
        factor["impact"] = round(float(impacts[g]), 3)
        factors.append(factor)
        if len(factors) >= MAX_FACTORS:
            break
    return factors


def _top_team_factors(impacts: np.ndarray, rows: pd.DataFrame, cluster: str) -> list:
    names = list(GROUPS)
    order = np.argsort(-np.abs(impacts))
    factors = []
    for g in order:
        name = names[g]
        if name not in TEAM_GROUPS or abs(impacts[g]) < MIN_IMPACT:
            continue
        factor = _team_factor(name, rows, cluster)
        if factor is None or any(f["label"] == factor["label"] for f in factors):
            continue
        factor["impact"] = round(float(impacts[g]), 3)
        factors.append(factor)
        if len(factors) >= MAX_FACTORS:
            break
    return factors


def _fixed_value(key: str, row: pd.Series, lap_seconds: float | None) -> dict:
    if key == "recentFinish" and _has(row, "d_fin_e3"):
        value = float(row["d_fin_e3"])
        return {"value": round(value, 2), "unit": "position", "text": f"avg P{value:.1f}",
                "detail": f"Has averaged P{value:.1f} in recent races when classified "
                          f"(retirements not counted)."}
    if key == "qualiGap" and _has(row, "d_qgap_e3"):
        return _gap_entry(float(row["d_qgap_e3"]), lap_seconds,
                          "Has qualified {pct:.2f}% ({sec}) off pole on average lately.")
    if key == "teamGap" and _has(row, "t_qgap_e3"):
        return _gap_entry(float(row["t_qgap_e3"]), lap_seconds,
                          "The team's faster car has qualified {pct:.2f}% ({sec}) off pole "
                          "lately.")
    if key == "championship" and _has(row, "d_champ_pos"):
        value = float(row["d_champ_pos"])
        return {"value": int(round(value)), "unit": "position", "text": f"P{value:.0f}",
                "detail": f"Sits {_ordinal(value)} in the drivers' championship."}
    if key == "trackHistory" and _has(row, "d_circ_fin") and row.get("d_circ_visits", 0) >= 1:
        visits = int(row["d_circ_visits"])
        value = float(row["d_circ_fin"])
        plural = "visit" if visits == 1 else "visits"
        return {"value": round(value, 2), "unit": "position", "visits": visits,
                "text": f"avg P{value:.1f} ({visits} {plural})",
                "detail": f"Has averaged P{value:.1f} here over {visits} {plural}."}
    if key == "trackHistory":
        return {"visits": 0, "detail": "No recent races at this circuit."}
    if key == "reliability" and _has(row, "d_dnf_e"):
        value = float(row["d_dnf_e"])
        share = value * 100
        return {"value": round(value, 4), "unit": "share", "text": f"{share:.0f}% DNF",
                "detail": f"Has retired from about {share:.0f}% of recent races."}
    return {}


def _gap_entry(percent: float, lap_seconds: float | None, template: str) -> dict:
    seconds = None if lap_seconds is None else percent / 100.0 * lap_seconds
    seconds_text = "no data" if seconds is None else f"+{seconds:.2f}s"
    detail = template.format(pct=percent, sec=seconds_text)
    text = f"+{percent:.2f}%"
    if seconds is not None:
        text = f"{text} (+{seconds:.2f}s)"
    rounded_seconds = None if seconds is None else round(seconds, 3)
    return {"value": round(percent, 4), "unit": "percent", "seconds": rounded_seconds,
            "text": text, "detail": detail}


def _typical_lap_seconds(row: pd.Series) -> float | None:
    if not (_has(row, "c_length") and _has(row, "c_speed")) or row["c_speed"] <= 0:
        return None
    return float(row["c_length"] / row["c_speed"] * 3600.0)


def _has(row, column) -> bool:
    return column in row and row[column] == row[column]


def _factor(kind: str, label: str, value: str, detail: str) -> dict:
    return {"kind": kind, "label": label, "value": value, "impact": 0.0, "detail": detail}


def _ordinal(number: float) -> str:
    value = int(round(number))
    if 10 <= value % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(value % 10, "th")
    return f"{value}{suffix}"


def _driver_factor(group: str, row: pd.Series, cluster: str) -> dict | None:
    if group == "grid" and _has(row, "grid"):
        grid = row["grid"]
        if _has(row, "pitlane") and row["pitlane"] == 1:
            return _factor("grid", "Pit lane start", "Pit lane",
                           "Starts from the pit lane.")
        if _has(row, "grid_pen") and row["grid_pen"] >= 3:
            return _factor("grid", "Grid penalty", f"P{grid:.0f}",
                           f"Qualified {_ordinal(row['q_pos'])} but starts {_ordinal(grid)} "
                           f"after a penalty.")
        return _factor("grid", "Grid slot", f"P{grid:.0f}", f"Starts {_ordinal(grid)} on the grid.")
    if group == "practice_pace" and _has(row, "fp_best_gap"):
        gap = row["fp_best_gap"]
        sessions = row["fp_n"] if _has(row, "fp_n") else 1
        rank = ""
        if _has(row, "fp_mean_rank") and sessions > 1:
            rank = f"; {sessions:.0f} sessions, average P{row['fp_mean_rank']:.0f}"
        elif _has(row, "fp_mean_rank"):
            rank = f"; P{row['fp_mean_rank']:.0f} in the session"
        if gap <= 0.001:
            return _factor("practice_pace", "Practice pace", "Fastest",
                           f"Fastest one-lap practice pace, compound adjusted{rank}.")
        return _factor("practice_pace", "Practice pace", f"+{gap:.2f}% to best",
                       f"One-lap practice pace {gap:.2f}% off the fastest, compound "
                       f"adjusted{rank}.")
    if group == "race_pace" and _has(row, "lr_rank"):
        rank = row["lr_rank"]
        return _factor("race_pace", "Long-run pace", f"P{rank:.0f}",
                       f"Ranked {_ordinal(rank)} on practice long runs, corrected for fuel "
                       f"and tyres.")
    if group == "sprint":
        if _has(row, "sp_fin"):
            return _factor("sprint", "Sprint result", f"P{row['sp_fin']:.0f}",
                           f"Finished the sprint {_ordinal(row['sp_fin'])}.")
        if _has(row, "sq_pos"):
            return _factor("sprint", "Sprint grid", f"P{row['sq_pos']:.0f}",
                           f"Qualified {_ordinal(row['sq_pos'])} for the sprint.")
        return None
    if group == "form" and _has(row, "d_fin_e3"):
        value = row["d_fin_e3"]
        return _factor("form", "Recent form", f"avg P{value:.1f}",
                       f"Has averaged P{value:.1f} at the finish in recent races.")
    if group == "quali_pace" and _has(row, "d_qgap_e3"):
        value = row["d_qgap_e3"]
        return _factor("quali_pace", "One-lap pace", f"+{value:.2f}% to pole",
                       f"Has qualified {value:.2f}% off pole on average lately.")
    if group == "championship" and _has(row, "d_champ_pos"):
        value = row["d_champ_pos"]
        return _factor("championship", "Championship", f"P{value:.0f}",
                       f"Sits {_ordinal(value)} in the drivers' championship.")
    if group == "team" and _has(row, "t_qgap_e3"):
        value = row["t_qgap_e3"]
        return _factor("team", "Car pace", f"+{value:.2f}% to pole",
                       f"The team's faster car has qualified {value:.2f}% off pole lately.")
    if group == "track_type" and _has(row, "t_cluster_qgap"):
        place = CLUSTER_NAMES.get(cluster, cluster)
        delta = row["t_cluster_qgap"]
        word = "closer to" if delta < 0 else "further from"
        return _factor("track_type", "Track type", place.capitalize(),
                       f"At {place} circuits the car qualifies {abs(delta):.2f}% {word} pole "
                       f"than its season average.")
    if group == "track_history":
        if _has(row, "d_circ_fin") and row.get("d_circ_visits", 0) >= 1:
            visits = int(row["d_circ_visits"])
            value = row["d_circ_fin"]
            plural = "visit" if visits == 1 else "visits"
            return _factor("track_history", "Track record", f"avg P{value:.1f}",
                           f"Has averaged P{value:.1f} here over {visits} {plural}.")
        return None
    if group == "teammate" and _has(row, "d_tm_qgap_e"):
        delta = row["d_tm_qgap_e"]
        word = "ahead of" if delta < 0 else "behind"
        sign = "-" if delta < 0 else "+"
        return _factor("teammate", "Vs team-mate", f"{sign}{abs(delta):.2f}% in quali",
                       f"Has qualified {abs(delta):.2f}% {word} the team-mate on average.")
    if group == "racecraft" and _has(row, "d_gain_e"):
        gained = row["d_gain_e"]
        word = "Gains" if gained >= 0 else "Loses"
        sign = "+" if gained >= 0 else "-"
        return _factor("racecraft", "Racecraft", f"{sign}{abs(gained):.1f} places",
                       f"{word} {abs(gained):.1f} places from grid to flag on average.")
    if group == "reliability" and _has(row, "t_mech_s"):
        share = row["t_mech_s"] * 100
        return _factor("reliability", "Reliability", f"{share:.0f}% failures",
                       f"The car has retired with a mechanical failure in {share:.0f}% of "
                       f"starts this season.")
    if group == "experience" and _has(row, "d_starts"):
        starts = row["d_starts"]
        label = "Rookie" if starts < 25 else "Experience"
        return _factor("experience", label, f"{starts:.0f} starts",
                       f"Has {starts:.0f} Grand Prix starts.")
    return None


def _team_factor(group: str, rows: pd.DataFrame, cluster: str) -> dict | None:
    first = rows.iloc[0]
    if group in ("team", "reliability", "track_type"):
        return _driver_factor(group, first, cluster)
    if group == "practice_pace" and _has(first, "fp_team_best_gap"):
        gap = first["fp_team_best_gap"]
        value = "Fastest" if gap <= 0.001 else f"+{gap:.2f}% to best"
        detail = ("Fastest one-lap practice pace, compound adjusted." if gap <= 0.001 else
                  f"One-lap practice pace {gap:.2f}% off the fastest, compound adjusted.")
        return _factor("practice_pace", "Practice pace", value, detail)
    if group == "grid" and rows["grid"].notna().all():
        best = rows["grid"].min()
        worst = rows["grid"].max()
        return _factor("grid", "Grid slots", f"P{best:.0f} and P{worst:.0f}",
                       f"Its cars start {_ordinal(best)} and {_ordinal(worst)}.")
    if group == "form" and _has(first, "t_fin_e3"):
        value = first["t_fin_e3"]
        return _factor("form", "Recent form", f"best car avg P{value:.1f}",
                       f"Its best car has averaged P{value:.1f} at the finish recently.")
    if group == "quali_pace" and _has(first, "t_qgap_e3"):
        return _driver_factor("team", first, cluster)
    return None
