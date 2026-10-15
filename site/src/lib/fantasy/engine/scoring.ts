// F1 Fantasy scoring for one driver or constructor and one race weekend. Exact port of
// pipeline/src/f1p/fantasy/scoring.py (checked for parity on real 2025 and 2026 weekends in
// scoring.test.ts). Breakdown keys match the Python reference.

export const QUALI_POINTS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
export const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

export interface ScoringRules {
  season: number;
  qualiNc: number;
  qualiDsqDriver: number;
  qualiDsqConstructorExtra: number;
  sprintNc: number;
  sprintDsqDriver: number;
  sprintDsqConstructorExtra: number;
  sprintLostCap: number;
  sprintFastestLap: number;
  raceNc: number;
  raceDsqDriver: number;
  raceDsqConstructorExtra: number;
  raceFastestLap: number;
  dotd: number;
  overtake: number;
  pitMode: "bands" | "rank";
  /** [upper bound in seconds (exclusive), points], fastest band first. */
  pitBands: [number, number][];
  pitFastestBonus: number;
  pitWorldRecordBonus: number;
  pitWorldRecordS: number;
  pitRankPoints: number[];
  progression: { noneQ2: number; oneQ2: number; bothQ2: number; oneQ3: number; bothQ3: number };
}

export interface SessionResult {
  /** Effective starting position (pit lane starters behind the last gridded car). */
  grid: number | null;
  finish: number | null;
  classified?: boolean;
  disqualified?: boolean;
  fastestLap?: boolean;
  overtakes?: number | null;
  driverOfTheDay?: boolean;
}

export interface DriverWeekend {
  /** null: no time set or not classified in qualifying. */
  qualiPosition: number | null;
  qualiDisqualified?: boolean;
  /** Deepest segment reached (1, 2, 3); derived from the position when missing. */
  qualiSegment?: number | null;
  sprint?: SessionResult | null;
  race?: SessionResult | null;
}

export interface WeekendPoints {
  qualifying: number;
  sprint: number;
  race: number;
  total: number;
  breakdown: Record<string, number>;
}

export interface PitInputs {
  teamFastestPitS?: number | null;
  raceFastestPitS?: number | null;
  /** 2023-2024 only: the team's ranks among the race's fastest stops. */
  pitRankPositions?: number[] | null;
}

const BASE_RULES: ScoringRules = {
  season: 2026,
  qualiNc: -5,
  qualiDsqDriver: -5,
  qualiDsqConstructorExtra: -5,
  sprintNc: -10,
  sprintDsqDriver: -10,
  sprintDsqConstructorExtra: -10,
  sprintLostCap: 10,
  sprintFastestLap: 5,
  raceNc: -20,
  raceDsqDriver: -20,
  raceDsqConstructorExtra: -10,
  raceFastestLap: 10,
  dotd: 10,
  overtake: 1,
  pitMode: "bands",
  pitBands: [
    [2.0, 20],
    [2.2, 10],
    [2.5, 5],
    [3.0, 2],
  ],
  pitFastestBonus: 5,
  pitWorldRecordBonus: 15,
  pitWorldRecordS: 1.8,
  pitRankPoints: [10, 5, 3],
  progression: { noneQ2: -1, oneQ2: 1, bothQ2: 3, oneQ3: 5, bothQ3: 10 },
};

/** Scoring rules variant for a season (2023 onwards). */
export function scoringRulesFor(season: number): ScoringRules {
  if (season < 2023) throw new Error("seasons before 2023 used a different game; not modelled");
  const base = { ...BASE_RULES, season };
  if (season >= 2026) return base;
  if (season === 2025) return { ...base, sprintNc: -20, sprintDsqDriver: -20 };
  return {
    ...base,
    sprintNc: -20,
    sprintDsqDriver: -25,
    raceDsqDriver: -25,
    qualiDsqDriver: -15,
    qualiDsqConstructorExtra: 0,
    sprintDsqConstructorExtra: 0,
    raceDsqConstructorExtra: 0,
    pitMode: "rank",
  };
}

