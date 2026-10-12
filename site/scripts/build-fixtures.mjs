// Builds the fixtures in src/lib/data/fixtures from:
//   - the Jolpica database dump (v2/data/raw/jolpica/dump/csv), for history, laps, pit stops
//   - the Jolpica API snapshots in scripts/raw (2026 calendar, entries, standings, results)
//   - the track outlines in scripts/raw/tracks
// Run with: node scripts/build-fixtures.mjs

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DUMP = resolveDumpDir();
const RAW = path.join(ROOT, "scripts/raw");
const OUT = path.join(ROOT, "src/lib/data/fixtures");
const CURRENT_SEASON = 2026;
const LAP_SEASONS = [2024, 2025, 2026];

const TEAM_COLORS_2026 = {
  mercedes: "#27F4D2",
  ferrari: "#E8002D",
  mclaren: "#FF8000",
  red_bull: "#3671C6",
  rb: "#6692FF",
  alpine: "#FF87BC",
  haas: "#B6BABD",
  audi: "#FF2D00",
  cadillac: "#C8A24A",
  williams: "#64C4FF",
  aston_martin: "#229971",
};

const TEAM_COLORS_HISTORIC = {
  sauber: "#52E252",
  alphatauri: "#5E8FAA",
  alfa: "#C92D4B",
  racing_point: "#F596C8",
  renault: "#FFF500",
  toro_rosso: "#469BFF",
  force_india: "#F596C8",
  lotus_f1: "#FFB800",
  brawn: "#B9F321",
  bmw_sauber: "#1F3FBF",
  toyota: "#CC0000",
  honda: "#CFCFCF",
  jaguar: "#0A5F38",
  jordan: "#F2C800",
  minardi: "#1D1D1D",
  benetton: "#2BBF9B",
  tyrrell: "#1F4FBF",
  brabham: "#2E6B4F",
  lotus: "#1C6B3A",
  cooper: "#2A5A2A",
  maserati: "#C00000",
  vanwall: "#1F6B3A",
  matra: "#1F4FBF",
  ligier: "#2D6BD6",
  arrows: "#F08A1D",
  stewart: "#FFFFFF",
  bar: "#D9D9D9",
};

const TRACK_FILES = [
  { file: "61.json", circuitId: "marina_bay" },
  { file: "39.json", circuitId: "monza" },
  { file: "9.json", circuitId: "americas" },
];

main();

function resolveDumpDir() {
  const dumpRoot = path.resolve(ROOT, "../data/raw/jolpica/dump");
  const pointer = JSON.parse(fs.readFileSync(path.join(dumpRoot, "current.json"), "utf8"));
  return path.join(dumpRoot, pointer.folder, "csv");
}

function main() {
  const dump = loadDump();
  const api = loadApi();
  fs.mkdirSync(OUT, { recursive: true });

  const seasons = buildSeasons(dump, api);
  writeJson("history/seasons.json", seasons.summary);
  for (const season of seasons.full) {
    writeJson(`seasons/${season.season}.json`, season);
  }

  const drivers = buildDrivers(dump, seasons.full);
  writeJson("history/drivers.json", drivers);

  const constructors = buildConstructors(dump, seasons.full);
  writeJson("history/constructors.json", constructors);

  const circuits = buildCircuits(dump, seasons.full);
  writeJson("history/circuits.json", circuits);

  const lapFiles = buildLaps(dump);
  for (const lapFile of lapFiles) {
    writeJson(`laps/${lapFile.season}-${lapFile.round}.json`, lapFile);
  }

  for (const track of TRACK_FILES) {
    const normalized = buildTrack(track);
    writeJson(`tracks/${track.circuitId}.json`, normalized);
  }

  const index = {
    generatedAt: new Date().toISOString(),
    currentSeason: CURRENT_SEASON,
    seasons: seasons.full.map((s) => s.season),
    lapFiles: lapFiles.map((l) => ({ season: l.season, round: l.round })),
    tracks: TRACK_FILES.map((t) => t.circuitId),
  };
  writeJson("index.json", index);
  console.log("fixtures written to", OUT);
}

// ---------------------------------------------------------------------------
// Seasons: calendar, results, qualifying, sprint, standings progression
// ---------------------------------------------------------------------------

