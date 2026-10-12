import { describe, expect, it } from "vitest";
import type { LiveMessage, TimingRow } from "@/lib/data/types";
import { createCarAnimator, initialLiveState, liveReducer, MAX_RACE_CONTROL, sectorFlag, tyreCode } from "./reducer";

const init: LiveMessage = {
  type: "init",
  mode: "replay",
  origin: 1791097200000,
  session: { key: 11731, season: 2026, round: 16, code: "R", name: "Race", start: "2026-10-04T07:00:00.000Z" },
  track: { outline: [[0, 0], [100, 0], [100, 100]], rotation: 0, corners: [], sectors: [] },
  drivers: [
    { number: 12, code: "ANT", name: "Kimi Antonelli", team: "Mercedes", teamColor: "#27F4D2" },
    { number: 44, code: "HAM", name: "Lewis Hamilton", team: "Ferrari", teamColor: "#E8002D" },
  ],
  sources: { timing: "archive", positions: "archive", positionsAvailable: true },
  timeline: { start: -120000, end: 7200000, green: 0 },
};

function row(pos: number, number: number, drs: boolean | null = null): TimingRow {
  const blank = { value: null, pb: false, ob: false };
  return { pos, number, gap: "", interval: "", laps: 0, lastLap: blank, bestLap: { value: null, lap: null, ob: false }, s1: blank, s2: blank, s3: blank, tyre: "MEDIUM", tyreAge: 0, tyreNew: true, stint: 1, pits: 0, inPit: false, pitOut: false, retired: false, stopped: false, knockedOut: false, drs };
}

