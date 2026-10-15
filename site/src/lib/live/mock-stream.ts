// Fixture-driven replay stream, used only when the live service is unreachable. Emits the same
// messages the service sends (live/README.md), built from real lap times, pit stops and a
// real track outline.

import type {
  LiveCar,
  LiveCommand,
  LiveDriver,
  LiveMessage,
  LiveSessionInfo,
  LiveTrack,
  PitHistoryStop,
  RaceControlMessage,
  TimedValue,
  TimingRow,
  TrackState,
} from "@/lib/data/types";
import { formatLapTime } from "@/lib/format";

export interface ReplayDriver extends LiveDriver {
  driverId: string;
  grid: number | null;
  laps: [number, number | null, number | null][];
  pitLaps: number[];
  retiredAfterLap: number | null;
}

export interface ReplayPayload {
  session: LiveSessionInfo & { totalLaps: number | null };
  track: LiveTrack;
  drivers: ReplayDriver[];
}

export interface MockStreamOptions {
  speed?: number;
  frameHz?: number;
  timingHz?: number;
  onMessage: (message: LiveMessage) => void;
}

interface CarModel {
  driver: ReplayDriver;
  lapEnds: number[];
  lapTimes: number[];
  stints: { fromLap: number; compound: string }[];
  sectorSplits: number[][];
}

interface Progress {
  lapsCompleted: number;
  lapIndex: number;
  fraction: number;
  distance: number;
  status: LiveCar["status"];
}

const SECTOR_FRACTIONS = [0.31, 0.36, 0.33];
const PIT_WINDOW_MS = 22000;
const PRE_START_MS = 30000;

export class MockLiveStream {
  private readonly cars: CarModel[];
  private readonly payload: ReplayPayload;
  private readonly onMessage: (message: LiveMessage) => void;
  private readonly frameInterval: number;
  private readonly timingInterval: number;
  private readonly endMs: number;
  private speed: number;
  private simT = -PRE_START_MS;
  private lastTick = 0;
  private lastTimingAt = -Infinity;
  private timer: ReturnType<typeof setInterval> | null = null;
  private paused = false;
  private ended = false;
  private announcedRetirements = new Set<number>();
  private announcedStints = new Map<number, number>();
  private lastLapAnnounced = 0;
  private trackState: TrackState = "green";
  private stateUntil = 0;
  private sessionBest = { lap: Infinity, sectors: [Infinity, Infinity, Infinity] };

  constructor(payload: ReplayPayload, options: MockStreamOptions) {
    this.payload = payload;
    this.onMessage = options.onMessage;
    this.speed = options.speed ?? 1;
    this.frameInterval = 1000 / (options.frameHz ?? 8);
    this.timingInterval = 1000 / (options.timingHz ?? 2);
    this.cars = payload.drivers.map(buildCarModel);
    this.endMs = Math.max(...this.cars.map((c) => c.lapEnds[c.lapEnds.length - 1] ?? 0)) + 20000;
  }

