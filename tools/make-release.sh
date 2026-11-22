#!/bin/sh
# Builds dist/ClaudeCompanion-<version>.zip: the ClaudeCompanion folder exactly as it goes in
# Interface/AddOns, including the game-data pack. Needs ClaudeCompanion/web/data/gamedata.js
# (run gamedata/build.sh and copy work/out/gamedata.js there, or take it from the last release).
#   sh tools/make-release.sh
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT"
VER=$(sed -n 's/^## Version: *//p' ClaudeCompanion/ClaudeCompanion.toc | tr -d '\r')
[ -f ClaudeCompanion/web/data/gamedata.js ] || { echo "missing ClaudeCompanion/web/data/gamedata.js (see gamedata/README.md)"; exit 1; }
# refuse to ship personal data
for f in ClaudeCompanion/companion-data/snapshot.json ClaudeCompanion/web/data.js; do
  [ -e "$f" ] && { echo "refusing to package personal data: $f"; exit 1; }
done
mkdir -p dist
OUT="dist/ClaudeCompanion-$VER.zip"; rm -f "$OUT"
zip -qr -X "$OUT" ClaudeCompanion -x '*/.DS_Store' '*/from-claude/*' '*/__pycache__/*' '*.pyc'
echo "$OUT ($(du -h "$OUT" | cut -f1))"
