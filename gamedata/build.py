#!/usr/bin/env python3
"""Build the Companion app's game-data pack (web/data/gamedata.js) and its coverage report.

  python3 -I build.py <work dir>

<work dir> holds what fetch.sh downloaded and export_questie.py / egt_parse.py produced:
  out/questie_*.json, out/questie_era_*.json, out/questie_manifest.json   (QuestieDB, Forever flavor)
  questiedb/support/Forever/...                                            (QuestieDB zone + XP tables)
  out/egt.json                                                             (endgametools item pages)
  raw/fdb/...                                                              (ForeverDB public data)
and writes out/gamedata.js, out/coverage.json and out/COVERAGE.md.

ONE OWNER PER FIELD (see README.md for the why):
  Quests, NPCs, objects, who drops / sells / rewards each item ....... QuestieDB Forever
  Quest XP ............................................................ QuestieDB QuestXP (Forever player traces)
  Item tooltips and stats for weapons and armor ....................... endgametools (Forever client build)
  Item icons; quality and sell price of non-gear ...................... ForeverDB
  Drop chances and "seen on Forever" counts ........................... ForeverDB (player uploads)
  Quest reward split (fixed vs choose-one) and reward money ........... ForeverDB quest guides
  Crafted-by and world-drop rows (QuestieDB has no crafting data) ..... ForeverDB
  Item sets: which items belong together ............................. ForeverDB (set id per item)
  Item sets: name and bonuses .......................................... endgametools (the set lines of a member's tooltip)
  NPCs: name, levels, rank, zone, spawn points ......................... QuestieDB Forever (points already in Forever map coordinates)
The game itself always wins in the app: your quest log rewards, your tooltips, your AH scans.
"""
import json, os, re, sys, time
from collections import Counter, defaultdict

W = sys.argv[1]
P = lambda *a: os.path.join(W, *a)
J = lambda *a: json.load(open(P(*a)))

# ------------------------------------------------------------------ inputs
Q = {k: J('out', f'questie_{k}.json') for k in ('quest', 'npc', 'item', 'object')}
E = {k: J('out', f'questie_era_{k}.json') for k in ('quest', 'npc', 'item', 'object')}
QMAN = J('out', 'questie_manifest.json')
EGT = J('out', 'egt.json')
EGT_MISSING = set(EGT.pop('_missing', []))
FDB_ITEMS = {it['id']: it for it in J('raw', 'fdb', 'items.json')}
FDB_SRC, FDB_QG = {}, {}
for i in range(64):
    FDB_SRC.update(J('raw', 'fdb', 'sources', f'{i}.json'))
    FDB_QG.update(J('raw', 'fdb', 'questguides', f'{i}.json'))
FDB_V = J('raw', 'fdb', 'vendors.json')


def f(row, i):
    """Field i (1-based, as in QuestieDB's key tables) of a QuestieDB row."""
    return row[i - 1] if row and len(row) >= i else None


def lst(v):
    return v if isinstance(v, list) else []


# ------------------------------------------------------------------ zones (QuestieDB support tables)
AREA = {}
zsrc = open(P('questiedb', 'support', 'Forever', 'Zones', 'areaIdToUiMapId.lua'), encoding='utf-8').read()
for m in re.finditer(r'^\s*\[(\d+)\]\s*=\s*\d+,\s*--\s*(.+?)\s*$', zsrc, re.M):
    name = m[2].split('->')[-1].strip()                 # "Longshore -> Westfall" shows as Westfall
    if 'synthetic' not in name.lower():
        AREA.setdefault(int(m[1]), name)
dsrc = open(P('questiedb', 'support', 'Forever', 'Zones', 'dungeons.lua'), encoding='utf-8').read()
DUNGEON = {}
for m in re.finditer(r'^\s*\[(\d+)\]\s*=\s*\{"([^"]+)",\s*(nil|\{[^}]*\})', dsrc, re.M):
    DUNGEON[int(m[1])] = m[2]
    for alt in re.findall(r'\d+', m[3] if m[3] != 'nil' else ''):
        DUNGEON.setdefault(int(alt), m[2])
zone_name = lambda z: DUNGEON.get(int(z)) or AREA.get(int(z)) or ''
SORTS = {}
for m in re.finditer(r'^\s*([A-Z_0-9]+)\s*=\s*(-\d+)', open(P('questiedb', 'src', 'corrections', 'enum', 'quests.lua')).read(), re.M):
    SORTS.setdefault(int(m[2]), m[1].replace('_', ' ').title())