/** Fantasy points of one driver for one race weekend. */
export function scoreDriver(weekend: DriverWeekend, rules: ScoringRules): WeekendPoints {
  const breakdown: Record<string, number> = {};
  const qualifying = scoreQualifying(weekend, rules, breakdown);
  let sprint = 0;
  if (weekend.sprint) sprint = scoreSession(weekend.sprint, rules, breakdown, true);
  let race = 0;
  if (weekend.race) race = scoreSession(weekend.race, rules, breakdown, false);
  return { qualifying, sprint, race, total: qualifying + sprint + race, breakdown };
}

/** Fantasy points of a constructor from its drivers' weekends and pit stops. */
export function scoreConstructor(
  drivers: DriverWeekend[],
  rules: ScoringRules,
  pit: PitInputs = {},
  fieldSize = 22,
): WeekendPoints {
  const driverPoints = drivers.map((d) => scoreDriver(d, rules));
  const breakdown: Record<string, number> = {};
  let qualifying = 0;
  let sprint = 0;
  let race = 0;
  for (const points of driverPoints) {
    qualifying += points.qualifying;
    sprint += points.sprint;
    race += points.race - (points.breakdown.race_dotd ?? 0);
  }

  const progression = progressionBonus(drivers, rules, fieldSize);
  breakdown.quali_progression = progression;
  qualifying += progression;

  const dsqQuali = drivers.filter((d) => d.qualiDisqualified).length;
  const dsqSprint = drivers.filter((d) => d.sprint?.disqualified).length;
  const dsqRace = drivers.filter((d) => d.race?.disqualified).length;
  qualifying += put(breakdown, "quali_dsq_extra", dsqQuali * rules.qualiDsqConstructorExtra);
  sprint += put(breakdown, "sprint_dsq_extra", dsqSprint * rules.sprintDsqConstructorExtra);
  race += put(breakdown, "race_dsq_extra", dsqRace * rules.raceDsqConstructorExtra);

  const pitPoints = pitStopPoints(rules, pit);
  for (const [key, value] of Object.entries(pitPoints)) {
    breakdown[key] = value;
    race += value;
  }

  for (const points of driverPoints) {
    for (const [key, value] of Object.entries(points.breakdown)) {
      if (key === "race_dotd") continue;
      const name = `drivers_${key}`;
      breakdown[name] = (breakdown[name] ?? 0) + value;
    }
  }
  return { qualifying, sprint, race, total: qualifying + sprint + race, breakdown };
}

/** Place pit lane starters (grid 0 or null) behind the last gridded car, in key order. */
export function effectiveGrid(grid: Record<string, number | null>): Record<string, number> {
  const result: Record<string, number> = {};
  let last = 0;
  for (const [key, value] of Object.entries(grid)) {
    if (!value) continue;
    result[key] = value;
    last = Math.max(last, value);
  }
  let offset = 0;
  for (const [key, value] of Object.entries(grid)) {
    if (value) continue;
    offset += 1;
    result[key] = last + offset;
  }
  return result;
}

/** Deepest qualifying segment for a classified position (Q3 = top 10). */
export function qualiSegmentFromPosition(position: number | null, fieldSize = 22): number | null {
  if (position === null) return null;
  const eliminated = Math.floor((fieldSize - 10) / 2);
  const q2Cut = 10 + eliminated;
  if (position <= 10) return 3;
  if (position <= q2Cut) return 2;
  return 1;
}

/** Negative part of a breakdown: what the No Negative chip removes (every negative category set to 0). */
export function negativeItems(points: WeekendPoints): number {
  let total = 0;
  for (const value of Object.values(points.breakdown)) {
    if (value < 0) total += value;
  }
  return total;
}

function scoreQualifying(weekend: DriverWeekend, rules: ScoringRules, breakdown: Record<string, number>): number {
  if (weekend.qualiDisqualified) return put(breakdown, "quali_dsq", rules.qualiDsqDriver);
  if (weekend.qualiPosition === null) return put(breakdown, "quali_nc", rules.qualiNc);
  const points = positionPoints(QUALI_POINTS, weekend.qualiPosition);
  return put(breakdown, "quali_position", points);
}