  start() {
    const origin = this.payload.session.start ? new Date(this.payload.session.start).getTime() : Date.now();
    this.onMessage({ type: "loading", season: this.payload.session.season, round: this.payload.session.round ?? 0, session: this.payload.session.code });
    this.onMessage({
      type: "init",
      mode: "replay",
      origin,
      originUtc: new Date(origin).toISOString(),
      session: this.payload.session,
      track: this.payload.track,
      drivers: this.payload.drivers.map((d) => ({ number: d.number, code: d.code, name: d.name, team: d.team, teamColor: d.teamColor })),
      sources: { timing: "fixture", positions: "fixture", positionsAvailable: true },
      positionsSource: "fixture",
      timeline: { start: -PRE_START_MS, end: this.endMs, green: 0 },
    });
    this.onMessage({ type: "weather", t: this.simT, ...this.weatherAt(0) });
    this.onMessage({ type: "trackStatus", t: this.simT, code: "1", state: "green", message: "AllClear", sessionStatus: "Started" });
    this.onMessage({ type: "raceControl", t: this.simT, history: true, messages: [this.rc(0, 1, "Other", null, "FORMATION LAP COMPLETE. GRID FORMED.")] });
    this.onMessage({ type: "playback", t: this.simT, speed: this.speed, paused: false, ended: false });
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), this.frameInterval);
    this.emitTiming();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  command(command: LiveCommand) {
    switch (command.cmd) {
      case "pause":
        this.paused = true;
        break;
      case "resume":
        this.paused = false;
        this.lastTick = performance.now();
        break;
      case "speed":
        this.speed = Math.min(64, Math.max(0.1, command.value));
        break;
      case "seek":
        this.simT = Math.max(-PRE_START_MS, Math.min(this.endMs, command.t));
        this.ended = false;
        this.resetAnnouncements();
        this.emitPitHistory();
        this.emitFrame();
        this.emitTiming();
        break;
    }
    this.onMessage({ type: "playback", t: this.simT, speed: this.speed, paused: this.paused, ended: this.ended });
  }

  get duration() {
    return this.endMs;
  }

  private tick() {
    const now = performance.now();
    if (!this.paused && !this.ended) this.simT += (now - this.lastTick) * this.speed;
    this.lastTick = now;
    if (this.simT >= this.endMs && !this.ended) {
      this.simT = this.endMs;
      this.ended = true;
      this.emitFrame();
      this.emitTiming();
      this.onMessage({ type: "trackStatus", t: this.simT, code: "1", state: "green", message: "Chequered flag", sessionStatus: "Finished" });
      this.onMessage({ type: "raceControl", t: this.simT, messages: [this.rc(this.simT, this.currentLap(), "Flag", "CHEQUERED", "CHEQUERED FLAG")] });
      this.onMessage({ type: "playback", t: this.simT, speed: this.speed, paused: false, ended: true });
      return;
    }
    this.emitFrame();
    if (now - this.lastTimingAt >= this.timingInterval) {
      this.lastTimingAt = now;
      this.emitTiming();
    }
  }

  private emitFrame() {
    const outline = this.payload.track.outline;
    const cars: LiveCar[] = [];
    for (const car of this.cars) {
      const progress = progressAt(car, this.simT);
      const point = pointOnOutline(outline, progress.fraction);
      cars.push({ number: car.driver.number, x: point[0], y: point[1], status: progress.status, speed: null });
    }
    this.onMessage({ type: "frame", t: this.simT, cars });
  }

  /** Every stop made before the current time, like the service's snapshot after a seek. */
  private emitPitHistory() {
    const stops: PitHistoryStop[] = [];
    for (const car of this.cars) {
      const made = car.stints.slice(1).filter((stint) => (car.lapEnds[stint.fromLap - 2] ?? Infinity) <= this.simT);
      this.announcedStints.set(car.driver.number, made.length + 1);
      made.forEach((stint, i) => stops.push(pitHistoryStop(car, stint, car.stints[i].compound)));
    }
    stops.sort((a, b) => a.t - b.t);
    this.onMessage({ type: "pitHistory", t: this.simT, stops });
  }

  private emitTiming() {
    const snapshot = this.cars.map((car) => ({ car, progress: progressAt(car, this.simT) }));
    snapshot.sort((a, b) => {
      const ar = a.progress.status === "retired" ? 1 : 0;
      const br = b.progress.status === "retired" ? 1 : 0;
      if (ar !== br) return ar - br;
      return b.progress.distance - a.progress.distance;
    });
    const leader = snapshot[0];
    const leaderLapTime = leader ? lapTimeAt(leader.car, leader.progress.lapIndex) : 90000;
    const currentLap = this.currentLap(snapshot);
    this.updateSessionBest(snapshot);

    const rows: TimingRow[] = snapshot.map((entry, i) => {
      const { car, progress } = entry;
      const retired = progress.status === "retired";
      const ahead = i > 0 ? snapshot[i - 1] : null;
      const gapLaps = leader ? leader.progress.distance - progress.distance : 0;
      const gap = i === 0 ? (currentLap > 0 ? `LAP ${currentLap}` : "") : retired ? null : gapText(gapLaps, leaderLapTime);
      const intervalLaps = ahead ? ahead.progress.distance - progress.distance : 0;
      const interval = i === 0 || retired ? null : gapText(intervalLaps, ahead ? lapTimeAt(ahead.car, ahead.progress.lapIndex) : leaderLapTime);
      const completed = progress.lapsCompleted;
      const lastLapMs = completed > 0 ? car.lapTimes[completed - 1] : null;
      const bestSoFar = completed > 0 ? Math.min(...car.lapTimes.slice(0, completed)) : null;
      const bestLapIndex = bestSoFar === null ? null : car.lapTimes.indexOf(bestSoFar) + 1;
      const stint = stintAt(car, completed + 1);
      const stintIndex = car.stints.indexOf(stint) + 1;
      const sectors = sectorValues(car, progress, this.sessionBest);
      return {
        pos: i + 1,
        number: car.driver.number,
        gap,
        interval,
        laps: completed,
        lastLap: { value: lastLapMs ? formatLapTime(lastLapMs) : null, pb: lastLapMs !== null && lastLapMs === bestSoFar, ob: lastLapMs !== null && lastLapMs <= this.sessionBest.lap },
        bestLap: { value: bestSoFar ? formatLapTime(bestSoFar) : null, lap: bestLapIndex, ob: bestSoFar !== null && bestSoFar <= this.sessionBest.lap },
        s1: sectors[0],
        s2: sectors[1],
        s3: sectors[2],
        tyre: stint.compound,
        tyreAge: Math.max(0, completed + 1 - stint.fromLap),
        tyreNew: completed + 1 - stint.fromLap <= 1,
        stint: stintIndex,
        pits: car.driver.pitLaps.filter((lap) => lap <= completed).length,
        inPit: progress.status === "pit",
        pitOut: false,
        retired,
        stopped: retired,
        knockedOut: false,
        drs: null,
      };
    });
    this.onMessage({ type: "timing", t: this.simT, lap: { current: Math.max(1, currentLap), total: this.payload.session.totalLaps }, sessionPart: null, clock: null, rows });
    this.announce(snapshot, currentLap, rows);
  }

  private currentLap(snapshot?: { car: CarModel; progress: Progress }[]) {
    const list = snapshot ?? this.cars.map((car) => ({ car, progress: progressAt(car, this.simT) }));
    const leader = list.filter((e) => e.progress.status !== "retired").sort((a, b) => b.progress.distance - a.progress.distance)[0];
    if (!leader) return 0;
    return Math.min(leader.progress.lapsCompleted + 1, leader.car.lapTimes.length);
  }

  private updateSessionBest(snapshot: { car: CarModel; progress: Progress }[]) {
    for (const { car, progress } of snapshot) {
      for (let lap = 0; lap < progress.lapsCompleted; lap++) {
        const time = car.lapTimes[lap];
        if (time < this.sessionBest.lap) this.sessionBest.lap = time;
        const splits = car.sectorSplits[lap];
        for (let s = 0; s < 3; s++) if (splits[s] < this.sessionBest.sectors[s]) this.sessionBest.sectors[s] = splits[s];
      }
    }
  }

  private announce(snapshot: { car: CarModel; progress: Progress }[], currentLap: number, rows: TimingRow[]) {
    const messages: RaceControlMessage[] = [];
    if (this.simT >= 0 && this.lastLapAnnounced === 0 && currentLap >= 1) {
      messages.push(this.rc(this.simT, 1, "Flag", "GREEN", "GREEN LIGHT - PIT EXIT OPEN"));
    }
    for (const { car, progress } of snapshot) {
      if (progress.status === "retired" && !this.announcedRetirements.has(car.driver.number)) {
        this.announcedRetirements.add(car.driver.number);
        const sector = Math.min(3, Math.floor(progress.fraction * 3) + 1);
        messages.push(this.rc(this.simT, currentLap, "Flag", "YELLOW", `YELLOW IN TRACK SECTOR ${sector}`, sector));
        messages.push(this.rc(this.simT, currentLap, "Other", null, `CAR ${car.driver.number} (${car.driver.code}) STOPPED ON TRACK`));
        const useSc = this.announcedRetirements.size % 3 === 0;
        this.trackState = useSc ? "sc" : "yellow";
        this.stateUntil = this.simT + (useSc ? 150000 : 25000);
        this.onMessage({ type: "trackStatus", t: this.simT, code: useSc ? "4" : "2", state: this.trackState, message: useSc ? "SCDeployed" : "Yellow", sessionStatus: "Started" });
        if (useSc) messages.push(this.rc(this.simT, currentLap, "SafetyCar", null, "SAFETY CAR DEPLOYED", null, "SAFETY CAR"));
      }
    }
    if (this.trackState !== "green" && this.simT >= this.stateUntil) {
      this.trackState = "green";
      this.onMessage({ type: "trackStatus", t: this.simT, code: "1", state: "green", message: "AllClear", sessionStatus: "Started" });
      messages.push(this.rc(this.simT, currentLap, "Flag", "CLEAR", "TRACK CLEAR"));
    }
    for (const row of rows) {
      const previous = this.announcedStints.get(row.number) ?? 1;
      if ((row.stint ?? 1) > previous) {
        this.announcedStints.set(row.number, row.stint ?? 1);
        const car = this.cars.find((c) => c.driver.number === row.number);
        const previousCompound = car ? car.stints[Math.max(0, (row.stint ?? 1) - 2)].compound : null;
        this.onMessage({ type: "pitStop", t: this.simT, number: row.number, duration: pitDuration(row.number), lap: Math.max(1, (row.laps ?? 1)) });
        this.onMessage({ type: "tyreChange", t: this.simT, number: row.number, stint: row.stint ?? 1, compound: row.tyre ?? "MEDIUM", previous: previousCompound, tyresNotChanged: false });
      }
    }
    if (currentLap > this.lastLapAnnounced) {
      if (currentLap % 10 === 0 && snapshot[0]) {
        messages.push(this.rc(this.simT, currentLap, "Other", null, `LAP ${currentLap}: ${snapshot[0].car.driver.code} LEADS`));
      }
      this.lastLapAnnounced = currentLap;
      this.onMessage({ type: "weather", t: this.simT, ...this.weatherAt(this.simT) });
    }
    if (messages.length) this.onMessage({ type: "raceControl", t: this.simT, messages });
  }

  private resetAnnouncements() {
    this.announcedRetirements.clear();
    this.announcedStints.clear();
    this.lastLapAnnounced = 0;
    this.trackState = "green";
    this.stateUntil = 0;
    this.sessionBest = { lap: Infinity, sectors: [Infinity, Infinity, Infinity] };
    this.onMessage({ type: "trackStatus", t: this.simT, code: "1", state: "green", message: "AllClear", sessionStatus: "Started" });
  }

  private rc(t: number, lap: number, category: string, flag: string | null, message: string, sector: number | null = null, mode: string | null = null): RaceControlMessage {
    const origin = this.payload.session.start ? new Date(this.payload.session.start).getTime() : Date.now();
    return { utc: new Date(origin + Math.max(0, t)).toISOString().slice(0, 19), lap, category, flag, scope: sector ? "Sector" : null, sector, driver: null, status: null, mode, message };
  }

  private weatherAt(t: number) {
    const hours = Math.max(0, t) / 3600000;
    return {
      airTemp: Math.round((27.5 - hours * 1.5 + Math.sin(t / 700000) * 0.4) * 10) / 10,
      trackTemp: Math.round((41 - hours * 4 + Math.sin(t / 500000) * 0.8) * 10) / 10,
      humidity: Math.round(48 + hours * 6),
      pressure: 1012.4,
      windSpeed: Math.round((2.4 + Math.sin(t / 900000) * 0.8) * 10) / 10,
      windDirection: Math.round(210 + Math.sin(t / 1300000) * 30),
      rainfall: false,
    };
  }
}

