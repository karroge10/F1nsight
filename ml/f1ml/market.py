"""Polymarket race winner prices, pooled into the forecast's win chances.

    uv run python -m f1ml.market            # the next race's prices, as the forecast would use them

`predict` reads the open "<Grand Prix>: Driver Winner" event of the race (public Gamma API, no
login) and pools its prices with the model's own win chances (`pool`, logarithmic pooling).
`forecast.forecast_race` then moves the race strengths until the simulated win chances match the
pooled ones, so podium, points, fantasy and title odds all follow the same worlds.

The model's weight per stage comes from the market experiment (scripts/exp_market,
scripts/exp_combo: weights refitted race by race on earlier races only, 2024 to 2026 R16). Its
final values were about 0.2 before the weekend and 0.35 after practice and after qualifying: the
market knows news, upgrades and paddock talk the model cannot see. With the rating features the
pooled forecast gave the real winner 16.0% / 19.4% / 30.5% (geometric mean, 64 races, the races
without a market keep the model) against 14.9% / 18.6% / 30.0% for the model alone.

Every fetch is archived in data/raw/polymarket/<raceId>/<utc time>.json, so the pooling can be
scored on races the experiment never saw. A failed fetch, a missing event or a field the event
does not cover leaves the forecast as the model's own.
"""

from __future__ import annotations

import json
import unicodedata
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from f1ml import paths

GAMMA_EVENTS = "https://gamma-api.polymarket.com/events"
F1_TAG = 435
OURS_WEIGHT = {"pre-weekend": 0.2, "post-practice": 0.35, "post-qualifying": 0.35}
ARCHIVE_DIR = paths.RAW_DIR / "polymarket"
TIMEOUT_S = 30
PROBABILITY_FLOOR = 1e-6
MAX_PRICE_SPREAD = 0.05
# Share of the field that must have its own price; the rest split the "Other" price, or get the
# smallest listed price each when the event has no "Other" outcome.
MIN_PRICED_SHARE = 0.8


@dataclass
class MarketPrices:
    event_slug: str
    fetched_at: str
    volume: float
    probabilities: np.ndarray  # aligned with the driver ids passed in, sums to 1
    priced: int  # drivers with their own price


def main() -> None:
    from f1ml import data
    races = pd.read_parquet(paths.processed("races"))
    results = pd.read_parquet(paths.processed("results"))
    upcoming = races[~races["raceId"].isin(results["raceId"])].sort_values("raceId")
    race = upcoming.iloc[0]
    drivers = data.load_core()["drivers"].set_index("driverId")
    entrants = results[results["season"] == race["season"]]["driverId"].unique()
    names = drivers["fullName"].to_dict()
    race_date = str(race["date"])[:10]
    prices = winner_prices(int(race["raceId"]), race["raceName"], race_date, list(entrants), names,
                           archive=False)
    if prices is None:
        print(f"{race['raceName']}: no usable winner market")
        return
    print(f"{race['raceName']}: {prices.event_slug}, volume ${prices.volume:,.0f}, "
          f"{prices.priced} of {len(entrants)} drivers priced")
    order = np.argsort(-prices.probabilities)
    for index in order[:10]:
        print(f"  {entrants[index]:20} {prices.probabilities[index]:.3f}")


def winner_prices(race_id: int, race_name: str, race_date: str, driver_ids: list[str],
                  names: dict, archive: bool = True) -> MarketPrices | None:
    """The race's winner market as probabilities over `driver_ids`, or None.

    race_date: YYYY-MM-DD of the Grand Prix. names: driverId -> full name.
    """
    try:
        event = _find_event(race_name, race_date)
    except (OSError, ValueError) as error:
        print(f"market: fetch failed ({error}); forecast stays the model's own")
        return None
    if event is None:
        return None
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if archive:
        _archive(race_id, fetched_at, event)
    raw, other = _driver_prices(event, driver_ids, names)
    probabilities = _complete_field(raw, other, len(driver_ids))
    if probabilities is None:
        print(f"market: {event['slug']} prices only {len(raw)} of {len(driver_ids)} drivers")
        return None
    volume = float(event.get("volume") or 0.0)
    return MarketPrices(event["slug"], fetched_at, volume, probabilities, len(raw))


