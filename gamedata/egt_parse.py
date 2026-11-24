#!/usr/bin/env python3
"""Parse endgametools WoW Forever item pages into one JSON file.

  python3 -I egt_parse.py <dir of <id>.html> <out egt.json>

Per item: {tip: [tooltip lines exactly as the page shows them, name excluded],
           q, slot, type, il, rl, bind, sell (copper), build, st: {statId: value}, unparsed: [lines]}
A page that is missing or is not a WoW Forever item page is recorded under "_missing".
"""
import glob, html, json, os, re, sys

SRC, OUT = sys.argv[1], sys.argv[2]
QUAL = {'Poor': 0, 'Common': 1, 'Uncommon': 2, 'Rare': 3, 'Epic': 4, 'Legendary': 5, 'Artifact': 6, 'Heirloom': 7}
BASE = {'Agility': 3, 'Strength': 4, 'Intellect': 5, 'Spirit': 6, 'Stamina': 7}
RES = {'Fire': 101, 'Frost': 102, 'Nature': 103, 'Shadow': 104, 'Arcane': 105}
SCHOOL = {'Fire': 110, 'Shadow': 111, 'Frost': 112, 'Arcane': 113, 'Nature': 114, 'Holy': 115}

# (regex, handler(match) -> {statId: value}); first match wins. Ids follow ITEM_MOD where one exists;
# 100+ are the pack's own ids for armor, resistances and single-school spell damage.
EQUIP = [
    (r'^Equip: Increases spell power by (\d+)', lambda m: {45: int(m[1])}),
    (r'^Equip: Increases attack power by (\d+)', lambda m: {38: int(m[1])}),
    (r'^Equip: Increases defense skill by (\d+)', lambda m: {12: int(m[1])}),
    (r'^Equip: Increases your armor by (\d+)', lambda m: {100: int(m[1])}),
    (r'^Equip: Increases your hit by (\d+)', lambda m: {31: int(m[1])}),
    (r'^Equip: Increases your critical strike by (\d+)', lambda m: {32: int(m[1])}),
    (r'^Equip: Increases your dodge by (\d+)', lambda m: {13: int(m[1])}),
    (r'^Equip: Increases your parry by (\d+)', lambda m: {14: int(m[1])}),
    (r'^Equip: Increases your shield block by (\d+)', lambda m: {15: int(m[1])}),
    (r'^Equip: Increases your expertise by (\d+)', lambda m: {37: int(m[1])}),
    (r'^Equip: Increases spell piercing by (\d+)', lambda m: {47: int(m[1])}),
    (r'^Equip: Increases (\w+) damage done by up to (\d+)', lambda m: {SCHOOL[m[1].title()]: int(m[2])} if m[1].title() in SCHOOL else None),
    (r'healing done by up to (\d+) and damage done by up to (\d+)', lambda m: {41: int(m[1]), 42: int(m[2])}),
    (r'damage and healing done by magical spells and effects by up to (\d+)', lambda m: {45: int(m[1])}),
    (r'healing done by spells and effects by up to (\d+)', lambda m: {41: int(m[1])}),
    (r'healing done by magical spells and effects by up to (\d+)', lambda m: {41: int(m[1])}),
    (r'Increases damage done by magical spells and effects by up to (\d+)', lambda m: {42: int(m[1])}),
    (r'damage done by (\w+) spells and effects by up to (\d+)', lambda m: {SCHOOL[m[1]]: int(m[2])} if m[1] in SCHOOL else None),
    (r'[Rr]estores (\d+) mana per 5 sec', lambda m: {43: int(m[1])}),
    (r'[Rr]estores (\d+) health per 5 sec', lambda m: {46: int(m[1])}),
    # the client writes these % lines in either case ("Critical Strike with Spells": Eye of the Beast), so they
    # alone ignore case; ranged-only hit ("with ranged weapons") has no stat of its own and stays unparsed
    (r'(?i)critical strike with spells by ([\d.]+)%', lambda m: {21: float(m[1])}),
    (r'(?i)critical strike with melee and ranged attacks by ([\d.]+)%', lambda m: {116: float(m[1])}),
    (r'critical strike by ([\d.]+)%', lambda m: {116: float(m[1])}),
    (r'chance to hit with spells by ([\d.]+)%', lambda m: {18: float(m[1])}),
    (r'chance to hit by ([\d.]+)%', lambda m: {117: float(m[1])}),
    (r'magical resistances of your spell targets by (\d+)', lambda m: {47: int(m[1])}),
    (r'^Equip: \+(\d+) Attack Power\.?$', lambda m: {38: int(m[1])}),
    (r'Increased Defense \+(\d+)', lambda m: {12: int(m[1])}),
    (r'chance to dodge an attack by ([\d.]+)%', lambda m: {118: float(m[1])}),
    (r'chance to parry an attack by ([\d.]+)%', lambda m: {119: float(m[1])}),
    (r'chance to block attacks with a shield by ([\d.]+)%', lambda m: {120: float(m[1])}),
    (r'block value of your shield by (\d+)', lambda m: {48: int(m[1])}),
]
LINE = [
    (r'^\+(\d+) (Agility|Strength|Intellect|Spirit|Stamina)$', lambda m: {BASE[m[2]]: int(m[1])}),
    (r'^\+(\d+) (Fire|Frost|Nature|Shadow|Arcane) Resistance$', lambda m: {RES[m[2]]: int(m[1])}),
    (r'^\+(\d+) All Resistances$', lambda m: {k: int(m[1]) for k in RES.values()}),
    (r'^(\d+) Armor$', lambda m: {100: int(m[1])}),
]


