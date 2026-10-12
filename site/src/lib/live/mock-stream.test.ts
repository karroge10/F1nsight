import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveMessage } from "@/lib/data/types";
import { getEntryList, getRace, getTrackOutline } from "@/lib/data";
import { MockLiveStream, pointOnOutline, type ReplayPayload } from "./mock-stream";
import { initialLiveState, liveReducer, type LiveState } from "./reducer";

async function buildPayload(): Promise<ReplayPayload> {
  const race = await getRace(2026, 13);
  const track = await getTrackOutline("monza");
  const entries = await getEntryList(2026);
  if (!race || !race.laps || !track) throw new Error("fixture missing");
  const entryById = new Map(entries.drivers.map((d) => [d.driverId, d]));
  const drivers = race.results.map((row) => {
    const entry = entryById.get(row.driverId);
    return {
      driverId: row.driverId,
      number: row.number ?? 0,
      code: entry?.code ?? row.driverId.slice(0, 3).toUpperCase(),
      name: entry?.name ?? row.driverId,
      team: entry?.team ?? row.constructorId,
      teamColor: entry?.teamColor ?? "#8A8F98",
      grid: row.grid,
      laps: race.laps?.laps[row.driverId] ?? [],
      pitLaps: (race.laps?.pitStops ?? []).filter((p) => p.driverId === row.driverId && p.lap !== null).map((p) => p.lap as number),
      retiredAfterLap: row.classified ? null : (race.laps?.laps[row.driverId] ?? []).length,
    };
  });
  return {
    session: { key: 202613, season: 2026, round: 13, code: "R", name: "Race", meeting: race.raceName, start: race.time, totalLaps: race.scheduledLaps },
    track: { outline: track.outline, rotation: track.rotation, corners: [], sectors: [{ number: 1, start: 0, end: 100 }] },
    drivers,
  };
}

describe("mock live stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("emits the service message shapes and drives the reducer", async () => {
    const payload = await buildPayload();
    const messages: LiveMessage[] = [];
    let state: LiveState = initialLiveState();
    const stream = new MockLiveStream(payload, {
      speed: 16,
      onMessage: (message) => {
        messages.push(message);
        state = liveReducer(state, { type: "message", message, receivedAt: Date.now() });
      },
    });
    stream.start();
    for (let i = 0; i < 80; i++) vi.advanceTimersByTime(125);
    stream.stop();

    const types = new Set(messages.map((m) => m.type));
    expect(types.has("init")).toBe(true);
    expect(types.has("frame")).toBe(true);
    expect(types.has("timing")).toBe(true);
    expect(types.has("playback")).toBe(true);
    expect(state.drivers.size).toBe(22);
    expect(state.frame?.cars.size).toBe(22);
    expect(state.timing.length).toBe(22);
    expect(state.timing[0].pos).toBe(1);
    expect(state.timing.every((r) => typeof r.gap === "string" || r.gap === null)).toBe(true);
    expect(state.sources?.positionsAvailable).toBe(true);
    expect(state.timeline?.end).toBeGreaterThan(3600000);
    expect(state.lap?.total).toBe(53);
  });

  it("seeks, pauses and reports playback", async () => {
    const payload = await buildPayload();
    const messages: LiveMessage[] = [];
    const stream = new MockLiveStream(payload, { onMessage: (m) => messages.push(m) });
    stream.start();
    stream.command({ cmd: "seek", t: 3600000 });
    stream.command({ cmd: "pause" });
    const playback = messages.filter((m) => m.type === "playback");
    expect(playback.length).toBeGreaterThanOrEqual(3);
    const last = playback[playback.length - 1];
    expect(last.type === "playback" && last.paused).toBe(true);
    const timing = [...messages].reverse().find((m) => m.type === "timing");
    expect(timing && timing.type === "timing" && timing.lap && timing.lap.current).toBeGreaterThan(10);
    stream.stop();
  });

  it("sends the full pit history after a seek, without announcing the same stops again", async () => {
    const payload = await buildPayload();
    let state: LiveState = initialLiveState();
    const stream = new MockLiveStream(payload, { onMessage: (message) => (state = liveReducer(state, { type: "message", message, receivedAt: Date.now() })) });
    stream.start();
    stream.command({ cmd: "seek", t: 3600000 });
    vi.advanceTimersByTime(1000);
    stream.stop();
    const pitsInTower = state.timing.reduce((sum, row) => sum + (row.pits ?? 0), 0);
    expect(pitsInTower).toBeGreaterThan(0);
    expect(state.pitStops.length).toBe(pitsInTower);
    for (const row of state.timing) {
      const own = state.pitStops.filter((p) => p.number === row.number);
      expect(own.length).toBe(row.pits ?? 0);
      expect(own.every((p) => p.lap !== null && p.compound !== null && p.t <= 3600000 + 2000)).toBe(true);
    }
  });

  it("walks the outline continuously", () => {
    const outline: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    expect(pointOnOutline(outline, 0)).toEqual([0, 0]);
    expect(pointOnOutline(outline, 0.125)).toEqual([50, 0]);
    expect(pointOnOutline(outline, 1)).toEqual([0, 0]);
  });
});
