"""Refresh F1 Fantasy data: `uv run python -m f1p.fantasy.update` (from v2/pipeline).

1. re-fetch the running season's official feeds (prices, points, breakdowns),
2. re-fetch the running season's DHL pit stop data (free award pages),
3. optionally (--history) top up the historical archives (skips files on disk),
4. rebuild data/processed/fantasy_prices, fantasy_points, id_map_fantasy,
   fantasy_pitstops and fantasy_overtakes (the latter from processed OpenF1 tables;
   refresh those first with `uv run python -m f1p.openf1.download --refresh` and
   `uv run python -m f1p.openf1.process`),
5. export data/serve/fantasy_rounds.json for the site (`serve_rounds`),
6. optionally (--validate) re-run the scoring / price change validation.

Safe to run repeatedly: finished gamedays are not downloaded again except the
last two (stewards' corrections), and processed tables are rebuilt from raw files.
"""

import argparse
import json

from f1p.fantasy import dhl, history, official, overtakes, process, serve_rounds, validate


def update(include_history: bool = False, run_validation: bool = False, force: bool = False) -> dict:
    summary = {"official": official.fetch_current_season(force=force)}
    summary["dhl"] = dhl.fetch_all(refresh_current=True)
    if include_history:
        summary["history"] = history.fetch_all(refresh_current=True)
    summary["processed"] = process.build_all()
    pitstops = dhl.build_pitstops()
    summary["processed"]["fantasy_pitstops"] = len(pitstops)
    overtake_counts = overtakes.build()
    summary["processed"]["fantasy_overtakes"] = len(overtake_counts)
    summary["served"] = serve_rounds.build()
    if run_validation:
        report = validate.run()
        summary["validation"] = {
            "scoring_oracle": report["scoring"]["oracle"],
            "price_change": {s: r["match_rate"] for s, r in report["price_change"].items()},
        }
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh F1 Fantasy data")
    parser.add_argument("--history", action="store_true", help="also top up historical archives")
    parser.add_argument("--validate", action="store_true", help="re-run validation afterwards")
    parser.add_argument("--force", action="store_true", help="re-fetch every gameday feed")
    args = parser.parse_args()
    summary = update(include_history=args.history, run_validation=args.validate, force=args.force)
    print(json.dumps(summary, indent=1, default=str))


if __name__ == "__main__":
    main()
