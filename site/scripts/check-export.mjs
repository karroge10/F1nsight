// Checks site/out against the Cloudflare Pages free plan limits: at most 20,000 files per
// deployment and 25 MiB per file. Prints the totals; exits 1 when a limit is broken.
//
//   node scripts/check-export.mjs

import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.resolve(import.meta.dirname, "../out");
const MAX_FILES = 20000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MIB = 1024 * 1024;

main();

function main() {
  if (!fs.existsSync(OUT_DIR)) {
    console.error(`No export at ${OUT_DIR}: run npm run build first.`);
    process.exit(1);
  }
  const files = listFiles(OUT_DIR);
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 3);
  const oversized = files.filter((f) => f.size > MAX_FILE_BYTES);
  console.log(`site/out: ${files.length} files, ${(totalBytes / MIB).toFixed(1)} MiB`);
  const largestText = largest.map((f) => `${f.rel} ${(f.size / MIB).toFixed(2)} MiB`).join(", ");
  console.log(`largest: ${largestText}`);
  let ok = true;
  if (files.length > MAX_FILES) {
    console.error(`Too many files for Cloudflare Pages: ${files.length} > ${MAX_FILES}`);
    ok = false;
  }
  for (const f of oversized) {
    console.error(`File over 25 MiB: ${f.rel}`);
    ok = false;
  }
  process.exit(ok ? 0 : 1);
}

function listFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      const size = fs.statSync(full).size;
      const rel = path.relative(dir, full).split(path.sep).join("/");
      out.push({ rel, size });
    }
  }
  return out;
}