function buildSeasons(dump, api) {
  const seasonsById = dump.seasons;
  const full = [];
  const summary = [];
  const years = Object.values(seasonsById)
    .map((s) => s.year)
    .sort((a, b) => a - b);

  for (const year of years) {
    const seasonRow = Object.values(seasonsById).find((s) => s.year === year);
    const rounds = Object.values(dump.rounds)
      .filter((r) => r.season_id === seasonRow.id)
      .sort((a, b) => Number(a.number || 99) - Number(b.number || 99));
    const races = [];
    for (const round of rounds) {
      if (!round.number) continue;
      const race = buildRace(dump, year, round);
      races.push(race);
    }
    const season = {
      season: year,
      races,
      standings: buildStandingsFromDump(dump, year),
    };
    if (year === CURRENT_SEASON) {
      mergeApiSeason(season, api);
    }
    full.push(season);
    summary.push(summarizeSeason(season));
  }
  return { full, summary };
}

function buildRace(dump, year, round) {
  const circuit = dump.circuits[round.circuit_id];
  const sessions = Object.values(dump.sessions)
    .filter((s) => s.round_id === round.id)
    .sort((a, b) => Number(a.number) - Number(b.number));
  const sessionTimes = {};
  for (const s of sessions) {
    if (!s.timestamp) continue;
    const iso = toIso(s.timestamp);
    const key = sessionKey(s.type);
    if (key && !sessionTimes[key]) sessionTimes[key] = iso;
  }
  const raceSession = sessions.find((s) => s.type === "R");
  const sprintSession = sessions.find((s) => s.type === "SR");
  const race = {
    season: year,
    round: Number(round.number),
    raceName: round.name,
    circuitId: circuit.reference,
    circuitName: circuit.name,
    locality: circuit.locality,
    country: circuit.country,
    countryCode: circuit.country_code,
    date: round.date,
    time: sessionTimes.race || null,
    sessions: sessionTimes,
    hasSprint: Boolean(sprintSession),
    scheduledLaps: raceSession && raceSession.scheduled_laps ? Number(raceSession.scheduled_laps) : null,
    cancelled: round.is_cancelled === "t",
    url: round.wikipedia,
    results: raceSession ? buildSessionResults(dump, raceSession, round, year) : [],
    sprint: sprintSession ? buildSessionResults(dump, sprintSession, round, year) : [],
    qualifying: buildQualifying(dump, sessions, round, year),
  };
  return race;
}

function buildSessionResults(dump, session, round, year) {
  const entries = dump.sessionEntriesBySession[session.id] || [];
  const rows = [];
  for (const entry of entries) {
    const identity = resolveEntry(dump, entry.round_entry_id, year);
    if (!identity) continue;
    rows.push({
      position: entry.position ? Number(entry.position) : null,
      positionText: positionText(entry),
      driverId: identity.driverId,
      constructorId: identity.constructorId,
      number: identity.number,
      grid: entry.grid ? Number(entry.grid) : null,
      laps: entry.laps_completed ? Number(entry.laps_completed) : null,
      status: entry.detail || statusName(entry.status),
      classified: entry.is_classified === "t",
      points: entry.points ? Number(entry.points) : 0,
      timeMs: entry.time ? durationToMs(entry.time) : null,
      fastestLapRank: entry.fastest_lap_rank ? Number(entry.fastest_lap_rank) : null,
    });
  }
  rows.sort(sortResults);
  return rows;
}

function buildQualifying(dump, sessions, round, year) {
  const qualiSessions = sessions.filter((s) => ["Q1", "Q2", "Q3", "QB", "QA", "QO"].includes(s.type));
  if (qualiSessions.length === 0) return [];
  const byDriver = new Map();
  for (const session of qualiSessions) {
    const entries = dump.sessionEntriesBySession[session.id] || [];
    for (const entry of entries) {
      const identity = resolveEntry(dump, entry.round_entry_id, year);
      if (!identity) continue;
      let row = byDriver.get(identity.driverId);
      if (!row) {
        row = {
          position: null,
          driverId: identity.driverId,
          constructorId: identity.constructorId,
          number: identity.number,
          q1: null,
          q2: null,
          q3: null,
        };
        byDriver.set(identity.driverId, row);
      }
      const ms = entry.time ? durationToMs(entry.time) : null;
      if (session.type === "Q1" || session.type === "QB" || session.type === "QA" || session.type === "QO") {
        if (row.q1 === null || (ms !== null && ms < row.q1)) row.q1 = ms;
      }
      if (session.type === "Q2") row.q2 = ms;
      if (session.type === "Q3") row.q3 = ms;
      if (entry.position) {
        const pos = Number(entry.position);
        if (session.type === "Q3" || row.position === null || pos < row.position) {
          row.position = pos;
        }
      }
    }
  }
  const rows = [...byDriver.values()];
  rows.sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  return rows;
}

function buildStandingsFromDump(dump, year) {
  const driverRows = dump.driverChampionship.filter((r) => Number(r.year) === year);
  const teamRows = dump.teamChampionship.filter((r) => Number(r.year) === year);
  return {
    drivers: progression(dump, driverRows, "driver_id", (id) => dump.drivers[id].reference),
    constructors: progression(dump, teamRows, "team_id", (id) => dump.teams[id].reference),
  };
}

