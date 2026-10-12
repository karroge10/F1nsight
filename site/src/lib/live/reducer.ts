// Pure reducer for the live / replay view. Every WebSocket (or mock) message goes through
// here, so the UI state is testable without a browser. Message shapes: v2/live/README.md.

import type {
  LiveCar,
  LiveDriver,
  LiveMessage,
  LiveMode,
  LiveSessionInfo,
  LiveSources,
  LiveTimeline,
  LiveTrack,
  PlaybackState,
  PositionsSource,
  RaceControlMessage,
  SectorFlag,
  TimedValue,
  TimingRow,
  TrackState,
  WeatherState,
} from "@/lib/data/types";

export type ConnectionState = "idle" | "connecting" | "loading" | "live" | "replay" | "ended" | "offline";

export type LiveSource = "service" | "mock" | null;

export interface CarFrame {
  t: number;
  receivedAt: number;
  cars: Map<number, LiveCar>;
}

export interface PitStopEvent {
  t: number;
  number: number;
  duration: number | null;
  lap: number | null;
  compound: string | null;
  previous: string | null;
}

export interface LiveState {
  connection: ConnectionState;
  source: LiveSource;
  mode: LiveMode | null;
  origin: number | null;
  session: LiveSessionInfo | null;
  track: LiveTrack | null;
  drivers: Map<number, LiveDriver>;
  sources: LiveSources | null;
  positionsSource: PositionsSource;
  timeline: LiveTimeline | null;
  frame: CarFrame | null;
  /** The last few frames, oldest first, for smooth playback (see createCarAnimator). */
  frames: CarFrame[];
  timing: TimingRow[];
  lap: { current: number; total: number | null } | null;
  sessionPart: number | null;
  clock: { remainingMs: number | null; running: boolean } | null;
  hasDrs: boolean;
  raceControl: RaceControlMessage[];
  weather: WeatherState | null;
  trackState: TrackState | "chequered";
  trackStatusMessage: string | null;
  sessionStatus: string | null;
  pitStops: PitStopEvent[];
  lapMarks: { lap: number; t: number }[];
  statusMarks: { t: number; state: TrackState | "chequered" }[];
  leadChanges: { t: number; number: number }[];
  playback: PlaybackState;
  t: number;
  error: string | null;
}

export type LiveAction =
  | { type: "message"; message: LiveMessage; receivedAt: number }
  | { type: "connection"; connection: ConnectionState; source?: LiveSource }
  | { type: "playback"; playback: Partial<PlaybackState> }
  | { type: "error"; message: string }
  | { type: "reset" };

export const MAX_RACE_CONTROL = 80;
export const MAX_PIT_EVENTS = 120;
const MAX_FRAMES = 16;
/** How many frames the animation runs behind the newest one, to absorb uneven arrival. */
const PLAYOUT_FRAMES = 3;
/** Time constant for pulling the animation clock back towards its target delay. */
const CLOCK_CORRECTION_MS = 3000;

export function initialLiveState(): LiveState {
  return {
    connection: "idle",
    source: null,
    mode: null,
    origin: null,
    session: null,
    track: null,
    drivers: new Map(),
    sources: null,
    positionsSource: null,
    timeline: null,
    frame: null,
    frames: [],
    timing: [],
    lap: null,
    sessionPart: null,
    clock: null,
    hasDrs: false,
    raceControl: [],
    weather: null,
    trackState: "green",
    trackStatusMessage: null,
    sessionStatus: null,
    pitStops: [],
    lapMarks: [],
    statusMarks: [],
    leadChanges: [],
    playback: { t: 0, speed: 1, paused: false, ended: false },
    t: 0,
    error: null,
  };
}

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case "reset":
      return initialLiveState();
    case "connection":
      return { ...state, connection: action.connection, source: action.source ?? state.source };
    case "playback": {
      // A local seek moves the clock at once, so a controlled slider does not snap back and seek again.
      const t = action.playback.t ?? state.t;
      return { ...state, playback: { ...state.playback, ...action.playback }, t };
    }
    case "error":
      return { ...state, error: action.message };
    case "message":
      return applyMessage(state, action.message, action.receivedAt);
    default:
      return state;
  }
}

