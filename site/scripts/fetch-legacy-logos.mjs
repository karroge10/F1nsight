import fs from "node:fs";
// constructorId -> [year, slug] on the legacy CDN path (first available season of that brand)
const LEGACY = [
  ["alphatauri", 2023, "alphatauri"],
  ["alfa", 2023, "alfa-romeo"],
  ["racing_point", 2020, "racing-point"],
  ["renault", 2020, "renault"],
  ["toro_rosso", 2019, "toro-rosso"],
  ["haas-2023", 2023, "haas-f1-team"],
  ["rb-2024", 2024, "rb"],
  ["sauber-2024", 2024, "kick-sauber"],
  ["mclaren-2023", 2023, "mclaren"],
  ["red_bull-2023", 2023, "red-bull-racing"],
  ["mercedes-2023", 2023, "mercedes"],
  ["ferrari-2023", 2023, "ferrari"],
  ["aston_martin-2023", 2023, "aston-martin"],
  ["alpine-2023", 2023, "alpine"],
  ["williams-2023", 2023, "williams"],
];
for (const [name, year, slug] of LEGACY) {
  const url = `https://media.formula1.com/content/dam/fom-website/teams/${year}/${slug}-logo.png`;
  const r = await fetch(url);
  if (!r.ok) { console.log("miss", name, r.status); continue; }
  fs.writeFileSync(`public/teams/legacy/${name}.png`, Buffer.from(await r.arrayBuffer()));
  await new Promise((res) => setTimeout(res, 120));
}
console.log("legacy files:", fs.readdirSync("public/teams/legacy").join(" "));