function progression(dump, rows, idField, toRef) {
  const byEntity = new Map();
  for (const row of rows) {
    const key = row[idField];
    if (!key) continue;
    let entry = byEntity.get(key);
    if (!entry) {
      entry = { id: toRef(key), rounds: new Map() };
      byEntity.set(key, entry);
    }
    const roundNumber = Number(row.round_number);
    const existing = entry.rounds.get(roundNumber);
    const sessionNumber = Number(row.session_number || 0);
    if (!existing || sessionNumber >= existing.sessionNumber) {
      entry.rounds.set(roundNumber, {
        sessionNumber,
        points: Number(row.points || 0),
        position: row.position ? Number(row.position) : null,
        wins: Number(row.win_count || 0),
      });
    }
  }
  const maxRound = Math.max(0, ...rows.map((r) => Number(r.round_number)));
  const list = [];
  for (const entry of byEntity.values()) {
    const points = [];
    const positions = [];
    let last = { points: 0, position: null, wins: 0 };
    for (let r = 1; r <= maxRound; r++) {
      const atRound = entry.rounds.get(r);
      if (atRound) last = atRound;
      points.push(last.points);
      positions.push(last.position);
    }
    list.push({
      id: entry.id,
      position: last.position,
      points: last.points,
      wins: last.wins,
      pointsByRound: points,
      positionByRound: positions,
    });
  }
  list.sort((a, b) => (a.position ?? 99) - (b.position ?? 99) || b.points - a.points);
  return { rounds: maxRound, list };
}

function mergeApiSeason(season, api) {
  const apiRaces = api.races;
  const byRound = new Map(season.races.map((r) => [r.round, r]));
  for (const apiRace of apiRaces) {
    const round = Number(apiRace.round);
    let race = byRound.get(round);
    if (!race) {
      race = {
        season: CURRENT_SEASON,
        round,
        results: [],
        sprint: [],
        qualifying: [],
        cancelled: false,
        scheduledLaps: null,
      };
      season.races.push(race);
      byRound.set(round, race);
    }
    race.raceName = apiRace.raceName;
    race.circuitId = apiRace.Circuit.circuitId;
    race.circuitName = apiRace.Circuit.circuitName;
    race.locality = apiRace.Circuit.Location.locality;
    race.country = apiRace.Circuit.Location.country;
    race.date = apiRace.date;
    race.time = apiRace.time ? `${apiRace.date}T${apiRace.time}` : race.time;
    race.url = apiRace.url;
    race.hasSprint = Boolean(apiRace.Sprint);
    race.sessions = {
      fp1: isoFromApi(apiRace.FirstPractice),
      fp2: isoFromApi(apiRace.SecondPractice),
      fp3: isoFromApi(apiRace.ThirdPractice),
      sprintQualifying: isoFromApi(apiRace.SprintQualifying),
      sprint: isoFromApi(apiRace.Sprint),
      qualifying: isoFromApi(apiRace.Qualifying),
      race: race.time,
    };
    for (const key of Object.keys(race.sessions)) {
      if (!race.sessions[key]) delete race.sessions[key];
    }
    const apiResults = api.results.get(round);
    if (apiResults) {
      race.results = apiResults.map(apiResultRow).sort(sortResults);
      race.scheduledLaps = race.scheduledLaps || Math.max(...race.results.map((r) => r.laps || 0));
    }
    const apiSprint = api.sprint.get(round);
    if (apiSprint) {
      race.sprint = apiSprint.map(apiResultRow).sort(sortResults);
    }
    const apiQuali = api.qualifying.get(round);
    if (apiQuali) {
      race.qualifying = apiQuali.map(apiQualifyingRow);
    }
  }
  season.races.sort((a, b) => a.round - b.round);
  season.standings = buildStandingsFromResults(season, api);
}

