// Official team logos (colour and white) for the current season into public/teams/<season>, then
// rebuilds the logo registry. Teams come from the served database, so a new team is picked up
// automatically; a team is downloaded only when its files for this season are missing (--force
// re-downloads all).
// Run with: node scripts/fetch-current-logos.mjs [--force]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readCurrentSeason, readMap, resolveTeamSlug, writeMap } from "./lib/current-season.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const FORCE = process.argv.includes("--force");
const VARIANTS = [
  ["logo", "colour"],
  ["logowhite", "white"],
];

main().catch((error) => {
  console.error(`fetch-current-logos: ${error.message}`);
  process.exit(1);
});

async function main() {
  const { season, constructors } = readCurrentSeason();
  const dir = path.join(ROOT, "public/teams", String(season));
  fs.mkdirSync(dir, { recursive: true });
  const map = readMap();
  map.cdnTeamSlugs ??= {};
  let saved = 0;
  let kept = 0;
  for (const team of constructors) {
    const colourFile = path.join(dir, `${team.constructorId}-colour.webp`);
    if (!FORCE && fs.existsSync(colourFile)) {
      kept++;
      continue;
    }
    const probe = (slug) => logoUrl(season, slug, "logo");
    const names = [team.name, ...knownNames(team.constructorId)];
    const slug = await resolveTeamSlug(team.constructorId, names, probe, map.cdnTeamSlugs);
    if (!slug) {
      console.warn(`no ${season} logo for ${team.constructorId} (${names.join(" / ")}), keeping the old one if any`);
      continue;
    }
    for (const [variant, name] of VARIANTS) {
      const response = await fetch(logoUrl(season, slug, variant)).catch(() => null);
      if (!response || !response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(path.join(dir, `${team.constructorId}-${name}.webp`), buffer);
      await new Promise((r) => setTimeout(r, 100));
    }
    saved++;
  }
  writeMap(map);
  console.log(`logos ${season}: ${saved} downloaded, ${kept} up to date`);
  execFileSync(process.execPath, [path.join(ROOT, "scripts/build-logo-registry.mjs")], { stdio: "inherit" });
}

function logoUrl(season, slug, variant) {
  return `https://media.formula1.com/image/upload/c_fit,h_256/q_auto/v1740000000/common/f1/${season}/${slug}/${season}${slug}${variant}.webp`;
}

/**
 * The game's current display name when it differs from the database name (the slug follows the
 * display name: "RB F1 Team" is "Racing Bulls" on the CDN). Candidates only: each one is checked
 * with a HEAD request before use.
 */
function knownNames(constructorId) {
  const names = { rb: ["Racing Bulls"], red_bull: ["Red Bull Racing"], alpine: ["Alpine"], cadillac: ["Cadillac"], haas: ["Haas"], kick_sauber: ["Kick Sauber"], sauber: ["Kick Sauber"] };
  return names[constructorId] ?? [];
}