# ------------------------------------------------------------------ quest XP (QuestieDB QuestXP: Classic seed, then Forever traces)
XP, XP_TRACE = {}, set()
for fn, traced in (('xpDB-classic.lua', False), ('xpDB-traces.lua', True)):
    s = open(P('questiedb', 'support', 'Forever', 'QuestXP', fn)).read()
    for m in re.finditer(r'\[(\d+)\]\s*=\s*\{(\d+),\s*(\d+)\}', s):
        XP[int(m[1])] = (int(m[2]), int(m[3]))
        if traced: XP_TRACE.add(int(m[1]))

# ------------------------------------------------------------------ faction names
# ForeverDB lists names; QuestieDB lists ids. Names come from ForeverDB's own table, plus matching
# each quest's reputation reward between the two sources (same quest, same amount).
FACTION = {int(k): v for k, v in FDB_V.get('factions', {}).items()}
votes = defaultdict(Counter)
for qid, row in Q['quest'].items():
    g = FDB_QG.get(qid)
    if not g: continue
    named = {r.get('value'): r.get('n') for r in g.get('reputation') or [] if r.get('n')}
    for pair in lst(f(row, 26)):
        if pair and len(pair) == 2 and pair[1] in named: votes[pair[0]][named[pair[1]]] += 1
for fid, c in votes.items():
    FACTION.setdefault(fid, c.most_common(1)[0][0])

# ------------------------------------------------------------------ helpers
ALLY, HORDE = 1 | 4 | 8 | 64 | 4294967296, 2 | 16 | 32 | 128 | 8589934592


def side(mask):
    if not mask: return None
    a, h = bool(mask & ALLY), bool(mask & HORDE)
    return 'Alliance' if a and not h else 'Horde' if h and not a else None


def place(kind, eid):
    """(name, zone name, x, y) of an NPC or object from QuestieDB, using its most-used zone."""
    row = (Q['npc'] if kind == 'npc' else Q['object']).get(str(eid))
    if not row: return None
    spawns = f(row, 7 if kind == 'npc' else 4) or {}
    if isinstance(spawns, list): spawns = {str(i + 1): v for i, v in enumerate(spawns) if v}
    best = max(spawns.items(), key=lambda kv: len(lst(kv[1])), default=(None, []))
    z = best[0] or f(row, 9 if kind == 'npc' else 5)
    pts = [p for p in lst(best[1]) if isinstance(p, list) and len(p) == 2 and p[0] is not None and p[0] >= 0]
    x, y = (round(pts[0][0], 1), round(pts[0][1], 1)) if pts else (None, None)
    return [f(row, 1) or '', zone_name(z) if z else '', x, y]


def forever_added(kind, eid, field):
    """Values QuestieDB has in Forever that its inherited Classic layers do not (Forever-specific facts)."""
    now, era = Q[kind].get(str(eid)), E[kind].get(str(eid))
    return set(lst(f(now, field))) - set(lst(f(era, field)))


# ------------------------------------------------------------------ items
SLOT_INV = {'Head': 1, 'Neck': 2, 'Shoulder': 3, 'Shirt': 4, 'Chest': 5, 'Waist': 6, 'Legs': 7, 'Feet': 8, 'Wrist': 9,
            'Hands': 10, 'Finger': 11, 'Trinket': 12, 'One-Hand': 13, 'Off Hand': 14, 'Ranged': 15, 'Back': 16,
            'Two-Hand': 17, 'Tabard': 19, 'Main Hand': 21, 'Held In Off-hand': 23, 'Thrown': 25, 'Relic': 28}
