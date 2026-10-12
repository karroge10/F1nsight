#!/usr/bin/env bash
# Headless screenshots and console-error capture for visual QA.
# Usage: scripts/shoot.sh <name> <path> [wait-ms]
# Writes .qa/<name>-desktop.png, .qa/<name>-mobile.png and .qa/<name>-console.txt
set -u
NAME="$1"
URL_PATH="$2"
WAIT="${3:-6000}"
BASE="http://localhost:3000"
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/.qa"
mkdir -p "$OUT_DIR"
WIN_OUT="$(cygpath -w "$OUT_DIR")"

shoot() {
  local suffix="$1" size="$2"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
    --force-device-scale-factor=1 --window-size="$size" --virtual-time-budget="$WAIT" \
    --screenshot="$WIN_OUT\\$NAME-$suffix.png" "$BASE$URL_PATH" >/dev/null 2>&1
}

shoot desktop 1440,2400
shoot mobile 390,3000

"$CHROME" --headless=new --disable-gpu --no-first-run --enable-logging=stderr --v=0 --virtual-time-budget="$WAIT" \
  --window-size=1440,900 --dump-dom "$BASE$URL_PATH" 2> "$OUT_DIR/$NAME-stderr.txt" > "$OUT_DIR/$NAME-dom.html"
grep -i "CONSOLE" "$OUT_DIR/$NAME-stderr.txt" | grep -iv "download the react devtools\|HMR\|Fast Refresh" > "$OUT_DIR/$NAME-console.txt" || true
ERRORS=$(grep -ci "error" "$OUT_DIR/$NAME-console.txt" || true)
PORTAL=$(grep -c "nextjs-portal" "$OUT_DIR/$NAME-dom.html" || true)
echo "$NAME: console lines $(wc -l < "$OUT_DIR/$NAME-console.txt"), error lines $ERRORS, nextjs-portal $PORTAL"
echo "  $OUT_DIR/$NAME-desktop.png"
echo "  $OUT_DIR/$NAME-mobile.png"
