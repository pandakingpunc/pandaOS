#!/usr/bin/env bash
# Runs PandaOS test suites in headless Chrome and prints the results.
#   bash tools/test.sh <suite>[,<suite>...] ["extra=query&params"]
# Env: BUDGET=<virtual ms, default 40000 per suite>
# Exit code 0 only if every test passed and no JS errors were captured.
set -u
SUITE="${1:?kullanım: tools/test.sh <suite>[,<suite>] [\"ek=parametre\"]}"
EXTRA="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="$(bash "$ROOT/tools/chrome.sh")" || exit 2
COMMAS="${SUITE//[^,]/}"
BUDGET_DEFAULT=$(( 40000 * (${#COMMAS} + 1) ))
TMPD="$(mktemp -d)"
URL="file:///$(cygpath -m "$ROOT")/index.html?fast=1&reset=1&test=${SUITE}${EXTRA:+&$EXTRA}"
"$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
  --autoplay-policy=no-user-gesture-required --hide-scrollbars \
  --user-data-dir="$(cygpath -w "$TMPD")" --window-size=1440,900 \
  --virtual-time-budget="${BUDGET:-$BUDGET_DEFAULT}" --dump-dom "$URL" > "$TMPD/dom.html" 2>/dev/null
node -e '
const fs = require("fs");
const html = fs.readFileSync(process.argv[1], "utf8");
const m = html.match(/<pre id="test-results"[^>]*>([\s\S]*?)<\/pre>/);
if (!m) {
  console.log("SONUÇ YOK: testler bitmedi ya da harness yüklenemedi. (BUDGET artırmayı dene; başlık: " + ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "?") + ")");
  process.exit(3);
}
const txt = m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "\x27").replace(/&amp;/g, "&");
const r = JSON.parse(txt);
for (const t of r.results) {
  console.log((t.ok ? "  ✔ " : "  ✘ ") + t.name + (t.ok ? "" : "\n      → " + t.error + (t.stack ? "\n      " + t.stack.split("\n").slice(1).join("\n      ") : "")));
}
console.log("\n" + r.passed + "/" + r.total + " test geçti");
if (r.errors.length) {
  console.log("\nYakalanan JS hataları (" + r.errors.length + "):");
  r.errors.forEach((e) => console.log("  ! " + e.split("\n").slice(0, 4).join("\n    ")));
} else console.log("JS hatası yok");
process.exit(r.passed === r.total && !r.errors.length ? 0 : 1);
' "$TMPD/dom.html"
CODE=$?
rm -rf "$TMPD"
exit $CODE