function scoreSession(
  result: SessionResult,
  rules: ScoringRules,
  breakdown: Record<string, number>,
  isSprint: boolean,
): number {
  const prefix = isSprint ? "sprint" : "race";
  if (result.disqualified) {
    const penalty = isSprint ? rules.sprintDsqDriver : rules.raceDsqDriver;
    return put(breakdown, `${prefix}_dsq`, penalty);
  }
  let total = 0;
  const overtakes = (result.overtakes ?? 0) * rules.overtake;
  total += put(breakdown, `${prefix}_overtakes`, overtakes);

  const classified = result.classified ?? true;
  if (!classified || result.finish === null) {
    const penalty = isSprint ? rules.sprintNc : rules.raceNc;
    total += put(breakdown, `${prefix}_nc`, penalty);
    return total;
  }
  const table = isSprint ? SPRINT_POINTS : RACE_POINTS;
  const position = positionPoints(table, result.finish);
  total += put(breakdown, `${prefix}_position`, position);
  const gained = gainedLost(result, rules, isSprint);
  total += put(breakdown, `${prefix}_gained_lost`, gained);
  if (result.fastestLap) {
    const bonus = isSprint ? rules.sprintFastestLap : rules.raceFastestLap;
    total += put(breakdown, `${prefix}_fastest_lap`, bonus);
  }
  if (result.driverOfTheDay && !isSprint) total += put(breakdown, "race_dotd", rules.dotd);
  return total;
}

function gainedLost(result: SessionResult, rules: ScoringRules, isSprint: boolean): number {
  if (result.grid === null || result.finish === null) return 0;
  const delta = result.grid - result.finish;
  if (isSprint && delta < -rules.sprintLostCap) return -rules.sprintLostCap;
  return delta;
}

function progressionBonus(drivers: DriverWeekend[], rules: ScoringRules, fieldSize: number): number {
  const segments = drivers.map((driver) => {
    let segment = driver.qualiSegment ?? null;
    if (segment === null) segment = qualiSegmentFromPosition(driver.qualiPosition, fieldSize);
    if (driver.qualiDisqualified) segment = 1;
    return segment || 1;
  });
  const inQ3 = segments.filter((s) => s >= 3).length;
  const inQ2 = segments.filter((s) => s >= 2).length;
  const table = rules.progression;
  if (inQ3 >= 2) return table.bothQ3;
  if (inQ3 === 1) return table.oneQ3;
  if (inQ2 >= 2) return table.bothQ2;
  if (inQ2 === 1) return table.oneQ2;
  return table.noneQ2;
}

function pitStopPoints(rules: ScoringRules, pit: PitInputs): Record<string, number> {
  if (rules.pitMode === "rank") {
    const positions = pit.pitRankPositions ?? [];
    const table = rules.pitRankPoints;
    let points = 0;
    for (const p of positions) {
      if (p >= 1 && p <= table.length) points += table[p - 1];
    }
    return { pit_rank: points };
  }
  const team = pit.teamFastestPitS ?? null;
  if (team === null) return { pit_band: 0, pit_fastest: 0, pit_world_record: 0 };
  let band = 0;
  for (const [upper, points] of rules.pitBands) {
    if (team < upper) {
      band = points;
      break;
    }
  }
  const raceFastest = pit.raceFastestPitS ?? null;
  const fastest = raceFastest !== null && Math.abs(team - raceFastest) < 1e-9 ? rules.pitFastestBonus : 0;
  const record = team < rules.pitWorldRecordS ? rules.pitWorldRecordBonus : 0;
  return { pit_band: band, pit_fastest: fastest, pit_world_record: record };
}

function positionPoints(table: number[], position: number): number {
  if (position >= 1 && position <= table.length) return table[position - 1];
  return 0;
}

function put(breakdown: Record<string, number>, key: string, value: number): number {
  if (value) breakdown[key] = (breakdown[key] ?? 0) + value;
  return value;
}