GEAR = (2, 4)
items, cov = {}, Counter()
junk = re.compile(r'^(Monster - |DEPRECATED|Deprecated|\[?PH\]|OLD|TEST|Test )')
all_ids = set(int(k) for k in Q['item']) | set(FDB_ITEMS)
for iid in sorted(all_ids):
    qr, fd, eg = Q['item'].get(str(iid)), FDB_ITEMS.get(iid) or {}, EGT.get(str(iid))
    name = f(qr, 1) or fd.get('n') or (eg and None) or ''
    if not name: continue
    cls = f(qr, 12) if qr else fd.get('c')
    row = [name, fd.get('q', 1), f(qr, 9) or fd.get('il') or 0, f(qr, 10) or fd.get('rl') or 0, fd.get('inv', 0),
           fd.get('ic'), fd.get('sell', 0), fd.get('b', 0), [], cls, [], '', f(qr, 13) if qr else fd.get('sc')]
    if eg:
        row[1] = eg['q'] if eg['q'] is not None else row[1]
        row[2], row[3] = eg['il'] or row[2], eg['rl'] or row[3]
        row[6], row[7] = eg['sell'], eg['bind']
        row[8] = [[int(k), v] for k, v in eg['st'].items()]
        row[10] = eg['tip']
        row[11] = 'e'
        if not row[4] and eg.get('slot') in SLOT_INV:
            row[4] = 26 if eg['slot'] == 'Ranged' and row[12] == 19 else SLOT_INV[eg['slot']]
        cov['gear_tooltip_endgametools'] += 1
    elif cls in GEAR and fd.get('st') is not None and not junk.match(name):
        # endgametools has no page (mostly Season of Discovery gear the Forever client carries but does not
        # drop): ForeverDB's stats, marked so the app can say where they came from
        row[8] = fd.get('st') or []
        row[11] = 'f'
        cov['gear_stats_foreverdb_fallback'] += 1
    elif cls in GEAR:
        cov['gear_no_tooltip_junk' if junk.match(name) else 'gear_no_stats'] += 1
    items[iid] = row
    cov['items'] += 1
    cov['items_in_questie'] += bool(qr)
    cov['items_fdb_only'] += (not qr)
    cov['items_with_icon'] += bool(row[5])

# ------------------------------------------------------------------ sources per item
# Loot (who drops it, drop chance, how often players saw it on Forever): ForeverDB, the only bulk source of
# Forever loot. QuestieDB lists drops only for quest items, so it adds those, and marks a row as Forever data
# when the fact came from its Forever layers (Wowhead Forever snapshot, QuestieTrace player traces).
# Row: [kind, name, id, pct, seenOnForever, inst, boss, zone, x, y, origin f/c, rateSrc m/c/'', eligibleKills]
src, vend = {}, {}
FDB_VENDORS = FDB_V['vendors']
SIDE = {'Alliance': 'A', 'Horde': 'H'}     # vend row [7]: who the vendor serves, 'A', 'H', 'AH' or '' (unknown)
RS = {'matched': 'm', 'classic': 'c'}
for iid in items:
    qr = Q['item'].get(str(iid))
    rows, have = [], set()
    for e in FDB_SRC.get(str(iid), []):
        t = e.get('t')
        fv = bool(e.get('fv') or e.get('src') == 'forever')
        if t == 'world':
            lv = e.get('lv')
            rows.append(['world', f'world drop (mobs {lv[0]}-{lv[1]})' if lv else 'world drop', 0, None, 0, 0, 0, '',
                         None, None, 'f' if fv else 'c', '', 0])
            continue
        eid = e.get('npc') or e.get('obj') or e.get('item') or e.get('q') or e.get('spell') or 0
        name = e.get('n', '')
        if t == 'craft':      # ForeverDB puts skill 1 on Forever-seen recipes it has no skill level for
            name = f"{e.get('prof', '')} {e.get('skill') if (e.get('skill') or 0) > 1 else ''}".strip()
        if t == 'vendor' and e.get('many'): name = 'many vendors'
        pl = place('npc' if t in ('drop', 'vendor') else 'object', eid) if t in ('drop', 'object', 'vendor') and eid else None
        zone, x, y = (pl[1], pl[2], pl[3]) if pl else ('', e.get('x'), e.get('y'))
        if t == 'quest':
            name = f(Q['quest'].get(str(eid)), 1) or name
        rows.append([t, (pl[0] if pl and pl[0] else name), eid, e.get('pct'), e.get('seen', 0) if e.get('fv') else 0,
                     e.get('inst', 0), 1 if e.get('boss') else 0, zone, x, y, 'f' if fv else 'c',
                     RS.get(e.get('rateSrc'), ''), e.get('eligible', 0)])
        have.add((t, eid))
    if qr:
        for kind, field, ent in (('drop', 2, 'npc'), ('object', 3, 'object'), ('container', 4, None), ('quest', 6, None)):
            ids = lst(f(qr, field))
            added = forever_added('item', iid, field)
            if kind == 'drop' and len(ids) > 40:
                if not any(r[0] == 'world' for r in rows):
                    rows.append(['world', f'world drop ({len(ids)} kinds of mobs)', 0, None, 0, 0, 0, '', None, None,
                                 'f' if added else 'c', '', 0])
                continue
            for eid in ids:
                if (kind, eid) in have:
                    if eid in added:      # QuestieDB's Forever layers confirm a row ForeverDB had as Classic
                        for r in rows:
                            if r[0] == kind and r[2] == eid: r[10] = 'f'
                    continue
                if ent:
                    pl = place(ent, eid) or [f'#{eid}', '', None, None]
                    boss = 1 if ent == 'npc' and f(Q['npc'].get(str(eid)), 6) in (1, 3) else 0
                else:
                    pl = [f(Q['item' if kind == 'container' else 'quest'].get(str(eid)), 1) or f'#{eid}', '', None, None]
                    boss = 0
                rows.append([kind, pl[0], eid, None, 0, 0, boss, pl[1], pl[2], pl[3], 'f' if eid in added else 'c', '', 0])
                cov['src_rows_added_by_questie'] += 1
        # vendors: QuestieDB's vendor list, with ForeverDB's price and "seen selling it on Forever"
        vadded = forever_added('item', iid, 14)
        for v in lst(f(qr, 14)):
            pl = place('npc', v) or [f'NPC #{v}', '', None, None]
            fv = FDB_VENDORS.get(str(v)) or {}
            price = ((fv.get('sells') or {}).get(str(iid)) or {}).get('p')
            nrow = Q['npc'].get(str(v))
            vend.setdefault(iid, []).append([pl[0], pl[1], pl[2], pl[3], price, 1 if (v in vadded or fv.get('fv')) else 0,
                                             f(nrow, 14) or fv.get('sub') or '', f(nrow, 13) or SIDE.get(fv.get('side'), '')])
    if rows:
        rows.sort(key=lambda r: (r[10] != 'f', r[0] == 'quest', -(r[4] or 0), -(r[3] or 0)))
        src[iid] = rows[:15]
        cov['items_with_sources'] += 1
        cov['items_with_drop_rate'] += any(r[3] is not None for r in rows)
        cov['items_with_forever_rate'] += any(r[11] == 'm' for r in rows)
        cov['items_seen_dropping_on_forever'] += any(r[4] for r in rows)
