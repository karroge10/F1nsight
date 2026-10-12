"""Pure F1 Fantasy scoring: points for a driver or constructor from one race weekend.

Rules follow data/raw/fantasy/rules_2026.json (official game rules, checked against
the official per session breakdowns). `rules_for(season)` returns the variant for
2023, 2024, 2025 and 2026; seasons before 2023 used another game and are not modelled.

Inputs are plain dataclasses so the functions work for real results (validation) and
for simulated finishing orders (predictions). Fields the results do not contain
(overtakes, driver of the day, pit stop times) are optional and score 0 when None.
"""

from dataclasses import dataclass, field, replace

QUALI_POINTS = (10, 9, 8, 7, 6, 5, 4, 3, 2, 1)
RACE_POINTS = (25, 18, 15, 12, 10, 8, 6, 4, 2, 1)
SPRINT_POINTS = (8, 7, 6, 5, 4, 3, 2, 1)


@dataclass(frozen=True)
class Rules:
    season: int
    quali_nc: int = -5
    quali_dsq_driver: int = -5
    quali_dsq_constructor_extra: int = -5
    sprint_nc: int = -10
    sprint_dsq_driver: int = -10
    sprint_dsq_constructor_extra: int = -10
    sprint_lost_cap: int = 10
    sprint_fastest_lap: int = 5
    race_nc: int = -20
    race_dsq_driver: int = -20
    race_dsq_constructor_extra: int = -10
    race_fastest_lap: int = 10
    dotd: int = 10
    overtake: int = 1
    pit_mode: str = "bands"  # "bands" (2025+) or "rank" (2023-2024)
    pit_bands: tuple = ((2.0, 20), (2.2, 10), (2.5, 5), (3.0, 2))
    pit_fastest_bonus: int = 5
    pit_world_record_bonus: int = 15
    pit_world_record_s: float = 1.80
    pit_rank_points: tuple = (10, 5, 3)
    progression: dict = field(default_factory=lambda: {
        "none_q2": -1, "one_q2": 1, "both_q2": 3, "one_q3": 5, "both_q3": 10,
    })


@dataclass(frozen=True)
class SessionResult:
    """One driver in one sprint or race.

    grid: effective starting position (pit lane starters already placed behind the
    last gridded car, see `effective_grid`). finish: classified position.
    """

    grid: int | None
    finish: int | None
    classified: bool = True
    disqualified: bool = False
    fastest_lap: bool = False
    overtakes: int | None = None
    driver_of_the_day: bool = False


@dataclass(frozen=True)
class DriverWeekend:
    """quali_position None means no time set / not classified in qualifying.

    quali_segment: deepest segment reached (1, 2 or 3); derived from the position
    when None, using the cut-offs for the field size.
    """

    quali_position: int | None
    quali_disqualified: bool = False
    quali_segment: int | None = None
    sprint: SessionResult | None = None
    race: SessionResult | None = None


@dataclass(frozen=True)
class DriverPoints:
    qualifying: int
    sprint: int
    race: int
    breakdown: dict

    @property
    def total(self) -> int:
        return self.qualifying + self.sprint + self.race


@dataclass(frozen=True)
class ConstructorPoints:
    qualifying: int
    sprint: int
    race: int
    breakdown: dict

    @property
    def total(self) -> int:
        return self.qualifying + self.sprint + self.race


def rules_for(season: int) -> Rules:
    """Scoring rules variant for a season (2023 onwards)."""
    if season < 2023:
        raise ValueError("seasons before 2023 used a different game; not modelled")
    base = Rules(season=season)
    if season >= 2026:
        return base
    if season == 2025:
        return replace(base, sprint_nc=-20, sprint_dsq_driver=-20)
    return replace(
        base,
        sprint_nc=-20,
        sprint_dsq_driver=-25,
        race_dsq_driver=-25,
        quali_dsq_driver=-15,
        quali_dsq_constructor_extra=0,
        sprint_dsq_constructor_extra=0,
        race_dsq_constructor_extra=0,
        pit_mode="rank",
    )


