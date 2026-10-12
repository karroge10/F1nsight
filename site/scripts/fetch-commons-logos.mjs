// Searches Wikimedia Commons for team logo files (free licences only) and downloads the first
// plausible hit per team for visual verification. Run: node scripts/fetch-commons-logos.mjs
import fs from "node:fs";
const UA = { "User-Agent": "F1nsight/0.1 (personal F1 stats site; logo lookup; contact: local)" };
const QUERIES = {
  force_india: "Force India F1 logo",
  sauber: "Sauber F1 Team logo",
  manor: "Manor Racing logo",
  marussia: "Marussia F1 Team logo",
  caterham: "Caterham F1 logo",
  lotus_f1: "Lotus F1 Team logo",
};
const results = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [id, q] of Object.entries(QUERIES)) {
  const search = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srlimit=6&format=json&srsearch=${encodeURIComponent(q)}`;
  const r = await fetch(search, { headers: UA });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { results[id] = { error: text.slice(0, 60) }; await sleep(4000); continue; }
  const hits = (json.query?.search ?? []).map((h) => h.title).filter((t) => /\.(svg|png)$/i.test(t));
  results[id] = { hits };
  await sleep(1500);
  if (hits.length) {
    const title = hits[0];
    const info = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=256&format=json&titles=${encodeURIComponent(title)}`;
    const ir = await fetch(info, { headers: UA });
    const ij = await ir.json();
    const page = Object.values(ij.query.pages)[0];
    const ii = page.imageinfo?.[0];
    if (ii) {
      const licence = ii.extmetadata?.LicenseShortName?.value ?? "";
      const thumb = ii.thumburl ?? ii.url;
      results[id].chosen = { title, licence, url: thumb };
      const img = await fetch(thumb, { headers: UA });
      if (img.ok) {
        const ext = /\.svg$/i.test(title) ? "png" : "png";
        fs.writeFileSync(`public/teams/commons/${id}.${ext}`, Buffer.from(await img.arrayBuffer()));
        results[id].saved = `${id}.${ext}`;
      }
    }
    await sleep(1500);
  }
}
fs.writeFileSync("scripts/raw/commons-logos.json", JSON.stringify(results, null, 2));
for (const [id, r] of Object.entries(results)) console.log(id.padEnd(12), r.saved ?? "none", r.chosen ? `${r.chosen.licence} | ${r.chosen.title}` : (r.error ?? (r.hits ?? []).slice(0, 3).join(" ; ")));
