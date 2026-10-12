// Writes the team logo registry into src/lib/data/fixtures/images.json (teams key).
// Official artwork only, used as-is: the current season's colour and white variants from F1's
// image CDN (public/teams/<season>, see fetch-current-logos.mjs) and the per-season PNGs for brands that no
// longer exist (public/teams/legacy, white background knocked out, never recoloured).
// Current-season files are transparent and drawn as-is; a brand whose colour file has under 3:1
// contrast with the dark theme background (read from globals.css) gets its white file on the dark
// theme, measured from the pixels, so a new team needs no edit.
// Legacy and Commons PNGs keep the light plate they were published on (`plate: true`).
// The CDN files pad their marks unevenly (none on wide wordmarks, an eighth of the tile on
// Mercedes and Racing Bulls), so each current-season variant gets a `scale` measured from its
// alpha bounding box: marks of every shape then look about the same size in the logo box.
// Teams without official artwork get no entry and fall back to the monogram in TeamLogo.
// Run with: node scripts/build-logo-registry.mjs

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAP_FILE = path.join(ROOT, "src/lib/data/fixtures/images.json");
// the newest season folder under public/teams (written by fetch-current-logos.mjs)
const TEAMS_DIR = path.join(ROOT, "public/teams");
const SEASONS = fs.readdirSync(TEAMS_DIR).filter((name) => /^\d{4}$/.test(name)).sort();
const CURRENT_SEASON = SEASONS[SEASONS.length - 1];
const CURRENT_DIR = path.join(TEAMS_DIR, CURRENT_SEASON);
const LEGACY_DIR = path.join(ROOT, "public/teams/legacy");
const COMMONS_DIR = path.join(ROOT, "public/teams/commons");

// constructorId -> variants, most recent first. from/to are seasons (inclusive); null = open.
const REGISTRY = {
  mercedes: [{ from: null, to: null, current: "mercedes" }],
  ferrari: [{ from: null, to: null, current: "ferrari" }],
  red_bull: [{ from: null, to: null, current: "red_bull" }],
  mclaren: [{ from: null, to: null, current: "mclaren" }],
  williams: [{ from: null, to: null, current: "williams" }],
  haas: [{ from: null, to: null, current: "haas" }],
  alpine: [{ from: 2021, to: null, current: "alpine" }],
  aston_martin: [{ from: 2021, to: null, current: "aston_martin" }],
  audi: [{ from: 2026, to: null, current: "audi" }],
  cadillac: [{ from: 2026, to: null, current: "cadillac" }],
  rb: [
    { from: 2025, to: null, current: "rb" },
    { from: 2024, to: 2024, legacy: "rb-2024" },
  ],
  alphatauri: [{ from: 2020, to: 2023, legacy: "alphatauri" }],
  toro_rosso: [{ from: null, to: 2019, legacy: "toro_rosso" }],
  racing_point: [{ from: 2019, to: 2020, legacy: "racing_point" }],
  renault: [{ from: 2016, to: 2020, legacy: "renault" }],
  alfa: [{ from: 2019, to: 2023, legacy: "alfa" }],
  sauber: [{ from: 2024, to: 2025, legacy: "sauber-2024" }],
  // free files from Wikimedia Commons (public domain / text logos), verified visually
  caterham: [{ from: null, to: 2014, commons: "caterham" }],
  marussia: [{ from: 2015, to: 2015, commons: "marussia" }],
};

// a colour logo needs this contrast against the dark theme background (WCAG non-text minimum),
// otherwise the white file is shown on dark
const MIN_DARK_CONTRAST = 3;
// optical sizing, as shares of TeamLogo's box. The image is drawn at LOGO_INSET of the box; a
// mark's longest side may grow to MAX_SIDE, and the square root of its bounding box area to
// OPTICAL_SIZE, whichever limit comes first.
const LOGO_INSET = 0.84;
const MAX_SIDE = 0.96;
const OPTICAL_SIZE = 0.68;
const OPAQUE_ALPHA = 24;
const DARK_BACKGROUND_LUMINANCE = darkBackgroundLuminance();