def score_driver(weekend: DriverWeekend, rules: Rules) -> DriverPoints:
    """Fantasy points of one driver for one race weekend."""
    breakdown: dict[str, int] = {}
    qualifying = _score_qualifying(weekend, rules, breakdown)
    sprint = 0
    if weekend.sprint is not None:
        sprint = _score_session(weekend.sprint, rules, breakdown, is_sprint=True)
    race = 0
    if weekend.race is not None:
        race = _score_session(weekend.race, rules, breakdown, is_sprint=False)
    return DriverPoints(qualifying=qualifying, sprint=sprint, race=race, breakdown=breakdown)


def score_constructor(
    drivers: list[DriverWeekend],
    rules: Rules,
    team_fastest_pit_s: float | None = None,
    race_fastest_pit_s: float | None = None,
    pit_rank_positions: list[int] | None = None,
    field_size: int = 22,
) -> ConstructorPoints:
    """Fantasy points of a constructor from its drivers' weekends and pit stops.

    team_fastest_pit_s: the team's fastest stationary stop in the Grand Prix.
    race_fastest_pit_s: fastest stop of the whole race (for the +5 bonus).
    pit_rank_positions: 2023-2024 only, the team's ranks among the race's fastest
    stops (e.g. [1, 3] when it had the fastest and third fastest).
    """
    driver_points = [score_driver(d, rules) for d in drivers]
    breakdown: dict[str, int] = {}
    qualifying = sum(p.qualifying for p in driver_points)
    sprint = sum(p.sprint for p in driver_points)
    race = sum(p.race for p in driver_points)
    race -= sum(p.breakdown.get("race_dotd", 0) for p in driver_points)

    progression = _progression_bonus(drivers, rules, field_size)
    breakdown["quali_progression"] = progression
    qualifying += progression

    dsq_quali = len([d for d in drivers if d.quali_disqualified])
    dsq_sprint = len([d for d in drivers if d.sprint is not None and d.sprint.disqualified])
    dsq_race = len([d for d in drivers if d.race is not None and d.race.disqualified])
    quali_extra = dsq_quali * rules.quali_dsq_constructor_extra
    sprint_extra = dsq_sprint * rules.sprint_dsq_constructor_extra
    race_extra = dsq_race * rules.race_dsq_constructor_extra
    qualifying += _put(breakdown, "quali_dsq_extra", quali_extra)
    sprint += _put(breakdown, "sprint_dsq_extra", sprint_extra)
    race += _put(breakdown, "race_dsq_extra", race_extra)

    pit = _pit_points(rules, team_fastest_pit_s, race_fastest_pit_s, pit_rank_positions)
    breakdown.update(pit)
    race += sum(pit.values())

    for points in driver_points:
        for key, value in points.breakdown.items():
            if key == "race_dotd":
                continue
            breakdown[f"drivers_{key}"] = breakdown.get(f"drivers_{key}", 0) + value
    return ConstructorPoints(qualifying=qualifying, sprint=sprint, race=race, breakdown=breakdown)


def effective_grid(grid_positions: dict[str, int | None]) -> dict[str, int]:
    """Place pit lane starters (grid 0 or None) behind the last gridded car.

    Pit lane starters keep their relative order by key insertion order.
    """
    gridded = {k: v for k, v in grid_positions.items() if v}
    grid_values = list(gridded.values())
    last = max(grid_values, default=0)
    result = dict(gridded)
    offset = 0
    for key, value in grid_positions.items():
        if value:
            continue
        offset += 1
        result[key] = last + offset
    return result


def quali_segment_from_position(position: int | None, field_size: int = 22) -> int | None:
    """Deepest qualifying segment for a classified position (Q3 top 10)."""
    if position is None:
        return None
    eliminated_per_segment = (field_size - 10) // 2
    q2_cut = 10 + eliminated_per_segment
    if position <= 10:
        return 3
    if position <= q2_cut:
        return 2
    return 1