# ForeverDB vendor lists for items QuestieDB has no vendor for
for vid, v in FDB_VENDORS.items():
    for siid, sv in (v.get('sells') or {}).items():
        siid = int(siid)
        if siid in items and not any(r[0] == (place('npc', vid) or [v.get('n')])[0] for r in vend.get(siid, [])):
            nrow = Q['npc'].get(str(vid))       # QuestieDB owns NPC facts (title, who it serves) when it has the NPC
            vend.setdefault(siid, []).append([v.get('n'), v.get('zone'), v.get('x'), v.get('y'), sv.get('p'), 1 if v.get('fv') else 0,
                                              f(nrow, 14) or v.get('sub') or '', f(nrow, 13) if nrow else SIDE.get(v.get('side'), '')])
for k in vend:
    vend[k] = sorted(vend[k], key=lambda r: -r[5])[:4]
cov['items_with_vendor'] = len(vend)

# ------------------------------------------------------------------ quests
nexts = defaultdict(set)
for qid, row in Q['quest'].items():
    for p in lst(f(row, 12)) + lst(f(row, 13)):
        nexts[p].add(int(qid))
reward_items = defaultdict(list)
for iid, row in Q['item'].items():
    for q in lst(f(row, 6)): reward_items[q].append(int(iid))


def who(group, kind):
    o = []
    for eid in lst(group)[:4]:
        pl = place(kind, eid)
        if pl: o.append([eid, pl[0], pl[1], pl[2], pl[3], kind])
    return o