// a team with current-season artwork but no entry above (a new team) gets one automatically
for (const file of fs.readdirSync(CURRENT_DIR)) {
  const match = /^(.+)-colour\.webp$/.exec(file);
  if (match && !REGISTRY[match[1]]) REGISTRY[match[1]] = [{ from: Number(CURRENT_SEASON), to: null, current: match[1] }];
}

const existing = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, "utf8")) : { drivers: {} };
const teams = {};
const missing = [];
for (const [id, variants] of Object.entries(REGISTRY)) {
  const out = [];
  for (const v of variants) {
    if (v.current) {
      const colour = path.join(CURRENT_DIR, `${v.current}-colour.webp`);
      const white = path.join(CURRENT_DIR, `${v.current}-white.webp`);
      if (!fs.existsSync(colour)) {
        missing.push(`${id}: ${colour}`);
        continue;
      }
      const contrast = await darkContrast(colour);
      const whiteSrc = fs.existsSync(white) && contrast < MIN_DARK_CONTRAST ? `/teams/${CURRENT_SEASON}/${v.current}-white.webp` : null;
      const scale = await opticalScale(colour);
      out.push({ from: v.from, to: v.to, colour: `/teams/${CURRENT_SEASON}/${v.current}-colour.webp`, white: whiteSrc, plate: false, scale, source: `F1 media CDN, ${CURRENT_SEASON} official variants` });
    } else if (v.commons) {
      const file = path.join(COMMONS_DIR, `${v.commons}.png`);
      if (!fs.existsSync(file)) {
        missing.push(`${id}: ${file}`);
        continue;
      }
      out.push({ from: v.from, to: v.to, colour: `/teams/commons/${v.commons}.png`, white: null, plate: true, source: "Wikimedia Commons, free file" });
    } else if (v.legacy) {
      const file = path.join(LEGACY_DIR, `${v.legacy}.png`);
      if (!fs.existsSync(file)) {
        missing.push(`${id}: ${file}`);
        continue;
      }
      out.push({ from: v.from, to: v.to, colour: `/teams/legacy/${v.legacy}.png`, white: null, plate: true, source: "F1 media CDN, season logo PNG" });
    }
  }
  if (out.length) teams[id] = { variants: out };
}
existing.teams = teams;
fs.writeFileSync(MAP_FILE, JSON.stringify(existing, null, 2));
console.log(`registry: ${Object.keys(teams).length} constructors with official artwork`);
if (missing.length) console.log("missing files:\n  " + missing.join("\n  "));

/** Contrast ratio of a logo's alpha-weighted average colour (linear light) against the dark background. */
async function darkContrast(file) {
  const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let weight = 0;
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    weight += alpha;
    for (let c = 0; c < 3; c++) sum[c] += alpha * srgbToLinear(data[i + c] / 255);
  }
  if (weight === 0) return 0;
  const [r, g, b] = sum.map((v) => v / weight);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const lighter = Math.max(luminance, DARK_BACKGROUND_LUMINANCE);
  const darker = Math.min(luminance, DARK_BACKGROUND_LUMINANCE);
  return (lighter + 0.05) / (darker + 0.05);
}

/** How much to enlarge a logo so its mark reaches the optical size; the white file shares the geometry. */
async function opticalScale(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] <= OPAQUE_ALPHA) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) return 1;
  const side = Math.max(info.width, info.height);
  const width = (right - left + 1) / side;
  const height = (bottom - top + 1) / side;
  const bySide = MAX_SIDE / (LOGO_INSET * Math.max(width, height));
  const byArea = OPTICAL_SIZE / (LOGO_INSET * Math.sqrt(width * height));
  const scale = Math.min(bySide, byArea);
  return Math.round(scale * 100) / 100;
}

/** Relative luminance of --bg in the [data-theme="dark"] block of globals.css (an oklch() value). */
function darkBackgroundLuminance() {
  const css = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
  const block = /\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  const match = /--bg:\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/.exec(block);
  if (!match) throw new Error("dark --bg oklch() not found in globals.css");
  const [l, c, h] = match.slice(1).map(Number);
  const [r, g, b] = oklchToLinearSrgb(l, c, h).map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function oklchToLinearSrgb(l, c, h) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1, -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1, -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1];
}

function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
