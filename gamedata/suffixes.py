#!/usr/bin/env python3
"""Build the random-suffix roll table (web/data/suffixes.js) from foreverchanges.pro.

  python3 -I suffixes.py <gamedata.js> <cache dir> <out suffixes.js> [<previous suffixes.js> <previous gamedata.js>]

A green or blue item "of Healing", "of the Owl", ... gets its stats from the suffix it rolled, and on
Forever the numbers for one suffix depend on the base item. foreverchanges.pro/item/<id> lists every
suffix a base can roll with its exact stats ("Confirmed in game": the numbers the Forever server sent
to players, client build 1.60.1). This script reads that list for every BoE green or blue weapon or
armor piece in the pack that has no fixed stats of its own (those are the ones that roll a suffix).

ONE OWNER: random-suffix rolls come only from foreverchanges.pro. Pages are cached in <cache dir>, so a
re-run only fetches what's missing. Lines it can't turn into stats are listed at the end; the build
fails if a page has a suffix list it can't read. A page that can't be fetched (foreverchanges.pro answers a few
with a redirect loop) keeps what the previous build read for it (its rolls, or none when the previous build checked it and it rolls
none), said in the log; the build fails only for a page the previous build never checked.

Output (window.GAMEDATA_SUFFIX):
  { v: 1, built, from, names: [suffix name, ...], items: { "<base id>": [[index into names, [[stat id, value], ...]], ...] } }
Stat ids are the pack's (gamedata/build.py STAT).
"""
import concurrent.futures as cf, html, json, os, re, sys, time, urllib.request

PACK, CACHE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
PREV = {}
if len(sys.argv) > 4 and os.path.exists(sys.argv[4]):
    try:
        p = open(sys.argv[4], encoding='utf-8').read()
        p = json.loads(p[p.index('{'):p.rindex('}') + 1])
        PREV = {k: [[p['names'][n], st] for n, st in rows] for k, rows in p['items'].items()}
    except (ValueError, KeyError, IndexError) as e:
        print(f'previous suffixes.js unreadable ({e}): nothing to keep', file=sys.stderr)
os.makedirs(CACHE, exist_ok=True)
s = open(PACK, encoding='utf-8').read()
GD = json.loads(s[s.index('{'):s.rindex('}') + 1])

# a BoE green/blue weapon or armor piece (not a shirt, tabard, bag or ammo) with no fixed stats besides armor/resistances
def base_ids(gd):
    return sorted((int(k) for k, g in gd['items'].items()
                   if g[9] in (2, 4) and g[1] in (2, 3) and g[7] == 2 and g[11] == 'e' and (g[2] or 0) >= 5
                   and g[4] not in (0, 4, 18, 19, 24) and not any(st < 100 for st, _ in (g[8] or []))))


bases = base_ids(GD)
# the bases the previous build checked: one with no rolls in the previous suffixes.js rolled none
PREV_BASES = set()
if PREV and len(sys.argv) > 5 and os.path.exists(sys.argv[5]):
    try:
        p = open(sys.argv[5], encoding='utf-8').read()
        PREV_BASES = set(base_ids(json.loads(p[p.index('{'):p.rindex('}') + 1])))
    except (ValueError, KeyError, IndexError, TypeError) as e:
        print(f'previous gamedata.js unreadable ({e}): only previous rolls are kept', file=sys.stderr)

# "+13 Stamina" -> pack stat id (gamedata/build.py STAT)
NAMES = {
    'Agility': 3, 'Strength': 4, 'Intellect': 5, 'Spirit': 6, 'Stamina': 7, 'Defense Rating': 12, 'Defense': 12,
    'Dodge Rating': 13, 'Parry Rating': 14, 'Block Rating': 15, 'Hit Rating': 31, 'Critical Strike Rating': 32, 'Crit Rating': 32,
    'Attack Power': 38, 'Healing': 41, 'Spell Damage': 42, 'Mana Regeneration': 43, 'Mana every 5 sec.': 43, 'Spell Power': 45,
    'Health Regeneration': 46, 'Block Value': 48, 'Armor': 100,
    'Fire Resistance': 101, 'Frost Resistance': 102, 'Nature Resistance': 103, 'Shadow Resistance': 104, 'Arcane Resistance': 105,
    'Fire Spell Damage': 110, 'Shadow Spell Damage': 111, 'Frost Spell Damage': 112, 'Arcane Spell Damage': 113,
    'Nature Spell Damage': 114, 'Holy Spell Damage': 115,
}
PCT = [(r'chance to dodge an attack by (\d+)%', 118), (r'chance to parry an attack by (\d+)%', 119),
       (r'chance to block attacks with a shield by (\d+)%', 120), (r'critical strike by (\d+)%', 116), (r'chance to hit by (\d+)%', 117)]