// ---------------------------------------------------------------------------
// car model on the fixture data
// ---------------------------------------------------------------------------

function buildCarModel(driver: ReplayDriver): CarModel {
  const lapTimes = driver.laps.map((l) => l[2] ?? 95000);
  const lapEnds: number[] = [];
  let acc = 0;
  for (const time of lapTimes) {
    acc += time;
    lapEnds.push(acc);
  }
  const sectorSplits = lapTimes.map((time, idx) => {
    const noise = seededNoise(driver.number * 1000 + idx);
    const f1 = SECTOR_FRACTIONS[0] + noise * 0.01;
    const f2 = SECTOR_FRACTIONS[1] - noise * 0.006;
    return [time * f1, time * f2, time * (1 - f1 - f2)];
  });
  return { driver, lapEnds, lapTimes, stints: buildStints(driver.pitLaps, lapTimes.length), sectorSplits };
}

function pitHistoryStop(car: CarModel, stint: { fromLap: number; compound: string }, previous: string): PitHistoryStop {
  const lap = stint.fromLap - 1;
  const number = car.driver.number;
  return { t: car.lapEnds[lap - 1], number, duration: pitDuration(number), lap, compound: stint.compound, previous };
}

function pitDuration(number: number): number {
  return 22 + (number % 5) * 0.7;
}

