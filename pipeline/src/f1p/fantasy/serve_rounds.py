"""Export round-aligned fantasy prices and points for the site: data/serve/fantasy_rounds.json.

`uv run python -m f1p.fantasy.serve_rounds [--season 2026]` (from v2/pipeline). `f1p.fantasy.update`
runs it after rebuilding the processed tables, so every refresh rewrites the file.

One record per round and game asset (fantasyId; a driver who changed seats mid-season has
two assets with the same driverId): the price going into the round, the official points it scored
(null when the round is not scored yet), whether the asset was active and the share of teams that
picked it. The site uses it for the fantasy market (latest round), the price change thresholds
(last active gamedays) and the hindsight best teams.
"""

import argparse
import json
import math

import pandas as pd

from f1p.paths import SERVE_DIR, processed_path

OUTPUT_NAME = "fantasy_rounds.json"


def build(season: int | None = None) -> dict:
    prices = pd.read_parquet(processed_path("fantasy_prices"))
    points = pd.read_parquet(processed_path("fantasy_points"))
    chosen = season if season is not None else int(prices["season"].max())
    payload = rounds_payload(prices[prices["season"] == chosen], points[points["season"] == chosen], chosen)
    SERVE_DIR.mkdir(parents=True, exist_ok=True)
    path = SERVE_DIR / OUTPUT_NAME
    text = json.dumps(payload, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    return {"season": chosen, "rounds": len(payload["rounds"]), "path": str(path)}


def rounds_payload(prices: pd.DataFrame, points: pd.DataFrame, season: int) -> dict:
    keyed_points = {}
    for row in points.itertuples(index=False):
        keyed_points[(int(row.round), str(row.fantasyId))] = row
    rounds = []
    for round_number, group in prices.groupby("round"):
        assets = []
        for row in group.itertuples(index=False):
            identifier = asset_id(row)
            if identifier is None:
                continue
            scored = keyed_points.get((int(round_number), str(row.fantasyId)))
            assets.append(asset_record(row, identifier, scored))
        assets.sort(key=lambda a: (a["kind"], a["id"]))
        rounds.append({"round": int(round_number), "assets": assets})
    return {"season": season, "rounds": rounds}


def asset_record(price_row, identifier: str, scored) -> dict:
    points_value = None if scored is None else number_or_none(scored.points)
    active = bool(price_row.active) if scored is None else bool(scored.active)
    return {
        "id": identifier,
        "fantasyId": str(price_row.fantasyId),
        "kind": price_row.kind,
        "constructorId": price_row.constructorId,
        "price": number_or_none(price_row.price),
        "points": points_value,
        "active": active,
        "selectedPct": number_or_none(price_row.selectedPct),
    }


def asset_id(row) -> str | None:
    value = row.driverId if row.kind == "driver" else row.constructorId
    return value if isinstance(value, str) and value else None


def number_or_none(value) -> float | None:
    if value is None:
        return None
    number = float(value)
    return None if math.isnan(number) else number


def main() -> None:
    parser = argparse.ArgumentParser(description="Export round-aligned fantasy history for the site")
    parser.add_argument("--season", type=int, default=None, help="season to export (default: latest)")
    args = parser.parse_args()
    summary = build(args.season)
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