function applyMessage(state: LiveState, message: LiveMessage, receivedAt: number): LiveState {
  switch (message.type) {
    case "loading":
      return { ...state, connection: "loading" };
    case "init": {
      const drivers = new Map<number, LiveDriver>();
      for (const d of message.drivers) drivers.set(d.number, d);
      const sameSession = state.session?.key !== undefined && state.session?.key === message.session.key;
      return {
        ...state,
        mode: message.mode,
        origin: message.origin,
        session: message.session,
        track: message.track,
        drivers,
        sources: message.sources,
        positionsSource: message.positionsSource ?? state.positionsSource,
        timeline: message.timeline ?? null,
        frame: sameSession ? state.frame : null,
        frames: sameSession ? state.frames : [],
        timing: sameSession ? state.timing : [],
        raceControl: sameSession ? state.raceControl : [],
        pitStops: sameSession ? state.pitStops : [],
        lapMarks: sameSession ? state.lapMarks : [],
        statusMarks: sameSession ? state.statusMarks : [],
        leadChanges: sameSession ? state.leadChanges : [],
        lap: sameSession ? state.lap : null,
        error: null,
      };
    }
    case "frame": {
      const cars = new Map<number, LiveCar>();
      for (const car of message.cars) cars.set(car.number, car);
      const frame: CarFrame = { t: message.t, receivedAt, cars };
      const newest = state.frames.at(-1);
      const frames = newest && newest.t < message.t ? [...state.frames, frame].slice(-MAX_FRAMES) : [frame];
      return { ...state, frame, frames, positionsSource: message.source ?? state.positionsSource, t: Math.max(state.t, message.t) };
    }
    case "timing": {
      const rows = [...message.rows].sort((a, b) => a.pos - b.pos);
      const hasDrs = rows.some((r) => r.drs !== null);
      let lapMarks = state.lapMarks;
      if (message.lap && (!state.lap || message.lap.current > state.lap.current)) {
        const known = new Map(lapMarks.map((m) => [m.lap, m]));
        if (!known.has(message.lap.current)) {
          lapMarks = [...lapMarks, { lap: message.lap.current, t: message.t }].sort((a, b) => a.lap - b.lap);
        }
      }
      let leadChanges = state.leadChanges;
      const leader = rows.find((r) => r.pos === 1);
      const previousLeader = state.timing.find((r) => r.pos === 1);
      if (leader && previousLeader && leader.number !== previousLeader.number) {
        leadChanges = [...leadChanges, { t: message.t, number: leader.number }];
      }
      return {
        ...state,
        timing: rows,
        lapMarks,
        leadChanges,
        lap: message.lap ?? state.lap,
        sessionPart: message.sessionPart,
        clock: message.clock ?? state.clock,
        hasDrs,
        t: Math.max(state.t, message.t),
      };
    }
    case "raceControl": {
      // The service can resend messages the client already has (its feed reconnected right as
      // the client joined), so a message already in the log is dropped.
      const base = message.history ? [] : state.raceControl;
      const known = new Set(base.map(raceControlKey));
      const fresh = message.messages.filter((m) => !known.has(raceControlKey(m)));
      const merged = [...fresh, ...base];
      merged.sort((a, b) => (b.utc > a.utc ? 1 : b.utc < a.utc ? -1 : 0));
      return { ...state, raceControl: merged.slice(0, MAX_RACE_CONTROL) };
    }
    case "weather": {
      // Before the first WeatherData of a recording (a seek to the very start) the service sends
      // the fields as null: keep "no weather" rather than half a readout that cannot render.
      if (!hasWeatherReadings(message)) return { ...state, weather: null };
      const weather: WeatherState = {
        airTemp: message.airTemp,
        trackTemp: message.trackTemp,
        humidity: message.humidity,
        pressure: message.pressure,
        windSpeed: message.windSpeed,
        windDirection: message.windDirection,
        rainfall: message.rainfall,
      };
      return { ...state, weather };
    }
    case "trackStatus": {
      const finished = message.sessionStatus === "Finished" || message.sessionStatus === "Finalised" || message.sessionStatus === "Ends";
      const nextState: TrackState | "chequered" = finished ? "chequered" : message.state;
      const statusMarks = nextState !== state.trackState ? [...state.statusMarks, { t: message.t, state: nextState }] : state.statusMarks;
      return {
        ...state,
        trackState: nextState,
        trackStatusMessage: message.message,
        sessionStatus: message.sessionStatus,
        statusMarks,
      };
    }
    case "pitHistory": {
      // Full history after connect or seek: newest first, like the live events.
      const stops = [...message.stops].reverse().slice(0, MAX_PIT_EVENTS);
      return { ...state, pitStops: stops };
    }
    case "pitStop": {
      // Same resend as race control: one stop per car and lap.
      const repeated = state.pitStops.some((p) => p.number === message.number && p.lap === message.lap && p.lap !== null);
      if (repeated) return state;
      const event: PitStopEvent = { t: message.t, number: message.number, duration: message.duration, lap: message.lap, compound: null, previous: null };
      const pitStops = [event, ...state.pitStops].slice(0, MAX_PIT_EVENTS);
      return { ...state, pitStops };
    }
    case "tyreChange": {
      const existing = state.pitStops.findIndex((p) => p.number === message.number && Math.abs(p.t - message.t) < 60000 && p.compound === null);
      const pitStops = [...state.pitStops];
      // The service sends lap null for a change before the car's first lap: a swap on the grid.
      const realChange = !message.tyresNotChanged && message.compound !== message.previous && message.lap !== null;
      if (existing >= 0) {
        pitStops[existing] = { ...pitStops[existing], compound: message.compound, previous: message.previous };
      } else if (realChange) {
        pitStops.unshift({ t: message.t, number: message.number, duration: null, lap: message.lap ?? null, compound: message.compound, previous: message.previous });
      }
      return { ...state, pitStops: pitStops.slice(0, MAX_PIT_EVENTS) };
    }
    case "playback": {
      const playback = { t: message.t, speed: message.speed, paused: message.paused, ended: message.ended };
      return { ...state, playback, t: message.t, connection: message.ended ? "ended" : state.connection === "loading" ? "replay" : state.connection };
    }
    case "error":
      return { ...state, error: message.message };
    default:
      return state;
  }
}

