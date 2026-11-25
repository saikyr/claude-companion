#!/usr/bin/env python3
"""Every profession recipe's tools and place (a Runed Arcanite Rod, an anvil, a Moonwell), from VMaNGOS (Classic 1.12).

  python3 -I recipes.py <world_full_*.sql or .7z> <out.json> [<enchants out.json>]

Writes {spell id: [spell name, profession, [tool item ids], place name, [item ids it makes], [[reagent item id, count],
...], trainer skill]} for every recipe the
profession skill lines teach (skill_line_ability), learned or not: the spells that make an item (effect 24) or enchant
one (53). The skill ranks themselves (Mining, Herb Gathering, Fishing...), Find Minerals and the like are not recipes. Tools are the spell's totem1/totem2 (items you carry), the
place is its requiresSpellFocus (an object you stand next to), named after the game objects that provide it. Reagents
are the spell's reagent1..8; the trainer skill is the lowest skill a trainer (npc_trainer, npc_trainer_template) asks
to teach it, through the spell the trainer casts to teach it (effect 36); 0 when it comes with the profession itself
(skill_line_ability learn_on_get_skill), null when neither: a recipe item teaches it, or nothing does.

With a third path, also every permanent enchant (#147): {enchant id: [name, description, [[spell that applies it, item
class, item subclass mask, inventory type mask], ...], [[item whose use applies it, the same masks], ...]]}: the spells with an Enchant Item
effect (53), from Enchanting and from items (an Arcanum, a Zandalar Signet, an armor kit). The description is the
spell's own text ("Permanently enchant bracers to give +7 Stamina."): the app reads its numbers (js/enchants.js).

Why VMaNGOS: neither QuestieDB nor ForeverDB carries a recipe's tools, and the game only tells you for recipes you
already know (C_TradeSkillUI.GetRecipeRequirements, read by Professions.lua). The data is Classic, labelled so in
the pack ('from'); for a known recipe the app and coaching use the game's own answer. Forever's own new recipes
(spell ids above 1,000,000) are not in it.
"""
import json, os, re, sys
from collections import Counter, defaultdict

PROF = {164: 'Blacksmithing', 165: 'Leatherworking', 171: 'Alchemy', 182: 'Herbalism', 185: 'Cooking', 186: 'Mining',
        197: 'Tailoring', 202: 'Engineering', 333: 'Enchanting', 129: 'First Aid', 356: 'Fishing', 40: 'Poisons'}


def text(path):
    if path.endswith('.7z'):
        import glob, py7zr, tempfile
        with tempfile.TemporaryDirectory() as d:
            with py7zr.SevenZipFile(path) as z: z.extractall(d)
            sql, = glob.glob(os.path.join(d, '*.sql'))
            return open(sql, encoding='utf-8').read()
    return open(path, encoding='utf-8').read()


TOKEN = re.compile(r"'((?:[^'\\]|\\.)*)'|(-?[0-9.eE+-]+)|(NULL)|([(),;])", re.S)


def inserts(sql, table):
    """Rows of every INSERT INTO `table` (...) VALUES (...),(...); as dicts by column name."""
    for m in re.finditer(r'INSERT INTO `' + table + r'` \(([^)]*)\) VALUES\s*', sql):
        cols = [c.strip(' `') for c in m.group(1).split(',')]
        pos, row, depth = m.end(), [], 0
        while True:
            t = TOKEN.match(sql, pos)
            if not t:      # whitespace
                pos += 1; continue
            pos = t.end()
            s, num, null, p = t.groups()
            if p == '(': depth, row = 1, []
            elif p == ')': depth = 0; yield dict(zip(cols, row))
            elif p == ';': break
            elif p == ',': pass
            elif s is not None: row.append(re.sub(r'\\(.)', r'\1', s))
            elif null: row.append(None)
            else: row.append(float(num) if re.search(r'[.eE]', num) else int(num))


