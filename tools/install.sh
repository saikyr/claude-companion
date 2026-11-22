#!/bin/sh
# One-time install (or repair) of Claude Companion on a Mac, from the newest build on the "stable" branch.
# After this the app updates itself; nothing else to run per build except /reload in game.
#   gh api repos/saikyr/claude-companion/contents/tools/install.sh?ref=main -H "Accept: application/vnd.github.raw" | sh
# Needs the GitHub CLI signed in (gh auth login), because the repository is private; the app's
# updater uses the same sign-in. Never touches companion-data/ or the game's saved data (WTF/).
set -e
REPO=saikyr/claude-companion
say() { printf '%s\n' "$*"; }

# the game folder: next to an existing install, else the usual places
ADDONS="${ADDONS:-}"
[ -n "$ADDONS" ] || for d in "/Applications/World of Warcraft/_forever_/Interface/AddOns" "$HOME/Applications/World of Warcraft/_forever_/Interface/AddOns" \
         "/Applications/WoW Forever/World of Warcraft/_forever_/Interface/AddOns"; do
  [ -d "$d" ] && { ADDONS="$d"; break; }
done
if [ -z "$ADDONS" ] && command -v mdfind >/dev/null; then
  hit=$(mdfind -name ClaudeCompanion.toc 2>/dev/null | grep '/_forever_/Interface/AddOns/ClaudeCompanion/' | head -1)
  [ -n "$hit" ] && ADDONS=$(dirname "$(dirname "$hit")")
fi
[ -n "$ADDONS" ] || { say "Couldn't find _forever_/Interface/AddOns. Run again with ADDONS=/path/to/_forever_/Interface/AddOns"; exit 1; }
DEST="$ADDONS/ClaudeCompanion"
say "Installing into $DEST"

TMP=$(mktemp -d /tmp/cc-install.XXXXXX)
trap 'rm -rf "$TMP"' EXIT
SHA=$(gh api "repos/$REPO/commits/stable" -q .sha)
TAG=$(printf %.12s "$SHA")
gh api "repos/$REPO/zipball/$SHA" > "$TMP/build.zip"
unzip -q "$TMP/build.zip" -d "$TMP/x"
SRC=$(dirname "$(find "$TMP/x" -path '*/ClaudeCompanion/ClaudeCompanion.toc' | head -1)")
[ -f "$SRC/ClaudeCompanion.toc" ] && [ -f "$SRC/web/server.py" ] && [ -f "$SRC/../BUILD.json" ] || { say "The build looks incomplete; nothing changed."; exit 1; }
# every file must match BUILD.json
/usr/bin/python3 - "$SRC" <<'PY' || { say "The download is damaged (checksum mismatch); nothing changed."; exit 1; }
import hashlib, json, os, sys
src = sys.argv[1]
b = json.load(open(os.path.join(src, '..', 'BUILD.json')))
for rel, want in b['files'].items():
    if hashlib.sha256(open(os.path.join(src, *rel.split('/')), 'rb').read()).hexdigest() != want: sys.exit('mismatch ' + rel)
PY

# back up what's there now (without companion-data, which is never overwritten)
if [ -d "$DEST" ]; then
  BK="$HOME/Library/Application Support/Claude Companion/backups/ClaudeCompanion-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BK"
  (cd "$DEST" && for f in * .[!.]*; do [ -e "$f" ] && [ "$f" != companion-data ] && cp -R "$f" "$BK/"; done) || true
  say "Backup: $BK"
fi
mkdir -p "$DEST/companion-data"
# copy the release over, leaving companion-data alone except its SCHEMA.md
(cd "$SRC" && find . -type f ! -path './companion-data/*' -print) | while IFS= read -r f; do
  mkdir -p "$DEST/$(dirname "$f")"; cp "$SRC/$f" "$DEST/$f"
done
cp "$SRC/companion-data/SCHEMA.md" "$DEST/companion-data/SCHEMA.md" 2>/dev/null || true
chmod +x "$DEST/web/Claude Companion.app/Contents/MacOS/launcher" 2>/dev/null || true
xattr -dr com.apple.quarantine "$DEST/web/Claude Companion.app" 2>/dev/null || true
printf '{"tag": "%s", "sha": "%s", "at": "%s", "by": "install.sh"}\n' "$TAG" "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DEST/companion-data/installed.json"

# restart the app's server (login item) on the new code and open the app
/usr/bin/python3 "$DEST/web/server.py"
say "Installed $TAG. From now on the app updates itself. In game: /reload."
