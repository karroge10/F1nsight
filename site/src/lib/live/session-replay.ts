import type { LiveCar, LiveCommand, LiveMessage, SessionLap, TimingRow } from "@/lib/data/types";
import { formatLapTime } from "@/lib/format";
import { pointOnOutline, type ReplayPayload, type MockStreamOptions } from "./mock-stream";

export function sessionTimeline(payload: ReplayPayload) {
  const report = payload.report;
  const starts = Object.values(report?.lapStarts ?? {}).flat().filter((t): t is number => t !== null && Number.isFinite(t));
  const start = starts.length ? Math.min(...starts) : 0;
  const ends = Object.entries(report?.laps ?? {}).flatMap(([id, laps]) => laps.map((lap, i) => {
    const at = report?.lapStarts?.[id]?.[i];
    return at === null || at === undefined ? start : at + lapDuration(lap);
  }));
  return { origin: start, end: Math.max(start + 1, ...ends) - start };
}

function lapDuration(lap: SessionLap): number {
  return lap[1] ?? (lap[2] ?? 0) + (lap[3] ?? 0) + (lap[4] ?? 0);
}

export function sessionSnapshot(payload: ReplayPayload, t: number): LiveMessage[] {
  const report = payload.report!;
  const now = sessionTimeline(payload).origin + t;
  const isRace = report.code === "S" || report.code === "R";
  const entries = payload.drivers.map((driver) => {
    const laps = report.laps[driver.driverId] ?? [];
    const completed = laps.filter((lap, i) => {
      const start = report.lapStarts?.[driver.driverId]?.[i];
      return start !== null && start !== undefined && start + lapDuration(lap) <= now;
    });
    const valid = completed.filter((lap) => lap[1] !== null && !(lap[8] & 1));
    const best = [...valid].sort((a, b) => a[1]! - b[1]!)[0] ?? null;
    const activeIndex = laps.findIndex((lap, i) => {
      const start = report.lapStarts?.[driver.driverId]?.[i];
      return start !== null && start !== undefined && start <= now && start + lapDuration(lap) > now;
    });
    const active = laps[activeIndex] ?? null;
    const last = completed.at(-1) ?? null;
    const start = report.lapStarts?.[driver.driverId]?.[activeIndex] ?? now;
    const fraction = active ? Math.max(0, Math.min(1, (now - start) / Math.max(1, lapDuration(active)))) : 0;
    return { driver, completed, best, active, last, fraction, distance: completed.length + fraction };
  });
  entries.sort((a, b) => isRace ? b.distance - a.distance : (a.best?.[1] ?? Infinity) - (b.best?.[1] ?? Infinity));
  const fastest = Math.min(...entries.map((e) => e.best?.[1] ?? Infinity));
  const rows: TimingRow[] = entries.map((e, i) => {
    const bestMs = e.best?.[1] ?? null;
    const shown = e.active ?? e.last;
    const previousBest = entries[i - 1]?.best?.[1] ?? null;
    const interval = bestMs === null || previousBest === null ? null : `+${((bestMs - previousBest) / 1000).toFixed(3)}`;
    const gap = bestMs === null || !Number.isFinite(fastest) ? null : i === 0 ? "" : `+${((bestMs - fastest) / 1000).toFixed(3)}`;
    return {
      pos: i + 1, number: e.driver.number, laps: e.completed.length,
      gap: isRace ? null : gap, interval: isRace ? null : interval,
      lastLap: { value: e.last?.[1] ? formatLapTime(e.last[1]) : null, pb: e.last === e.best, ob: e.last?.[1] === fastest },
      bestLap: { value: bestMs === null ? null : formatLapTime(bestMs), lap: e.best?.[0] ?? null, ob: bestMs === fastest },
      s1: { value: e.last?.[2] ? (e.last[2] / 1000).toFixed(3) : null, pb: false, ob: false },
      s2: { value: e.last?.[3] ? (e.last[3] / 1000).toFixed(3) : null, pb: false, ob: false },
      s3: { value: e.last?.[4] ? (e.last[4] / 1000).toFixed(3) : null, pb: false, ob: false },
      tyre: ({ S: "SOFT", M: "MEDIUM", H: "HARD", I: "INTERMEDIATE", W: "WET" } as Record<string, string>)[shown?.[5] ?? ""] ?? null, tyreAge: shown?.[6] ?? null, tyreNew: shown?.[6] === 1, stint: null,
      pits: report.pitStops.filter((p) => p.driverId === e.driver.driverId && p.lap !== null && p.lap <= (e.last?.[0] ?? 0)).length,
      inPit: !e.active, pitOut: !!(e.active && e.active[8] & 4), retired: false, stopped: false, knockedOut: false, drs: null,
    };
  });
  const cars: LiveCar[] = entries.filter((e) => e.active).map((e) => {
    const [x, y] = pointOnOutline(payload.track.outline, e.fraction);
    return { number: e.driver.number, x, y, status: "onTrack", trackProgress: e.fraction, trackOffset: 0 };
  });
  return [
    { type: "timing", t, lap: isRace ? { current: Math.max(1, ...entries.map((e) => e.completed.length + 1)), total: null } : null, sessionPart: null, clock: null, rows },
    { type: "frame", t, cars, source: "estimated" },
  ];
}

export class SessionReplayStream {
  private timer: ReturnType<typeof setInterval> | null = null;
  private t = 0;
  private speed: number;
  private paused = false;
  private last = 0;
  private readonly end: number;
  constructor(private readonly payload: ReplayPayload, private readonly options: MockStreamOptions) {
    this.speed = options.speed ?? 1;
    this.end = sessionTimeline(payload).end;
  }
  start() {
    this.options.onMessage({ type: "init", mode: "replay", origin: 0, session: this.payload.session, track: this.payload.track, drivers: this.payload.drivers, sources: { timing: "Session lap timing", positions: "Lap reconstruction", positionsAvailable: true }, positionsSource: "estimated", timeline: { start: 0, end: this.end, green: 0 } });
    this.emit();
    this.last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      if (!this.paused) this.t = Math.min(this.end, this.t + (now - this.last) * this.speed);
      this.last = now;
      this.emit();
    }, 250);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  command(command: LiveCommand) {
    if (command.cmd === "pause") this.paused = true;
    if (command.cmd === "resume") { this.paused = false; this.last = performance.now(); }
    if (command.cmd === "speed") this.speed = Math.min(64, Math.max(0.1, command.value));
    if (command.cmd === "seek") this.t = Math.min(this.end, Math.max(0, command.t));
    this.emit();
  }
  private emit() {
    for (const message of sessionSnapshot(this.payload, this.t)) this.options.onMessage(message);
    this.options.onMessage({ type: "playback", t: this.t, speed: this.speed, paused: this.paused, ended: this.t >= this.end });
  }
}