quests = {}
for qid, row in Q['quest'].items():
    qi = int(qid)
    if not f(row, 1):                    # QuestieDB stub without a title: left out, counted as a gap
        cov['quests_skipped_no_title'] += 1
        continue
    sb, fb = f(row, 2) or [], f(row, 3) or []
    g = FDB_QG.get(qid) or {}
    zs = f(row, 17) or 0
    rew = [[r['id'], r.get('count', 1)] for r in g.get('reward') or []]
    cho = [[r['id'], r.get('count', 1)] for r in g.get('choice') or []]
    q = {
        't': f(row, 1), 'lv': f(row, 5), 'min': f(row, 4), 'side': side(f(row, 6) or 0), 'cls': f(row, 7),
        'cat': zone_name(zs) if zs > 0 else SORTS.get(zs, ''),
        'from': who(f(sb, 1), 'npc') + who(f(sb, 2), 'object'),
        'to': who(f(fb, 1), 'npc') + who(f(fb, 2), 'object'),
        'starter_item': lst(f(sb, 3))[:1] or None,
        'xp': XP.get(qi, (None, None))[1], 'xpLv': XP.get(qi, (None, None))[0],
        'reward': rew, 'choice': cho, 'money': g.get('money'),
        # QuestieDB knows which items a quest gives but not fixed vs choose-one
        'rewardAny': [[i, 1] for i in sorted(reward_items.get(qi, []))] if not (rew or cho) else None,
        'rep': [[FACTION.get(p[0], f'faction {p[0]}'), p[1]] for p in lst(f(row, 26)) if p and len(p) == 2],
        'prev': lst(f(row, 12)) + lst(f(row, 13)), 'next': sorted(nexts.get(qi, [])),
        'repReq': [[FACTION.get(f(row, 19)[0], f'faction {f(row, 19)[0]}'), f(row, 19)[1]]] if lst(f(row, 19)) else None,
        'skill': f(row, 18), 'provided': f(row, 11), 'obj': f(row, 8),
        'repeatable': 1 if (f(row, 24) or 0) & 1 else None,
        'type': g.get('type') or None,          # ForeverDB: Dungeon / Raid / Elite / PvP
        'origin': 'c' if qid in E['quest'] else 'f',
    }
    quests[qi] = {a: b for a, b in q.items() if b not in (None, [], '', 0, False)}
    cov['quests'] += 1
    cov['quests_forever_only'] += qid not in E['quest']
    cov['quests_with_giver'] += bool(quests[qi].get('from') or q['starter_item'])
    cov['quests_with_turnin'] += bool(quests[qi].get('to'))
    cov['quests_with_xp'] += bool(q['xp'])
    cov['quests_with_xp_from_forever_traces'] += qi in XP_TRACE
    cov['quests_with_reward_split'] += bool(rew or cho)
    cov['quests_with_reward_items_unsplit'] += bool(q['rewardAny'])
    cov['quests_with_money'] += bool(g.get('money'))

STAT = {3: 'Agility', 4: 'Strength', 5: 'Intellect', 6: 'Spirit', 7: 'Stamina', 12: 'Defense', 13: 'Dodge', 14: 'Parry',
        15: 'Block', 18: 'Spell hit %', 21: 'Spell crit %', 31: 'Hit', 32: 'Crit', 37: 'Expertise', 38: 'Attack power',
        41: 'Healing', 42: 'Spell damage', 43: 'MP5', 45: 'Spell power', 46: 'HP5', 47: 'Spell penetration',
        48: 'Block value', 100: 'Armor', 101: 'Fire resistance', 102: 'Frost resistance', 103: 'Nature resistance',
        104: 'Shadow resistance', 105: 'Arcane resistance', 110: 'Fire damage', 111: 'Shadow damage',
        112: 'Frost damage', 113: 'Arcane damage', 114: 'Nature damage', 115: 'Holy damage', 116: 'Crit %', 117: 'Hit %', 118: 'Dodge %', 119: 'Parry %', 120: 'Block %'}

# ------------------------------------------------------------------ item sets
# sets[id] = [name, [item ids], [[pieces, bonus text], ...], class mask]
SET_LINE = re.compile(r'^\((\d+)\) Set: (.+)$')
sets = {}
for it in FDB_ITEMS.values():
    sid = it.get('set')
    if not sid or it['id'] not in items: continue
    s_ = sets.setdefault(sid, [None, [], [], 0])
    s_[1].append(it['id'])
    s_[3] |= it.get('cls') or 0
    tip = (EGT.get(str(it['id'])) or {}).get('tip') or []
    k = next((i for i, l in enumerate(tip) if SET_LINE.match(l)), None)
    # the tooltip with the most bonus lines names the set (pieces the client hides have no tooltip)
    if k and len([l for l in tip if SET_LINE.match(l)]) > len(s_[2]):
        s_[0] = tip[k - 1]
        s_[2] = [[int(m.group(1)), m.group(2)] for m in map(SET_LINE.match, tip) if m]
