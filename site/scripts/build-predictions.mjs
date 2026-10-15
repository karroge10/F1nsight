// Builds the prediction fixtures (src/lib/data/fixtures/predictions) that follow the
// contract in SPEC.md. The model is a transparent form-based Monte Carlo: it exists so the
// site has realistic, internally consistent numbers until the trained model publishes
// data/predictions/next.json. The same code also produces the backtest history files.
// Run with: node scripts/build-predictions.mjs

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURES = path.join(ROOT, "src/lib/data/fixtures");
const FANTASY_RAW = path.resolve(ROOT, "../data/raw/fantasy");
const SEASON = 2026;
const SIMS = 6000;
const HISTORY_ROUNDS = 7;
const MODEL_VERSION = "form-mc-0.3";

const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];
const FANTASY_RACE = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const FANTASY_QUALI = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const FANTASY_SPRINT = [8, 7, 6, 5, 4, 3, 2, 1];
const PRICE_CHANGE_BUCKETS = ["-0.6", "-0.3", "-0.2", "-0.1", "0", "0.1", "0.2", "0.3", "0.6"];

const TEAM_NAME_TO_ID = {
  Mercedes: "mercedes",
  Ferrari: "ferrari",
  "Red Bull Racing": "red_bull",
  McLaren: "mclaren",
  "Racing Bulls": "rb",
  Alpine: "alpine",
  "Haas F1 Team": "haas",
  Audi: "audi",
  Williams: "williams",
  Cadillac: "cadillac",
  "Aston Martin": "aston_martin",
};

const TEAM_TLA_TO_ID = {
  MER: "mercedes",
  FER: "ferrari",
  RBR: "red_bull",
  MCL: "mclaren",
  RBS: "rb",
  ALP: "alpine",
  HAA: "haas",
  AUD: "audi",
  WIL: "williams",
  CAD: "cadillac",
  AST: "aston_martin",
};

const STREET_CIRCUITS = new Set(["monaco", "baku", "marina_bay", "jeddah", "vegas", "miami", "madring", "albert_park", "villeneuve"]);

main();

function main() {
  const season = readJson(path.join(FIXTURES, `seasons/${SEASON}.json`));
  const constructors = readJson(path.join(FIXTURES, "history/constructors.json"));
  const drivers = readJson(path.join(FIXTURES, "history/drivers.json"));
  const circuits = readJson(path.join(FIXTURES, "history/circuits.json"));
  const fantasy = loadFantasy();
  const lookup = buildLookup(drivers, constructors, circuits, fantasy);

  const completed = season.races.filter((r) => r.results.length > 0);
  const nextRace = season.races.find((r) => r.results.length === 0 && !r.cancelled);
  const rng = makeRng(20261007);

  const backtest = [];
  const historyFiles = [];
  for (let i = 3; i < completed.length; i++) {
    const target = completed[i];
    const before = completed.slice(0, i);
    const forecast = forecastRace(target, before, season, lookup, fantasy, rng, { withChampionship: false });
    const actual = actualBlock(target);
    const scored = scoreForecast(forecast, actual);
    backtest.push(scored);
    if (i >= completed.length - HISTORY_ROUNDS) {
      historyFiles.push({ ...forecast, actual });
    }
  }
  const metrics = aggregateBacktest(backtest);

  fantasy.deadline = nextRace.sessions.sprintQualifying || nextRace.sessions.qualifying || nextRace.time || null;
  const next = forecastRace(nextRace, completed, season, lookup, fantasy, rng, { withChampionship: true });
  next.model.backtest = metrics;
  next.model.notes =
    "Form-based Monte Carlo placeholder: weighted recent race and qualifying form, team pace, reliability and circuit type, " +
    `${SIMS} simulated races. Replaced by the trained model when data/predictions/next.json is published.`;

  writeJson("predictions/next.json", next);
  for (const file of historyFiles) {
    writeJson(`predictions/history/${SEASON}-${file.race.round}.json`, file);
  }
  writeJson("fantasy/2026.json", buildFantasyFixture(fantasy, lookup));
  console.log(`next: ${next.race.raceName} (round ${next.race.round}), ${next.drivers.length} drivers, backtest over ${backtest.length} races`);
  console.log("backtest", JSON.stringify(metrics));
  console.log(
    next.drivers
      .slice(0, 6)
      .map((d) => `${d.code} win ${(d.pWin * 100).toFixed(0)}% exp ${d.expectedPosition.toFixed(1)}`)
      .join(" | "),
  );
}

// ---------------------------------------------------------------------------
// Forecast for one race
// ---------------------------------------------------------------------------

