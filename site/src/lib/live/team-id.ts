/** Keyword, then the constructor id used by the logo registry. Order matters: Racing Bulls before Red Bull. */
const TEAM_KEYWORDS: [string, string][] = [
  ["racing bull", "rb"],
  ["alphatauri", "rb"],
  ["toro rosso", "toro_rosso"],
  ["red bull", "red_bull"],
  ["ferrari", "ferrari"],
  ["mercedes", "mercedes"],
  ["mclaren", "mclaren"],
  ["williams", "williams"],
  ["haas", "haas"],
  ["alpine", "alpine"],
  ["aston", "aston_martin"],
  ["audi", "audi"],
  ["cadillac", "cadillac"],
  ["alfa", "alfa"],
  ["sauber", "sauber"],
  ["kick", "sauber"],
  ["racing point", "racing_point"],
  ["renault", "renault"],
];

/** Constructor id for a team name as the live feed spells it ("Red Bull Racing", "Kick Sauber"), or null. */
export function constructorIdForTeam(team: string | null | undefined): string | null {
  const name = (team ?? "").toLowerCase();
  if (!name) return null;
  for (const [keyword, id] of TEAM_KEYWORDS) {
    if (name.includes(keyword)) return id;
  }
  return null;
}
