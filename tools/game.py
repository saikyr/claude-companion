#!/usr/bin/env python3
"""Game facts offline: the `game` schema's look-ups, read from the pack every install has (web/data/gamedata.js,
web/data/rules.js), for a Claude with no database (a friend's; ships in every build as claude/game.py).

The rows are tools/pack-to-rows.py's, the ones the database loads; the drop-rate labels are game.drop_rates'
(supabase/migrations/*_game_data.sql), worked out the same way and printed as Postgres prints them.
test/web/game.test.js compares every drop row's label and every look-up below with the database's.

    python3 claude/game.py item <id or name>        what it is, every source labelled (the best 40), vendors, quest rewards
    python3 claude/game.py npc <id or name>         level, rank, where, everything it drops, labelled
    python3 claude/game.py quest <id or title>      the chain, rewards, rep, and whether to keep it (the dungeon-quest rule)
    python3 claude/game.py instance <zone>          bosses, the best 300 drops (bosses first), its rules
    python3 claude/game.py drop <item id> <npc id>  one drop's rate and label: what a card's src game.drop:<item>:<npc> means
    python3 claude/game.py recipe <id or name>      recipes by spell, name, tool (Runed Arcanite Rod), what they make or teach them: tools, place
    python3 claude/game.py status                   which pack
Output is JSON, the same fields as the database's game.item / game.npc / game.quest / game.instance / game.recipe / game.status
(status has no loadedAt: nothing is loaded here).
"""
import importlib.util, json, os, re, sys
from decimal import Decimal, ROUND_HALF_UP, getcontext

HERE = os.path.dirname(os.path.abspath(__file__))
# game.recipe_source() (supabase/migrations/*_game_recipes.sql), word for word
RECIPE_SOURCE = ("VMaNGOS world database (Classic 1.12): a recipe Forever changed can differ; for a recipe the character knows, "
                 "the game's own answer (the now record) wins. Forever's own new recipes are not listed.")
_spec = importlib.util.spec_from_file_location('pack_to_rows', os.path.join(HERE, 'pack-to-rows.py'))
P = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(P)
getcontext().prec = 40


def _num(v):
    return None if v is None else Decimal(v) if not isinstance(v, Decimal) else v


def wilson(k, n, upper):
    """game.wilson: the 95% Wilson range of k drops in n corpses, in percent, rounded to 2 places."""
    if n is None or n <= 0: return None
    k, n = Decimal(k), Decimal(n)
    p = k / n
    s = (p * (1 - p) / n + Decimal('0.9604') / (n * n))
    s = max(Decimal(0), s).sqrt()
    v = (p + Decimal('1.9208') / n + (1 if upper else -1) * Decimal('1.96') * s) / (1 + Decimal('3.8416') / n)
    return (100 * max(Decimal(0), min(Decimal(1), v))).quantize(Decimal('0.01'), ROUND_HALF_UP)


def _s(d):   # a numeric as Postgres prints it
    return format(d, 'f') if isinstance(d, Decimal) else str(d)