function forecastRace(race, before, season, lookup, fantasy, rng, options) {
  const entrants = currentEntrants(before, fantasy);
  const ratings = entrants.map((e) => rateDriver(e, before, race, lookup));
  const sim = simulateRace(ratings, rng, race.hasSprint);
  const quali = simulateQualifying(ratings, rng);

  const driverRows = ratings.map((rating, i) => {
    const dist = sim.positionDist[i];
    const expectedPosition = dist.reduce((acc, p, idx) => acc + p * (idx + 1), 0);
    const expectedPoints = dist.reduce((acc, p, idx) => acc + p * (RACE_POINTS[idx] || 0), 0);
    const info = lookup.drivers.get(rating.driverId) || {};
    const team = lookup.constructors.get(rating.constructorId) || {};
    const fantasyRow = fantasyForDriver(rating, sim, quali, i, fantasy, race, rng);
    return {
      driverId: rating.driverId,
      code: info.code || rating.code,
      number: rating.number ?? info.number ?? null,
      name: info.name || rating.driverId,
      constructorId: rating.constructorId,
      team: team.name || rating.constructorId,
      teamColor: team.color || "#8A8F98",
      grid: null,
      expectedPosition: round2(expectedPosition),
      positionDist: dist.map(round4),
      pDnf: round3(sim.pDnf[i]),
      pWin: round3(dist[0]),
      pPodium: round3(dist[0] + dist[1] + dist[2]),
      pPoints: round3(dist.slice(0, 10).reduce((a, b) => a + b, 0)),
      expectedPoints: round2(expectedPoints),
      fantasy: fantasyRow,
      reasons: reasonsFor(rating, race),
      factors: factorsFor(rating, race),
    };
  });
  driverRows.sort((a, b) => a.expectedPosition - b.expectedPosition);

  const constructorRows = constructorForecast(driverRows, ratings, sim, quali, fantasy, lookup, rng);

  const forecast = {
    generatedAt: new Date().toISOString(),
    model: {
      version: MODEL_VERSION,
      trainedAt: "2026-10-06T22:00:00Z",
      notes: "",
      backtest: null,
    },
    race: {
      season: SEASON,
      round: race.round,
      raceName: race.raceName,
      circuitId: race.circuitId,
      circuitName: race.circuitName,
      country: race.country,
      date: race.time || `${race.date}T00:00:00Z`,
      hasSprint: Boolean(race.hasSprint),
      stage: "pre-weekend",
      inputsUsed: [],
    },
    drivers: driverRows,
    constructors: constructorRows,
    championship: options.withChampionship ? simulateChampionship(season, before, ratings, lookup, rng) : { drivers: [], constructors: [] },
  };
  return forecast;
}

function currentEntrants(before, fantasy) {
  const lastRace = before[before.length - 1];
  const entrants = lastRace.results.map((r) => ({ driverId: r.driverId, constructorId: r.constructorId, number: r.number }));
  // Mid-season seat changes: the fantasy feed knows who is active for the next gameday.
  for (const asset of fantasy.activeDrivers) {
    const existing = entrants.find((e) => e.driverId === asset.driverId);
    if (existing) {
      existing.constructorId = asset.constructorId;
    }
  }
  return entrants;
}