def lines_of(h):
    t = re.sub(r'<script.*?</script>', '', h, flags=re.S)
    t = re.sub(r'<style.*?</style>', '', t, flags=re.S)
    t = re.sub(r'<[^>]+>', '\n', t)
    return [html.unescape(l).strip() for l in t.split('\n') if l.strip()]


def parse(h):
    L = lines_of(h)
    if 'Item ID' not in L or 'Copied' not in L:
        return None
    a = L.index('Copied') + 1
    b = min([L.index(x) for x in ('Sell price', 'Item ID', 'How to get it') if x in L[a:]] or [len(L)])
    tip = L[a:b]
    kv = {}
    i = L.index('Item ID')
    for k in ('Item ID', 'Quality', 'Item level', 'Requires level', 'Slot', 'Type', 'Client build'):
        if k in L[i:i + 40]:
            j = L.index(k, i)
            kv[k] = L[j + 1]
    sell = 0
    if 'Sell price' in L:
        j = L.index('Sell price')
        for w in L[j + 1:j + 8]:
            m = re.match(r'^(\d+) (Gold|Silver|Copper)$', w)
            if m: sell += int(m[1]) * {'Gold': 10000, 'Silver': 100, 'Copper': 1}[m[2]]
    st, unparsed = {}, []
    for l in tip:
        got = None
        for rx, fn in LINE:
            m = re.search(rx, l)
            if m: got = fn(m); break
        if got is None and l.startswith('Equip:'):
            for rx, fn in EQUIP:
                m = re.search(rx, l)
                if m: got = fn(m); break
            if not got: unparsed.append(l)
        for k, v in (got or {}).items():
            st[k] = st.get(k, 0) + v
    # "How to get it": the dungeon or raid line says "Level 46–55 · 5 players"; raids say 10/20/40
    how = L[L.index('How to get it') + 1:] if 'How to get it' in L else []
    how = how[:how.index('Keep going')] if 'Keep going' in how else how[:12]
    stop = ('Bosses and quests from the', 'From the WoW Forever client', 'Where to find it', 'Keep going',
            'In the BiS list of', 'Worth getting on the leveling route', 'Numbers from', 'Which one:',
            'Where it comes from, after', 'Who gives it, and where')   # endgametools' page layout of 22 Nov 2026
    noise = {'(Wowhead)', '↗', 'Copy the name for the auction house', 'Copied', 'The recipe →'}
    src = []
    for l in how:
        if l.startswith(stop): break
        if l in noise or re.match(r'^Requires level \d+$', l): continue
        src.append(l)
    size = max([int(m[1]) for l in how for m in [re.search(r'(\d+) players', l)] if m] or [0])
    bind = 1 if 'Binds when picked up' in tip else 2 if 'Binds when equipped' in tip else 3 if 'Binds when used' in tip else 0
    num = lambda s: int(s) if s and s.isdigit() else 0
    return {'id': num(kv.get('Item ID')), 'tip': tip, 'q': QUAL.get(kv.get('Quality'), None),
            'slot': kv.get('Slot'), 'type': kv.get('Type'), 'il': num(kv.get('Item level')),
            'rl': num(kv.get('Requires level')), 'bind': bind, 'sell': sell, 'build': kv.get('Client build'),
            'st': st, 'unparsed': unparsed, 'size': size, 'how': ' · '.join(src)}


out, missing = {}, []
for f in sorted(glob.glob(os.path.join(SRC, '*.html'))):
    iid = int(os.path.basename(f)[:-5])
    r = parse(open(f, errors='replace').read())
    if not r or r['id'] != iid:
        missing.append(iid); continue
    del r['id']
    out[iid] = r
out['_missing'] = missing
json.dump(out, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
un = [l for k, v in out.items() if k != '_missing' for l in v['unparsed']]
print(f'parsed {len(out) - 1}, missing/not-an-item {len(missing)}, equip lines not turned into stats {len(un)}')
