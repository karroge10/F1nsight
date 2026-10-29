// Domain types shared by the data layer and the UI. Ids are the stable Jolpica/Ergast
// string ids (driverId, constructorId, circuitId) as required by SPEC.md.

export type SessionKey = "fp1" | "fp2" | "fp3" | "sprintQualifying" | "sprint" | "qualifying" | "race";

export type RaceStatus = "completed" | "next" | "upcoming" | "cancelled";

export interface RaceSummary {
  season: number;
  round: number;
  raceName: string;
  circuitId: string;
  circuitName: string;
  locality: string;
  country: string;
  countryCode: string | null;
  date: string;
  time: string | null;
  sessions: Partial<Record<SessionKey, string>>;
  hasSprint: boolean;
  scheduledLaps: number | null;
  cancelled: boolean;
  url: string | null;
  officialSources?: { race?: string; qualifying?: string };
  status: RaceStatus;
  hasResults: boolean;
}

export interface ResultRow {
  position: number | null;
  positionText: string;
  driverId: string;
  constructorId: string;
  number: number | null;
  grid: number | null;
  laps: number | null;
  status: string;
  classified: boolean;
  points: number;
  timeMs: number | null;
  fastestLapRank: number | null;
  fastestLapMs?: number | null;
  fastestLapNumber?: number | null;
}

export interface QualifyingRow {
  position: number | null;
  driverId: string;
  constructorId: string;
  number: number | null;
  q1: number | null;
  q2: number | null;
  q3: number | null;
}

export interface PitStop {
  driverId: string;
  stop: number;
  lap: number | null;
  durationMs: number | null;
  localTime: string | null;
}

/** One lap: [lapNumber, position, lapTimeMs]. */
export type LapTuple = [number, number | null, number | null];

export interface RaceLaps {
  season: number;
  round: number;
  laps: Record<string, LapTuple[]>;
  pitStops: PitStop[];
}

export interface Race extends RaceSummary {
  results: ResultRow[];
  sprint: ResultRow[];
  qualifying: QualifyingRow[];
  laps: RaceLaps | null;
}

// ---------------------------------------------------------------------------
// Per-session report (data/serve/sessions, f1p.fastf1.session_export)
// ---------------------------------------------------------------------------

/** Timing codes as used by FastF1, the live service and the session JSON files. */
export type SessionCode = "FP1" | "FP2" | "FP3" | "SQ" | "S" | "Q" | "R";

export interface SessionDriver {
  number: number | null;
  code: string;
  driverId: string;
  constructorId: string;
  name: string;
  team: string;
  color: string | null;
}

export interface SessionClassificationRow {
  driverId: string;
  position: number | null;
  positionText: string;
  grid: number | null;
  /** Race and sprint: the winner's total time; everyone else's gap to the winner. */
  timeMs: number | null;
  status: string;
  points: number;
  laps: number | null;
  q1Ms: number | null;
  q2Ms: number | null;
  q3Ms: number | null;
  bestLapMs: number | null;
  bestLapNumber: number | null;
  bestLapCompound: string | null;
}

/** One lap: [lap, timeMs, s1Ms, s2Ms, s3Ms, compound, tyreLife, position, flags]. */
export type SessionLap = [number | null, number | null, number | null, number | null, number | null, string | null, number | null, number | null, number];

export const LAP_FLAG_DELETED = 1;
export const LAP_FLAG_PIT_IN = 2;
export const LAP_FLAG_PIT_OUT = 4;
export const LAP_FLAG_PERSONAL_BEST = 8;

export interface SessionStint {
  driverId: string;
  stint: number;
  compound: string | null;
  lapStart: number | null;
  lapEnd: number | null;
  laps: number;
  tyreAgeAtStart: number;
}

export interface SessionWeather {
  airTemp: [number | null, number | null];
  trackTemp: [number | null, number | null];
  humidity: number | null;
  windSpeed: number | null;
  rainfall: boolean;
}

export interface SessionReport {
  season: number;
  round: number;
  code: SessionCode;
  sessionName: string;
  eventName: string;
  drivers: SessionDriver[];
  classification: SessionClassificationRow[];
  laps: Record<string, SessionLap[]>;
  lapStarts?: Record<string, (number | null)[]>;
  stints: SessionStint[];
  pitStops: { driverId: string; stop: number; lap: number | null; durationMs: number | null }[];
  sectorBests: { sector: number; driverId: string; ms: number | null }[];
  speedTrap: { driverId: string; kph: number }[];
  weather: SessionWeather | null;
  /** Race and sprint only: on-track passes per driver (fantasy count) and raw OpenF1 swaps. */
  overtakes?: { driverId: string; count: number; raw: number }[];
}