function buildStints(pitLaps: number[], totalLaps: number): { fromLap: number; compound: string }[] {
  const sequences: Record<number, string[]> = {
    0: ["MEDIUM"],
    1: ["MEDIUM", "HARD"],
    2: ["SOFT", "MEDIUM", "HARD"],
    3: ["SOFT", "MEDIUM", "HARD", "MEDIUM"],
    4: ["SOFT", "MEDIUM", "HARD", "MEDIUM", "SOFT"],
  };
  const stops = pitLaps.filter((l) => l > 0 && l <= totalLaps).sort((a, b) => a - b);
  const sequence = sequences[Math.min(stops.length, 4)];
  const stints = [{ fromLap: 1, compound: sequence[0] }];
  stops.forEach((lap, i) => stints.push({ fromLap: lap + 1, compound: sequence[Math.min(i + 1, sequence.length - 1)] }));
  return stints;
}

function stintAt(car: CarModel, lap: number) {
  let current = car.stints[0];
  for (const stint of car.stints) if (stint.fromLap <= lap) current = stint;
  return current;
}

function progressAt(car: CarModel, t: number): Progress {
  const totalLaps = car.lapTimes.length;
  const finalEnd = car.lapEnds[totalLaps - 1] ?? 0;
  const gridOffset = ((car.driver.grid ?? 20) - 1) * 0.0035;
  if (totalLaps === 0) return { lapsCompleted: 0, lapIndex: 0, fraction: 1 - gridOffset, distance: -gridOffset, status: "retired" };
  if (t < 0) return { lapsCompleted: 0, lapIndex: 0, fraction: 1 - gridOffset, distance: -gridOffset, status: "onTrack" };
  if (t >= finalEnd) {
    const retired = car.driver.retiredAfterLap !== null;
    return { lapsCompleted: totalLaps, lapIndex: totalLaps - 1, fraction: retired ? 0.5 + (car.driver.number % 7) * 0.05 : 0.02, distance: totalLaps, status: retired ? "retired" : "onTrack" };
  }
  let lapIndex = 0;
  while (lapIndex < totalLaps - 1 && t >= car.lapEnds[lapIndex]) lapIndex++;
  const lapStart = lapIndex === 0 ? 0 : car.lapEnds[lapIndex - 1];
  let fraction = (t - lapStart) / car.lapTimes[lapIndex];
  if (lapIndex === 0) fraction = fraction * (1 + gridOffset) - gridOffset;
  const normalized = ((fraction % 1) + 1) % 1;
  const inPit = car.driver.pitLaps.includes(lapIndex) && t - lapStart < PIT_WINDOW_MS;
  return { lapsCompleted: lapIndex, lapIndex, fraction: normalized, distance: lapIndex + fraction, status: inPit ? "pit" : "onTrack" };
}