def _score_qualifying(weekend: DriverWeekend, rules: Rules, breakdown: dict) -> int:
    if weekend.quali_disqualified:
        return _put(breakdown, "quali_dsq", rules.quali_dsq_driver)
    if weekend.quali_position is None:
        return _put(breakdown, "quali_nc", rules.quali_nc)
    points = _position_points(QUALI_POINTS, weekend.quali_position)
    return _put(breakdown, "quali_position", points)


def _score_session(result: SessionResult, rules: Rules, breakdown: dict, is_sprint: bool) -> int:
    prefix = "sprint" if is_sprint else "race"
    if result.disqualified:
        penalty = rules.sprint_dsq_driver if is_sprint else rules.race_dsq_driver
        return _put(breakdown, f"{prefix}_dsq", penalty)

    total = 0
    overtakes = (result.overtakes or 0) * rules.overtake
    total += _put(breakdown, f"{prefix}_overtakes", overtakes)

    if not result.classified or result.finish is None:
        penalty = rules.sprint_nc if is_sprint else rules.race_nc
        total += _put(breakdown, f"{prefix}_nc", penalty)
        return total

    table = SPRINT_POINTS if is_sprint else RACE_POINTS
    position_points = _position_points(table, result.finish)
    total += _put(breakdown, f"{prefix}_position", position_points)
    gained_lost = _gained_lost(result, rules, is_sprint)
    total += _put(breakdown, f"{prefix}_gained_lost", gained_lost)
    if result.fastest_lap:
        bonus = rules.sprint_fastest_lap if is_sprint else rules.race_fastest_lap
        total += _put(breakdown, f"{prefix}_fastest_lap", bonus)
    if result.driver_of_the_day and not is_sprint:
        total += _put(breakdown, "race_dotd", rules.dotd)
    return total


def _gained_lost(result: SessionResult, rules: Rules, is_sprint: bool) -> int:
    if result.grid is None or result.finish is None:
        return 0
    delta = result.grid - result.finish
    if is_sprint and delta < -rules.sprint_lost_cap:
        return -rules.sprint_lost_cap
    return delta


def _progression_bonus(drivers: list[DriverWeekend], rules: Rules, field_size: int) -> int:
    segments = []
    for driver in drivers:
        segment = driver.quali_segment
        if segment is None:
            segment = quali_segment_from_position(driver.quali_position, field_size)
        if driver.quali_disqualified:
            segment = 1
        segments.append(segment or 1)
    in_q3 = len([s for s in segments if s >= 3])
    in_q2 = len([s for s in segments if s >= 2])
    table = rules.progression
    if in_q3 >= 2:
        return table["both_q3"]
    if in_q3 == 1:
        return table["one_q3"]
    if in_q2 >= 2:
        return table["both_q2"]
    if in_q2 == 1:
        return table["one_q2"]
    return table["none_q2"]


def _pit_points(rules, team_fastest_s, race_fastest_s, rank_positions) -> dict:
    if rules.pit_mode == "rank":
        positions = rank_positions or []
        table = rules.pit_rank_points
        points = sum(table[p - 1] for p in positions if 1 <= p <= len(table))
        return {"pit_rank": points}
    if team_fastest_s is None:
        return {"pit_band": 0, "pit_fastest": 0, "pit_world_record": 0}
    band = 0
    for upper, points in rules.pit_bands:
        if team_fastest_s < upper:
            band = points
            break
    fastest = 0
    if race_fastest_s is not None and abs(team_fastest_s - race_fastest_s) < 1e-9:
        fastest = rules.pit_fastest_bonus
    record = rules.pit_world_record_bonus if team_fastest_s < rules.pit_world_record_s else 0
    return {"pit_band": band, "pit_fastest": fastest, "pit_world_record": record}


def _position_points(table: tuple, position: int) -> int:
    if 1 <= position <= len(table):
        return table[position - 1]
    return 0


def _put(breakdown: dict, key: str, value: int) -> int:
    if value:
        breakdown[key] = breakdown.get(key, 0) + value
    return value
