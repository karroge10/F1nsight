// Current season, roster and F1 media CDN team slugs for the image scripts. The roster comes from
// the same database the site serves (F1_DATA_DIR/serve/f1.sqlite, default ../data), so a
// mid-season seat change gives the driver's latest team.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA_DIR = process.env.F1_DATA_DIR ? path.resolve(process.env.F1_DATA_DIR) : path.resolve(ROOT, "../data");
export const DB_FILE = path.join(DATA_DIR, "serve/f1.sqlite");
export const MAP_FILE = path.join(ROOT, "src/lib/data/fixtures/images.json");

/** Exceptions only: constructor ids whose CDN slug is not the slug of any of their names. */
const SLUG_OVERRIDES = {};

/**
 * Season of the latest race with results, its drivers (each with the team of their latest race;
 * juniors without a race are left out) and the constructors that raced.
 */
export function readCurrentSeason() {
  if (!fs.existsSync(DB_FILE)) throw new Error(`no database at ${DB_FILE}`);
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  try {
    const season = db.prepare("select season from v_current_season").get().season;
    const rows = db
      .prepare(
        `select e.driverId, e.constructorId, e.lastRound, e.role, d.code, d.permanentNumber, d.givenName, d.familyName, c.name as teamName
         from season_entries e join drivers d using (driverId) join constructors c using (constructorId)
         where e.season = ? and e.lastRound is not null
         order by e.driverId, e.lastRound desc, case e.role when 'permanent' then 0 else 1 end`,
      )
      .all(season);
    const drivers = [];
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.driverId)) continue;
      seen.add(row.driverId);
      drivers.push({ ...row });
    }
    const constructors = new Map();
    for (const d of drivers) constructors.set(d.constructorId, { constructorId: d.constructorId, name: d.teamName });
    return { season, drivers, constructors: [...constructors.values()] };
  } finally {
    db.close();
  }
}

/** "Haas F1 Team" to "haasf1team", "Red Bull Racing" to "redbullracing". */
export function slugOf(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * The CDN slug of a team: the cached one when it still answers, else the first candidate (an
 * override, then the slug of each known name) whose probe URL answers 200. Null when none does.
 */
export async function resolveTeamSlug(constructorId, names, probeUrl, cache) {
  const candidates = [SLUG_OVERRIDES[constructorId], cache[constructorId], ...names.map(slugOf)].filter(Boolean);
  const unique = [...new Set(candidates)];
  for (const slug of unique) {
    const url = probeUrl(slug);
    const response = await fetch(url, { method: "HEAD" }).catch(() => null);
    if (response && response.ok) {
      cache[constructorId] = slug;
      return slug;
    }
  }
  return null;
}

export function readMap() {
  return fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, "utf8")) : { drivers: {} };
}

export function writeMap(map) {
  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2));
}
