import { describe, expect, it } from "vitest";
import { addTeam, decodePlannerState, decodeTeamQuery, defaultPlannerState, defaultPlannerTeams, dropInvalidPicks, emptyTeam, encodePlannerState, encodeTeamQuery, isTeamComplete, MAX_TEAMS, mergeSharedTeam, normalizeConstraints, sanitizeTeams, teamsFromLegacy, toggleBanned, toggleLocked, type SavedTeam } from "./planner-state";

describe("planner state codec", () => {
  it("round-trips a full state through the query string", () => {
    const state = {
      ...defaultPlannerState(),
      drivers: ["max_verstappen", "hamilton", "antonelli", "lawson", "bearman"],
      constructors: ["mercedes", "haas"],
      bank: 2.5,
      chipsAvailable: ["wildcard" as const, "autopilot" as const],
      chipToPlay: "wildcard" as const,
      risk: "safe" as const,
      locked: ["hamilton"],
      banned: ["stroll"],
    };
    const query = encodePlannerState(state);
    expect(query.startsWith("?")).toBe(true);
    const decoded = decodePlannerState(query);
    expect(decoded).toEqual(state);
    expect(isTeamComplete(decoded)).toBe(true);
  });

  it("encodes an empty default state as an empty string and tolerates junk", () => {
    expect(encodePlannerState(defaultPlannerState())).toBe("");
    const decoded = decodePlannerState("?d=ver,,,,&c=,&ft=99&play=nonsense&risk=wild");
    expect(decoded.drivers).toEqual(["ver", null, null, null, null]);
    expect(decoded.constructors).toEqual([null, null]);
    expect(decoded.chipToPlay).toBeNull();
    expect(decoded.risk).toBe("expected");
    expect(isTeamComplete(decoded)).toBe(false);
  });

  it("does not treat a team with a repeated pick as complete", () => {
    const state = { ...defaultPlannerState(), drivers: ["russell", "russell", "hamilton", "norris", "leclerc"], constructors: ["mercedes", "mclaren"] };
    expect(isTeamComplete(state)).toBe(false);
  });

  it("drops unknown and repeated picks from a shared link", () => {
    const state = { ...defaultPlannerState(), drivers: ["russell", "russell", "nobody", null, "norris"], constructors: ["mercedes", "mercedes"] };
    const cleaned = dropInvalidPicks(state, (id) => id !== "nobody");
    expect(cleaned.drivers).toEqual(["russell", null, null, null, "norris"]);
    expect(cleaned.constructors).toEqual(["mercedes", null]);
  });
});

describe("optimiser locks and excludes", () => {
  const assets = [
    { id: "d1", kind: "driver" as const },
    { id: "d2", kind: "driver" as const },
    { id: "d3", kind: "driver" as const },
    { id: "d4", kind: "driver" as const },
    { id: "d5", kind: "driver" as const },
    { id: "d6", kind: "driver" as const },
    { id: "c1", kind: "constructor" as const },
    { id: "c2", kind: "constructor" as const },
    { id: "c3", kind: "constructor" as const },
  ];

  it("drops unknown and repeated ids, lets an exclude win, caps locks per kind", () => {
    const state = { ...defaultPlannerState(), locked: ["d1", "ghost", "d1", "d2", "c1", "c2", "c3", "d3"], banned: ["d3", "ghost", "d3"] };
    const clean = normalizeConstraints(state, assets);
    expect(clean.locked).toEqual(["d1", "d2", "c1", "c2"]);
    expect(clean.banned).toEqual(["d3"]);
  });

  it("toggles lock and exclude as mutually exclusive and refuses a sixth driver lock", () => {
    let state = defaultPlannerState();
    for (const id of ["d1", "d2", "d3", "d4", "d5"]) state = toggleLocked(state, { id, kind: "driver" }, assets);
    expect(state.locked).toHaveLength(5);
    const refused = toggleLocked(state, { id: "d6", kind: "driver" }, assets);
    expect(refused).toBe(state);
    state = toggleBanned(state, { id: "d1", kind: "driver" });
    expect(state.locked).not.toContain("d1");
    expect(state.banned).toEqual(["d1"]);
    state = toggleLocked(state, { id: "d1", kind: "driver" }, assets);
    expect(state.locked).toContain("d1");
    expect(state.banned).toEqual([]);
    state = toggleLocked(state, { id: "d1", kind: "driver" }, assets);
    expect(state.locked).not.toContain("d1");
  });

  it("persists locks and excludes through the URL and sanitises them after decoding", () => {
    const state = { ...defaultPlannerState(), locked: ["d1", "c1"], banned: ["d2"] };
    const query = encodePlannerState(state);
    expect(query).toContain("lock=d1%2Cc1");
    const decoded = decodePlannerState(query);
    expect(normalizeConstraints(decoded, assets)).toEqual(state);
  });
});

describe("saved teams", () => {
  const team: SavedTeam = { drivers: ["norris", "lawson", "bearman", "hulkenberg", "albon"], constructors: ["mclaren", "audi"], bank: 1.2 };

  it("adds empty teams up to the game's limit of three", () => {
    let state = defaultPlannerTeams();
    for (let i = 0; i < 5; i++) state = addTeam(state);
    expect(state.teams).toHaveLength(MAX_TEAMS);
    expect(state.active).toBe(MAX_TEAMS - 1);
    expect(state.teams[2]).toEqual(emptyTeam());
  });

  it("round-trips a team through the share link", () => {
    const params = encodeTeamQuery(team);
    const query = params.toString();
    expect(decodeTeamQuery(query)).toEqual(team);
    expect(encodeTeamQuery(emptyTeam()).toString()).toBe("");
    expect(decodeTeamQuery("?view=backtest")).toBeNull();
  });

  it("merges a shared team: selects a match, fills an empty team, then adds", () => {
    const start = defaultPlannerTeams();
    const filled = mergeSharedTeam(start, team);
    expect(filled.teams).toHaveLength(1);
    expect(filled.teams[0]).toEqual(team);
    const again = mergeSharedTeam({ ...filled, active: 0 }, { ...team, drivers: [...team.drivers].reverse() });
    expect(again.teams).toHaveLength(1);
    const other: SavedTeam = { ...team, constructors: ["ferrari", "audi"] };
    const added = mergeSharedTeam(filled, other);
    expect(added.teams).toHaveLength(2);
    expect(added.active).toBe(1);
  });

  it("migrates the old single-team save, turning its Cost Cap into the bank", () => {
    const legacy = { ...defaultPlannerState(), drivers: team.drivers, constructors: team.constructors, costCap: 104.3, locked: ["norris"] };
    const migrated = teamsFromLegacy(legacy, () => 14.6);
    expect(migrated.teams[0].bank).toBeCloseTo(2.1, 6);
    expect(migrated.locked).toEqual(["norris"]);
    const empty = teamsFromLegacy(defaultPlannerState(), () => 10);
    expect(empty.teams[0].bank).toBe(100);
  });

  it("drops unknown and repeated picks and keeps the active index in range", () => {
    const assets = [
      { id: "norris", kind: "driver" as const },
      { id: "mclaren", kind: "constructor" as const },
    ];
    const state = { teams: [{ ...team, drivers: ["norris", "norris", "nobody", null, null] }], active: 4, locked: ["ghost", "norris"], banned: [] };
    const clean = sanitizeTeams(state, assets);
    expect(clean.teams[0].drivers).toEqual(["norris", null, null, null, null]);
    expect(clean.teams[0].constructors).toEqual(["mclaren", null]);
    expect(clean.active).toBe(0);
    expect(clean.locked).toEqual(["norris"]);
  });
});
