#!/usr/bin/env python3
"""Validation tests for the game-data pack. Exit code 1 if any check fails.

  python3 -I test_pack.py <gamedata.js> [ClaudeCompanion.lua SavedVariables, optional]

1. Shape: every row has the fields the app reads, with the right types.
2. Known facts, each checked by hand against the source page when the test was written.
3. Coverage floors: a broken download or a changed page layout shows up as a collapse here.
4. With a SavedVariables file: the pack's stats against the game's own tooltips for every
   item the player has seen, and pack coverage of the player's quest log.
"""
import json, re, sys

PACK = sys.argv[1]
SAVE = sys.argv[2] if len(sys.argv) > 2 else None
s = open(PACK, encoding='utf-8').read()
G = json.loads(s[s.index('=') + 1:s.rstrip().rindex(';')])
fails, passes = [], 0


def check(ok, msg):
    global passes
    if ok: passes += 1
    else: fails.append(msg)


# ---------------------------------------------------------------- 1. shape
check(G.get('v') == 2, 'pack version is 2')
bad = [k for k, r in G['items'].items() if not (isinstance(r, list) and len(r) == 13 and isinstance(r[0], str) and r[0]
       and isinstance(r[8], list) and isinstance(r[10], list) and r[11] in ('', 'e', 'f'))]
check(not bad, f'item rows well formed ({len(bad)} bad, e.g. {bad[:3]})')
bad = [k for k, rows in G['src'].items() for r in rows if not (len(r) == 13 and r[10] in ('f', 'c') and r[11] in ('', 'm', 'c'))]
check(not bad, f'source rows well formed ({len(bad)} bad, e.g. {bad[:3]})')
bad = [k for k, q in G['quests'].items() if not q.get('t') or any(len(w) != 6 for w in q.get('from', []) + q.get('to', []))]
check(not bad, f'quest rows well formed ({len(bad)} bad, e.g. {bad[:3]})')
bad = [k for k, q in G['quests'].items() if '#' in str(q.get('t')) or 'object Object' in json.dumps(q)]
check(not bad, f'no placeholder quest titles or [object Object] ({len(bad)}, e.g. {bad[:3]})')
bad = [k for k, rows in G['src'].items() for r in rows if r[3] is not None and not (0 < r[3] <= 100)]
check(not bad, f'drop chances are percentages in (0, 100] ({len(bad)} bad)')

# ---------------------------------------------------------------- 2. known facts
it = G['items']
st = lambda i: dict((a, b) for a, b in it[str(i)][8])
# endgametools 17710 (build 1.60.1.71037): +11 Int, 2 mp5, healing 116 / damage 38; game tooltip agrees
dv = (G.get('sets') or {}).get('182') or []
check(len(dv) == 4 and dv[0] == 'Vestments of the Devout' and len(dv[1]) == 8 and dv[3] & 16 and any(n == 6 for n, _ in dv[2]),
      'item sets: Vestments of the Devout has 8 pieces, 6-piece bonus, and is a Priest set')
check(st(17710).get(41) == 116 and st(17710).get(42) == 38 and st(17710).get(43) == 2 and st(17710).get(5) == 11,
      f'Charstone Dirk stats {st(17710)}')
check(it['17710'][11] == 'e', 'Charstone Dirk tooltip comes from endgametools')
# a lower-case "+1% spell crit" line is read (#123): Eye of the Beast, "Critical Strike with Spells by 1%"
check(st(13968).get(21) == 1, f'Eye of the Beast has 1% spell crit {st(13968)}')
# Forever's own T0.5 pieces keep their ForeverDB stats when endgametools has no page (Virtuous Epaulets)
check(st(226955).get(45) and st(226955).get(31), f'Virtuous Epaulets has spell power and hit {st(226955)}')
q64 = G['quests']['64']
check(q64['t'] == 'The Forgotten Heirloom' and q64['from'][0][1] == 'Farmer Furlbrow' and q64['from'][0][2] == 'Westfall',
      f"quest 64 giver {q64.get('from')}")
check(G['quests']['272'].get('side') == 'Alliance', "quest 272 (Night Elf + Skyborne Alliance) is Alliance")
check(any(r[0] == 'drop' and r[1] == 'Princess Theradras' for r in G['src'].get('17710', [])), 'Charstone Dirk drops from Princess Theradras')
check(all(q.get('t') for q in G['quests'].values()), 'every quest has a title')
npc = G.get('npcs') or {}
# QuestieDB Forever npc 1261: Veron Amberstill, Ram Breeder, level 10, Dun Morogh 63.5, 50.6 (same as quest 7674's giver)
v = npc.get('1261') or []
check(v[:2] == ['Veron Amberstill', 10] and v[4] == 'Ram Breeder' and v[5] == 'Dun Morogh' and v[6][:1] == [[63.5, 50.6]],
      f'npc 1261 Veron Amberstill {v}')
check((npc.get('9019') or [''])[0] == 'Emperor Dagran Thaurissan', 'npc 9019 is Emperor Dagran Thaurissan (BRD)')

# ---------------------------------------------------------------- 3. coverage floors
n = lambda c: sum(1 for x in c)
gear_e = n(r for r in it.values() if r[11] == 'e' and r[9] in (2, 4))
check(gear_e > 10000, f'endgametools tooltips for >10,000 items (got {gear_e})')
check(len(G['quests']) > 6000, f'>6,000 quests (got {len(G["quests"])})')
check(len(G['src']) > 15000, f'>15,000 items with sources (got {len(G["src"])})')
fq = n(q for q in G['quests'].values() if q.get('origin') == 'f')
check(fq > 1500, f'>1,500 Forever-only quests (got {fq})')
check(len(npc) > 15000, f'>15,000 NPCs (got {len(npc)})')
# ForeverDB 17059 Plans: Dark Iron Reaver: teaches spell 20890 (the Reaver's craft), needs Thorium Brotherhood Friendly
check((G.get('teach') or {}).get('17015') == [[17059, 300]] and (G.get('req') or {}).get('17059') == ['Thorium Brotherhood', 5],
      'Dark Iron Reaver: recipe Plans: Dark Iron Reaver (skill 300), Thorium Brotherhood Friendly')
