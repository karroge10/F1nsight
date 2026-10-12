"""SYNTHETIC data/predictions/fantasy.json for building and testing the fantasy engine.

This is NOT a model forecast. It exists so the TypeScript fantasy engine and the site can be
built and tested independently of `f1ml.predict`. The payload follows the SPEC fantasy
contract exactly and is marked `"synthetic": true`.

How the worlds are drawn (simple, but with the correlations the optimiser must handle):
- pace = recent 2026 finishing positions (recent rounds weighted more);
- each world adds a shared team shock (teammates and their constructor move together), a
  driver shock for qualifying and a correlated one for the race, and a "chaos" flag (10% of
  worlds) with more retirements;
- qualifying, sprint and race orders follow from pace plus noise; retirements are random;
- overtakes, fastest lap, Driver of the Day and pit stop points are drawn from 2026 averages;
- every world is scored with the official reference rules (f1p.fantasy.scoring) and prices
  move with the reverse engineered PPM rule (f1p.fantasy.price_change).

Besides the contract fields, `scenarios` carries two optional matrices the engine uses when
present: `negative` (sum of the negative scoring items, for the No Negative chip, which
clamps every scoring category at zero) and `race` (Grand Prix points only, for Final Fix).

Run: cd v2/ml && uv run python scripts/synthetic_fantasy.py [--out PATH] [--n 2000]
Default output: data/predictions/fantasy.synthetic.json (pass --out to write elsewhere).
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

V2 = Path(__file__).resolve().parents[2]
PIPELINE_SRC = str(V2 / "pipeline" / "src")
sys.path.insert(0, PIPELINE_SRC)

from f1p.fantasy import price_change as pc  # noqa: E402
from f1p.fantasy import scoring  # noqa: E402

PROCESSED = V2 / "data" / "processed"
RAW_RULES = V2 / "data" / "raw" / "fantasy" / "rules_2026.json"
DEFAULT_OUT = str(V2 / "data" / "predictions" / "fantasy.synthetic.json")
SEASON = 2026
ROUND = 17
HORIZON = 3
CHAOS_SHARE = 0.10
TEAM_COLORS = {
    "mercedes": "#27F4D2", "ferrari": "#E8002D", "mclaren": "#FF8000", "red_bull": "#3671C6",
    "rb": "#6692FF", "williams": "#64C4FF", "aston_martin": "#229971", "alpine": "#FF87BC",
    "haas": "#B6BABD", "audi": "#00E701", "cadillac": "#C0A062",
}
COMPONENTS = ("qualifying", "race", "sprint", "positionsGained", "overtakes", "fastestLap",
              "dotd", "pitStops", "dnfPenalty")
CONTRACT_RULE_KEYS = ("season", "team", "chips_and_multipliers", "price_change", "qualifying",
                      "sprint", "race")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--n", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=17)
    args = parser.parse_args()
    payload = build(args.n, args.seed)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    out.write_text(text, encoding="utf-8")
    size_kb = len(text) // 1024
    asset_count = len(payload["assets"])
    print("wrote", out, size_kb, "KB,", asset_count, "assets")


def build(n: int, seed: int) -> dict:
    races = pd.read_parquet(PROCESSED / "races.parquet")
    races = races[races["season"] == SEASON].set_index("round")
    book = asset_book()
    pace = pace_table(book)
    pit = pit_samples()
    rng = np.random.default_rng(seed)

    race = races.loc[ROUND]
    has_sprint = bool(race["hasSprint"])
    sims = simulate(book, pace, pit, n, has_sprint, rng)
    assets = [asset_entry(row, sims, i) for i, row in enumerate(book)]
    horizon = horizon_block(book, pace, pit, races, sims, rng)
    rules_text = RAW_RULES.read_text(encoding="utf-8")
    rules = json.loads(rules_text)
    generated = datetime.now(timezone.utc)
    return {
        "synthetic": True,
        "syntheticNote": "Synthetic stand-in built by ml/scripts/synthetic_fantasy.py, not a model forecast.",
        "generatedAt": generated.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "season": SEASON, "round": ROUND, "raceName": race["raceName"],
        "hasSprint": has_sprint, "stage": "pre-weekend",
        "rules": {key: rules.get(key) for key in CONTRACT_RULE_KEYS},
        "assets": assets,
        "scenarios": {
            "n": n,
            "points": rounded_rows(sims["total"]),
            "negative": rounded_rows(sims["negative"]),
            "race": rounded_rows(sims["race"]),
        },
        "horizon": horizon,
    }


def asset_book() -> list[dict]:
    prices = pd.read_parquet(PROCESSED / "fantasy_prices.parquet")
    points = pd.read_parquet(PROCESSED / "fantasy_points.parquet")
    now = prices[(prices["season"] == SEASON) & (prices["round"] == ROUND) & prices["active"]]
    past = points[(points["season"] == SEASON) & (points["round"] < ROUND) & points["active"]]
    book = []
    for kind in ("driver", "constructor"):
        rows = now[now["kind"] == kind].sort_values("price", ascending=False)
        for row in rows.itertuples():
            history = past[past["fantasyId"] == row.fantasyId].sort_values("round")
            asset_id = row.driverId if kind == "driver" else row.constructorId
            book.append({
                "id": asset_id, "kind": kind, "fantasyId": str(row.fantasyId),
                "name": row.fantasyName, "constructorId": row.constructorId,
                "price": float(row.price), "previous": history["points"].tolist(),
            })
    return book


def pace_table(book: list[dict]) -> dict:
    """Pace score per driver (higher is faster): weighted mean finishing position, negated."""
    results = pd.read_parquet(PROCESSED / "results.parquet")
    results = results[(results["season"] == SEASON) & (results["round"] < ROUND)]
    pace = {}
    for asset in book:
        if asset["kind"] != "driver":
            continue
        rows = results[results["driverId"] == asset["id"]].sort_values("round")
        if rows.empty:
            pace[asset["id"]] = -16.0
            continue
        rounds = rows["round"].to_numpy()
        weights = 0.85 ** (rounds.max() - rounds)
        orders = rows["positionOrder"].to_numpy()
        mean_order = np.average(orders, weights=weights)
        pace[asset["id"]] = -float(mean_order)
    return pace


def pit_samples() -> dict:
    points = pd.read_parquet(PROCESSED / "fantasy_points.parquet")
    rows = points[(points["season"] == SEASON) & (points["kind"] == "constructor")]
    values = rows["pit_band"].fillna(0) + rows["pit_fastest"].fillna(0) + rows["pit_world_record"].fillna(0)
    groups = values.groupby(rows["constructorId"])
    return {team: group.to_numpy() for team, group in groups}


def simulate(book, pace, pit, n, has_sprint, rng) -> dict:
    drivers = [a for a in book if a["kind"] == "driver"]
    field = len(drivers)
    count = len(book)
    driver_index = {a["id"]: i for i, a in enumerate(drivers)}
    base = np.array([pace[a["id"]] for a in drivers])
    team_of = [a["constructorId"] for a in drivers]
    team_ids = sorted(set(team_of))
    matrices = {name: np.zeros((n, count)) for name in ("total", "negative", "race", "qualifying", "sprint")}
    rules = scoring.rules_for(SEASON)
    no_pit = np.zeros(1)
    for world in range(n):
        chaos = rng.random() < CHAOS_SHARE
        team_shock = {t: rng.normal(0, 1.6) for t in team_ids}
        shocks = np.array([team_shock[t] for t in team_of])
        shared = base + shocks
        quali_noise = rng.normal(0, 1.8, field)
        race_extra = rng.normal(0, 2.0, field)
        race_noise = 0.6 * quali_noise + race_extra
        quali_order = np.argsort(-(shared + quali_noise))
        quali_pos = np.empty(field, dtype=int)
        quali_pos[quali_order] = np.arange(1, field + 1)
        sprint = None
        if has_sprint:
            sprint_extra = rng.normal(0, 1.5, field)
            sprint_score = shared + 0.6 * quali_noise + sprint_extra
            sprint = session(sprint_score, quali_pos, 0.03 + 0.05 * chaos, rng, 3.6, 5)
        race_score = shared + race_noise + 0.15 * (field - quali_pos) / 2
        race = session(race_score, quali_pos, 0.06 + 0.14 * chaos, rng, 5.5, 10)
        dotd = dotd_pick(race, rng)
        weekends = {}
        for asset in drivers:
            i = driver_index[asset["id"]]
            race_result = scoring.SessionResult(driver_of_the_day=(i == dotd), **race[i])
            sprint_result = scoring.SessionResult(**sprint[i]) if sprint else None
            position = int(quali_pos[i])
            weekends[asset["id"]] = scoring.DriverWeekend(quali_position=position, sprint=sprint_result,
                                                          race=race_result)
        for j, asset in enumerate(book):
            pit_points = 0.0
            if asset["kind"] == "driver":
                result = scoring.score_driver(weekends[asset["id"]], rules)
            else:
                members = [weekends[a["id"]] for a in drivers if a["constructorId"] == asset["id"]]
                result = scoring.score_constructor(members, rules, field_size=field)
                pit_values = pit.get(asset["id"], no_pit)
                drawn = rng.choice(pit_values)
                pit_points = float(drawn)
            race_points = result.race + pit_points
            matrices["total"][world, j] = result.qualifying + result.sprint + race_points
            matrices["race"][world, j] = race_points
            matrices["qualifying"][world, j] = result.qualifying
            matrices["sprint"][world, j] = result.sprint
            matrices["negative"][world, j] = negative_items(result.breakdown)
    return matrices


def session(score, grid_positions, dnf_rate, rng, overtake_mean, fastest_rank_pool) -> list[dict]:
    """One sprint or race: finish order from score, retirements, overtakes, fastest lap."""
    count = len(score)
    retired = rng.random(count) < dnf_rate
    order = np.argsort(-score)
    classified_order = [i for i in order if not retired[i]]
    finish = {driver: pos + 1 for pos, driver in enumerate(classified_order)}
    fastest_candidates = classified_order[:fastest_rank_pool]
    fastest = -1
    if fastest_candidates:
        picked = rng.choice(fastest_candidates)
        fastest = int(picked)
    out = []
    for i in range(count):
        grid = int(grid_positions[i])
        finished = finish.get(i, grid)
        gained = max(0, grid - finished)
        lam = max(0.3, overtake_mean * 0.6 + 0.5 * gained)
        overtakes = rng.poisson(lam)
        out.append({
            "grid": grid,
            "finish": finish.get(i),
            "classified": not retired[i],
            "fastest_lap": i == fastest,
            "overtakes": int(overtakes),
        })
    return out


def dotd_pick(race, rng) -> int:
    weights = []
    for entry in race:
        if not entry["classified"]:
            weights.append(0.05)
            continue
        gained = entry["grid"] - entry["finish"]
        weight = np.exp(0.25 * gained - 0.12 * entry["finish"])
        weights.append(weight)
    weights = np.array(weights)
    probabilities = weights / weights.sum()
    picked = rng.choice(len(race), p=probabilities)
    return int(picked)


def negative_items(breakdown: dict) -> float:
    """Sum of the negative scoring categories (a constructor's driver items are summed per category)."""
    negatives = [v for v in breakdown.values() if v < 0]
    return float(sum(negatives))


def asset_entry(asset, sims, j) -> dict:
    points = sims["total"][:, j]
    change = price_distribution(points, asset["price"], asset["previous"])
    breakdown = {name: 0.0 for name in COMPONENTS}
    for name in ("race", "qualifying", "sprint"):
        breakdown[name] = rounded_mean(sims[name][:, j], 2)
    negative = np.minimum(sims["negative"][:, j], 0)
    breakdown["dnfPenalty"] = rounded_mean(negative, 2)
    p10 = np.percentile(points, 10)
    p90 = np.percentile(points, 90)
    return {
        "id": asset["id"], "kind": asset["kind"], "fantasyId": asset["fantasyId"],
        "name": asset["name"], "constructorId": asset["constructorId"],
        "teamColor": TEAM_COLORS.get(asset["constructorId"], "#888888"),
        "price": asset["price"],
        "expectedPoints": rounded_mean(points, 2),
        "p10": rounded(p10, 1),
        "p90": rounded(p90, 1),
        "pNegative": rounded_mean(points < 0, 4),
        "breakdown": breakdown,
        "expectedPriceChange": round(change["expected"], 3),
        "priceChangeProbs": change["probs"],
        "recentPoints": asset["previous"][-2:],
    }


def price_distribution(points: np.ndarray, price: float, previous: list) -> dict:
    window = list(previous[-(pc.WINDOW - 1):])
    count = len(window) + 1
    already = np.sum(window)
    mean_points = (already + points) / count
    ppm = np.round(mean_points / price + 1e-9, 2)
    tier = pc.tier_of(price)
    steps = pc.STEPS[tier]
    change = np.select([ppm >= 1.2, ppm >= 0.9, ppm > 0.6],
                       [steps["great"], steps["good"], steps["poor"]], steps["terrible"])
    floor = pc.price_floor(SEASON)
    ceiling = pc.price_ceiling(SEASON)
    clipped = np.clip(price + change, floor, ceiling)
    new_price = np.round(clipped, 1)
    realised = np.round(new_price - price, 1)
    values, counts = np.unique(realised, return_counts=True)
    total = counts.sum()
    probs = {}
    for value, c in zip(values, counts):
        key = f"{value:+.1f}".replace("+0.0", "0.0").replace("-0.0", "0.0")
        probs[key] = rounded(c / total, 4)
    return {"expected": rounded_mean(realised, 6), "probs": probs}


def horizon_block(book, pace, pit, races, current, rng) -> list[dict]:
    """Expected points and price changes for the next rounds (smaller simulations)."""
    blocks = []
    prices = {a["id"]: a["price"] for a in book}
    previous = {a["id"]: list(a["previous"]) for a in book}
    last_points = {a["id"]: current["total"][:, j] for j, a in enumerate(book)}
    for offset in range(1, HORIZON + 1):
        round_number = ROUND + offset
        if round_number not in races.index:
            break
        # Every asset's points window moves on by the round before, at its expected value.
        for a in book:
            mean_points = rounded_mean(last_points[a["id"]], 6)
            change = price_distribution(last_points[a["id"]], prices[a["id"]], previous[a["id"]])
            prices[a["id"]] = round(prices[a["id"]] + change["expected"], 2)
            previous[a["id"]].append(mean_points)
        track = {}
        for a in book:
            if a["kind"] == "driver":
                shift = rng.normal(0, 1.2)
                track[a["id"]] = pace[a["id"]] + shift
        race = races.loc[round_number]
        has_sprint = bool(race["hasSprint"])
        sims = simulate(book, track, pit, 300, has_sprint, rng)
        expected, price_change = {}, {}
        for j, a in enumerate(book):
            points = sims["total"][:, j]
            last_points[a["id"]] = points
            expected[a["id"]] = rounded_mean(points, 2)
            change = price_distribution(points, prices[a["id"]], previous[a["id"]])
            price_change[a["id"]] = round(change["expected"], 3)
        blocks.append({"round": int(round_number), "raceName": race["raceName"],
                       "circuitId": race["circuitId"], "hasSprint": has_sprint,
                       "expectedPoints": expected, "expectedPriceChange": price_change})
    return blocks


def rounded(value, digits: int) -> float:
    number = float(value)
    return round(number, digits)


def rounded_mean(values: np.ndarray, digits: int) -> float:
    mean = float(values.mean())
    return round(mean, digits)


def rounded_rows(matrix: np.ndarray) -> list:
    rounded = np.round(matrix, 1)
    return rounded.tolist()


if __name__ == "__main__":
    main()