function buildStandingsFromResults(season, api) {
  const completed = season.races.filter((r) => r.results.length > 0);
  const roundsDone = completed.length;
  const driverPoints = new Map();
  const constructorPoints = new Map();
  const driverTeams = new Map();
  const driverWins = new Map();
  const constructorWins = new Map();
  const driverByRound = new Map();
  const constructorByRound = new Map();

  for (const race of completed) {
    for (const session of [race.sprint, race.results]) {
      for (const row of session) {
        driverPoints.set(row.driverId, (driverPoints.get(row.driverId) || 0) + row.points);
        constructorPoints.set(row.constructorId, (constructorPoints.get(row.constructorId) || 0) + row.points);
        const teams = driverTeams.get(row.driverId) || [];
        if (!teams.includes(row.constructorId)) teams.push(row.constructorId);
        driverTeams.set(row.driverId, teams);
      }
    }
    for (const row of race.results) {
      if (row.position === 1) {
        driverWins.set(row.driverId, (driverWins.get(row.driverId) || 0) + 1);
        constructorWins.set(row.constructorId, (constructorWins.get(row.constructorId) || 0) + 1);
      }
    }
    for (const [id, pts] of driverPoints) {
      const arr = driverByRound.get(id) || [];
      while (arr.length < race.round - 1) arr.push(arr.length ? arr[arr.length - 1] : 0);
      arr.push(pts);
      driverByRound.set(id, arr);
    }
    for (const [id, pts] of constructorPoints) {
      const arr = constructorByRound.get(id) || [];
      while (arr.length < race.round - 1) arr.push(arr.length ? arr[arr.length - 1] : 0);
      arr.push(pts);
      constructorByRound.set(id, arr);
    }
  }

  const driverList = [...driverPoints.keys()].map((id) => ({
    id,
    points: driverPoints.get(id),
    wins: driverWins.get(id) || 0,
    constructorIds: driverTeams.get(id),
    pointsByRound: padTo(driverByRound.get(id), roundsDone),
  }));
  rankList(driverList, api.driverStandings);
  const constructorList = [...constructorPoints.keys()].map((id) => ({
    id,
    points: constructorPoints.get(id),
    wins: constructorWins.get(id) || 0,
    pointsByRound: padTo(constructorByRound.get(id), roundsDone),
  }));
  rankList(constructorList, api.constructorStandings);
  attachPositionsByRound(driverList, roundsDone);
  attachPositionsByRound(constructorList, roundsDone);
  return {
    drivers: { rounds: roundsDone, list: driverList },
    constructors: { rounds: roundsDone, list: constructorList },
  };
}

function rankList(list, apiOrder) {
  const order = new Map(apiOrder.map((row, i) => [row.id, i]));
  list.sort((a, b) => {
    const ai = order.has(a.id) ? order.get(a.id) : 999;
    const bi = order.has(b.id) ? order.get(b.id) : 999;
    if (ai !== bi) return ai - bi;
    return b.points - a.points;
  });
  list.forEach((row, i) => {
    row.position = i + 1;
    const apiRow = apiOrder.find((r) => r.id === row.id);
    if (apiRow && apiRow.points !== row.points) {
      console.warn(`points mismatch for ${row.id}: computed ${row.points}, api ${apiRow.points}`);
      row.points = apiRow.points;
    }
  });
}

function attachPositionsByRound(list, rounds) {
  for (let r = 0; r < rounds; r++) {
    const ranked = [...list].sort((a, b) => b.pointsByRound[r] - a.pointsByRound[r]);
    ranked.forEach((row, i) => {
      if (!row.positionByRound) row.positionByRound = [];
      row.positionByRound[r] = i + 1;
    });
  }
}

function summarizeSeason(season) {
  const driverLeader = season.standings.drivers.list[0];
  const constructorLeader = season.standings.constructors.list[0];
  const completed = season.races.filter((r) => r.results.length > 0).length;
  const total = season.races.filter((r) => !r.cancelled).length;
  const inProgress = season.season === CURRENT_SEASON;
  return {
    season: season.season,
    rounds: total,
    completedRounds: completed,
    inProgress,
    driverChampion: driverLeader
      ? { driverId: driverLeader.id, points: driverLeader.points, wins: driverLeader.wins, constructorId: leaderTeam(season, driverLeader.id) }
      : null,
    constructorChampion: constructorLeader && season.season >= 1958
      ? { constructorId: constructorLeader.id, points: constructorLeader.points, wins: constructorLeader.wins }
      : null,
  };
}

