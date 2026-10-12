// Runs after `next build` (npm postbuild). On Windows, Next 16 writes a page's nested prefetch
// segment files into folders (`drivers/x/__next.drivers/$d$id/__PAGE__.txt`) because it joins the
// segment path with backslashes, while the client asks for the flat name
// (`drivers/x/__next.drivers.$d$id.__PAGE__.txt`). This flattens them to the name the client uses.
// On other systems there is nothing to do.

import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.resolve(import.meta.dirname, "../out");

main();

function main() {
  if (!fs.existsSync(OUT_DIR)) return;
  const segmentDirs = findSegmentDirs(OUT_DIR);
  let moved = 0;
  for (const dir of segmentDirs) moved += flatten(dir);
  if (moved > 0) console.log(`fix-export-segments: flattened ${moved} prefetch files`);
}

/** Folders named `__next.*`: each holds the nested segment files of one page. */
function findSegmentDirs(root) {
  const found = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(current, entry.name);
      if (entry.name.startsWith("__next.")) found.push(full);
      else stack.push(full);
    }
  }
  return found;
}

function flatten(dir) {
  const parent = path.dirname(dir);
  const prefix = path.basename(dir);
  const files = listFiles(dir);
  for (const file of files) {
    const parts = path.relative(dir, file).split(path.sep);
    const flatName = [prefix, ...parts].join(".");
    const target = path.join(parent, flatName);
    fs.renameSync(file, target);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return files.length;
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}