# which classes a set is for: the items' own class mask (ForeverDB) or "Classes:" tooltip line, a class
# quest that rewards a piece, or a class quest that asks for pieces by name (the dungeon set 0.5 chain)
CLASS_BIT = {'Warrior': 1, 'Paladin': 2, 'Hunter': 4, 'Rogue': 8, 'Priest': 16, 'Shaman': 64, 'Mage': 128, 'Warlock': 256, 'Druid': 1024}
set_of = {i: sid for sid, s_ in sets.items() for i in s_[1]}
for sid, s_ in sets.items():
    for i in s_[1]:
        for l in (EGT.get(str(i)) or {}).get('tip') or []:
            if l.startswith('Classes: '):
                for c in l[9:].split(', '): s_[3] |= CLASS_BIT.get(c, 0)
piece_names = {sid: [items[i][0] for i in s_[1] if items[i][0]] for sid, s_ in sets.items()}
for q in quests.values():
    m = q.get('cls') or 0
    if not m: continue
    for i, _ in (q.get('reward') or []) + (q.get('choice') or []):
        if i in set_of: sets[set_of[i]][3] |= m
    text = ' '.join(q.get('obj') or [])
    if text:
        for sid, names in piece_names.items():
            if any(n in text for n in names): sets[sid][3] |= m
for s_ in sets.values(): s_[1].sort()
cov['item_sets'] = len(sets)
cov['item_sets_named'] = sum(1 for s_ in sets.values() if s_[0])

# ------------------------------------------------------------------ NPCs (QuestieDB Forever)
# npcs[id] = [name, min level, max level, rank, subname, zone, [[x, y], ...] up to 4 points in that zone, spawns there,
#             who it is friendly to ('A', 'H', 'AH' or '')]
# rank: 0 normal, 1 elite, 2 rare elite, 3 boss, 4 rare. Zone is the zone with the most spawns; inside a dungeon
# the points are (-1, -1) and are left out. QuestieDB's Forever points are already in Forever map coordinates
# (its README, "Era-to-Forever coordinate conversion"), so they are used as they are.
npcs = {}
for nid, row in Q['npc'].items():
    name = f(row, 1)
    if not name: continue
    spawns = f(row, 7) or {}
    if isinstance(spawns, list): spawns = {str(i + 1): v for i, v in enumerate(spawns) if v}
    zid, pts = max(spawns.items(), key=lambda kv: len(lst(kv[1])), default=(None, []))
    pts = [p for p in lst(pts) if isinstance(p, list) and len(p) == 2 and p[0] is not None and p[0] >= 0]
    step = max(1, len(pts) // 4)
    keep = [[round(p[0], 1), round(p[1], 1)] for p in pts[::step][:4]]
    z = zid or f(row, 9)
    npcs[int(nid)] = [name, f(row, 4) or 0, f(row, 5) or 0, f(row, 6) or 0, f(row, 14) or '', zone_name(z) if z else '',
                      keep, len(pts), f(row, 13) or '']
cov['npcs'] = len(npcs)
cov['npcs_with_spawn_point'] = sum(1 for n in npcs.values() if n[6])

builds = Counter(v.get('build') for v in EGT.values())
pack = {
    'v': 2, 'built': int(time.time()),
    'from': {'quests_npcs_sources': 'QuestieDB Forever ' + QMAN['questiedb_commit'][:10],
             'item_tooltips': 'endgametools, client build ' + (builds.most_common(1)[0][0] if builds else '?'),
             'drop_rates_icons_reward_split': 'ForeverDB (foreverdb.net/data)'},
    'items': items, 'src': src, 'quests': quests, 'vend': vend, 'npcs': npcs, 'stat': STAT,
    'sets': {sid: v for sid, v in sets.items()},
    # group size of the dungeon / raid an item drops in, from endgametools ("5 players", "10 players")
    'size': {int(k): v['size'] for k, v in EGT.items() if v.get('size')},
    # how the Forever client says you get it (endgametools "How to get it"); no entry = no known way yet
    'how': {int(k): v['how'] for k, v in EGT.items() if v.get('how')},
}
s = json.dumps(pack, separators=(',', ':'), ensure_ascii=False)
open(P('out', 'gamedata.js'), 'w', encoding='utf-8').write('window.GAMEDATA=' + s + ';\n')

cov['egt_pages_missing'] = len(EGT_MISSING)
cov['factions_named'] = len(FACTION)
cov['pack_kb'] = len(s) // 1024
report = {'built': time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime()), 'from': pack['from'], 'counts': dict(cov)}
json.dump(report, open(P('out', 'coverage.json'), 'w'), indent=1)
print(json.dumps(report, indent=1))
