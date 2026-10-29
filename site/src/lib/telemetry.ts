// Fastest-lap telemetry exported by f1p.fastf1.telemetry_export into data/serve/telemetry.
// Every driver's lap is resampled onto `points` samples evenly spread over its own lap length,
// so two drivers line up sample by sample (same circuit, lengths within a few metres).

export interface TelemetryDriver {
  number: string;
  code: string;
  name: string;
  team: string;
  color: string;
  lapNumber: number;
  lapTimeMs: number;
  /** Lap length in metres. */
  length: number;
  speed: number[];
  throttle: number[];
  brake: number[];
  gear: number[];
  x: number[];
  y: number[];
}

export interface SessionTelemetry {
  season: number;
  round: number;
  code: string;
  eventName: string;
  sessionName: string;
  points: number;
  drivers: TelemetryDriver[];
}

export interface TelemetryIndexEntry {
  season: number;
  round: number;
  code: string;
  eventName: string;
  sessionName: string;
  drivers: string[];
}

export interface SessionRef {
  season: number;
  round: number;
  code: string;
}

const SESSION_CODES = ["FP1", "FP2", "FP3", "SQ", "S", "Q", "R"];

/** "2026-16-Q" to a session reference, or null for anything else (also guards file paths). */
export function parseSessionKey(text: string | undefined | null): SessionRef | null {
  if (!text) return null;
  const match = /^(\d{4})-(\d{1,2})-([A-Z0-9]{1,3})$/.exec(text);
  if (!match) return null;
  const code = match[3];
  if (!SESSION_CODES.includes(code)) return null;
  return { season: Number(match[1]), round: Number(match[2]), code };
}

export function sessionKey(ref: SessionRef): string {
  return `${ref.season}-${ref.round}-${ref.code}`;
}

/** The two drivers to compare: the requested codes when present, otherwise the two fastest laps. */
export function pickPair(session: SessionTelemetry, a?: string | null, b?: string | null): [TelemetryDriver, TelemetryDriver | null] {
  const byCode = new Map(session.drivers.map((d) => [d.code, d]));
  const first = (a ? byCode.get(a) : undefined) ?? session.drivers[0];
  const fallback = session.drivers.find((d) => d.code !== first.code) ?? null;
  const requested = b ? byCode.get(b) : undefined;
  const second = requested && requested.code !== first.code ? requested : fallback;
  return [first, second];
}

/** The constructor id behind a FastF1 team name ("Red Bull Racing" is red_bull), for the team logo. */
export function telemetryTeamId(team: string): string {
  const key = team.trim().toLowerCase();
  return TELEMETRY_TEAM_IDS[key] ?? key.replace(/\s+/g, "_");
}

/** Sample positions in metres for a driver's lap. */
export function distances(driver: TelemetryDriver): number[] {
  const n = driver.speed.length;
  const step = n > 1 ? driver.length / (n - 1) : 0;
  return Array.from({ length: n }, (_, i) => i * step);
}

/**
 * Running time gap of `b` to `a` in seconds along the lap (positive: b is behind), from the
 * speed traces. Scaled so the final value equals the real lap time difference.
 */
export function timeDelta(a: TelemetryDriver, b: TelemetryDriver): number[] {
  const timesA = elapsed(a);
  const timesB = elapsed(b);
  const n = Math.min(timesA.length, timesB.length);
  const scaleA = a.lapTimeMs / 1000 / (timesA[timesA.length - 1] || 1);
  const scaleB = b.lapTimeMs / 1000 / (timesB[timesB.length - 1] || 1);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(timesB[i] * scaleB - timesA[i] * scaleA);
  return out;
}

/** Which driver is quicker through each sample: 1 for a, -1 for b, 0 for level (within 1 km/h). */
export function fasterBySample(a: TelemetryDriver, b: TelemetryDriver): number[] {
  const n = Math.min(a.speed.length, b.speed.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const diff = a.speed[i] - b.speed[i];
    out.push(Math.abs(diff) <= 1 ? 0 : diff > 0 ? 1 : -1);
  }
  return out;
}

/** Bin index 0..bins-1 of each speed sample between the lap's min and max speed. */
export function speedBins(driver: TelemetryDriver, bins: number): number[] {
  const min = Math.min(...driver.speed);
  const max = Math.max(...driver.speed);
  const span = max - min || 1;
  return driver.speed.map((v) => {
    const bin = Math.floor(((v - min) / span) * bins);
    return Math.min(bins - 1, bin);
  });
}

export function formatLapTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = (ms % 60000) / 1000;
  const secondsText = seconds.toFixed(3).padStart(6, "0");
  return `${minutes}:${secondsText}`;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Seconds elapsed at every sample, trapezoid rule on distance over speed. */
function elapsed(driver: TelemetryDriver): number[] {
  const n = driver.speed.length;
  const step = n > 1 ? driver.length / (n - 1) : 0;
  const out = [0];
  for (let i = 1; i < n; i++) {
    const v = (Math.max(driver.speed[i - 1], 1) + Math.max(driver.speed[i], 1)) / 2 / 3.6;
    out.push(out[i - 1] + step / v);
  }
  return out;
}

/** FastF1 team names, 2018 onwards, mapped to the constructor ids in the database. */
const TELEMETRY_TEAM_IDS: Record<string, string> = {
  "alfa romeo": "alfa",
  "alfa romeo racing": "alfa",
  alphatauri: "alphatauri",
  alpine: "alpine",
  "aston martin": "aston_martin",
  audi: "audi",
  cadillac: "cadillac",
  ferrari: "ferrari",
  "force india": "force_india",
  "haas f1 team": "haas",
  "kick sauber": "sauber",
  mclaren: "mclaren",
  mercedes: "mercedes",
  rb: "rb",
  "racing bulls": "rb",
  "racing point": "racing_point",
  "red bull racing": "red_bull",
  renault: "renault",
  sauber: "sauber",
  "toro rosso": "toro_rosso",
  williams: "williams",
};

export function newestTelemetrySessions(index: TelemetryIndexEntry[]): TelemetryIndexEntry[] {
  return [...index].sort((a, b) => b.season - a.season || b.round - a.round || SESSION_CODES.indexOf(b.code) - SESSION_CODES.indexOf(a.code));
}
