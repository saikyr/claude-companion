#!/bin/sh
# Rebuild the Companion app's game-data pack. Needs: git, curl, python3 with lupa and py7zr (pip install lupa py7zr).
#   sh build.sh [work dir]        (default ./work; about 10 minutes the first time, 2-3 after)
# Output: <work>/out/gamedata.js and out/suffixes.js (copy both to web/data/), out/icons.js (copy to web/js/),
# <work>/out/COVERAGE.md (copy to gamedata/), test results.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${1:-$HERE/work}; mkdir -p "$W/raw/fdb" "$W/raw/egt" "$W/out"; cd "$W"

echo "1/9 QuestieDB (quests, NPCs, objects, item sources)"
if [ -d questiedb/.git ]; then git -C questiedb pull -q --ff-only
else GIT_LFS_SKIP_SMUDGE=1 git clone -q --depth 1 https://github.com/Questie/questiedb questiedb; fi
python3 -I "$HERE/export_questie.py" questiedb out

echo "2/9 ForeverDB (icons, drop chances, reward split, Forever's enchanting recipes)"
B=https://foreverdb.net/data
{ for f in items vendors zones; do echo "url = $B/$f.json"; echo "output = raw/fdb/$f.json"; done
  for d in sources questguides; do mkdir -p raw/fdb/$d
    for i in $(seq 0 63); do echo "url = $B/$d/$i.json"; echo "output = raw/fdb/$d/$i.json"; done; done
} > raw/fdb/list.txt
curl -sf --retry 3 --parallel --parallel-max 8 -K raw/fdb/list.txt
# Forever's own enchanting recipes: the formulas it added (Enchant Necklace - Healing Power) and the reagents it changed
# (#175). Not required: without it the pack has no fench and the app says reagents are unknown
mkdir -p raw/fdb/professions
curl -sf --retry 3 -o raw/fdb/professions/enchanting.json "$B/professions/enchanting.json" || { echo "   ForeverDB enchanting.json not fetched: the pack has no fench"; rm -f raw/fdb/professions/enchanting.json; }

echo "3/9 VMaNGOS world database (every profession recipe's tools, place, reagents and trainer, and every permanent enchant; Classic 1.12, frozen since June 2021)"
# one file of brotalnia/database (the VMaNGOS world dump): only that blob is fetched, about 30 MB
V=world_full_14_june_2021
if [ ! -s "raw/$V.7z" ]; then
  rm -rf raw/vmdb; git clone -q --depth 1 --filter=blob:none --no-checkout https://github.com/brotalnia/database raw/vmdb
  git -C raw/vmdb checkout -q HEAD -- "$V.7z" && mv "raw/vmdb/$V.7z" raw/ && rm -rf raw/vmdb
fi
python3 -I "$HERE/recipes.py" "raw/$V.7z" out/recipes.json out/enchants.json

echo "4/9 endgametools item pages (weapons, armor, consumables, and what Forever vendors sell for a currency or as a recipe; only pages not fetched in the last 30 days)"
# every weapon, armor and consumable QuestieDB or ForeverDB knows: Forever's own items (its Tier 0.5 spec sets) are only
# in ForeverDB; consumables (potions, elixirs, flasks, food, scrolls, oils) for what they do on Forever (#91)
python3 -I - "$W" <<'EOF'
import json, os, sys, time
w = sys.argv[1]
items = json.load(open(os.path.join(w, 'out', 'questie_item.json')))
import re
oil = re.compile(r'((Wizard|Mana|Shadow|Frost) Oil|Sharpening Stone|Weightstone)$')   # Trade Goods (class 7) used on a weapon
ids = {k for k, v in items.items() if len(v) > 11 and (v[11] in (0, 2, 4) or (v[11] == 7 and oil.search(str(v[0] or ''))))}
ids |= {str(it['id']) for it in json.load(open(os.path.join(w, 'raw', 'fdb', 'items.json')))
        if it.get('c') in (0, 2, 4) or (it.get('c') == 7 and oil.search(str(it.get('n') or '')))}
# and everything a vendor Forever players saw sells for a currency or as a recipe: its page names each vendor's price
# (240 Merchant's Favor) and the reputation that vendor asks (#151), which ForeverDB doesn't carry
fdbi = {it['id']: it for it in json.load(open(os.path.join(w, 'raw', 'fdb', 'items.json')))}
for v in json.load(open(os.path.join(w, 'raw', 'fdb', 'vendors.json')))['vendors'].values():
    if not v.get('fv'): continue
    for k, sv in (v.get('sells') or {}).items():
        if (sv or {}).get('c') or (fdbi.get(int(k)) or {}).get('c') == 9: ids.add(str(k))
old = time.time() - 30 * 86400
with open(os.path.join(w, 'raw', 'egt', 'list.txt'), 'w') as f:
    n = 0
    for k in sorted(ids, key=int):
        p = os.path.join(w, 'raw', 'egt', k + '.html')
        if not os.path.exists(p) or os.path.getmtime(p) < old:
            f.write(f'url = https://endgametools.com/en/wow-forever/items/{k}\noutput = {p}\n'); n += 1
print(f'   {n} pages to fetch')
EOF
[ -s raw/egt/list.txt ] && curl -s --retry 3 --parallel --parallel-max 6 -K raw/egt/list.txt || true
python3 -I "$HERE/egt_parse.py" raw/egt out/egt.json

echo "5/9 build"
python3 -I "$HERE/build.py" "$W" > out/build.log
echo "6/9 tests"
python3 -I "$HERE/test_pack.py" out/gamedata.js ${SAVEDVARIABLES:+"$SAVEDVARIABLES"} | tail -3
echo "7/9 coverage report: $W/out/COVERAGE.md"
python3 -I "$HERE/coverage_md.py" out/coverage.json out/COVERAGE.md
echo "8/9 random-suffix rolls (foreverchanges.pro; only pages not cached yet): $W/out/suffixes.js (copy to web/data/)"
python3 -I "$HERE/suffixes.py" out/gamedata.js raw/fc out/suffixes.js "$HERE/../ClaudeCompanion/web/data/suffixes.js" "$HERE/../ClaudeCompanion/web/data/gamedata.js"
echo "9/9 icon names (wowdev community listfile): $W/out/icons.js (copy to web/js/)"
curl -sfL --retry 3 -o raw/listfile.csv https://github.com/wowdev/wow-listfile/releases/latest/download/community-listfile.csv
python3 -I "$HERE/icons.py" raw/listfile.csv out/icons.js