function rateDriver(entrant, before, race, lookup) {
  const recent = before.slice(-8);
  const finishes = [];
  const qualis = [];
  const dnfs = [];
  const streetFinishes = [];
  let weightSum = 0;
  let weighted = 0;
  let qWeightSum = 0;
  let qWeighted = 0;
  recent.forEach((r, idx) => {
    const age = recent.length - 1 - idx;
    const w = Math.pow(0.78, age);
    const row = r.results.find((x) => x.driverId === entrant.driverId);
    if (row) {
      const dnf = !row.classified || row.positionText === "R" || row.positionText === "D" || row.positionText === "W";
      const pos = dnf ? Math.max(14, row.position ?? 18) : row.position;
      finishes.push({ pos, dnf, round: r.round, raceName: r.raceName, circuitId: r.circuitId, grid: row.grid, points: row.points });
      if (!dnf) {
        weighted += w * pos;
        weightSum += w;
      } else {
        weighted += w * 0.5 * pos;
        weightSum += w * 0.5;
      }
      dnfs.push(dnf ? 1 : 0);
      if (STREET_CIRCUITS.has(r.circuitId) && !dnf) streetFinishes.push(pos);
    }
    const q = r.qualifying.find((x) => x.driverId === entrant.driverId);
    if (q && q.position) {
      qualis.push(q.position);
      qWeighted += w * q.position;
      qWeightSum += w;
    }
  });
  const avgFinish = weightSum ? weighted / weightSum : 12;
  const avgQuali = qWeightSum ? qWeighted / qWeightSum : avgFinish;
  const teamRows = before
    .slice(-4)
    .flatMap((r) => r.results.filter((x) => x.constructorId === entrant.constructorId && x.classified))
    .map((x) => x.position);
  const teamAvg = teamRows.length ? teamRows.reduce((a, b) => a + b, 0) / teamRows.length : avgFinish;
  const seasonRows = before.flatMap((r) => r.results.filter((x) => x.driverId === entrant.driverId));
  const dnfRate = seasonRows.length ? seasonRows.filter((x) => !x.classified).length / seasonRows.length : 0.1;
  const wins = seasonRows.filter((x) => x.position === 1).length;
  const podiums = seasonRows.filter((x) => x.position !== null && x.position <= 3).length;
  const poles = before.flatMap((r) => r.qualifying.filter((q) => q.driverId === entrant.driverId && q.position === 1)).length;
  const classifiedPositions = finishes.filter((f) => !f.dnf).map((f) => f.pos);
  const spread = stddev(classifiedPositions.length > 1 ? classifiedPositions : [avgFinish, avgFinish + 3]);
  const streetAvg = streetFinishes.length ? streetFinishes.reduce((a, b) => a + b, 0) / streetFinishes.length : null;
  const isStreet = STREET_CIRCUITS.has(race.circuitId);
  let rating = 0.5 * avgFinish + 0.32 * avgQuali + 0.18 * teamAvg;
  if (isStreet && streetAvg !== null) rating = 0.85 * rating + 0.15 * streetAvg;
  const circuitHistory = lookup.circuitWins.get(`${race.circuitId}:${entrant.driverId}`) || 0;
  if (circuitHistory > 0) rating -= Math.min(1.0, 0.4 * circuitHistory);
  const sigma = 2.3 + 0.45 * Math.min(spread, 6);
  const pDnf = clamp(0.045 + 0.55 * dnfRate, 0.045, 0.3);
  const info = lookup.drivers.get(entrant.driverId) || {};
  return {
    driverId: entrant.driverId,
    constructorId: entrant.constructorId,
    number: entrant.number,
    code: info.code,
    rating,
    sigma,
    pDnf,
    qualiRating: 0.7 * avgQuali + 0.3 * avgFinish,
    qualiSigma: 1.6 + 0.3 * Math.min(stddev(qualis.length > 1 ? qualis : [avgQuali, avgQuali + 2]), 5),
    stats: { avgFinish, avgQuali, teamAvg, dnfRate, wins, podiums, poles, finishes, qualis, streetAvg, isStreet, circuitHistory, spread, races: seasonRows.length },
  };
}

function simulateRace(ratings, rng, hasSprint) {
  const n = ratings.length;
  const counts = ratings.map(() => new Array(n).fill(0));
  const dnfCounts = new Array(n).fill(0);
  const pointsSamples = ratings.map(() => []);
  const positionSamples = ratings.map(() => []);
  for (let s = 0; s < SIMS; s++) {
    const order = [];
    const retired = [];
    for (let i = 0; i < n; i++) {
      const r = ratings[i];
      if (rng() < r.pDnf) {
        retired.push(i);
        dnfCounts[i] += 1;
      } else {
        order.push({ i, score: r.rating + gaussian(rng) * r.sigma });
      }
    }
    order.sort((a, b) => a.score - b.score);
    shuffle(retired, rng);
    const finishing = [...order.map((o) => o.i), ...retired];
    finishing.forEach((i, pos) => {
      counts[i][pos] += 1;
      positionSamples[i].push(pos + 1);
      pointsSamples[i].push(RACE_POINTS[pos] || 0);
    });
  }
  return {
    positionDist: counts.map((row) => row.map((c) => c / SIMS)),
    pDnf: dnfCounts.map((c) => c / SIMS),
    positionSamples,
    pointsSamples,
    hasSprint,
  };
}

function simulateQualifying(ratings, rng) {
  const samples = ratings.map(() => []);
  for (let s = 0; s < SIMS; s++) {
    const order = ratings.map((r, i) => ({ i, score: r.qualiRating + gaussian(rng) * r.qualiSigma }));
    order.sort((a, b) => a.score - b.score);
    order.forEach((o, pos) => samples[o.i].push(pos + 1));
  }
  return { samples };
}

function reasonsFor(rating, race) {
  const s = rating.stats;
  const reasons = [];
  const lastThree = s.finishes.slice(-3);
  if (lastThree.length) {
    const text = lastThree.map((f) => (f.dnf ? "DNF" : `P${f.pos}`)).join(", ");
    reasons.push(`Last three races: ${text}`);
  }
  if (s.avgQuali <= 3.5) reasons.push(`Qualifies on average P${s.avgQuali.toFixed(1)} in recent rounds`);
  else if (s.avgQuali - s.avgFinish > 2.5) reasons.push(`Race pace stronger than qualifying (P${s.avgQuali.toFixed(1)} grid to P${s.avgFinish.toFixed(1)} finish)`);
  else if (s.avgFinish - s.avgQuali > 2.5) reasons.push(`Tends to lose places on Sunday (P${s.avgQuali.toFixed(1)} grid to P${s.avgFinish.toFixed(1)} finish)`);
  if (s.wins >= 3) reasons.push(`${s.wins} wins this season`);
  else if (s.podiums >= 3) reasons.push(`${s.podiums} podiums this season`);
  if (s.dnfRate >= 0.25) reasons.push(`Retired from ${Math.round(s.dnfRate * 100)}% of races, reliability risk`);
  else if (s.dnfRate === 0 && s.races >= 8) reasons.push("Finished every race this season");
  if (s.isStreet && s.streetAvg !== null) {
    reasons.push(`Street circuits this season: average P${s.streetAvg.toFixed(1)}`);
  }
  if (s.circuitHistory > 0) reasons.push(`${s.circuitHistory} previous ${s.circuitHistory === 1 ? "win" : "wins"} at ${race.circuitName}`);
  if (s.teamAvg <= 4) reasons.push(`Team cars average P${s.teamAvg.toFixed(1)} over the last four rounds`);
  if (s.spread >= 4.5) reasons.push("Volatile results, wide position distribution");
  return reasons.slice(0, 4);
}

