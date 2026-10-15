"""Build the SPEC JSON payloads (next.json, history/<season>-<round>.json, fantasy.json)."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from f1ml import data, explain, fantasy, fantasy_history, paths

SCENARIO_COUNT = 2000


def race_payload(forecast, bundle, model_meta: dict, history, assets: "AssetBook",
                 backtest_summary: dict | None) -> dict:
    """The SPEC prediction contract for one forecast."""
    frame = forecast.frame
    race_id = forecast.race_id
    race = history.races.loc[race_id]
    core = data.load_core()
    circuits = core["circuits"].set_index("circuitId")
    circuit = circuits.loc[race["circuitId"]]
    colors = data.team_colors_2026()
    names = _constructor_names()
    summary = forecast.summary
    cluster = race["cluster"]
    booster = bundle.race_models[forecast.stage]
    explained = explain.explain_race(booster, frame, forecast.stage, cluster,
                                     forecast.grid_penalties)
    fantasy_block = _fantasy_blocks(forecast, assets)
    driver_rows = []
    for i, row in frame.iterrows():
        driver_id = row["driverId"]
        driver = _driver_info(driver_id)
        constructor_id = row["constructorId"]
        grid = None
        if forecast.stage == "post-qualifying" and row["grid"] == row["grid"]:
            grid = int(row["grid"])
        position_dist = [round(float(p), 5) for p in summary["positionDist"][i]]
        driver_rows.append({
            "driverId": driver_id,
            "code": driver["code"],
            "number": _int_or_none(row["number"]),
            "name": driver["name"],
            "constructorId": constructor_id,
            "team": names.get(constructor_id, constructor_id),
            "teamColor": colors.get(constructor_id, "#888888"),
            "grid": grid,
            "expectedPosition": round(float(summary["expectedPosition"][i]), 3),
            "positionDist": position_dist,
            "pDnf": round(float(summary["pDnf"][i]), 4),
            "pWin": round(float(summary["pWin"][i]), 4),
            "pPodium": round(float(summary["pPodium"][i]), 4),
            "pPoints": round(float(summary["pPoints"][i]), 4),
            "expectedPoints": round(float(summary["expectedPoints"][i]), 3),
            "fantasy": fantasy_block["drivers"].get(driver_id),
            "reasons": explain.reasons_from(explained["drivers"][i]),
            "factors": explained["drivers"][i],
            "keyFactors": explained["keyFactors"][i],
        })
    driver_rows.sort(key=lambda item: item["expectedPosition"])
    constructor_rows = _constructor_rows(frame, summary, fantasy_block, colors, names,
                                         explained["constructors"])
    payload = {
        "generatedAt": _now(),
        "model": dict(model_meta, backtest=backtest_summary or {}),
        "race": {
            "season": int(race["season"]),
            "round": int(race["round"]),
            "raceName": race["raceName"],
            "circuitId": race["circuitId"],
            "circuitName": circuit["circuitName"],
            "country": circuit["country"],
            "date": _race_date(race),
            "hasSprint": bool(race["hasSprint"]),
            "stage": forecast.stage,
            "inputsUsed": forecast.inputs_used,
        },
        "drivers": driver_rows,
        "constructors": constructor_rows,
        "championship": _championship_block(forecast.championship),
    }
    return payload


def actual_block(history, frame: pd.DataFrame, race_id: int) -> dict:
    """What really happened, for history files."""
    events = history.events[history.events["raceId"] == race_id]
    rows = []
    for record in events.sort_values("finish").itertuples(index=False):
        rows.append({
            "driverId": record.driverId,
            "constructorId": record.constructorId,
            "grid": _int_or_none(record.grid_raw),
            "position": int(record.finish),
            "classified": bool(record.classified),
            "dnf": bool(record.dnf),
            "points": float(record.points),
        })
    season = race_id // 100
    round_number = race_id % 100
    fantasy_actual = {}
    if season >= 2023:
        actual = fantasy_history.actual_points(season, round_number)
        for record in actual.itertuples(index=False):
            key = record.driverId if record.kind == "driver" else record.constructorId
            fantasy_actual[f"{record.kind}:{key}"] = float(record.points)
    winner = rows[0]["driverId"] if rows else None
    podium = [row["driverId"] for row in rows[:3]]
    return {"winner": winner, "podium": podium, "results": rows, "fantasyPoints": fantasy_actual}


def fantasy_payload(forecast, assets: "AssetBook", rules: dict, horizon: list[dict],
                    history) -> dict:
    """fantasy.json: per asset summaries, joint scenarios from the same worlds, horizon."""
    race = history.races.loc[forecast.race_id]
    colors = data.team_colors_2026()
    names = _constructor_names()
    sims = forecast.fantasy_sims
    frame = forecast.frame
    entries = []
    columns = []
    for i, row in frame.iterrows():
        driver = _driver_info(row["driverId"])
        info = assets.lookup("driver", row["driverId"])
        entry = _asset_entry(row["driverId"], "driver", info, driver["name"],
                             row["constructorId"], colors, sims.driver_points[:, i],
                             _component_column(sims.driver_components, i), assets.season)
        entries.append(entry)
        columns.append(sims.driver_points[:, i])
    for t, team in enumerate(sims.teams):
        info = assets.lookup("constructor", team)
        entry = _asset_entry(team, "constructor", info, names.get(team, team), team, colors,
                             sims.constructor_points[:, t],
                             _component_column(sims.constructor_components, t), assets.season)
        entries.append(entry)
        columns.append(sims.constructor_points[:, t])
    matrix = np.stack(columns, axis=1)[:SCENARIO_COUNT]
    scenario_points = np.round(matrix, 1).tolist()
    race_matrix = np.concatenate([sims.driver_race, sims.constructor_race], axis=1)
    negative_matrix = np.concatenate([sims.driver_negative, sims.constructor_negative], axis=1)
    scenario_race = np.round(race_matrix[:SCENARIO_COUNT], 1).tolist()
    scenario_negative = np.round(negative_matrix[:SCENARIO_COUNT], 1).tolist()
    return {
        "generatedAt": _now(),
        "season": int(race["season"]),
        "round": int(race["round"]),
        "raceName": race["raceName"],
        "hasSprint": bool(race["hasSprint"]),
        "stage": forecast.stage,
        "rules": rules,
        "assets": entries,
        "scenarios": {"n": len(scenario_points), "points": scenario_points,
                      "race": scenario_race, "negative": scenario_negative},
        "horizon": horizon,
    }


class AssetBook:
    """Fantasy prices and recent points per asset for one round (empty before 2023)."""

    def __init__(self, season: int, round_number: int):
        self.season = season
        self.round = round_number
        prices = fantasy_history.price_table()
        rows = prices[(prices["season"] == season) & (prices["round"] == round_number)]
        self.rows = rows.sort_values("active", ascending=False)
        points_path = paths.processed("fantasy_points")
        points = pd.read_parquet(points_path)
        before = points[(points["season"] == season) & (points["round"] < round_number)]
        self.points = before[before["active"].fillna(True).astype(bool)]

    def lookup(self, kind: str, asset_id: str) -> dict | None:
        key = "driverId" if kind == "driver" else "constructorId"
        match = self.rows[(self.rows["kind"] == kind) & (self.rows[key] == asset_id)]
        if not len(match):
            return None
        first = match.iloc[0]
        # 2024 and 2025 come from the community dataset without fantasy ids: match on the
        # driver or constructor instead (before 2026-10-15 their recent points were empty)
        if pd.notna(first["fantasyId"]):
            history_rows = self.points[self.points["fantasyId"] == first["fantasyId"]]
        else:
            same_kind = self.points[self.points["kind"] == kind]
            history_rows = same_kind[same_kind[key] == asset_id]
        previous = history_rows.sort_values("round")["points"].tolist()
        return {"fantasyId": str(first["fantasyId"]), "price": float(first["price"]),
                "previous": previous, "name": first["fantasyName"]}


def write_json(path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=_default)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def fantasy_rules_block() -> dict:
    path = paths.FANTASY_RAW / "rules_2026.json"
    rules = json.loads(path.read_text(encoding="utf-8"))
    keys = ("season", "team", "chips_and_multipliers", "price_change", "qualifying", "sprint",
            "race")
    return {key: rules.get(key) for key in keys}


# ----------------------------------------------------------------------------------------------
# helpers


def _fantasy_blocks(forecast, assets: AssetBook) -> dict:
    blocks = {"drivers": {}, "constructors": {}}
    sims = forecast.fantasy_sims
    if sims is None:
        return blocks
    season = assets.season
    frame = forecast.frame
    for i, driver_id in enumerate(frame["driverId"]):
        info = assets.lookup("driver", driver_id)
        blocks["drivers"][driver_id] = _fantasy_summary(sims.driver_points[:, i], info, season)
    for t, team in enumerate(sims.teams):
        info = assets.lookup("constructor", team)
        blocks["constructors"][team] = _fantasy_summary(sims.constructor_points[:, t], info,
                                                        season)
    return blocks


def _fantasy_summary(points: np.ndarray, info: dict | None, season: int) -> dict:
    price = info["price"] if info else None
    previous = info["previous"] if info else []
    change = fantasy.price_change_distribution(points, price, previous, season) if info else {
        "expected": None, "probs": {}}
    return {
        "price": price,
        "expectedPoints": round(float(points.mean()), 2),
        "p10": round(float(np.percentile(points, 10)), 1),
        "p90": round(float(np.percentile(points, 90)), 1),
        "expectedPriceChange": None if change["expected"] is None else round(change["expected"], 3),
        "priceChangeProbs": {k: round(v, 4) for k, v in change["probs"].items()},
    }


def _asset_entry(asset_id, kind, info, name, constructor_id, colors, points, components,
                 season):
    price = info["price"] if info else None
    previous = info["previous"] if info else []
    change = fantasy.price_change_distribution(points, price, previous, season) if info else {
        "expected": None, "probs": {}}
    breakdown = {key: round(float(values.mean()), 2) for key, values in components.items()}
    return {
        "id": asset_id,
        "kind": kind,
        "fantasyId": info["fantasyId"] if info else None,
        "name": name,
        "constructorId": constructor_id,
        "teamColor": colors.get(constructor_id, "#888888"),
        "price": price,
        "expectedPoints": round(float(points.mean()), 2),
        "p10": round(float(np.percentile(points, 10)), 1),
        "p90": round(float(np.percentile(points, 90)), 1),
        "pNegative": round(float((points < 0).mean()), 4),
        "breakdown": breakdown,
        "expectedPriceChange": None if change["expected"] is None else round(change["expected"], 3),
        "priceChangeProbs": {k: round(v, 4) for k, v in change["probs"].items()},
    }


def _component_column(components: dict, index: int) -> dict:
    return {key: values[:, index] for key, values in components.items()}


def _constructor_rows(frame, summary, fantasy_block, colors, names, factors) -> list:
    rows = []
    for team in dict.fromkeys(frame["constructorId"]):
        members = np.where(frame["constructorId"].to_numpy() == team)[0]
        expected = float(summary["expectedPoints"][members].sum())
        rows.append({
            "constructorId": team,
            "name": names.get(team, team),
            "teamColor": colors.get(team, "#888888"),
            "expectedPoints": round(expected, 3),
            "fantasy": fantasy_block["constructors"].get(team),
            "reasons": explain.reasons_from(factors.get(team, [])),
            "factors": factors.get(team, []),
        })
    rows.sort(key=lambda item: -item["expectedPoints"])
    return rows


def _championship_block(result: dict | None) -> dict | None:
    if result is None:
        return None
    drivers = []
    for driver_id, title, points in zip(result["driverIds"], result["driver_title"],
                                        result["driver_points"]):
        drivers.append({"driverId": driver_id, "pTitle": round(float(title), 4),
                        "expectedFinalPoints": round(float(points), 1)})
    drivers.sort(key=lambda item: -item["expectedFinalPoints"])
    constructors = []
    for team, title, points in zip(result["teams"], result["team_title"], result["team_points"]):
        constructors.append({"constructorId": str(team), "pTitle": round(float(title), 4),
                             "expectedFinalPoints": round(float(points), 1)})
    constructors.sort(key=lambda item: -item["expectedFinalPoints"])
    return {"drivers": drivers, "constructors": constructors,
            "remainingRounds": int(result["remaining"])}


def _driver_info(driver_id: str) -> dict:
    drivers = data.load_core()["drivers"].set_index("driverId")
    if driver_id not in drivers.index:
        return {"code": None, "name": driver_id}
    row = drivers.loc[driver_id]
    code = row["code"] if isinstance(row["code"], str) else None
    return {"code": code, "name": row["fullName"]}


def _constructor_names() -> dict:
    constructors = data.load_core()["constructors"]
    return dict(zip(constructors["constructorId"], constructors["name"]))


def _race_date(race) -> str:
    utc = race.get("raceUtc")
    if utc is not None and utc == utc:
        return pd.Timestamp(utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return pd.Timestamp(race["date"]).strftime("%Y-%m-%d")


def _int_or_none(value):
    if value is None or value != value:
        return None
    return int(value)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _default(value):
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, np.ndarray):
        return value.tolist()
    raise TypeError(f"not serialisable: {type(value)}")
