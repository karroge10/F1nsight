// Driver headshots for the current season into public/drivers, recorded in
// src/lib/data/fixtures/images.json with the season and team they were taken for.
//
// Roster and teams come from the served database (see scripts/lib/current-season.mjs). A photo
// is downloaded only for a new driver or when their season or team changed; --force re-downloads
// all. Source order: the official season headshot on the F1 media CDN (webp, square face crop),
// then the legacy formula1.com path OpenF1 still lists (png).
// Run with: node scripts/fetch-images.mjs [--force]

import fs from "node:fs";
import path from "node:path";
import { readCurrentSeason, readMap, resolveTeamSlug, writeMap } from "./lib/current-season.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "public/drivers");
const FORCE = process.argv.includes("--force");
/** Files smaller than this are the CDN's generic silhouette, not a real headshot. */
const PLACEHOLDER_BYTES = 4000;
/**
 * The season headshots are tall right-facing upper-body cutouts. The CDN crops a square around the
 * face zoomed out to 0.45, 288px tall, then pads 32px of transparency on top. Measured on four
 * drivers: about 12% headroom above the hair, clear side edges, shoulders reach the bottom.
 */
const HEADSHOT_CROP = "c_thumb,g_face,w_320,h_288,z_0.45/c_lpad,w_320,h_320,g_south";
const CDN_SOURCE = "F1 media CDN, official season headshot";
const LEGACY_SOURCE = "OpenF1 drivers feed, F1 media CDN (legacy path)";

main().catch((error) => {
  console.error(`fetch-images: ${error.message}`);
  process.exit(1);
});

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { season, drivers } = readCurrentSeason();
  const map = readMap();
  map.drivers ??= {};
  map.cdnTeamSlugs ??= {};
  const openf1 = await readOpenF1();
  let saved = 0;
  let kept = 0;
  for (const driver of drivers) {
    const record = map.drivers[driver.driverId];
    if (!FORCE && isCurrent(record, season, driver.constructorId)) {
      kept++;
      continue;
    }
    const feed = openf1.get(driver.code) ?? openf1.get(driver.permanentNumber) ?? null;
    const result = await downloadHeadshot(driver, season, feed, map.cdnTeamSlugs);
    if (!result) {
      console.warn(`no headshot for ${driver.driverId}, keeping the old one if any`);
      continue;
    }
    saved++;
    const bytes = fs.statSync(result.file).size;
    if (bytes < PLACEHOLDER_BYTES) {
      delete map.drivers[driver.driverId];
      continue;
    }
    const src = `/drivers/${path.basename(result.file)}`;
    map.drivers[driver.driverId] = { src, width: 2, height: 2, season, team: driver.constructorId, source: result.source };
  }
  writeMap(map);
  console.log(`headshots ${season}: ${saved} downloaded, ${kept} up to date`);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isCurrent(record, season, team) {
  if (!record || record.season !== season || record.team !== team) return false;
  const file = path.join(ROOT, "public", record.src);
  return fs.existsSync(file);
}

/** The season CDN webp first, then the legacy png. Null when neither answers. */
async function downloadHeadshot(driver, season, feed, slugCache) {
  const ref = refFromUrl(feed?.headshot_url) ?? refFromName(driver);
  const names = [feed?.team_name, driver.teamName].filter(Boolean);
  const probe = (slug) => headshotUrl(season, slug, ref);
  const slug = await resolveTeamSlug(driver.constructorId, names, probe, slugCache);
  const webp = path.join(OUT_DIR, `${driver.driverId}.webp`);
  if (slug && (await save(probe(slug), webp))) return { file: webp, source: CDN_SOURCE };
  console.warn(`season headshot missing for ${driver.driverId} (${names.join(" / ")}, ${ref}), trying legacy`);
  if (!feed?.headshot_url) return null;
  const png = path.join(OUT_DIR, `${driver.driverId}.png`);
  const legacyUrl = feed.headshot_url.replace("/1col/", "/2col/");
  return (await save(legacyUrl, png)) ? { file: png, source: LEGACY_SOURCE } : null;
}

function headshotUrl(season, slug, ref) {
  return `https://media.formula1.com/image/upload/${HEADSHOT_CROP}/q_auto/v1740000000/common/f1/${season}/${slug}/${ref}/${season}${slug}${ref}right.webp`;
}

/** OpenF1 drivers of the latest session, by code and by number; empty when the feed is down. */
async function readOpenF1() {
  const out = new Map();
  const response = await fetch("https://api.openf1.org/v1/drivers?session_key=latest").catch(() => null);
  if (!response || !response.ok) {
    console.warn("OpenF1 drivers feed unavailable, deriving refs from names");
    return out;
  }
  for (const d of await response.json()) {
    out.set(d.name_acronym, d);
    out.set(d.driver_number, d);
  }
  return out;
}

async function save(url, file) {
  const image = await fetch(url).catch(() => null);
  if (!image || !image.ok) return false;
  const buffer = Buffer.from(await image.arrayBuffer());
  fs.writeFileSync(file, buffer);
  await new Promise((r) => setTimeout(r, 200));
  return true;
}

/** "andant01" from ".../ANDANT01_Kimi_Antonelli/andant01.png.transform/1col/image.png". */
function refFromUrl(url) {
  const match = /\/([a-z]{6}\d{2})\.png\.transform\//.exec(url ?? "");
  return match ? match[1] : null;
}

/** F1's ref: first three letters of the given and family name plus "01" (Andrea Antonelli: andant01). */
function refFromName(driver) {
  const clean = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  const given = clean(driver.givenName).slice(0, 3);
  const family = clean(driver.familyName).slice(0, 3);
  return `${given}${family}01`;
}
