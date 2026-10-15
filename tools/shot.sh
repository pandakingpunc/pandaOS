#!/usr/bin/env bash
# Takes a headless screenshot of PandaOS.
#   bash tools/shot.sh <out.png> "<query params>" [WIDTHxHEIGHT]
# e.g. bash tools/shot.sh /tmp/calc.png "fast=1&open=calculator&theme=light"
# Env: BUDGET=<virtual ms, default 8000>. Storage starts empty every run.
set -u
OUT="${1:?kullanım: tools/shot.sh <out.png> \"<parametreler>\" [1440x900]}"
PARAMS="${2:-fast=1}"
SIZE="${3:-1440x900}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="$(bash "$ROOT/tools/chrome.sh")" || exit 2
TMPD="$(mktemp -d)"
URL="file:///$(cygpath -m "$ROOT")/index.html?${PARAMS}"
"$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
  --autoplay-policy=no-user-gesture-required --hide-scrollbars \
  --user-data-dir="$(cygpath -w "$TMPD")" --window-size="${SIZE/x/,}" \
  --virtual-time-budget="${BUDGET:-8000}" --screenshot="$(cygpath -w "$TMPD")\shot.png" "$URL" >/dev/null 2>&1
if [ -f "$TMPD/shot.png" ]; then
  mkdir -p "$(dirname "$OUT")"
  cp "$TMPD/shot.png" "$OUT"
  echo "Kaydedildi: $(cygpath -w "$OUT")"
else
  echo "Ekran görüntüsü alınamadı" >&2
  rm -rf "$TMPD"; exit 1
fi
rm -rf "$TMPD"