/**
 * Returns a function that gives car positions for the current animation frame. It plays the frame
 * buffer back on its own smooth clock, a few frames behind the newest frame, and interpolates by
 * the frames' session time. Frames arrive over the network unevenly (often two at once, then a
 * gap), so timing the motion by arrival made the dots surge and stall.
 */
export function createCarAnimator() {
  let renderT: number | null = null;
  let lastNow: number | null = null;
  return (state: LiveState, now: number, reducedMotion = false): LiveCar[] => {
    const frames = state.frames;
    const newest = frames.at(-1);
    const elapsed = lastNow === null ? 0 : now - lastNow;
    lastNow = now;
    if (!newest || frames.length < 2 || reducedMotion) {
      renderT = newest?.t ?? null;
      return newest ? [...newest.cars.values()] : [];
    }
    const step = (newest.t - frames[0].t) / (frames.length - 1);
    const target = newest.t - step * PLAYOUT_FRAMES;
    const arrivalSpan = newest.receivedAt - frames[0].receivedAt;
    const rate = state.playback.paused || arrivalSpan <= 0 ? 0 : (newest.t - frames[0].t) / arrivalSpan;
    if (renderT === null || Math.abs(target - renderT) > step * 12) renderT = target;
    else renderT += elapsed * rate + (target - renderT) * Math.min(1, elapsed / CLOCK_CORRECTION_MS);
    return carsAt(frames, renderT);
  };
}

export function sectorFlag(value: TimedValue | null | undefined): SectorFlag {
  if (!value || !value.value) return null;
  if (value.ob) return "purple";
  if (value.pb) return "green";
  return "yellow";
}

export function tyreCode(compound: string | null | undefined): string {
  switch ((compound ?? "").toUpperCase()) {
    case "SOFT":
      return "S";
    case "MEDIUM":
      return "M";
    case "HARD":
      return "H";
    case "INTERMEDIATE":
      return "I";
    case "WET":
      return "W";
    case "":
      return "";
    default:
      // The feed sends UNKNOWN or TEST_UNKNOWN for unidentified compounds: never a raw letter.
      return "?";
  }
}

function hasWeatherReadings(message: WeatherState): boolean {
  const readings = [message.airTemp, message.trackTemp, message.humidity, message.windSpeed, message.windDirection];
  return readings.every((value) => typeof value === "number" && Number.isFinite(value));
}

function carsAt(frames: CarFrame[], t: number): LiveCar[] {
  const nextIndex = frames.findIndex((f) => f.t > t);
  if (nextIndex === -1) return [...frames[frames.length - 1].cars.values()];
  if (nextIndex === 0) return [...frames[0].cars.values()];
  const before = frames[nextIndex - 1];
  const after = frames[nextIndex];
  const alpha = (t - before.t) / (after.t - before.t);
  const out: LiveCar[] = [];
  for (const car of after.cars.values()) {
    const from = before.cars.get(car.number);
    const jump = from ? Math.hypot(car.x - from.x, car.y - from.y) : 0;
    if (!from || car.status === "retired" || car.status === "stale" || jump > 4000) {
      out.push(car);
      continue;
    }
    out.push({ ...car, x: from.x + (car.x - from.x) * alpha, y: from.y + (car.y - from.y) * alpha });
  }
  return out;
}

function raceControlKey(message: RaceControlMessage): string {
  return `${message.utc}|${message.message}`;
}
