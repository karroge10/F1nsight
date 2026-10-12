import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// A fully static export (site/out): every page is prerendered from f1.sqlite and the published
// JSON at build time, so the same files serve the local site (start.ps1) and Cloudflare Pages
// (scripts/publish.ps1). Rebuild after a data refresh to pick up new results.
const nextConfig: NextConfig = {
  output: "export",
  cacheComponents: false,
  devIndicators: false,
  images: { unoptimized: true },
  generateBuildId: codeBuildId,
  turbopack: {
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

/**
 * The build id is a hash of the code, not of the moment: a data-only rebuild leaves every page
 * whose data did not change byte-identical, so a Cloudflare upload sends only what changed.
 */
function codeBuildId(): string {
  const hash = crypto.createHash("sha256");
  const roots = ["src", "package-lock.json", "next.config.ts"].map((p) => path.join(__dirname, p));
  for (const file of listFiles(roots)) {
    const rel = path.relative(__dirname, file);
    const content = fs.readFileSync(file);
    hash.update(rel).update(content);
  }
  return hash.digest("hex").slice(0, 16);
}

function listFiles(roots: string[]): string[] {
  const files: string[] = [];
  const stack = [...roots];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (!fs.existsSync(current)) continue;
    if (!fs.statSync(current).isDirectory()) {
      files.push(current);
      continue;
    }
    for (const name of fs.readdirSync(current)) stack.push(path.join(current, name));
  }
  return files.sort();
}