function leaderTeam(season, driverId) {
  for (let i = season.races.length - 1; i >= 0; i--) {
    const row = season.races[i].results.find((r) => r.driverId === driverId);
    if (row) return row.constructorId;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Drivers, constructors, circuits (career aggregates from the seasons built above)
// ---------------------------------------------------------------------------

function buildDrivers(dump, seasons) {
  const careers = new Map();
  for (const season of seasons) {
    for (const race of season.races) {
      for (const row of race.results) {
        const c = careerFor(careers, row.driverId);
        c.starts += 1;
        if (row.position === 1) {
          c.wins += 1;
          c.winList.push({ season: season.season, round: race.round, raceName: race.raceName, constructorId: row.constructorId });
        }
        if (row.position !== null && row.position <= 3) c.podiums += 1;
        if (row.grid === 1) c.poles += 1;
        if (row.fastestLapRank === 1) c.fastestLaps += 1;
        c.points += row.points;
        c.seasons.add(season.season);
        if (!c.teams.includes(row.constructorId)) c.teams.push(row.constructorId);
      }
      for (const row of race.sprint) {
        const c = careerFor(careers, row.driverId);
        c.points += row.points;
        if (row.position === 1) c.sprintWins += 1;
      }
    }
    for (const standing of season.standings.drivers.list) {
      const c = careerFor(careers, standing.id);
      c.seasonSummaries.push({
        season: season.season,
        position: standing.position,
        points: standing.points,
        wins: standing.wins,
        constructorIds: standing.constructorIds || teamsForDriverInSeason(season, standing.id),
      });
      if (standing.position === 1 && (season.season !== CURRENT_SEASON)) c.titles += 1;
    }
  }
  const list = [];
  for (const row of Object.values(dump.drivers)) {
    const career = careers.get(row.reference);
    if (!career) continue;
    const seasonsSorted = [...career.seasons].sort((a, b) => a - b);
    list.push({
      driverId: row.reference,
      code: row.abbreviation || null,
      number: row.permanent_car_number ? Number(row.permanent_car_number) : null,
      givenName: row.forename,
      familyName: row.surname,
      nationality: row.nationality || null,
      countryCode: row.country_code || null,
      dateOfBirth: row.date_of_birth || null,
      url: row.wikipedia || null,
      career: {
        starts: career.starts,
        wins: career.wins,
        sprintWins: career.sprintWins,
        podiums: career.podiums,
        poles: career.poles,
        fastestLaps: career.fastestLaps,
        points: round1(career.points),
        titles: career.titles,
        firstSeason: seasonsSorted[0] ?? null,
        lastSeason: seasonsSorted[seasonsSorted.length - 1] ?? null,
        constructorIds: career.teams,
      },
      seasons: career.seasonSummaries.sort((a, b) => a.season - b.season),
      wins: career.winList,
    });
  }
  list.sort((a, b) => a.familyName.localeCompare(b.familyName));
  return list;
}

function teamsForDriverInSeason(season, driverId) {
  const teams = [];
  for (const race of season.races) {
    for (const row of race.results) {
      if (row.driverId === driverId && !teams.includes(row.constructorId)) teams.push(row.constructorId);
    }
  }
  return teams;
}

function careerFor(map, id) {
  let c = map.get(id);
  if (!c) {
    c = { starts: 0, wins: 0, sprintWins: 0, podiums: 0, poles: 0, fastestLaps: 0, points: 0, titles: 0, seasons: new Set(), teams: [], seasonSummaries: [], winList: [] };
    map.set(id, c);
  }
  return c;
}

function buildConstructors(dump, seasons) {
  const careers = new Map();
  for (const season of seasons) {
    for (const race of season.races) {
      const seenThisRace = new Set();
      for (const row of race.results) {
        const c = careerFor(careers, row.constructorId);
        if (!seenThisRace.has(row.constructorId)) {
          c.starts += 1;
          seenThisRace.add(row.constructorId);
        }
        if (row.position === 1) c.wins += 1;
        if (row.position !== null && row.position <= 3) c.podiums += 1;
        if (row.grid === 1) c.poles += 1;
        c.points += row.points;
        c.seasons.add(season.season);
        if (!c.teams.includes(row.driverId)) c.teams.push(row.driverId);
      }
      for (const row of race.sprint) {
        const c = careerFor(careers, row.constructorId);
        c.points += row.points;
      }
    }
    for (const standing of season.standings.constructors.list) {
      const c = careerFor(careers, standing.id);
      c.seasonSummaries.push({ season: season.season, position: standing.position, points: standing.points, wins: standing.wins });
      if (standing.position === 1 && season.season >= 1958 && season.season !== CURRENT_SEASON) c.titles += 1;
    }
  }
  const list = [];
  for (const row of Object.values(dump.teams)) {
    const career = careers.get(row.reference);
    if (!career) continue;
    const seasonsSorted = [...career.seasons].sort((a, b) => a - b);
    list.push({
      constructorId: row.reference,
      name: row.name,
      nationality: row.nationality || null,
      countryCode: row.country_code || null,
      color: TEAM_COLORS_2026[row.reference] || TEAM_COLORS_HISTORIC[row.reference] || row.primary_color || "#8A8F98",
      url: row.wikipedia || null,
      career: {
        starts: career.starts,
        wins: career.wins,
        podiums: career.podiums,
        poles: career.poles,
        points: round1(career.points),
        titles: career.titles,
        firstSeason: seasonsSorted[0] ?? null,
        lastSeason: seasonsSorted[seasonsSorted.length - 1] ?? null,
        driverCount: career.teams.length,
      },
      seasons: career.seasonSummaries.sort((a, b) => a.season - b.season),
    });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function buildCircuits(dump, seasons) {
  const byCircuit = new Map();
  for (const season of seasons) {
    for (const race of season.races) {
      let c = byCircuit.get(race.circuitId);
      if (!c) {
        c = { races: [], years: new Set() };
        byCircuit.set(race.circuitId, c);
      }
      const winner = race.results.find((r) => r.position === 1);
      const pole = race.results.find((r) => r.grid === 1) || race.qualifying.find((q) => q.position === 1);
      c.races.push({
        season: season.season,
        round: race.round,
        raceName: race.raceName,
        winnerDriverId: winner ? winner.driverId : null,
        winnerConstructorId: winner ? winner.constructorId : null,
        poleDriverId: pole ? pole.driverId : null,
      });
      c.years.add(season.season);
    }
  }
  const lapRecords = computeLapRecords(dump);
  const list = [];
  for (const row of Object.values(dump.circuits)) {
    const c = byCircuit.get(row.reference);
    if (!c) continue;
    const years = [...c.years].sort((a, b) => a - b);
    list.push({
      circuitId: row.reference,
      name: row.name,
      locality: row.locality,
      country: row.country,
      countryCode: row.country_code || null,
      lat: Number(row.latitude),
      lng: Number(row.longitude),
      altitude: row.altitude ? Number(row.altitude) : null,
      url: row.wikipedia || null,
      firstSeason: years[0],
      lastSeason: years[years.length - 1],
      raceCount: c.races.length,
      lapRecord: lapRecords.get(row.reference) || null,
      races: c.races.sort((a, b) => b.season - a.season),
    });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function computeLapRecords(dump) {
  const records = new Map();
  for (const lap of dump.fastestLaps) {
    const entry = dump.sessionEntries[lap.session_entry_id];
    if (!entry) continue;
    const session = dump.sessions[entry.session_id];
    if (!session || session.type !== "R") continue;
    const round = dump.rounds[session.round_id];
    const circuit = dump.circuits[round.circuit_id];
    const year = dump.seasons[round.season_id].year;
    const identity = resolveEntry(dump, entry.round_entry_id, year);
    const ms = durationToMs(lap.time);
    if (!ms || !identity) continue;
    const existing = records.get(circuit.reference);
    if (!existing || ms < existing.timeMs) {
      records.set(circuit.reference, { timeMs: ms, driverId: identity.driverId, constructorId: identity.constructorId, season: year });
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Laps and pit stops per race (recent seasons only)
// ---------------------------------------------------------------------------

function buildLaps(dump) {
  const files = [];
  const lapSeasonIds = new Set(
    Object.values(dump.seasons)
      .filter((s) => LAP_SEASONS.includes(s.year))
      .map((s) => s.id),
  );
  const raceSessions = Object.values(dump.sessions).filter((s) => {
    const round = dump.rounds[s.round_id];
    return s.type === "R" && round && lapSeasonIds.has(round.season_id);
  });
  for (const session of raceSessions) {
    const round = dump.rounds[session.round_id];
    const year = dump.seasons[round.season_id].year;
    const entries = dump.sessionEntriesBySession[session.id] || [];
    if (entries.length === 0) continue;
    const laps = {};
    const pitStops = [];
    let any = false;
    for (const entry of entries) {
      const identity = resolveEntry(dump, entry.round_entry_id, year);
      if (!identity) continue;
      const entryLaps = dump.lapsBySessionEntry[entry.id] || [];
      if (entryLaps.length === 0) continue;
      any = true;
      laps[identity.driverId] = entryLaps
        .map((l) => [Number(l.number), l.position ? Number(l.position) : null, durationToMs(l.time)])
        .sort((a, b) => a[0] - b[0]);
      const stops = dump.pitStopsBySessionEntry[entry.id] || [];
      for (const stop of stops) {
        const lap = dump.lapNumberById[stop.lap_id];
        pitStops.push({
          driverId: identity.driverId,
          stop: Number(stop.number),
          lap: lap ? Number(lap) : null,
          durationMs: durationToMs(stop.duration),
          localTime: stop.local_timestamp || null,
        });
      }
    }
    if (!any) continue;
    pitStops.sort((a, b) => (a.lap ?? 0) - (b.lap ?? 0) || a.stop - b.stop);
    files.push({ season: year, round: Number(round.number), laps, pitStops });
  }
  files.sort((a, b) => a.season - b.season || a.round - b.round);
  return files;
}

// ---------------------------------------------------------------------------
// Track outlines
// ---------------------------------------------------------------------------

function buildTrack(track) {
  const raw = readJson(path.join(RAW, "tracks", track.file));
  const outline = raw.x.map((x, i) => [Math.round(x), Math.round(raw.y[i])]);
  const corners = raw.corners.map((c) => ({
    number: c.number,
    x: Math.round(c.trackPosition.x),
    y: Math.round(c.trackPosition.y),
    angle: Math.round(c.angle * 10) / 10,
    length: Math.round(c.length),
  }));
  const sectors = raw.marshalSectors.map((s) => ({
    number: s.number,
    x: Math.round(s.trackPosition.x),
    y: Math.round(s.trackPosition.y),
    length: Math.round(s.length),
  }));
  return {
    circuitId: track.circuitId,
    name: raw.circuitName,
    country: raw.countryName,
    rotation: raw.rotation,
    outline,
    corners,
    sectors,
    source: "multiviewer.app circuits API, 2025 layout",
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function loadDump() {
  const seasons = indexById(readCsv("formula_one_season.csv"));
  const rounds = indexById(readCsv("formula_one_round.csv"));
  const circuits = indexById(readCsv("formula_one_circuit.csv"));
  const drivers = indexById(readCsv("formula_one_driver.csv"));
  const teams = indexById(readCsv("formula_one_team.csv"));
  const teamDrivers = indexById(readCsv("formula_one_teamdriver.csv"));
  const roundEntries = indexById(readCsv("formula_one_roundentry.csv"));
  const sessions = indexById(readCsv("formula_one_session.csv"));
  const sessionEntryRows = readCsv("formula_one_sessionentry.csv");
  const sessionEntries = indexById(sessionEntryRows);
  const sessionEntriesBySession = groupBy(sessionEntryRows, "session_id");
  const driverChampionship = readCsv("formula_one_driverchampionship.csv");
  const teamChampionship = readCsv("formula_one_teamchampionship.csv");

  for (const season of Object.values(seasons)) season.year = Number(season.year);
  const lapSeasonIds = new Set(
    Object.values(seasons)
      .filter((s) => LAP_SEASONS.includes(s.year))
      .map((s) => s.id),
  );
  const keepEntries = new Set();
  for (const entry of sessionEntryRows) {
    const session = sessions[entry.session_id];
    const round = session ? rounds[session.round_id] : null;
    if (round && lapSeasonIds.has(round.season_id) && session.type === "R") keepEntries.add(entry.id);
  }
  const lapRows = readCsv("formula_one_lap.csv");
  const lapsBySessionEntry = {};
  const lapNumberById = {};
  const fastestLaps = [];
  for (const lap of lapRows) {
    if (lap.is_entry_fastest_lap === "t") fastestLaps.push(lap);
    if (!keepEntries.has(lap.session_entry_id)) continue;
    lapNumberById[lap.id] = lap.number;
    const arr = lapsBySessionEntry[lap.session_entry_id] || (lapsBySessionEntry[lap.session_entry_id] = []);
    arr.push(lap);
  }
  const pitStopRows = readCsv("formula_one_pitstop.csv");
  const pitStopsBySessionEntry = groupBy(pitStopRows.filter((p) => keepEntries.has(p.session_entry_id)), "session_entry_id");

  return {
    seasons,
    rounds,
    circuits,
    drivers,
    teams,
    teamDrivers,
    roundEntries,
    sessions,
    sessionEntries,
    sessionEntriesBySession,
    driverChampionship,
    teamChampionship,
    lapsBySessionEntry,
    lapNumberById,
    fastestLaps,
    pitStopsBySessionEntry,
  };
}

function loadApi() {
  const races = readJson(path.join(RAW, "2026-races.json")).MRData.RaceTable.Races;
  const results = collectRaceTables("2026-results", "Results");
  const qualifying = collectRaceTables("2026-qualifying", "QualifyingResults");
  const sprint = collectRaceTables("2026-sprint", "SprintResults");
  const driverStandings = readJson(path.join(RAW, "2026-driverStandings.json")).MRData.StandingsTable.StandingsLists[0].DriverStandings.map((r) => ({
    id: r.Driver.driverId,
    points: Number(r.points),
  }));
  const constructorStandings = readJson(path.join(RAW, "2026-constructorStandings.json")).MRData.StandingsTable.StandingsLists[0].ConstructorStandings.map((r) => ({
    id: r.Constructor.constructorId,
    points: Number(r.points),
  }));
  return { races, results, qualifying, sprint, driverStandings, constructorStandings };
}

function collectRaceTables(prefix, key) {
  const byRound = new Map();
  const files = fs.readdirSync(RAW).filter((f) => f.startsWith(prefix + "-") && f.endsWith(".json"));
  for (const file of files) {
    const json = readJson(path.join(RAW, file));
    for (const race of json.MRData.RaceTable.Races) {
      const round = Number(race.round);
      const arr = byRound.get(round) || [];
      arr.push(...(race[key] || []));
      byRound.set(round, arr);
    }
  }
  return byRound;
}

function apiResultRow(r) {
  return {
    position: r.position ? Number(r.position) : null,
    positionText: r.positionText,
    driverId: r.Driver.driverId,
    constructorId: r.Constructor.constructorId,
    number: r.number ? Number(r.number) : null,
    grid: r.grid ? Number(r.grid) : null,
    laps: r.laps ? Number(r.laps) : null,
    status: r.status,
    classified: /^\d+$/.test(r.positionText),
    points: Number(r.points || 0),
    timeMs: r.Time && r.Time.millis ? Number(r.Time.millis) : null,
    fastestLapRank: r.FastestLap && r.FastestLap.rank ? Number(r.FastestLap.rank) : null,
    fastestLapMs: r.FastestLap && r.FastestLap.Time ? durationToMs(r.FastestLap.Time.time) : null,
    fastestLapNumber: r.FastestLap && r.FastestLap.lap ? Number(r.FastestLap.lap) : null,
  };
}

function apiQualifyingRow(q) {
  return {
    position: Number(q.position),
    driverId: q.Driver.driverId,
    constructorId: q.Constructor.constructorId,
    number: q.number ? Number(q.number) : null,
    q1: q.Q1 ? durationToMs(q.Q1) : null,
    q2: q.Q2 ? durationToMs(q.Q2) : null,
    q3: q.Q3 ? durationToMs(q.Q3) : null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveEntry(dump, roundEntryId, year) {
  const roundEntry = dump.roundEntries[roundEntryId];
  if (!roundEntry) return null;
  const teamDriver = dump.teamDrivers[roundEntry.team_driver_id];
  if (!teamDriver) return null;
  const driver = dump.drivers[teamDriver.driver_id];
  const team = dump.teams[teamDriver.team_id];
  if (!driver || !team) return null;
  return {
    driverId: driver.reference,
    constructorId: team.reference,
    number: roundEntry.car_number ? Number(roundEntry.car_number) : null,
    year,
  };
}

function sessionKey(type) {
  switch (type) {
    case "FP1":
      return "fp1";
    case "FP2":
      return "fp2";
    case "FP3":
      return "fp3";
    case "Q1":
    case "QB":
    case "QA":
    case "QO":
      return "qualifying";
    case "SQ1":
      return "sprintQualifying";
    case "SR":
      return "sprint";
    case "R":
      return "race";
    default:
      return null;
  }
}

function positionText(entry) {
  if (entry.is_classified === "t" && entry.position) return String(entry.position);
  if (entry.status === "11" || /retired/i.test(entry.detail || "")) return "R";
  if (/disqualified/i.test(entry.detail || "")) return "D";
  if (/did not start/i.test(entry.detail || "")) return "W";
  if (/did not qualify/i.test(entry.detail || "")) return "F";
  return entry.position ? String(entry.position) : "N";
}

function statusName(code) {
  const names = {
    0: "Finished",
    1: "Lapped",
    10: "Accident",
    11: "Retired",
    20: "Disqualified",
    30: "Did not start",
    40: "Did not qualify",
  };
  return names[code] || "Unknown";
}

function sortResults(a, b) {
  const ac = a.classified ? 0 : 1;
  const bc = b.classified ? 0 : 1;
  if (ac !== bc) return ac - bc;
  return (a.position ?? 99) - (b.position ?? 99);
}

function toIso(timestamp) {
  return timestamp.replace(" ", "T").replace("+00:00", "Z");
}

function isoFromApi(session) {
  if (!session) return null;
  return session.time ? `${session.date}T${session.time}` : `${session.date}T00:00:00Z`;
}

function durationToMs(text) {
  if (!text) return null;
  const parts = text.split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p))) return null;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return Math.round(seconds * 1000);
}

function padTo(arr, length) {
  const out = arr ? [...arr] : [];
  while (out.length < length) out.push(out.length ? out[out.length - 1] : 0);
  return out;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function indexById(rows) {
  const out = {};
  for (const row of rows) out[row.id] = row;
  return out;
}

function groupBy(rows, key) {
  const out = {};
  for (const row of rows) {
    const arr = out[row[key]] || (out[row[key]] = []);
    arr.push(row);
  }
  return out;
}

function readCsv(name) {
  const text = fs.readFileSync(path.join(DUMP, name), "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = values[j] ?? "";
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(rel, data) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}