def main(src, out, ench_out=None):
    sql = text(src)
    prof = {}
    auto = set()      # learned with the profession itself (Charred Wolf Meat with Cooking)
    for r in inserts(sql, 'skill_line_ability'):
        if r['skill_id'] in PROF:
            prof[r['spell_id']] = PROF[r['skill_id']]
            if r['learn_on_get_skill']: auto.add(r['spell_id'])
    best, ench, pts, learn = {}, {}, {}, {}      # newest build of each spell up to 1.12.1 (5875); pts: each spell's effect values
    for r in inserts(sql, 'spell_template'):
        if r['build'] > 5875: continue
        for i in (1, 2, 3):      # a spell that teaches another (a trainer's): effect 36, Learn Spell
            if r[f'effect{i}'] == 36 and r[f'effectTriggerSpell{i}']: learn[r['entry']] = r[f'effectTriggerSpell{i}']
        if r['build'] >= pts.get(r['entry'], (-1,))[0]:
            pts[r['entry']] = (r['build'],) + tuple((r[f'effectBasePoints{i}'], r[f'effectDieSides{i}']) for i in (1, 2, 3))
        if r['entry'] in prof and r['build'] >= best.get(r['entry'], {}).get('build', -1):
            best[r['entry']] = r
        if any(r[f'effect{i}'] == 53 for i in (1, 2, 3)) and r['build'] >= ench.get(r['entry'], {}).get('build', -1):
            ench[r['entry']] = r
    best = {k: r for k, r in best.items() if any(r[f'effect{i}'] in (24, 53) for i in (1, 2, 3))}
    names = defaultdict(Counter)      # spell focus id -> names of the objects that provide it
    for r in inserts(sql, 'gameobject_template'):
        if r['type'] == 8 and r['data0']: names[r['data0']][r['name']] += 1
    place = {k: c.most_common(1)[0][0] for k, c in names.items()}
    trainer = {}      # recipe spell -> the lowest skill a trainer asks
    for t in ('npc_trainer', 'npc_trainer_template'):
        for r in inserts(sql, t):
            if not (r['build_min'] <= 5875 <= r['build_max']): continue
            sp = learn.get(r['spell'], r['spell'])
            if sp in best: trainer[sp] = min(trainer.get(sp, 10 ** 6), r['reqskillvalue'] or 0)
    for sp in auto:
        if sp in best: trainer[sp] = 0
    res, nofocus = {}, Counter()
    for sid, r in sorted(best.items()):
        f = r['requiresSpellFocus']
        if f and f not in place: nofocus[f] += 1
        makes = sorted({r[f'effectItemType{i}'] for i in (1, 2, 3) if r[f'effect{i}'] == 24 and r[f'effectItemType{i}']})
        res[sid] = [' '.join(r['name'].split()), prof[sid], [t for t in (r['totem1'], r['totem2']) if t], place.get(f, '') if f else '', makes,
                   [[r[f'reagent{j}'], r[f'reagentCount{j}']] for j in range(1, 9) if r[f'reagent{j}'] and r[f'reagentCount{j}']], trainer.get(sid)]
    if nofocus: sys.exit(f'spell focus ids with no object name: {dict(nofocus)}')
    if ench_out: enchants(sql, ench, pts, ench_out)
    with open(out, 'w', encoding='utf-8') as fh: json.dump(res, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(res)} recipes, {sum(1 for v in res.values() if v[2])} with tools, {sum(1 for v in res.values() if v[3])} with a place, '
          f'{sum(1 for v in res.values() if v[5])} with reagents, {sum(1 for v in res.values() if v[6] is not None)} taught by a trainer')


def resolve(text, sid, pts):
    """a description's $s1 / $13897s1 (effect 1 of this spell / of spell 13897) as the number the game shows"""
    def val(m):
        p = pts.get(int(m[1]) if m[1] else sid)
        if not p: return m[0]
        base, sides = p[int(m[2])]
        lo, hi = base + 1, base + max(sides, 1)
        return str(lo) if lo == hi else f'{lo} to {hi}'
    return re.sub(r'\$(\d+)?s([123])', val, text)


def enchants(sql, spells, pts, out):
    """{enchant id: [name, description, [[spell, item class, subclass mask, inventory type mask], ...],
    [[item, item class, subclass mask, inventory type mask], ...]]}: the masks are each spell's own (Enchant Boots - Spirit
    and Enchant Bracer - Spirit put the same enchant on different slots), an item's those of the spell it casts"""
    by, mask = {}, {}      # enchant id -> its row; spell -> (enchant id, its masks)
    for sid, r in sorted(spells.items()):
        i = next(i for i in (1, 2, 3) if r[f'effect{i}'] == 53)
        eid = r[f'effectMiscValue{i}']
        if not eid: continue
        name = ' '.join(r['name'].split())
        row = by.setdefault(eid, [name.split(' - ', 1)[1] if name.startswith('Enchant ') and ' - ' in name else name,
                                  resolve(' '.join((r['description'] or '').split()), sid, pts), [], []])
        m = [r['equippedItemClass'], r['equippedItemSubClassMask'], r['equippedItemInventoryTypeMask']]
        row[2].append([sid] + m)
        mask[sid] = (eid, m)
    item = {}      # newest patch of each item that uses one of these spells
    for r in inserts(sql, 'item_template'):
        for i in range(1, 6):      # used (trigger 0), not a recipe that teaches the spell (6)
            sp = r.get(f'spellid_{i}')
            if sp in mask and r.get(f'spelltrigger_{i}') == 0 and r['class'] != 9 and r['patch'] >= item.get(r['entry'], (-1, 0))[0]:
                item[r['entry']] = (r['patch'], sp)
    for iid, (_, sp) in sorted(item.items()):
        eid, m = mask[sp]
        by[eid][3].append([iid] + m)
    with open(out, 'w', encoding='utf-8') as fh: json.dump(by, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(by)} enchants, {sum(1 for v in by.values() if v[3])} applied by an item')


if __name__ == '__main__':
    main(*sys.argv[1:4])
