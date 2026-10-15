#!/usr/bin/env bash
# Locates a Chromium-based browser for headless runs. Prints its path.
for c in "/c/Program Files/Google/Chrome/Application/chrome.exe" \
         "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
         "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
         "/c/Program Files/Microsoft/Edge/Application/msedge.exe"; do
  if [ -x "$c" ]; then echo "$c"; exit 0; fi
done
echo "Chrome/Edge bulunamadı" >&2
exit 1