export interface StandingRow {
  id: string;
  position: number | null;
  points: number;
  wins: number;
  constructorIds?: string[];
  pointsByRound: number[];
  positionByRound: (number | null)[];
}

export interface StandingsTable {
  rounds: number;
  list: StandingRow[];
}

export interface SeasonStandings {
  season: number;
  drivers: StandingsTable;
  constructors: StandingsTable;
}

export interface SeasonSummary {
  season: number;
  rounds: number;
  completedRounds: number;
  inProgress: boolean;
  driverChampion: { driverId: string; points: number; wins: number; constructorId: string | null } | null;
  constructorChampion: { constructorId: string; points: number; wins: number } | null;
}

export interface DriverSeasonSummary {
  season: number;
  position: number | null;
  points: number;
  wins: number;
  constructorIds: string[];
}

export interface DriverWin {
  season: number;
  round: number;
  raceName: string;
  constructorId: string;
}

export interface Driver {
  driverId: string;
  code: string | null;
  number: number | null;
  givenName: string;
  familyName: string;
  nationality: string | null;
  countryCode: string | null;
  dateOfBirth: string | null;
  url: string | null;
  career: {
    starts: number;
    wins: number;
    sprintWins: number;
    podiums: number;
    poles: number;
    fastestLaps: number;
    points: number;
    titles: number;
    firstSeason: number | null;
    lastSeason: number | null;
    constructorIds: string[];
  };
  seasons: DriverSeasonSummary[];
  wins: DriverWin[];
}

export interface Constructor {
  constructorId: string;
  name: string;
  nationality: string | null;
  countryCode: string | null;
  color: string;
  url: string | null;
  career: {
    starts: number;
    wins: number;
    podiums: number;
    poles: number;
    points: number;
    titles: number;
    firstSeason: number | null;
    lastSeason: number | null;
    driverCount: number;
  };
  seasons: { season: number; position: number | null; points: number; wins: number }[];
}

export interface CircuitRace {
  season: number;
  round: number;
  raceName: string;
  winnerDriverId: string | null;
  winnerConstructorId: string | null;
  poleDriverId: string | null;
}

export interface Circuit {
  circuitId: string;
  name: string;
  locality: string;
  country: string;
  countryCode: string | null;
  lat: number;
  lng: number;
  altitude: number | null;
  url: string | null;
  firstSeason: number;
  lastSeason: number;
  raceCount: number;
  lapRecord: { timeMs: number; driverId: string; constructorId: string; season: number } | null;
  races: CircuitRace[];
}

export interface TrackOutline {
  circuitId: string;
  name: string;
  country: string;
  rotation: number;
  outline: [number, number][];
  corners: { number: number; x: number; y: number; angle: number; length: number }[];
  sectors: { number: number; x: number; y: number; length: number }[];
  source: string;
}

// ---------------------------------------------------------------------------
// Predictions (contract from SPEC.md)
// ---------------------------------------------------------------------------

export type ForecastStage = "pre-weekend" | "post-practice" | "post-qualifying";

export interface BacktestMetrics {
  seasons: number[];
  races?: number;
  winnerAccuracy: number;
  podiumHitRate: number;
  spearman: number;
  brier: number;
  baseline: { name: string; spearman: number };
  perRace?: { round: number; winnerHit: number; podiumHitRate: number; spearman: number }[];
}

export interface FantasyForecast {
  price: number;
  expectedPoints: number;
  p10: number;
  p90: number;
  expectedPriceChange: number;
  priceChangeProbs?: Record<string, number>;
}

export interface DriverForecast {
  driverId: string;
  code: string;
  number: number | null;
  name: string;
  constructorId: string;
  team: string;
  teamColor: string;
  grid: number | null;
  expectedPosition: number;
  positionDist: number[];
  pDnf: number;
  pWin: number;
  pPodium: number;
  pPoints: number;
  expectedPoints: number;
  fantasy: FantasyForecast;
  reasons: string[];
  factors?: ReasonFactor[];
  /** The six fixed "why" entries, in the model's order (newer files only). */
  keyFactors?: KeyFactor[];
}

export type FactorKind = "form" | "qualifying" | "quali_pace" | "wins" | "reliability" | "circuit" | "team" | "championship" | "volatility" | "pace" | "other" | (string & {});