class Game:
    def __init__(self, data=None):
        data = data or P.DATA
        gd, gtext = P.load_js(os.path.join(data, 'gamedata.js'), 'GAMEDATA', parse_float=Decimal)
        with open(os.path.join(data, 'rules.js'), encoding='utf-8') as f: rtext = f.read()
        self._rtext = rtext
        self._rules = None
        self.hash = __import__('hashlib').sha256((gtext + '\n' + rtext).encode('utf-8')).hexdigest()[:16]
        self.gd = gd
        t = P.rows(gd, {})
        self.items = {r['id']: r for r in t['items']}
        self.quests = {r['id']: r for r in t['quests']}
        self.npcs = {r['id']: r for r in t['npcs']}
        self.vendors = t['vendors']
        self.recipes = sorted(t['recipes'], key=lambda c: c['spell_id'])
        self.rates = [self._rate(d) for d in t['drops']]
        self.counts = {k: len(v) for k, v in t.items()}

    @property
    def rules(self):
        if self._rules is None: self._rules = P.rules_obj(self._rtext)
        return self._rules

    def _rate(self, d):
        """one row of game.drop_rates"""
        pct, elig = _num(d['pct']), d['eligible'] or 0
        if d['kind'] == 'drop' and d['rate_src'] == 'm' and elig > 0 and pct is not None: rate = 'forever'
        elif d['kind'] == 'drop' and d['rate_src'] == 'c' and pct is not None: rate = 'classic'
        else: rate = 'unknown'
        seen = d['origin'] == 'f' or (d['seen'] or 0) > 0
        r = {'item_id': d['item_id'], 'item_name': (self.items.get(d['item_id']) or {}).get('name'), 'kind': d['kind'], 'source': d['source'],
             'source_id': d['source_id'], 'zone': d['zone'], 'instance_id': d['instance_id'], 'boss': d['boss'], 'rate': rate,
             'rate_pct': None, 'rate_low': None, 'rate_high': None, 'corpses': None, 'classic_pct': None, 'seen_on_forever': seen}
        if rate == 'forever':
            k = (pct * elig / 100).quantize(Decimal(1), ROUND_HALF_UP)
            r.update(rate_pct=pct, rate_low=wilson(k, elig, False), rate_high=wilson(k, elig, True), corpses=elig)
            r['label'] = f"{_s(pct)}% (95% range {_s(r['rate_low'])}-{_s(r['rate_high'])}%, {elig} corpses, ForeverDB players)"
        elif rate == 'classic':
            r['classic_pct'] = pct
            r['label'] = f'Classic rate {_s(pct)}%: not measured on Forever, never quote it as a Forever rate'
        else:
            r['label'] = 'seen on Forever, rate unknown' if seen else 'listed by Classic data only, not seen on Forever; rate unknown'
        return r

    def _find(self, table, field, p, fuzzy=False):
        p = str(p).strip()
        exact = [r for r in table.values() if str(r['id']) == p or (r[field] or '').lower() == p.lower()]
        if exact or not fuzzy: return exact[:10]
        return [r for r in table.values() if p.lower() in (r[field] or '').lower()][:10]

    def drop(self, item, npc):
        """the row a card's src game.drop:<item>:<npc> names (Forever-measured first), or None"""
        rows = [r for r in self.rates if r['item_id'] == int(item) and r['source_id'] == int(npc) and r['kind'] == 'drop']
        rows.sort(key=lambda r: r['rate'] != 'forever')
        return rows[0] if rows else None

    def item(self, p):
        out = []
        for h in self._find(self.items, 'name', p, fuzzy=True):
            src = [r for r in self.rates if r['item_id'] == h['id']]
            best = sorted(src, key=lambda r: (r['rate'] != 'forever', r['rate_pct'] is None, -(r['rate_pct'] or 0), not r['seen_on_forever'], r['source'] or ''))[:40]
            hid = [h['id']]
            out.append({'id': h['id'], 'name': h['name'], 'quality': h['q'], 'itemLevel': h['ilvl'], 'requiresLevel': h['req'], 'sellsToVendor': h['sell'],
                        'how': h['how'], 'groupSize': h['size'], 'needsRep': h['req_rep'], 'tooltip': h['tip'],
                        'tooltipFrom': {'e': 'endgametools (Forever client)', 'f': 'ForeverDB'}.get(h['tip_src']),
                        'sourcesTotal': len(src),
                        'sources': [{'kind': r['kind'], 'from': r['source'], 'id': r['source_id'], 'zone': r['zone'], 'boss': r['boss'],
                                     'rate': r['rate'], 'label': r['label']} for r in best],
                        'vendors': [{'npc': v['npc'], 'zone': v['zone'], 'x': v['x'], 'y': v['y'], 'price': v['price'], 'seenOnForever': v['seen_forever'],
                                     'side': v['side']} for v in self.vendors if v['item_id'] == h['id']],
                        'questReward': [{'quest': q['id'], 'title': q['title'], 'zone': q['cat']} for q in self.quests.values()
                                        if any(isinstance(e, list) and e[:1] == hid for e in (q['reward'] or []) + (q['choice'] or []) + (q['reward_any'] or []))],
                        'recipes': {k: [self._recipe(c) for c in self.recipes if any(e['id'] == h['id'] for e in c[f])]
                                    for k, f in (('madeBy', 'makes'), ('teaches', 'taught_by'), ('toolFor', 'tools'))} | {'from': RECIPE_SOURCE}
                                   if self.recipes else None})
        return out

    @staticmethod
    def _recipe(c):
        """game.recipe_row"""
        return {'spell': c['spell_id'], 'name': c['name'], 'profession': c['prof'], 'tools': c['tools'], 'place': c['place'] or None,
                'taughtBy': c['taught_by'], 'makes': c['makes']}

    def recipe(self, p):
        """game.recipe: by spell id, recipe name, a tool / made item / recipe item by name or id (each says what matched);
        else a part of a recipe name"""
        p = str(p).strip(); lp = p.lower()
        def hits(lst): return any(str(e['id']) == p or (e['name'] or '').lower() == lp for e in lst)
        def match(c):
            if str(c['spell_id']) == p: return 'spell'
            if (c['name'] or '').lower() == lp: return 'name'
            for k, f in (('tool', 'tools'), ('makes', 'makes'), ('taughtBy', 'taught_by')):
                if hits(c[f]): return k
            return None
        hit = [(c, match(c)) for c in self.recipes]
        hit = [x for x in hit if x[1]] or [(c, 'part of the name') for c in self.recipes if lp in (c['name'] or '').lower()]
        hit.sort(key=lambda x: (x[0]['prof'] or '', x[0]['name'] or '', x[0]['spell_id']))
        out = {'recipes': [dict(self._recipe(c), match=m) for c, m in hit[:200]], 'total': len(hit), 'from': RECIPE_SOURCE}
        if not self.recipes: out['note'] = 'the loaded game data has no recipes yet: unknown, not none'
        return out

    def npc(self, p):
        rank = {0: 'normal', 1: 'elite', 2: 'rare elite', 3: 'boss', 4: 'rare'}
        out = []
        for n in self._find(self.npcs, 'name', p):
            drops = sorted([r for r in self.rates if r['kind'] == 'drop' and r['source_id'] == n['id']],
                           key=lambda r: (r['rate'] != 'forever', r['rate_pct'] is None, -(r['rate_pct'] or 0), r['item_name'] or ''))
            out.append({'id': n['id'], 'name': n['name'], 'levels': [n['min_lv'], n['max_lv']], 'rank': rank.get(n['rank']), 'zone': n['zone'],
                        'points': n['points'], 'spawns': n['spawns'],
                        'drops': [{'item': r['item_name'], 'id': r['item_id'], 'rate': r['rate'], 'label': r['label']} for r in drops],
                        'resistances': 'not published for Forever (no source); the addon will measure them',
                        'respawn': 'not published for Forever (no source)'})
        return out

    def _instances(self):
        bg = set((self.rules.get('instances') or {}).get('battlegrounds') or [])
        return sorted({r['zone'] for r in self.rates if r['kind'] == 'drop' and (r['instance_id'] or 0) > 0 and r['zone'] and r['zone'] not in bg})

    def _keep(self, root, inst, unl):
        """game.quest's keep: the nearest step of the chain (back first, then forward) that is a key step, in a dungeon, or a Dungeon quest"""
        seen, cands = set(), []
        for d in ('prev', 'next'):
            front, depth = [root], 0
            while front and depth <= 30:
                for qid in front:
                    if (qid, d) in seen: continue
                    seen.add((qid, d))
                    cands.append((depth, 0 if d == 'prev' else 1, qid))
                nxt = []
                for qid in front:
                    x = self.quests.get(qid)
                    if x: nxt += [int(e) for e in (x[d] or [])]
                front, depth = nxt, depth + 1
        best = None
        for depth, dk, qid in cands:
            x = self.quests.get(qid)
            if not x: continue
            obj = json.dumps(x['obj'], ensure_ascii=False)
            ks = [(u.get('name'), 'key or attunement: ' + (u.get('what') or ''), 1) for u in unl if qid in (u.get('quests') or [])]
            if x['cat'] in inst: ks.append((x['cat'], 'dungeon quest', 2))
            z = next((z for z in inst if len(z) > 3 and z in obj), None)
            if z: ks.append((z, 'objective in ' + z, 3))
            if x['type'] == 'Dungeon': ks.append((x['cat'] or 'a dungeon', 'dungeon quest', 4))
            for k in ks:
                key = (depth, dk, k[2])
                if best is None or key < best[0]:
                    best = (key, {'dungeon': k[0], 'why': k[1], 'step': {'id': x['id'], 'title': x['title']} if x['id'] != root else None})
        return best[1] if best else None

    def quest(self, p):
        inst, unl = self._instances(), self.rules.get('unlocks') or []   # sorted: the first instance an objective names is the same every run
        def named(lst):
            return [{'id': int(e[0]), 'name': (self.items.get(int(e[0])) or {}).get('name'), 'count': e[1] if len(e) > 1 else None} for e in lst or []]
        out = []
        for q in self._find(self.quests, 'title', p):
            keep = self._keep(q['id'], inst, unl)
            out.append({'id': q['id'], 'title': q['title'], 'level': q['lv'], 'minLevel': q['min'], 'side': q['side'], 'type': q['type'], 'zone': q['cat'],
                        'objectives': q['obj'], 'giver': q['giver'], 'turnIn': q['turnin'], 'xp': q['xp'], 'money': q['money'], 'rep': q['rep'],
                        'reward': named(q['reward']), 'choose': named(q['choice']),
                        'prev': [{'id': x['id'], 'title': x['title']} for x in self.quests.values() if x['id'] in (q['prev'] or [])],
                        'next': [{'id': x['id'], 'title': x['title']} for x in self.quests.values() if x['id'] in (q['next'] or [])],
                        'dungeonQuest': keep is not None, 'keep': keep,
                        'unlocks': next((u.get('name') for u in unl if q['id'] in (u.get('quests') or [])), None),
                        'link': f"https://foreverchanges.pro/quest/{q['id']}"})
        return out

    def instance(self, p):
        ins = self.rules.get('instances') or {}
        src = [r for r in self.rates if r['zone'] == p and r['kind'] == 'drop' and (r['instance_id'] or 0) > 0
               and ((self.items.get(r['item_id']) or {}).get('q') or 0) >= 2]
        src.sort(key=lambda r: (not r['boss'], r['rate'] != 'forever', r['rate_pct'] is None, -(r['rate_pct'] or 0), r['item_name'] or ''))
        return {'name': p,
                'rules': {'raid': p in (ins.get('raids') or []), 'battleground': p in (ins.get('battlegrounds') or []), 'all': ins} if ins else None,
                'unlocks': [u for u in self.rules.get('unlocks') or [] if p.lower() in (u.get('name') or '').lower() or ((u.get('value') or {}).get('zone') == p)],
                'bosses': sorted({r['source'] for r in self.rates if r['zone'] == p and r['boss']}),
                'dropsTotal': len(src),
                'drops': [{'item': r['item_name'], 'id': r['item_id'], 'from': r['source'], 'boss': r['boss'], 'label': r['label']} for r in src[:300]]}

    def status(self):
        """game.status's fields, but loadedAt: nothing is loaded, the pack is read where the app has it"""
        from datetime import datetime, timezone
        b = self.gd.get('built')
        built = datetime.fromtimestamp(int(b), timezone.utc).isoformat() if isinstance(b, (int, Decimal)) else b
        return {'pack': self.hash, 'built': built, 'from': self.gd.get('from'), 'counts': dict(self.counts, rules=len(self.rules))}


def jsonable(o):
    if isinstance(o, Decimal): return int(o) if o == o.to_integral_value() and 'E' not in str(o) and '.' not in str(o) else float(o)
    raise TypeError(type(o))


def main(argv):
    cmds = {'item': 1, 'npc': 1, 'quest': 1, 'instance': 1, 'recipe': 1, 'drop': 2, 'status': 0}
    if len(argv) < 1 or argv[0] not in cmds or len(argv) - 1 < cmds[argv[0]]:
        print(__doc__.split('\n\n')[1] if '\n\n' in __doc__ else __doc__); return 2
    cmd, args = argv[0], argv[1:]
    if cmd == 'drop' and not all(re.fullmatch(r'\d{1,12}', a) for a in args[:2]):
        print('drop takes an item id and a creature id (numbers): game.py drop 2378 202', file=sys.stderr); return 2
    try: g = Game()
    except OSError as e: print(f'no game data to read ({e}): is this the app\'s own folder?', file=sys.stderr); return 1
    if cmd == 'drop': res = g.drop(args[0], args[1])
    elif cmd == 'status': res = g.status()
    else: res = getattr(g, cmd)(' '.join(args))
    print(json.dumps(res, ensure_ascii=False, indent=1, default=jsonable))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