unread = {}


def stats(text):
    out = []
    for part in [p.strip() for p in text.split(',') if p.strip()]:
        m = re.fullmatch(r'\+(\d+) (.+?)\.?', part)
        if m and m[2] in NAMES:
            out.append([NAMES[m[2]], int(m[1])])
            continue
        hit = next(((sid, int(mm[1])) for rx, sid in PCT for mm in [re.search(rx, part)] if mm), None)
        if hit:
            out.append(list(hit))
            continue
        unread[part] = unread.get(part, 0) + 1
    return out


def fetch(i):
    path = os.path.join(CACHE, f'{i}.html')
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return i, open(path, encoding='utf-8').read()
    for attempt in range(4):
        try:
            req = urllib.request.Request(f'https://foreverchanges.pro/item/{i}', headers={'User-Agent': 'claude-companion gamedata build'})
            body = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
            open(path, 'w', encoding='utf-8').write(body)
            return i, body
        except Exception as e:  # network hiccup: back off and retry
            err = e
            time.sleep(2 ** attempt)
    print(f'fetch failed {i}: {err}', file=sys.stderr)
    return i, ''


items, failed, bad, kept = {}, [], [], []
with cf.ThreadPoolExecutor(4) as ex:
    for i, body in ex.map(fetch, bases):
        if not body:
            if str(i) in PREV or i in PREV_BASES:
                if str(i) in PREV: items[str(i)] = PREV[str(i)]
                kept.append(i)
            else:
                failed.append(i)
            continue
        sec = re.search(r'<section class="it-from it-suffixes".*?</section>', body, re.S)
        if not sec:
            continue                                      # no suffix list: the item doesn't roll one
        rows = []
        for li in re.findall(r'<li>(.*?)</li>', sec[0], re.S):
            name = re.search(r'<b[^>]*>(.*?)</b>', li, re.S)
            sets = re.findall(r'<span class="it-suffix-set">(.*?)</span>', li, re.S)
            if not name or not sets:
                bad.append(i)
                continue
            # a suffix with more than one stat set on this base: keep each (the AH name can't tell them apart; the app takes the lowest)
            for st in sets:
                rows.append([html.unescape(name[1]).strip(), stats(html.unescape(re.sub(r'<[^>]+>', '', st)))])
        if rows:
            items[str(i)] = rows

# suffix names are stored once: each roll is [index into names, stats]
names = sorted({n for rows in items.values() for n, _ in rows})
ix = {n: i for i, n in enumerate(names)}
items = {k: [[ix[n], st] for n, st in rows] for k, rows in items.items()}
pack = {'v': 1, 'built': int(time.time()), 'from': 'foreverchanges.pro item pages, "Confirmed in game" (client build 1.60.1)', 'names': names, 'items': items}
open(OUT, 'w', encoding='utf-8').write('window.GAMEDATA_SUFFIX=' + json.dumps(pack, separators=(',', ':'), ensure_ascii=False) + ';\n')
print(f'{len(bases)} bases checked, {len(items)} roll a suffix, {sum(len(v) for v in items.values())} rolls, {len(names)} suffix names; fetch failed: {len(failed) + len(kept)}'
      + (f' ({len(kept)} kept as the previous build read them: {kept[:20]})' if kept else ''))
if unread:
    print('lines not turned into stats:', json.dumps(sorted(unread.items(), key=lambda x: -x[1])[:40]))
# a few pages a site can't serve are kept; most of them failing is an outage, never hidden behind last week's table
if len(kept) > max(20, len(bases) // 20):
    sys.exit(f'{len(kept)} of {len(bases)} pages could not be fetched: foreverchanges.pro is down or blocking the build')
if bad or failed:
    sys.exit(f'unreadable suffix lists: {sorted(set(bad))[:20]}; failed fetches: {failed[:20]}')
