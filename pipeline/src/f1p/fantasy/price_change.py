"""F1 Fantasy price change rule (2025 and 2026 game), reverse engineered.

After each gameday the game rates every active asset on points per million (PPM):

    ppm = mean(points over the asset's last min(3, n) active gamedays) / current price

and moves the price by a fixed step for its rating and price tier:

    rating     ppm            tier A (price >= 18.5)   tier B (price < 18.5)
    great      >= 1.20        +0.3                     +0.6
    good       0.90 .. 1.19   +0.1                     +0.2
    poor       0.61 .. 0.89   -0.1                     -0.2
    terrible   <= 0.60        -0.3                     -0.6

(PPM rounded to 2 decimals; the exact boundary handling is fitted, not published)

clamped to [floor, ceiling] (2026: 3.0 to 34.0; 2025: floor 4.5 and no ceiling, McLaren
reached 36.1). Inactive assets keep their price. Reproduces about 99% of 2025 and 2026
observed changes (see f1p.fantasy.validate). The 2023/2024 game also used transfer activity and is not
reproducible from points, so `price_change` raises for those seasons.
"""

from dataclasses import dataclass

TIER_SPLIT = 18.5
WINDOW = 3
THRESHOLDS = ((1.2, "great"), (0.9, "good"), (0.6, "poor"))
STEPS = {
    "A": {"great": 0.3, "good": 0.1, "poor": -0.1, "terrible": -0.3},
    "B": {"great": 0.6, "good": 0.2, "poor": -0.2, "terrible": -0.6},
}


@dataclass(frozen=True)
class PriceChange:
    rating: str
    ppm: float
    change: float
    new_price: float


def price_change(price: float, recent_points: list[float], season: int = 2026,
                 active: bool = True) -> PriceChange:
    """Price change after a gameday.

    price: the asset price going into the gameday just scored.
    recent_points: official gameday totals of the asset's active gamedays, oldest
    first, ending with the gameday just scored (only the last 3 are used).
    """
    if season < 2025:
        raise ValueError("price changes before 2025 depended on transfers; not modelled")
    if not active or not recent_points:
        return PriceChange(rating="inactive", ppm=0.0, change=0.0, new_price=price)
    ppm = points_per_million(price, recent_points)
    rating = rate(ppm)
    tier = tier_of(price)
    step = STEPS[tier][rating]
    floor = price_floor(season)
    ceiling = price_ceiling(season)
    raised = max(price + step, floor)
    capped = min(raised, ceiling)
    new_price = round(capped, 1)
    change = round(new_price - price, 1)
    return PriceChange(rating=rating, ppm=ppm, change=change, new_price=new_price)


def change_for_points(price: float, previous_points: list[float], season: int = 2026) -> dict:
    """Points needed in the next gameday for each rating, given the earlier window.

    previous_points: active gameday totals before the next gameday (oldest first).
    Returns {rating: minimum points} for 'great', 'good', 'poor'; below 'poor' is
    'terrible'. Useful to turn a predicted points distribution into price change
    probabilities.
    """
    window = list(previous_points[-(WINDOW - 1):])
    count = len(window) + 1
    already = sum(window)
    needed = {}
    for threshold, rating in THRESHOLDS:
        needed[rating] = threshold * price * count - already
    return needed


def points_per_million(price: float, recent_points: list[float]) -> float:
    window = recent_points[-WINDOW:]
    mean_points = sum(window) / len(window)
    return mean_points / price


def rate(ppm: float) -> str:
    """Boundaries fitted on 2025/2026: PPM rounded to 2 decimals, 1.20 is great, 0.60 terrible."""
    rounded = round(ppm + 1e-9, 2)
    if rounded >= 1.2:
        return "great"
    if rounded >= 0.9:
        return "good"
    if rounded > 0.6:
        return "poor"
    return "terrible"


def tier_of(price: float) -> str:
    return "A" if price >= TIER_SPLIT else "B"


def price_floor(season: int) -> float:
    return 3.0 if season >= 2026 else 4.5


def price_ceiling(season: int) -> float:
    """34.0 cap observed in 2026 (Mercedes 33.8 -> 34.0); none in 2025."""
    return 34.0 if season >= 2026 else float("inf")