check(len(G.get('teach') or {}) > 1000, f">1,000 crafted items with a recipe item (got {len(G.get('teach') or {})})")

# ---------------------------------------------------------------- 4. the player's own game data
GAME = {'ITEM_MOD_AGILITY_SHORT': 3, 'ITEM_MOD_STRENGTH_SHORT': 4, 'ITEM_MOD_INTELLECT_SHORT': 5,
        'ITEM_MOD_SPIRIT_SHORT': 6, 'ITEM_MOD_STAMINA_SHORT': 7, 'ITEM_MOD_SPELL_HEALING_DONE_SHORT': 41,
        'ITEM_MOD_SPELL_DAMAGE_DONE_SHORT': 42, 'ITEM_MOD_MANA_REGENERATION_SHORT': 43, 'ITEM_MOD_SPELL_POWER_SHORT': 45,
        'ITEM_MOD_FIRE_DAMAGE_DONE_SHORT': 110, 'ITEM_MOD_SHADOW_DAMAGE_DONE_SHORT': 111,
        'ITEM_MOD_FROST_DAMAGE_DONE_SHORT': 112, 'ITEM_MOD_ARCANE_DAMAGE_DONE_SHORT': 113,
        'ITEM_MOD_NATURE_DAMAGE_DONE_SHORT': 114, 'ITEM_MOD_HOLY_DAMAGE_DONE_SHORT': 115,
        'ITEM_MOD_FIRE_RESISTANCE_SHORT': 101, 'ITEM_MOD_FROST_RESISTANCE_SHORT': 102,
        'ITEM_MOD_NATURE_RESISTANCE_SHORT': 103, 'ITEM_MOD_SHADOW_RESISTANCE_SHORT': 104,
        'ITEM_MOD_ARCANE_RESISTANCE_SHORT': 105, 'RESISTANCE0_NAME': 100, 'ITEM_MOD_HIT_RATING_SHORT': 31,
        'ITEM_MOD_CRIT_RATING_SHORT': 32, 'ITEM_MOD_ATTACK_POWER_SHORT': 38, 'ITEM_MOD_DEFENSE_SKILL_RATING_SHORT': 12,
        'ITEM_MOD_DODGE_RATING_SHORT': 13, 'ITEM_MOD_PARRY_RATING_SHORT': 14, 'ITEM_MOD_BLOCK_RATING_SHORT': 15}
report = {}
if SAVE:
    import lupa.lua51 as L
    lua = L.LuaRuntime()
    lua.execute(open(SAVE, encoding='utf-8', errors='replace').read())

    def conv(o):
        if L.lua_type(o) == 'table': return {str(k): conv(v) for k, v in o.items()}
        return o
    db = conv(lua.globals().ClaudeCompanionDB)
    compared, mism, plain = 0, [], 0
    for link, rec in (db.get('items') or {}).items():
        m = re.match(r'item:(\d+):([^:]*):(?:[^:]*:){4}([^:]*)', link)
        if not m or not rec.get('stats'): continue
        iid, ench, suffix = m[1], m[2], m[3]
        row = it.get(iid)
        if not row or row[11] != 'e': continue
        bonus = re.search(r':1:(\d{5}):', link)            # random-enchantment bonus ("of the Owl") changes stats
        if ench or suffix or bonus: continue
        want = {GAME[k]: v for k, v in rec['stats'].items() if k in GAME}
        if 15 in want: want.pop(15)                         # block rating vs shield block value differ by design
        have = dict((a, b) for a, b in row[8])
        diff = {k: (v, have.get(k)) for k, v in want.items() if have.get(k) != v}
        compared += 1
        if diff: mism.append((rec.get('name'), diff))
    report['stats_compared_with_game'] = compared
    report['stats_mismatch'] = mism
    check(compared >= 20 and len(mism) <= max(2, compared // 50),
          f'pack stats match the game tooltips ({compared} compared, {len(mism)} differ: {mism[:4]})')
    seen_q = {}
    for ch in (db.get('chars') or {}).values():
        for q in ((ch.get('snap') or {}).get('quests') or {}).values():
            if isinstance(q, dict) and q.get('id'): seen_q[str(q['id'])] = q.get('title')
    inpack = [i for i in seen_q if i in G['quests']]
    withto = [i for i in inpack if G['quests'][i].get('to')]
    report['log_quests'] = len(seen_q); report['log_quests_in_pack'] = len(inpack); report['log_quests_with_turnin'] = len(withto)
    report['log_quests_missing'] = [(i, seen_q[i]) for i in seen_q if i not in G['quests']]
    check(len(inpack) == len(seen_q), f'every quest in the log is in the pack (missing {report["log_quests_missing"]})')
    titles = [(i, seen_q[i], G['quests'][i]['t']) for i in inpack if seen_q[i] and G['quests'][i]['t'] != seen_q[i]]
    report['log_title_mismatch'] = titles
    check(not titles, f'quest titles match the game ({titles[:4]})')

print(json.dumps(report, indent=1, ensure_ascii=False))
print(f'{passes} passed, {len(fails)} failed')
for f_ in fails: print('FAIL:', f_)
sys.exit(1 if fails else 0)