function factorsFor(rating, race) {
  const s = rating.stats;
  const factors = [];
  const lastThree = s.finishes.slice(-3);
  if (lastThree.length) {
    const text = lastThree.map((f) => (f.dnf ? "DNF" : `P${f.pos}`)).join(" ");
    const dnfs = lastThree.filter((f) => f.dnf).length;
    const avg = lastThree.filter((f) => !f.dnf).reduce((a, f) => a + f.pos, 0) / Math.max(1, lastThree.length - dnfs);
    factors.push({ kind: "form", label: "Last three", value: text, impact: dnfs >= 2 || avg > 10 ? "hurts" : avg <= 5 ? "helps" : "neutral", detail: `Last three races: ${lastThree.map((f) => (f.dnf ? "DNF" : `P${f.pos}`)).join(", ")}` });
  }
  factors.push({ kind: "qualifying", label: "Qualifying", value: `P${s.avgQuali.toFixed(1)} avg`, impact: s.avgQuali <= 5 ? "helps" : s.avgQuali >= 12 ? "hurts" : "neutral", detail: `Average qualifying position P${s.avgQuali.toFixed(1)} over recent rounds` });
  const raceVsQuali = s.avgQuali - s.avgFinish;
  if (Math.abs(raceVsQuali) >= 2) {
    factors.push({ kind: "pace", label: "Sunday", value: `${raceVsQuali > 0 ? "+" : ""}${raceVsQuali.toFixed(1)} places`, impact: raceVsQuali > 0 ? "helps" : "hurts", detail: raceVsQuali > 0 ? `Gains ${raceVsQuali.toFixed(1)} places on average from grid to finish` : `Loses ${Math.abs(raceVsQuali).toFixed(1)} places on average from grid to finish` });
  }
  if (s.wins >= 1) factors.push({ kind: "wins", label: "Wins", value: `${s.wins} this year`, impact: "helps", detail: `${s.wins} wins and ${s.podiums} podiums this season` });
  else if (s.podiums >= 2) factors.push({ kind: "wins", label: "Podiums", value: `${s.podiums} this year`, impact: "helps", detail: `${s.podiums} podiums this season` });
  if (s.dnfRate >= 0.2) factors.push({ kind: "reliability", label: "Retirements", value: `${Math.round(s.dnfRate * 100)}% of races`, impact: "hurts", detail: `Retired from ${Math.round(s.dnfRate * 100)}% of races this season` });
  else if (s.dnfRate === 0 && s.races >= 8) factors.push({ kind: "reliability", label: "Reliability", value: "no DNF", impact: "helps", detail: "Finished every race this season" });
  if (s.isStreet && s.streetAvg !== null) factors.push({ kind: "circuit", label: "Street tracks", value: `P${s.streetAvg.toFixed(1)} avg`, impact: s.streetAvg <= 5 ? "helps" : s.streetAvg >= 12 ? "hurts" : "neutral", detail: `Average finish P${s.streetAvg.toFixed(1)} on street circuits this season` });
  if (s.circuitHistory > 0) factors.push({ kind: "circuit", label: "Won here", value: `${s.circuitHistory}x`, impact: "helps", detail: `${s.circuitHistory} previous ${s.circuitHistory === 1 ? "win" : "wins"} at ${race.circuitName}` });
  if (s.teamAvg <= 4) factors.push({ kind: "team", label: "Team pace", value: `P${s.teamAvg.toFixed(1)} avg`, impact: "helps", detail: `Team cars average P${s.teamAvg.toFixed(1)} over the last four rounds` });
  else if (s.teamAvg >= 13) factors.push({ kind: "team", label: "Team pace", value: `P${s.teamAvg.toFixed(1)} avg`, impact: "hurts", detail: `Team cars average P${s.teamAvg.toFixed(1)} over the last four rounds` });
  if (s.spread >= 4.5) factors.push({ kind: "volatility", label: "Volatile", value: `±${s.spread.toFixed(1)} places`, impact: "neutral", detail: "Wide spread of recent results, so a wide position distribution" });
  const order = { hurts: 0, helps: 1, neutral: 2 };
  factors.sort((a, b) => order[a.impact] - order[b.impact]);
  return factors.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Fantasy
// ---------------------------------------------------------------------------

function fantasyForDriver(rating, sim, quali, i, fantasy, race, rng) {
  const asset = fantasy.driversById.get(rating.driverId);
  const price = asset ? asset.price : 5;
  const samples = [];
  const gridSamples = quali.samples[i];
  for (let s = 0; s < SIMS; s++) {
    const pos = sim.positionSamples[i][s];
    const grid = gridSamples[s];
    const dnf = sim.pointsSamples[i][s] === 0 && pos > rating.stats.races && rng() < rating.pDnf * 1.6;
    let pts = FANTASY_QUALI[grid - 1] || 0;
    if (dnf) {
      pts += -20;
    } else {
      pts += FANTASY_RACE[pos - 1] || 0;
      pts += grid - pos;
      pts += Math.max(0, grid - pos) * 0.7;
      if (pos <= 3 && rng() < 0.25) pts += 10;
    }
    if (race.hasSprint) {
      const sprintPos = clamp(Math.round(pos + gaussian(rng) * 2.5), 1, 22);
      pts += FANTASY_SPRINT[sprintPos - 1] || 0;
      pts += (grid - sprintPos) * 0.5;
    }
    samples.push(pts);
  }
  samples.sort((a, b) => a - b);
  const modelMean = mean(samples);
  const history = asset ? asset.pointsHistory.filter((p) => p !== null) : [];
  const recentMean = history.length ? mean(history.slice(-4)) : modelMean;
  const expected = 0.6 * modelMean + 0.4 * recentMean;
  const shift = expected - modelMean;
  const p10 = quantile(samples, 0.1) + shift;
  const p90 = quantile(samples, 0.9) + shift;
  const priceChange = priceChangeDistribution(samples.map((s) => s + shift), history, price, fantasy.rules);
  return {
    price,
    expectedPoints: round1(expected),
    p10: round1(p10),
    p90: round1(p90),
    expectedPriceChange: round2(priceChange.expected),
    priceChangeProbs: priceChange.probs,
  };
}

function constructorForecast(driverRows, ratings, sim, quali, fantasy, lookup, rng) {
  const byTeam = new Map();
  driverRows.forEach((d) => {
    const arr = byTeam.get(d.constructorId) || [];
    arr.push(d);
    byTeam.set(d.constructorId, arr);
  });
  const rows = [];
  for (const [constructorId, members] of byTeam) {
    const team = lookup.constructors.get(constructorId) || {};
    const asset = fantasy.constructorsById.get(constructorId);
    const price = asset ? asset.price : 5;
    const expectedPoints = members.reduce((a, d) => a + d.expectedPoints, 0);
    const indices = members.map((d) => ratings.findIndex((r) => r.driverId === d.driverId));
    const samples = [];
    for (let s = 0; s < SIMS; s++) {
      let pts = 0;
      let q2 = 0;
      let q3 = 0;
      for (const idx of indices) {
        const pos = sim.positionSamples[idx][s];
        const grid = quali.samples[idx][s];
        pts += FANTASY_RACE[pos - 1] || 0;
        pts += FANTASY_QUALI[grid - 1] || 0;
        pts += grid - pos;
        if (grid <= 15) q2 += 1;
        if (grid <= 10) q3 += 1;
      }
      pts += q3 === 2 ? 10 : q3 === 1 ? 5 : q2 === 2 ? 3 : q2 === 1 ? 1 : -1;
      pts += rng() < 0.3 ? 10 : rng() < 0.5 ? 5 : 2;
      samples.push(pts);
    }
    samples.sort((a, b) => a - b);
    const modelMean = mean(samples);
    const history = asset ? asset.pointsHistory.filter((p) => p !== null) : [];
    const recentMean = history.length ? mean(history.slice(-4)) : modelMean;
    const expected = 0.6 * modelMean + 0.4 * recentMean;
    const shift = expected - modelMean;
    const priceChange = priceChangeDistribution(samples.map((x) => x + shift), history, price, fantasy.rules);
    rows.push({
      constructorId,
      name: team.name || constructorId,
      teamColor: team.color || "#8A8F98",
      expectedPoints: round2(expectedPoints),
      fantasy: {
        price,
        expectedPoints: round1(expected),
        p10: round1(quantile(samples, 0.1) + shift),
        p90: round1(quantile(samples, 0.9) + shift),
        expectedPriceChange: round2(priceChange.expected),
        priceChangeProbs: priceChange.probs,
      },
    });
  }
  rows.sort((a, b) => b.expectedPoints - a.expectedPoints);
  return rows;
}

function priceChangeDistribution(samples, history, price, rules) {
  const counts = {};
  for (const bucket of PRICE_CHANGE_BUCKETS) counts[bucket] = 0;
  const previous = history.slice(-2);
  const tier = price >= rules.tierThreshold ? rules.tierA : rules.tierB;
  let expected = 0;
  for (const sample of samples) {
    const window = [...previous, sample];
    const ppm = mean(window) / price;
    let change;
    if (ppm > 1.2) change = tier.great;
    else if (ppm >= 0.9) change = tier.good;
    else if (ppm >= 0.6) change = tier.poor;
    else change = tier.terrible;
    const bounded = clamp(price + change, rules.floor, rules.ceiling) - price;
    const key = formatBucket(bounded);
    counts[key] = (counts[key] || 0) + 1;
    expected += bounded;
  }
  const probs = {};
  for (const key of Object.keys(counts)) {
    if (counts[key] > 0) probs[key] = round3(counts[key] / samples.length);
  }
  return { expected: expected / samples.length, probs };
}

function formatBucket(value) {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0";
  return rounded.toFixed(1).replace(/\.0$/, "");
}

function buildFantasyFixture(fantasy, lookup) {
  const drivers = [...fantasy.driversById.values()].map((a) => {
    const info = lookup.drivers.get(a.driverId) || {};
    const team = lookup.constructors.get(a.constructorId) || {};
    return {
      driverId: a.driverId,
      code: info.code || a.code,
      name: info.name || a.name,
      constructorId: a.constructorId,
      team: team.name || a.constructorId,
      teamColor: team.color || "#8A8F98",
      price: a.price,
      previousPrice: a.previousPrice,
      priceHistory: a.priceHistory,
      pointsHistory: a.pointsHistory,
      seasonPoints: a.seasonPoints,
      selectedPct: a.selectedPct,
      active: a.active,
    };
  });
  const constructors = [...fantasy.constructorsById.values()].map((a) => {
    const team = lookup.constructors.get(a.constructorId) || {};
    return {
      constructorId: a.constructorId,
      name: team.name || a.name,
      teamColor: team.color || "#8A8F98",
      price: a.price,
      previousPrice: a.previousPrice,
      priceHistory: a.priceHistory,
      pointsHistory: a.pointsHistory,
      seasonPoints: a.seasonPoints,
      selectedPct: a.selectedPct,
    };
  });
  return {
    season: SEASON,
    gameday: fantasy.gameday,
    deadline: fantasy.deadline,
    rules: fantasy.rules,
    rounds: fantasy.rounds,
    drivers,
    constructors,
  };
}

function loadFantasy() {
  const rulesRaw = readJson(path.join(FANTASY_RAW, "rules_2026.json"));
  const tierA = rulesRaw.price_change.tiers.find((t) => t.tier === "A");
  const tierB = rulesRaw.price_change.tiers.find((t) => t.tier === "B");
  const rules = {
    drivers: rulesRaw.team.drivers,
    constructors: rulesRaw.team.constructors,
    budget: rulesRaw.team.budget_musd,
    floor: rulesRaw.team.price_floor_musd,
    ceiling: rulesRaw.team.price_ceiling_musd,
    freeTransfers: rulesRaw.team.free_transfers_per_race,
    transferPenalty: rulesRaw.team.extra_transfer_penalty,
    tierThreshold: tierA.min_price,
    tierA: tierA.changes,
    tierB: tierB.changes,
    source: "fantasy.formula1.com rules text, snapshot 2026-10-07",
  };
  const driversDir = path.join(FANTASY_RAW, "official/2026/drivers");
  const gamedayFiles = fs
    .readdirSync(driversDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const latestFile = gamedayFiles[gamedayFiles.length - 1];
  const latest = readJson(path.join(driversDir, latestFile)).Data.Value;
  const gameday = Number(latestFile.replace(/\D/g, ""));
  const deadline = null;

  const communityDir = path.join(FANTASY_RAW, "community/mzafram2001_f1-fantasy/2026");
  const roundFiles = fs
    .readdirSync(communityDir)
    .filter((f) => /^round_\d+\.json$/.test(f))
    .sort();
  const rounds = [];
  const driverHistory = new Map();
  const teamHistory = new Map();
  for (const file of roundFiles) {
    const json = readJson(path.join(communityDir, file));
    const round = Number(json.Meta.race_id);
    const hasPoints = json.Drivers.some((d) => d.Round_Fantasy_Points !== 0);
    rounds.push(round);
    for (const d of json.Drivers) {
      const h = driverHistory.get(d.Driver_Code) || { points: [], prices: [] };
      h.points.push(hasPoints ? d.Round_Fantasy_Points : null);
      h.prices.push(d.Value);
      driverHistory.set(d.Driver_Code, h);
    }
    for (const t of json.Teams) {
      const id = TEAM_NAME_TO_ID[t.Team_Name] || t.Team_Name;
      const h = teamHistory.get(id) || { points: [], prices: [] };
      h.points.push(hasPoints ? t.Round_Fantasy_Points : null);
      h.prices.push(t.Value);
      teamHistory.set(id, h);
    }
  }

  const driversById = new Map();
  const constructorsById = new Map();
  const activeDrivers = [];
  for (const asset of latest) {
    if (asset.Skill === 1) {
      const code = asset.DriverTLA;
      const constructorId = TEAM_NAME_TO_ID[asset.TeamName] || asset.TeamName;
      const active = asset.IsActive === "1";
      const existing = [...driversById.values()].find((d) => d.code === code);
      if (existing && !active) continue;
      const history = driverHistory.get(code) || { points: [], prices: [] };
      const row = {
        code,
        name: asset.FUllName,
        constructorId,
        price: asset.Value,
        previousPrice: asset.OldPlayerValue,
        active,
        seasonPoints: Number(asset.OverallPpints),
        selectedPct: Number(asset.SelectedPercentage),
        pointsHistory: history.points,
        priceHistory: history.prices,
        driverId: null,
      };
      driversById.set(code, row);
    } else {
      const teamName = asset.TeamName || asset.FUllName;
      const constructorId = TEAM_NAME_TO_ID[teamName] || TEAM_TLA_TO_ID[asset.DriverTLA] || teamName;
      const history = teamHistory.get(constructorId) || { points: [], prices: [] };
      constructorsById.set(constructorId, {
        constructorId,
        name: teamName,
        price: asset.Value,
        previousPrice: asset.OldPlayerValue,
        seasonPoints: Number(asset.OverallPpints),
        selectedPct: Number(asset.SelectedPercentage),
        pointsHistory: history.points,
        priceHistory: history.prices,
      });
    }
  }
  return { rules, gameday, deadline, rounds, driversByCode: driversById, driversById, constructorsById, activeDrivers };
}

// ---------------------------------------------------------------------------
// Championship
// ---------------------------------------------------------------------------

function simulateChampionship(season, before, ratings, lookup, rng) {
  const remaining = season.races.filter((r) => r.results.length === 0 && !r.cancelled);
  const standing = season.standings;
  const driverPoints = new Map(standing.drivers.list.map((d) => [d.id, d.points]));
  const constructorPoints = new Map(standing.constructors.list.map((c) => [c.id, c.points]));
  const n = ratings.length;
  const titleCounts = new Map();
  const finalSums = new Map();
  const teamTitleCounts = new Map();
  const sims = 3000;
  for (let s = 0; s < sims; s++) {
    const dp = new Map(driverPoints);
    const cp = new Map(constructorPoints);
    for (const race of remaining) {
      const order = [];
      const retired = [];
      for (let i = 0; i < n; i++) {
        const r = ratings[i];
        if (rng() < r.pDnf) retired.push(i);
        else order.push({ i, score: r.rating + gaussian(rng) * (r.sigma + 0.6) });
      }
      order.sort((a, b) => a.score - b.score);
      shuffle(retired, rng);
      const finishing = [...order.map((o) => o.i), ...retired];
      finishing.forEach((i, pos) => {
        const pts = RACE_POINTS[pos] || 0;
        const r = ratings[i];
        dp.set(r.driverId, (dp.get(r.driverId) || 0) + pts);
        cp.set(r.constructorId, (cp.get(r.constructorId) || 0) + pts);
      });
      if (race.hasSprint) {
        const sprintOrder = ratings.map((r, i) => ({ i, score: r.rating + gaussian(rng) * (r.sigma + 1) }));
        sprintOrder.sort((a, b) => a.score - b.score);
        sprintOrder.forEach((o, pos) => {
          const pts = SPRINT_POINTS[pos] || 0;
          const r = ratings[o.i];
          dp.set(r.driverId, (dp.get(r.driverId) || 0) + pts);
          cp.set(r.constructorId, (cp.get(r.constructorId) || 0) + pts);
        });
      }
    }
    let bestDriver = null;
    for (const [id, pts] of dp) {
      finalSums.set(id, (finalSums.get(id) || 0) + pts);
      if (!bestDriver || pts > bestDriver.pts) bestDriver = { id, pts };
    }
    titleCounts.set(bestDriver.id, (titleCounts.get(bestDriver.id) || 0) + 1);
    let bestTeam = null;
    for (const [id, pts] of cp) {
      if (!bestTeam || pts > bestTeam.pts) bestTeam = { id, pts };
    }
    teamTitleCounts.set(bestTeam.id, (teamTitleCounts.get(bestTeam.id) || 0) + 1);
  }
  const drivers = [...driverPoints.keys()]
    .map((id) => ({
      driverId: id,
      pTitle: round4((titleCounts.get(id) || 0) / sims),
      expectedFinalPoints: round1((finalSums.get(id) || driverPoints.get(id) * sims) / sims),
    }))
    .sort((a, b) => b.pTitle - a.pTitle || b.expectedFinalPoints - a.expectedFinalPoints);
  const constructors = [...constructorPoints.keys()]
    .map((id) => ({ constructorId: id, pTitle: round4((teamTitleCounts.get(id) || 0) / sims) }))
    .sort((a, b) => b.pTitle - a.pTitle);
  return { drivers, constructors };
}

// ---------------------------------------------------------------------------
// Backtest
// ---------------------------------------------------------------------------

function actualBlock(race) {
  const results = race.results.map((r) => ({
    driverId: r.driverId,
    position: r.position,
    positionText: r.positionText,
    grid: r.grid,
    points: r.points,
    status: r.status,
    classified: r.classified,
  }));
  return { results };
}

function scoreForecast(forecast, actual) {
  const order = finishingOrder(actual.results);
  const predictedWinner = forecast.drivers.reduce((best, d) => (!best || d.pWin > best.pWin ? d : best), null);
  const actualWinner = order[0];
  const predictedPodium = [...forecast.drivers].sort((a, b) => b.pPodium - a.pPodium).slice(0, 3).map((d) => d.driverId);
  const actualPodium = order.slice(0, 3);
  const podiumHits = predictedPodium.filter((id) => actualPodium.includes(id)).length;
  const predictedRank = new Map(forecast.drivers.map((d, i) => [d.driverId, i + 1]));
  const actualRank = new Map(order.map((id, i) => [id, i + 1]));
  const common = order.filter((id) => predictedRank.has(id));
  const spearman = spearmanCorrelation(common.map((id) => predictedRank.get(id)), common.map((id) => actualRank.get(id)));
  const gridRank = new Map(
    [...actual.results].sort((a, b) => (a.grid || 30) - (b.grid || 30)).map((r, i) => [r.driverId, i + 1]),
  );
  const gridSpearman = spearmanCorrelation(common.map((id) => gridRank.get(id)), common.map((id) => actualRank.get(id)));
  let brier = 0;
  for (const d of forecast.drivers) {
    const won = d.driverId === actualWinner ? 1 : 0;
    brier += (d.pWin - won) ** 2;
  }
  return {
    round: forecast.race.round,
    winnerHit: predictedWinner.driverId === actualWinner ? 1 : 0,
    podiumHitRate: podiumHits / 3,
    spearman,
    gridSpearman,
    brier: brier / forecast.drivers.length,
  };
}

function finishingOrder(results) {
  const classified = results.filter((r) => r.classified && r.position !== null).sort((a, b) => a.position - b.position);
  const rest = results.filter((r) => !(r.classified && r.position !== null)).sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  return [...classified, ...rest].map((r) => r.driverId);
}

function aggregateBacktest(rows) {
  const seasons = [SEASON];
  return {
    seasons,
    races: rows.length,
    winnerAccuracy: round3(mean(rows.map((r) => r.winnerHit))),
    podiumHitRate: round3(mean(rows.map((r) => r.podiumHitRate))),
    spearman: round3(mean(rows.map((r) => r.spearman))),
    brier: round4(mean(rows.map((r) => r.brier))),
    baseline: { name: "grid order", spearman: round3(mean(rows.map((r) => r.gridSpearman))) },
    perRace: rows.map((r) => ({ round: r.round, winnerHit: r.winnerHit, podiumHitRate: round3(r.podiumHitRate), spearman: round3(r.spearman) })),
  };
}

// ---------------------------------------------------------------------------
// Lookup and maths
// ---------------------------------------------------------------------------

function buildLookup(drivers, constructors, circuits, fantasy) {
  const driverMap = new Map();
  const codeToId = new Map();
  for (const d of drivers) {
    driverMap.set(d.driverId, { code: d.code, number: d.number, name: `${d.givenName} ${d.familyName}` });
    if (d.code && d.career.lastSeason === SEASON) codeToId.set(d.code, d.driverId);
  }
  const constructorMap = new Map();
  for (const c of constructors) constructorMap.set(c.constructorId, { name: c.name, color: c.color });
  const circuitWins = new Map();
  for (const c of circuits) {
    for (const race of c.races) {
      if (!race.winnerDriverId) continue;
      const key = `${c.circuitId}:${race.winnerDriverId}`;
      circuitWins.set(key, (circuitWins.get(key) || 0) + 1);
    }
  }
  for (const asset of fantasy.driversById.values()) {
    asset.driverId = codeToId.get(asset.code) || asset.code.toLowerCase();
    if (asset.active) fantasy.activeDrivers.push(asset);
  }
  const byId = new Map();
  for (const asset of fantasy.driversById.values()) byId.set(asset.driverId, asset);
  fantasy.driversById = byId;
  return { drivers: driverMap, constructors: constructorMap, circuitWins };
}

function spearmanCorrelation(a, b) {
  const n = a.length;
  if (n < 3) return 0;
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (a[i] - b[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}

function quantile(sorted, q) {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx];
}

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function round3(n) {
  return Math.round(n * 1000) / 1000;
}
function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(rel, data) {
  const file = path.join(FIXTURES, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}
