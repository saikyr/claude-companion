#!/usr/bin/env python3
"""The game-data pack as database rows (the `game` schema on the sync backend, supabase/migrations/*_game_data.sql).

The same pack the app uses (web/data/gamedata.js, web/data/rules.js), so a Claude session looks a fact up in
the database and gets exactly what the app shows: no web search, no second source. Nothing is computed here
beyond splitting the pack's rows into columns; rates and their labels are made by the database views.

    python3 tools/pack-to-rows.py [--out DIR] [--chunk N]
      writes DIR/pack.json ({hash, built, from, counts}) and DIR/<table>-<n>.json (lists of rows), default dist/game

Tables: items, drops (every source row of `src`: drops, objects, quests, vendors, crafts...), quests, npcs,
vendors, rules. Keys are stable for one pack: items/quests/npcs by id, drops and vendors by item and position.
"""
import argparse, hashlib, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'ClaudeCompanion', 'web', 'data')


def load_js(path, var):
    """window.<var> = {...}; -> the object (the pack files are plain JSON after the assignment)."""
    text = open(path, encoding='utf-8').read()
    m = re.search(r'window\.' + var + r'\s*=\s*', text)
    if not m: raise SystemExit(f'{path}: no window.{var}')
    return json.JSONDecoder().raw_decode(text[m.end():])[0], text


def rules_obj(text):
    """rules.js is JavaScript, not JSON (comments, unquoted keys): node evaluates it."""
    import subprocess
    js = "global.window={};require(process.argv[1]);process.stdout.write(JSON.stringify(window.GAMERULES))"
    r = subprocess.run(['node', '-e', js, os.path.join(DATA, 'rules.js')], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def at(row, i, default=None):
    return row[i] if isinstance(row, list) and len(row) > i and row[i] is not None else default


def rows(gd, rules):
    items = [{'id': int(k), 'name': at(r, 0), 'q': at(r, 1), 'ilvl': at(r, 2), 'req': at(r, 3), 'inv': at(r, 4),
              'icon': at(r, 5), 'sell': at(r, 6), 'bind': at(r, 7), 'stats': at(r, 8, []), 'class': at(r, 9),
              'tip': at(r, 10, []), 'tip_src': at(r, 11, ''), 'subclass': at(r, 12),
              'how': (gd.get('how') or {}).get(k), 'size': (gd.get('size') or {}).get(k),
              'req_rep': (gd.get('req') or {}).get(k)} for k, r in gd['items'].items()]
    drops = []
    for k, lst in gd['src'].items():
        for i, r in enumerate(lst):
            drops.append({'key': f'{k}:{i}', 'item_id': int(k), 'kind': at(r, 0), 'source': at(r, 1), 'source_id': at(r, 2),
                          'pct': at(r, 3), 'seen': at(r, 4, 0), 'instance_id': at(r, 5, 0), 'boss': bool(at(r, 6, 0)),
                          'zone': at(r, 7, ''), 'x': at(r, 8), 'y': at(r, 9), 'origin': at(r, 10, ''),
                          'rate_src': at(r, 11, ''), 'eligible': at(r, 12, 0)})
    quests = []
    for k, q in gd['quests'].items():
        quests.append({'id': int(k), 'title': q.get('t'), 'lv': q.get('lv'), 'min': q.get('min'), 'side': q.get('side'),
                       'type': q.get('type'), 'cat': q.get('cat'), 'prev': q.get('prev') or [], 'next': q.get('next') or [],
                       'obj': q.get('obj') or [], 'giver': q.get('from') or [], 'turnin': q.get('to') or [],
                       'reward': q.get('reward') or [], 'choice': q.get('choice') or [], 'reward_any': q.get('rewardAny') or [],
                       'rep': q.get('rep') or [], 'xp': q.get('xp'), 'money': q.get('money'), 'origin': q.get('origin')})
    npcs = [{'id': int(k), 'name': at(r, 0), 'min_lv': at(r, 1), 'max_lv': at(r, 2), 'rank': at(r, 3), 'sub': at(r, 4, ''),
             'zone': at(r, 5, ''), 'points': at(r, 6, []), 'spawns': at(r, 7, 0), 'friendly': at(r, 8, '')} for k, r in gd['npcs'].items()]
    vendors = []
    for k, lst in gd['vend'].items():
        for i, r in enumerate(lst):
            vendors.append({'key': f'{k}:{i}', 'item_id': int(k), 'npc': at(r, 0), 'zone': at(r, 1), 'x': at(r, 2), 'y': at(r, 3),
                            'price': at(r, 4), 'seen_forever': bool(at(r, 5, 0)), 'sub': at(r, 6, ''), 'side': at(r, 7, '')})
    rule_rows = [{'key': k, 'value': v} for k, v in rules.items()]
    return {'items': items, 'drops': drops, 'quests': quests, 'npcs': npcs, 'vendors': vendors, 'rules': rule_rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'dist', 'game'))
    ap.add_argument('--chunk', type=int, default=4000)
    a = ap.parse_args()
    gd, gtext = load_js(os.path.join(DATA, 'gamedata.js'), 'GAMEDATA')
    rtext = open(os.path.join(DATA, 'rules.js'), encoding='utf-8').read()
    rules = rules_obj(rtext)
    h = hashlib.sha256((gtext + '\n' + rtext).encode('utf-8')).hexdigest()[:16]
    tables = rows(gd, rules)
    os.makedirs(a.out, exist_ok=True)
    for f in os.listdir(a.out):
        if f.endswith('.json'): os.remove(os.path.join(a.out, f))
    files = []
    for t, lst in tables.items():
        for n in range(0, len(lst), a.chunk):
            name = f'{t}-{n // a.chunk:03d}.json'
            with open(os.path.join(a.out, name), 'w', encoding='utf-8') as fh:
                json.dump(lst[n:n + a.chunk], fh, ensure_ascii=False, separators=(',', ':'))
            files.append({'table': t, 'file': name, 'rows': len(lst[n:n + a.chunk])})
    meta = {'hash': h, 'built': gd.get('built'), 'from': gd.get('from'), 'counts': {t: len(l) for t, l in tables.items()}, 'files': files}
    with open(os.path.join(a.out, 'pack.json'), 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)
    print(json.dumps({'hash': h, 'counts': meta['counts'], 'files': len(files)}))


if __name__ == '__main__':
    main()
