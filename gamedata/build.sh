#!/bin/sh
# Rebuild the Companion app's game-data pack. Needs: git, curl, python3 with lupa (pip install lupa).
#   sh build.sh [work dir]        (default ./work; about 10 minutes the first time, 2-3 after)
# Output: <work>/out/gamedata.js and out/suffixes.js (copy both to web/data/), <work>/out/COVERAGE.md, test results.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${1:-$HERE/work}; mkdir -p "$W/raw/fdb" "$W/raw/egt" "$W/out"; cd "$W"

echo "1/7 QuestieDB (quests, NPCs, objects, item sources)"
if [ -d questiedb/.git ]; then git -C questiedb pull -q --ff-only
else GIT_LFS_SKIP_SMUDGE=1 git clone -q --depth 1 https://github.com/Questie/questiedb questiedb; fi
python3 -I "$HERE/export_questie.py" questiedb out

echo "2/7 ForeverDB (icons, drop chances, reward split)"
B=https://foreverdb.net/data
{ for f in items vendors zones; do echo "url = $B/$f.json"; echo "output = raw/fdb/$f.json"; done
  for d in sources questguides; do mkdir -p raw/fdb/$d
    for i in $(seq 0 63); do echo "url = $B/$d/$i.json"; echo "output = raw/fdb/$d/$i.json"; done; done
} > raw/fdb/list.txt
curl -sf --retry 3 --parallel --parallel-max 8 -K raw/fdb/list.txt

echo "3/7 endgametools item pages (weapons and armor; only pages not fetched in the last 30 days)"
python3 -I - "$W" <<'EOF'
import json, os, sys, time
w = sys.argv[1]
items = json.load(open(os.path.join(w, 'out', 'questie_item.json')))
old = time.time() - 30 * 86400
with open(os.path.join(w, 'raw', 'egt', 'list.txt'), 'w') as f:
    n = 0
    for k, v in items.items():
        if len(v) > 11 and v[11] in (2, 4):
            p = os.path.join(w, 'raw', 'egt', k + '.html')
            if not os.path.exists(p) or os.path.getmtime(p) < old:
                f.write(f'url = https://endgametools.com/en/wow-forever/items/{k}\noutput = {p}\n'); n += 1
print(f'   {n} pages to fetch')
EOF
[ -s raw/egt/list.txt ] && curl -s --retry 3 --parallel --parallel-max 6 -K raw/egt/list.txt || true
python3 -I "$HERE/egt_parse.py" raw/egt out/egt.json

echo "4/7 build"
python3 -I "$HERE/build.py" "$W" > out/build.log
echo "5/7 tests"
python3 -I "$HERE/test_pack.py" out/gamedata.js ${SAVEDVARIABLES:+"$SAVEDVARIABLES"} | tail -3
echo "6/7 coverage report: $W/out/COVERAGE.md"
python3 -I "$HERE/coverage_md.py" out/coverage.json out/COVERAGE.md
echo "7/7 random-suffix rolls (foreverchanges.pro; only pages not cached yet): $W/out/suffixes.js (copy to web/data/)"
python3 -I "$HERE/suffixes.py" out/gamedata.js raw/fc out/suffixes.js