describe("live reducer", () => {
  it("stores session, track, drivers, sources and timeline on init", () => {
    const state = liveReducer(initialLiveState(), { type: "message", message: init, receivedAt: 0 });
    expect(state.session?.name).toBe("Race");
    expect(state.drivers.get(44)?.code).toBe("HAM");
    expect(state.sources?.positionsAvailable).toBe(true);
    expect(state.timeline?.end).toBe(7200000);
    expect(state.origin).toBe(1791097200000);
  });

  it("animates cars a few frames behind the newest one, by session time", () => {
    let state = liveReducer(initialLiveState(), { type: "message", message: init, receivedAt: 0 });
    for (let i = 0; i <= 5; i++) {
      state = liveReducer(state, { type: "message", message: { type: "frame", t: 1000 + i * 100, cars: [{ number: 12, x: i * 10, y: 0, status: "onTrack" }] }, receivedAt: 1000 + i * 100 });
    }
    expect(state.frames).toHaveLength(6);
    const animate = createCarAnimator();
    expect(animate(state, 1500)[0].x).toBeCloseTo(20, 5);
    expect(animate(state, 1550)[0].x).toBeCloseTo(25, 1);
    expect(createCarAnimator()(state, 1500, true)[0].x).toBe(50);
  });

  it("starts a new frame buffer when time goes backwards (seek)", () => {
    let state = liveReducer(initialLiveState(), { type: "message", message: init, receivedAt: 0 });
    state = liveReducer(state, { type: "message", message: { type: "frame", t: 5000, cars: [] }, receivedAt: 0 });
    state = liveReducer(state, { type: "message", message: { type: "frame", t: 1000, cars: [] }, receivedAt: 10 });
    expect(state.frames.map((f) => f.t)).toEqual([1000]);
  });

  it("sorts timing rows, updates the lap counter and detects the DRS channel", () => {
    let state = liveReducer(initialLiveState(), { type: "message", message: init, receivedAt: 0 });
    state = liveReducer(state, { type: "message", message: { type: "timing", t: 5000, lap: { current: 3, total: 55 }, sessionPart: null, clock: { remainingMs: 100, running: true }, rows: [row(2, 44), row(1, 12)] }, receivedAt: 5000 });
    expect(state.timing.map((r) => r.number)).toEqual([12, 44]);
    expect(state.lap?.current).toBe(3);
    expect(state.hasDrs).toBe(false);
    state = liveReducer(state, { type: "message", message: { type: "timing", t: 6000, lap: { current: 3, total: 55 }, sessionPart: null, clock: null, rows: [row(1, 12, true)] }, receivedAt: 6000 });
    expect(state.hasDrs).toBe(true);
  });

  it("replaces history on connect, caps race control and keeps newest first", () => {
    let state = initialLiveState();
    const messages = Array.from({ length: MAX_RACE_CONTROL + 10 }, (_, i) => ({ utc: `2026-10-04T07:${String(i).padStart(2, "0")}:00`, lap: 1, category: "Flag", flag: null, scope: null, sector: null, driver: null, status: null, mode: null, message: `msg ${i}` }));
    state = liveReducer(state, { type: "message", message: { type: "raceControl", t: 0, history: true, messages }, receivedAt: 0 });
    expect(state.raceControl.length).toBe(MAX_RACE_CONTROL);
    expect(state.raceControl[0].message).toBe(`msg ${MAX_RACE_CONTROL + 9}`);
  });

  it("drops race control messages and pit stops it already has, resent after a feed reconnect", () => {
    let state = initialLiveState();
    const messages = ["SAFETY CAR DEPLOYED", "ALL CARS THROUGH THE PIT LANE"].map((message, i) => ({ utc: `2026-10-10T09:3${i}:00`, lap: 2, category: "Other", flag: null, scope: null, sector: null, driver: null, status: null, mode: null, message }));
    state = liveReducer(state, { type: "message", message: { type: "raceControl", t: 0, history: true, messages }, receivedAt: 0 });
    state = liveReducer(state, { type: "message", message: { type: "raceControl", t: 1, history: false, messages }, receivedAt: 1 });
    expect(state.raceControl.length).toBe(2);
    state = liveReducer(state, { type: "message", message: { type: "pitStop", t: 10, number: 81, duration: 21.4, lap: 2 }, receivedAt: 10 });
    state = liveReducer(state, { type: "message", message: { type: "pitStop", t: 11, number: 81, duration: 21.4, lap: 2 }, receivedAt: 11 });
    expect(state.pitStops.length).toBe(1);
  });

  it("tracks status, weather, pit stops with tyre changes and playback end", () => {
    let state = initialLiveState();
    state = liveReducer(state, { type: "message", message: { type: "trackStatus", t: 1, code: "4", state: "sc", message: "SC deployed", sessionStatus: "Started" }, receivedAt: 1 });
    expect(state.trackState).toBe("sc");
    state = liveReducer(state, { type: "message", message: { type: "weather", t: 2, airTemp: 30, trackTemp: 38, humidity: 70, pressure: 1006, windSpeed: 2, windDirection: 90, rainfall: false }, receivedAt: 2 });
    expect(state.weather?.trackTemp).toBe(38);
    state = liveReducer(state, { type: "message", message: { type: "pitStop", t: 10, number: 81, duration: 21.4, lap: 2 }, receivedAt: 10 });
    state = liveReducer(state, { type: "message", message: { type: "tyreChange", t: 12, number: 81, stint: 2, compound: "HARD", previous: "MEDIUM", tyresNotChanged: false }, receivedAt: 12 });
    expect(state.pitStops.length).toBe(1);
    expect(state.pitStops[0].compound).toBe("HARD");
    // A stint entry that is not a tyre change and has no box time is not a stop.
    state = liveReducer(state, { type: "message", message: { type: "tyreChange", t: 30, number: 1, stint: 2, compound: "SOFT", previous: "SOFT", tyresNotChanged: true }, receivedAt: 30 });
    expect(state.pitStops.length).toBe(1);
    // A tyre swap on the grid (no lap yet) is not a stop either.
    state = liveReducer(state, { type: "message", message: { type: "tyreChange", t: 31, number: 4, stint: 2, compound: "MEDIUM", previous: "INTERMEDIATE", tyresNotChanged: false, lap: null }, receivedAt: 31 });
    expect(state.pitStops.length).toBe(1);
    // A snapshot after a seek replaces the list with the full history, newest first.
    const history = [
      { t: 5, number: 1, duration: 23.0, lap: 1, compound: "MEDIUM", previous: "SOFT" },
      { t: 10, number: 81, duration: 21.4, lap: 2, compound: "HARD", previous: "MEDIUM" },
      { t: 40, number: 1, duration: null, lap: null, compound: "SOFT", previous: "MEDIUM" },
    ];
    state = liveReducer(state, { type: "message", message: { type: "pitHistory", t: 50, stops: history }, receivedAt: 50 });
    expect(state.pitStops.map((p) => p.t)).toEqual([40, 10, 5]);
    expect(state.pitStops[2].previous).toBe("SOFT");
    state = liveReducer(state, { type: "message", message: { type: "trackStatus", t: 20, code: "1", state: "green", message: "AllClear", sessionStatus: "Finished" }, receivedAt: 20 });
    expect(state.trackState).toBe("chequered");
    state = liveReducer(state, { type: "message", message: { type: "playback", t: 30, speed: 4, paused: false, ended: true }, receivedAt: 30 });
    expect(state.connection).toBe("ended");
    expect(state.playback.speed).toBe(4);
  });

  it("moves the clock at once on a local seek, so the slider does not snap back", () => {
    let state = initialLiveState();
    state = liveReducer(state, { type: "message", message: { type: "playback", t: 5000, speed: 1, paused: false, ended: false }, receivedAt: 1 });
    state = liveReducer(state, { type: "playback", playback: { t: 90000 } });
    expect(state.t).toBe(90000);
    expect(state.playback.t).toBe(90000);
    state = liveReducer(state, { type: "playback", playback: { paused: true } });
    expect(state.t).toBe(90000);
  });

  it("drops a weather message with null readings, sent for a seek before the first WeatherData", () => {
    const withWeather = liveReducer(initialLiveState(), {
      type: "message",
      message: { type: "weather", t: 0, airTemp: 30, trackTemp: 40, humidity: 50, pressure: 1010, windSpeed: 1.2, windDirection: 90, rainfall: false },
      receivedAt: 0,
    });
    expect(withWeather.weather?.airTemp).toBe(30);
    const blank = { type: "weather", t: -3000000, airTemp: null, trackTemp: null, humidity: null, pressure: null, windSpeed: null, windDirection: null, rainfall: false } as unknown as LiveMessage;
    const state = liveReducer(withWeather, { type: "message", message: blank, receivedAt: 0 });
    expect(state.weather).toBeNull();
  });

  it("maps sector values and tyre compounds", () => {
    expect(sectorFlag({ value: "36.8", pb: true, ob: true })).toBe("purple");
    expect(sectorFlag({ value: "36.8", pb: true, ob: false })).toBe("green");
    expect(sectorFlag({ value: "36.8", pb: false, ob: false })).toBe("yellow");
    expect(sectorFlag({ value: null, pb: false, ob: false })).toBeNull();
    expect(tyreCode("INTERMEDIATE")).toBe("I");
    expect(tyreCode("SOFT")).toBe("S");
    expect(tyreCode("UNKNOWN")).toBe("?");
    expect(tyreCode("TEST_UNKNOWN")).toBe("?");
    expect(tyreCode(null)).toBe("");
    expect(tyreCode(null)).toBe("");
  });
});