def pool(ours: np.ndarray, market: np.ndarray, ours_weight: float) -> np.ndarray:
    """Logarithmic pool: ours^w * market^(1-w), normalised."""
    ours = np.maximum(ours, PROBABILITY_FLOOR)
    market = np.maximum(market, PROBABILITY_FLOOR)
    values = ours ** ours_weight * market ** (1.0 - ours_weight)
    return values / values.sum()


# ----------------------------------------------------------------------------------------------
# helpers


def _find_event(race_name: str, date: str) -> dict | None:
    """The open main-race winner event for the race (slug f1-<name>-winner-<race date>)."""
    name = _normalize(race_name).replace(" ", "-")
    slug = f"f1-{name}-winner-{date}"
    events = _get({"slug": slug})
    if events:
        return events[0]
    # Older or renamed slugs: search the open F1 events for a winner event ending soon after.
    candidates = _get({"tag_id": F1_TAG, "closed": "false", "limit": 200})
    race_day = pd.Timestamp(date, tz="UTC")
    for event in candidates:
        title = _normalize(event.get("title", ""))
        if "driver winner" not in title or "sprint" in title:
            continue
        end = pd.Timestamp(event.get("endDate"))
        if race_day <= end <= race_day + pd.Timedelta(days=10):
            return event
    return None


def _get(params: dict) -> list:
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(f"{GAMMA_EVENTS}?{query}",
                                     headers={"User-Agent": "f1nsight-forecast"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
        body = response.read().decode("utf-8")
    data = json.loads(body)
    if not isinstance(data, list):
        raise ValueError("unexpected Gamma response")
    return data


def _driver_prices(event: dict, driver_ids: list[str], names: dict):
    """{index in driver_ids: price of Yes} and the "Other" price (or None)."""
    surnames = {}
    for index, driver_id in enumerate(driver_ids):
        full_name = _normalize(names.get(driver_id, driver_id))
        surnames[index] = full_name.split()[-1]
    prices = {}
    other = None
    for market in event.get("markets", []):
        if market.get("closed"):
            continue
        price = _yes_price(market)
        if price is None:
            continue
        label = _normalize(market.get("groupItemTitle") or market.get("question") or "")
        if label == "other":
            other = price
            continue
        matches = [index for index, surname in surnames.items() if surname in label.split()]
        if len(matches) == 1:
            prices[matches[0]] = price
    return prices, other


def _yes_price(market: dict) -> float | None:
    """Displayed price of the Yes outcome (the order book midpoint, or the last trade when the
    spread is wide)."""
    outcomes = market.get("outcomes")
    values = market.get("outcomePrices")
    if not outcomes or not values:
        return None
    outcomes = json.loads(outcomes) if isinstance(outcomes, str) else outcomes
    values = json.loads(values) if isinstance(values, str) else values
    if "Yes" not in outcomes:
        return None
    try:
        bid = float(market.get("bestBid") or 0.0)
        ask = float(market["bestAsk"]) if market.get("bestAsk") is not None else 1.0
        price = float(values[outcomes.index("Yes")])
    except (TypeError, ValueError, IndexError):
        return None
    if not all(np.isfinite(value) for value in (bid, ask, price)):
        return None
    if not 0 <= bid <= price <= ask <= 1 or ask - bid > MAX_PRICE_SPREAD:
        return None
    return price if price > 0 else None


def _complete_field(prices: dict, other: float | None, field: int) -> np.ndarray | None:
    if field == 0 or len(prices) < MIN_PRICED_SHARE * field:
        return None
    prices = dict(prices)
    missing = [index for index in range(field) if index not in prices]
    if missing:
        share = other / len(missing) if other else min(prices.values())
        for index in missing:
            prices[index] = share
    values = np.array([prices[index] for index in range(field)], dtype=float)
    return values / values.sum()


def _archive(race_id: int, fetched_at: str, event: dict) -> None:
    folder = ARCHIVE_DIR / str(race_id)
    folder.mkdir(parents=True, exist_ok=True)
    stamp = fetched_at.replace(":", "").replace("-", "")
    target = folder / f"{stamp}.json"
    text = json.dumps(event, ensure_ascii=False)
    target.write_text(text, encoding="utf-8")


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", str(text))
    text = text.encode("ascii", "ignore").decode("ascii")
    return text.lower().replace(".", "").strip()


if __name__ == "__main__":
    main()
