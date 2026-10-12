// Serves the static export (site/out) the way Cloudflare Pages does: `/drivers/x` answers with
// drivers/x.html, a folder with its index.html, anything else with 404.html. No dependencies.
//
//   node scripts/serve-static.mjs [--port 3000]

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const OUT_DIR = path.resolve(import.meta.dirname, "../out");
const PORT = readPort(process.argv.slice(2));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

main();

function main() {
  if (!fs.existsSync(OUT_DIR)) {
    console.error(`No export at ${OUT_DIR}: run npm run build first.`);
    process.exit(1);
  }
  const server = http.createServer(handle);
  server.listen(PORT, () => console.log(`Serving ${OUT_DIR} on http://localhost:${PORT}/`));
}

function handle(request, response) {
  const url = new URL(request.url ?? "/", "http://localhost");
  const file = resolveFile(url.pathname);
  if (file) {
    send(response, 200, file, url.pathname);
    return;
  }
  const notFound = path.join(OUT_DIR, "404.html");
  send(response, 404, notFound, url.pathname);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** The file for a URL path, or null. Never leaves the export folder. */
function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const base = path.join(OUT_DIR, path.normalize(decoded));
  if (!base.startsWith(OUT_DIR)) return null;
  const candidates = [base, `${base}.html`, path.join(base, "index.html")];
  return candidates.find(isFile) ?? null;
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function send(response, status, file, pathname) {
  const extension = path.extname(file).toLowerCase();
  const type = TYPES[extension] ?? "application/octet-stream";
  const immutable = pathname.startsWith("/_next/static/");
  const cache = immutable ? "public, max-age=31536000, immutable" : "no-cache";
  response.writeHead(status, { "Content-Type": type, "Cache-Control": cache });
  fs.createReadStream(file).pipe(response);
}

function readPort(args) {
  const index = args.indexOf("--port");
  const value = index === -1 ? NaN : Number(args[index + 1]);
  return Number.isFinite(value) ? value : 3000;
}