export type KeyFactorKey = "recentFinish" | "qualiGap" | "teamGap" | "championship" | "trackHistory" | "reliability" | (string & {});

/** One fixed "why" entry from the model: the same keys in the same order for every driver. */
export interface KeyFactor {
  key: KeyFactorKey;
  label: string;
  /** Raw value in `unit`, or null when the model has no data for this driver. */
  value: number | null;
  unit: "position" | "percent" | "share" | (string & {});
  /** Ready-made display text from the model ("no data" when the value is missing). */
  text: string;
  detail: string;
  /** Signed effect on the forecast (positive helps). */
  impact: number;
  /** Gap entries: the percent gap converted to seconds. */
  seconds?: number | null;
  /** trackHistory: number of visits behind the average. */
  visits?: number | null;
}

export interface ReasonFactor {
  kind: FactorKind;
  label: string;
  value: string;
  /** "helps" / "hurts" / "neutral", or a signed number (positive helps) from the model. */
  impact: "helps" | "hurts" | "neutral" | number;
  detail?: string;
}

export interface ConstructorForecast {
  constructorId: string;
  name: string;
  teamColor: string;
  expectedPoints: number;
  fantasy: FantasyForecast;
}

export interface Prediction {
  generatedAt: string;
  model: {
    version: string;
    trainedAt: string;
    notes: string;
    market?: { source: string; event: string; fetchedAt: string; volume: number; modelWeight: number } | null;
    backtest: BacktestMetrics;
  };
  race: {
    season: number;
    round: number;
    raceName: string;
    circuitId: string;
    circuitName: string;
    country: string;
    date: string;
    hasSprint: boolean;
    stage: ForecastStage;
    inputsUsed: string[];
  };
  drivers: DriverForecast[];
  constructors: ConstructorForecast[];
  championship: {
    drivers: { driverId: string; pTitle: number; expectedFinalPoints: number }[];
    constructors: { constructorId: string; pTitle: number }[];
  };
}

export interface ActualResult {
  driverId: string;
  position: number | null;
  positionText: string;
  grid: number | null;
  points: number;
  status: string;
  classified: boolean;
}

export interface PredictionHistoryEntry extends Prediction {
  actual: { results: ActualResult[] };
  /** Fantasy projections archived at team lock (published history files only). */
  fantasyAtLock?: FantasyAtLock;
}

export interface FantasyAtLock {
  stage: string;
  drivers: Record<string, { price: number | null; expectedPoints: number }>;
  constructors: Record<string, { price: number | null; expectedPoints: number }>;
}

// ---------------------------------------------------------------------------
// Fantasy market data
// ---------------------------------------------------------------------------

export interface FantasyRules {
  drivers: number;
  constructors: number;
  budget: number;
  floor: number;
  ceiling: number;
  freeTransfers: number;
  transferPenalty: number;
  tierThreshold: number;
  tierA: Record<"great" | "good" | "poor" | "terrible", number>;
  tierB: Record<"great" | "good" | "poor" | "terrible", number>;
  source: string;
}

export interface FantasyDriverAsset {
  driverId: string;
  code: string;
  name: string;
  constructorId: string;
  team: string;
  teamColor: string;
  price: number;
  previousPrice: number;
  priceHistory: number[];
  pointsHistory: (number | null)[];
  seasonPoints: number;
  selectedPct: number;
  active: boolean;
}

export interface FantasyConstructorAsset {
  constructorId: string;
  name: string;
  teamColor: string;
  price: number;
  previousPrice: number;
  priceHistory: number[];
  pointsHistory: (number | null)[];
  seasonPoints: number;
  selectedPct: number;
}

export interface FantasyMarket {
  season: number;
  gameday: number;
  deadline: string | null;
  rules: FantasyRules;
  rounds: number[];
  drivers: FantasyDriverAsset[];
  constructors: FantasyConstructorAsset[];
}

// ---------------------------------------------------------------------------
// Live service contract (live/README.md is authoritative)
// ---------------------------------------------------------------------------

export type LiveMode = "live" | "simulated" | "replay";

export interface LiveDriver {
  number: number;
  code: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  team: string;
  teamColor: string;
  headshotUrl?: string | null;
  line?: number | null;
}

export interface LiveTrack {
  outline: [number, number][];
  rotation: number;
  corners: { number: number; letter?: string | null; x: number; y: number; angle?: number | null }[];
  sectors: { number: number; start: number; end: number }[];
  finish?: [number, number] | null;
  source?: string | null;
  circuitKey?: number | null;
}