function lapTimeAt(car: CarModel, lapIndex: number) {
  return car.lapTimes[Math.min(lapIndex, car.lapTimes.length - 1)] ?? 90000;
}

function sectorValues(car: CarModel, progress: Progress, sessionBest: { lap: number; sectors: number[] }): [TimedValue, TimedValue, TimedValue] {
  const blank: TimedValue = { value: null, pb: false, ob: false };
  const lapIndex = progress.lapIndex;
  const completedSectors = progress.status === "retired" ? 3 : progress.fraction < SECTOR_FRACTIONS[0] ? 0 : progress.fraction < SECTOR_FRACTIONS[0] + SECTOR_FRACTIONS[1] ? 1 : 2;
  const referenceLap = completedSectors === 0 ? lapIndex - 1 : lapIndex;
  if (referenceLap < 0 || referenceLap >= car.sectorSplits.length) return [blank, blank, blank];
  const splits = car.sectorSplits[referenceLap];
  const shown = completedSectors === 0 ? 3 : completedSectors;
  const out: [TimedValue, TimedValue, TimedValue] = [blank, blank, blank];
  for (let s = 0; s < shown; s++) {
    const value = splits[s];
    let personalBest = Infinity;
    for (let lap = 0; lap < referenceLap; lap++) personalBest = Math.min(personalBest, car.sectorSplits[lap][s]);
    out[s] = { value: (value / 1000).toFixed(3), pb: value <= personalBest, ob: value <= sessionBest.sectors[s] };
  }
  return out;
}

function gapText(laps: number, lapTimeMs: number): string {
  if (laps >= 1) {
    const whole = Math.floor(laps);
    return `${whole}L`;
  }
  const ms = Math.max(0, laps * lapTimeMs);
  return `+${(ms / 1000).toFixed(3)}`;
}

export function pointOnOutline(outline: [number, number][], fraction: number): [number, number] {
  const n = outline.length;
  if (n === 0) return [0, 0];
  const f = ((fraction % 1) + 1) % 1;
  const scaled = f * n;
  const i = Math.floor(scaled) % n;
  const j = (i + 1) % n;
  const k = scaled - Math.floor(scaled);
  const a = outline[i];
  const b = outline[j];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

function seededNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}
