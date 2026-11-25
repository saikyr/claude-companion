#!/usr/bin/env python3
"""Every profession recipe's tools and place (a Runed Arcanite Rod, an anvil, a Moonwell), from VMaNGOS (Classic 1.12).

  python3 -I recipes.py <world_full_*.sql or .7z> <out.json>

Writes {spell id: [spell name, profession, [tool item ids], place name]} for every spell the profession skill
lines teach (skill_line_ability), learned or not. Tools are the spell's totem1/totem2 (items you carry), the
place is its requiresSpellFocus (an object you stand next to), named after the game objects that provide it.

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


def main(src, out):
    sql = text(src)
    prof = {}
    for r in inserts(sql, 'skill_line_ability'):
        if r['skill_id'] in PROF: prof[r['spell_id']] = PROF[r['skill_id']]
    best = {}      # newest build of each spell up to 1.12.1 (5875)
    for r in inserts(sql, 'spell_template'):
        if r['entry'] in prof and r['build'] <= 5875 and r['build'] >= best.get(r['entry'], {}).get('build', -1):
            best[r['entry']] = r
    names = defaultdict(Counter)      # spell focus id -> names of the objects that provide it
    for r in inserts(sql, 'gameobject_template'):
        if r['type'] == 8 and r['data0']: names[r['data0']][r['name']] += 1
    place = {k: c.most_common(1)[0][0] for k, c in names.items()}
    res, nofocus = {}, Counter()
    for sid, r in sorted(best.items()):
        f = r['requiresSpellFocus']
        if f and f not in place: nofocus[f] += 1
        res[sid] = [' '.join(r['name'].split()), prof[sid], [t for t in (r['totem1'], r['totem2']) if t], place.get(f, '') if f else '']
    if nofocus: sys.exit(f'spell focus ids with no object name: {dict(nofocus)}')
    with open(out, 'w', encoding='utf-8') as fh: json.dump(res, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(res)} recipes, {sum(1 for v in res.values() if v[2])} with tools, {sum(1 for v in res.values() if v[3])} with a place')


if __name__ == '__main__':
    main(*sys.argv[1:3])