export interface LiveSessionInfo {
  key?: number | null;
  season: number;
  round: number | null;
  code: string;
  name: string;
  type?: string | null;
  meeting?: string | null;
  officialName?: string | null;
  location?: string | null;
  country?: string | null;
  circuit?: string | null;
  circuitKey?: number | null;
  start: string | null;
  end?: string | null;
  gmtOffset?: string | null;
  path?: string | null;
  status?: string | null;
}

export type PositionsSource = "official" | "estimated" | "archive" | "fixture" | null;

export interface LiveSources {
  timing: string | null;
  positions: string | null;
  positionsAvailable: boolean;
}

export interface LiveTimeline {
  start: number;
  end: number;
  green: number | null;
}

export type CarStatus = "onTrack" | "offTrack" | "pit" | "stopped" | "retired" | "stale";

export interface LiveCar {
  trackProgress?: number;
  trackOffset?: number;
  number: number;
  x: number;
  y: number;
  status: CarStatus;
  speed?: number | null;
}

export interface TimedValue {
  value: string | null;
  pb: boolean;
  ob: boolean;
}

export interface BestLapValue {
  value: string | null;
  lap: number | null;
  ob: boolean;
}

export type SectorFlag = "purple" | "green" | "yellow" | null;

export interface TimingRow {
  pos: number;
  number: number;
  gap: string | null;
  interval: string | null;
  laps: number | null;
  lastLap: TimedValue;
  bestLap: BestLapValue;
  s1: TimedValue;
  s2: TimedValue;
  s3: TimedValue;
  tyre: string | null;
  tyreAge: number | null;
  tyreNew: boolean;
  stint: number | null;
  pits: number;
  inPit: boolean;
  pitOut: boolean;
  retired: boolean;
  stopped: boolean;
  knockedOut: boolean;
  drs: boolean | null;
}

export interface RaceControlMessage {
  utc: string;
  lap: number | null;
  category: string;
  flag: string | null;
  scope: string | null;
  sector: number | null;
  driver: string | null;
  status: string | null;
  mode: string | null;
  message: string;
}

export type TrackState = "green" | "yellow" | "sc" | "vsc" | "vscEnding" | "red";

export interface WeatherState {
  airTemp: number;
  trackTemp: number;
  humidity: number;
  pressure: number | null;
  windSpeed: number;
  windDirection: number;
  rainfall: boolean;
}

export interface PlaybackState {
  t: number;
  speed: number;
  paused: boolean;
  ended: boolean;
}

export type LiveMessage =
  | { type: "loading"; season: number; round: number; session: string }
  | {
      type: "init";
      mode: LiveMode;
      origin: number;
      originUtc?: string;
      session: LiveSessionInfo;
      track: LiveTrack | null;
      drivers: LiveDriver[];
      sources: LiveSources;
      positionsSource?: PositionsSource;
      timeline?: LiveTimeline | null;
    }
  | { type: "frame"; t: number; cars: LiveCar[]; source?: PositionsSource }
  | {
      type: "timing";
      t: number;
      lap: { current: number; total: number | null } | null;
      sessionPart: number | null;
      clock: { remainingMs: number | null; running: boolean } | null;
      rows: TimingRow[];
    }
  | { type: "raceControl"; t: number; history?: boolean; messages: RaceControlMessage[] }
  | { type: "trackStatus"; t: number; code: string | null; state: TrackState; message: string | null; sessionStatus: string | null }
  | ({ type: "weather"; t: number } & WeatherState)
  | { type: "pitStop"; t: number; number: number; duration: number | null; lap: number | null }
  | { type: "pitHistory"; t: number; stops: PitHistoryStop[] }
  | { type: "tyreChange"; t: number; number: number; stint: number; compound: string; previous: string | null; tyresNotChanged: boolean; lap?: number | null }
  | ({ type: "playback" } & PlaybackState)
  | { type: "error"; message: string };

/** One stop in the pit history a snapshot carries: box time and the tyre change made in it. */
export interface PitHistoryStop {
  t: number;
  number: number;
  duration: number | null;
  lap: number | null;
  compound: string | null;
  previous: string | null;
}

export type LiveCommand = { cmd: "seek"; t: number } | { cmd: "speed"; value: number } | { cmd: "pause" } | { cmd: "resume" };

export interface ReplaySession {
  season: number;
  round: number;
  raceName: string;
  circuitId: string | null;
  session: string;
  sessionName: string;
  date: string;
  source: "service" | "fixture";
}
