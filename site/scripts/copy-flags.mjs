// Copies the 3:2 SVG country flags from the country-flag-icons package (MIT) into public/flags,
// so flags render offline and on Windows, which has no flag emoji. Run after updating the package:
//   node scripts/copy-flags.mjs
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "country-flag-icons", "3x2");
const target = join(root, "public", "flags");

main();

function main() {
  mkdirSync(target, { recursive: true });
  const files = readdirSync(source).filter((name) => name.endsWith(".svg"));
  for (const name of files) {
    const lower = name.toLowerCase();
    copyFileSync(join(source, name), join(target, lower));
  }
  console.log(`copied ${files.length} flags to public/flags`);
}
