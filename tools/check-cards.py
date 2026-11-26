#!/usr/bin/env python3
# Checks a From Claude cards file (companion-data/from-claude/cards.json) against the format in
# companion-data/SCHEMA.md before Claude writes it to the player's computer.
# The format, then the answer rules (tools/answer_rules.py: sources for numbers, rates with samples, profit
# only from flips, risk on farm cards, no banned tips), then each game.drop:<item>:<npc> fact against the pack
# this install has (game.py, the same rows and labels as the database's game.drop_rates). Online, Postgres runs
# the same rules and also compares every other fact's number with its src (private.claude_put_setting refuses
# a list that fails).
#   python3 tools/check-cards.py path/to/cards.json      -> "ok, N cards" or the problems, exit 1
import json, os, re, sys
from decimal import Decimal
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from answer_rules import card_rules

KINDS = {'farm', 'flip', 'quest', 'gear', 'craft', 'route', 'note'}
STATUS = {'open', 'done', 'withdrawn'}
KEYS = {'id', 'kind', 'title', 'summary', 'status', 'created', 'updated', 'expires', 'character', 'where',
        'facts', 'items', 'steps', 'track', 'body', 'sources', 'step', 'risk',
        'order', 'group', 'stepsDone', 'doneWhen',   # #163: Claude's order, plan, ticks and game checks
        'stale'}   # the database's marks on facts that changed since Claude wrote them (private.claude_put_setting); dropped when sent


# a step's game check (doneWhen): the same grammar as js/cardsteps.js CHECK and private.check_cards
CHECK = re.compile(r'quest:[0-9]{1,9}|item:[0-9]{1,9}(x[0-9]{1,4})?|rep:[^\n]+>=(Hated|Hostile|Unfriendly|Neutral|Friendly|Honored|Revered|Exalted)|level:[0-9]{1,2}|skill:[^\n]+>=[0-9]{1,3}')
CHECK_WORDS = 'quest:<id>, item:<id> or item:<id>x<count>, rep:<faction>>=<standing>, level:<n> or skill:<profession>>=<n>'


def is_int(v): return isinstance(v, int) and not isinstance(v, bool)


def iso(v):
    try: datetime.fromisoformat(str(v).replace('Z', '+00:00')); return True
    except ValueError: return False


def ahead(v):
    """more than 10 minutes after now (a time with no zone is UTC, as in the database)"""
    t = datetime.fromisoformat(str(v).replace('Z', '+00:00'))
    if t.tzinfo is None: t = t.replace(tzinfo=timezone.utc)
    return t > datetime.now(timezone.utc) + timedelta(minutes=10)


def now_utc(): return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def check(d):
    bad = []
    if not isinstance(d, dict) or d.get('schema') != 1 or not isinstance(d.get('cards'), list):
        return ['top level must be {"schema": 1, "cards": [...]}']
    seen = set()
    for n, c in enumerate(d['cards']):
        at = f'card {n + 1}'
        if not isinstance(c, dict): bad.append(f'{at}: not an object'); continue
        cid = c.get('id')
        if not isinstance(cid, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', cid): bad.append(f'{at}: id must be lower-case letters, digits and dashes')
        elif cid in seen: bad.append(f'{at}: id {cid} used twice')
        seen.add(cid); at = f'card {cid}'
        for k in sorted(set(c) - KEYS): bad.append(f'{at}: unknown field "{k}"')
        if not isinstance(c.get('title'), str) or not c['title'].strip(): bad.append(f'{at}: needs a title')
        if c.get('kind', 'note') not in KINDS: bad.append(f'{at}: kind must be one of {sorted(KINDS)}')
        if c.get('status', 'open') not in STATUS: bad.append(f'{at}: status must be one of {sorted(STATUS)}')
        for k in ('created', 'updated', 'expires'):
            if c.get(k) is not None and not iso(c[k]): bad.append(f'{at}: {k} is not an ISO time')
        for k in ('created', 'updated'):      # Claude's own clock: a time ahead of now sorts the card wrong everywhere (#150)
            if c.get(k) is not None and iso(c[k]) and ahead(c[k]): bad.append(f'{at}: {k} is in the future: use the real UTC time now ({now_utc()})')
        for k in ('summary', 'character', 'where', 'body', 'risk', 'group'):
            if c.get(k) is not None and not isinstance(c[k], str): bad.append(f'{at}: {k} must be text')
        for k in ('steps', 'facts', 'items', 'sources'):
            if k in c and not isinstance(c[k], list): bad.append(f'{at}: {k} must be a list')
        if isinstance(c.get('steps'), list) and not all(isinstance(s, str) for s in c['steps']): bad.append(f'{at}: steps must be a list of text')
        n_steps = len(c['steps']) if isinstance(c.get('steps'), list) else 0
        if c.get('order') is not None and not (is_int(c['order']) and 0 <= c['order'] <= 9999): bad.append(f'{at}: order is a whole number from 0 to 9999 (lowest shows first)')
        if 'stepsDone' in c and not (isinstance(c['stepsDone'], list) and all(is_int(i) and 0 <= i < n_steps for i in c['stepsDone']) and len(set(c['stepsDone'])) == len(c['stepsDone'])):
            bad.append(f'{at}: stepsDone is a list of step positions (from 0, each once, below {n_steps})')
        if 'doneWhen' in c and not (isinstance(c['doneWhen'], list) and len(c['doneWhen']) <= n_steps):
            bad.append(f'{at}: doneWhen is a list as long as steps at most, one check (or null) per step')
        elif isinstance(c.get('doneWhen'), list):
            for i, w in enumerate(c['doneWhen']):
                if w is not None and not (isinstance(w, str) and CHECK.fullmatch(w)): bad.append(f'{at}: doneWhen {i}: a check is {CHECK_WORDS}')
            # the checks read the save of the character played last: a card with checks says whose they are
            if any(w is not None for w in c['doneWhen']) and not (isinstance(c.get('character'), str) and c['character'].strip()):
                bad.append(f'{at}: a card with doneWhen checks needs character (the checks read that character\'s save)')
        if not all(isinstance(f, dict) and isinstance(f.get('label'), str) and isinstance(f.get('value'), str)
                   and set(f) <= {'label', 'value', 'note', 'src'} for f in (c['facts'] if isinstance(c.get('facts'), list) else [])):
            bad.append(f'{at}: each fact needs label and value (text), and may have note and src')
        if not all(isinstance(i, dict) and isinstance(i.get('id'), int) and not isinstance(i['id'], bool) and i['id'] > 0 for i in (c['items'] if isinstance(c.get('items'), list) else [])):
            bad.append(f'{at}: each item needs a numeric game item id')
        if not all(isinstance(s, dict) and isinstance(s.get('label'), str) and (s.get('url') is None or str(s['url']).startswith(('https://', 'http://'))) for s in (c['sources'] if isinstance(c.get('sources'), list) else [])):
            bad.append(f'{at}: each source needs a label (and an http(s) url if any)')
        if c.get('step') is not None and not (isinstance(c['step'], str) and re.fullmatch(r'(quest|item|npc):\d+|(dungeon|zone):\S.*', c['step'])):
            bad.append(f'{at}: step is quest:<id>, item:<id>, npc:<id>, dungeon:<name> or zone:<name>')
        t = c.get('track')
        if t is not None and not (isinstance(t, dict) and isinstance(t.get('grind'), str) and isinstance(t.get('mobs', []), list) and all(isinstance(m, str) for m in t.get('mobs', []))):
            bad.append(f'{at}: track is {{"grind": "<name used with /cc start>", "mobs": [names]}}')
        if c.get('status', 'open') == 'open':           # a withdrawn or done card is no longer advice
            bad += [f'{at}: [{r}] {m}' for r, m in card_rules(c)]
            for f in (c['facts'] if isinstance(c.get('facts'), list) else []):
                if isinstance(f, dict) and re.fullmatch(r'game\.drop:\d{1,9}:\d{1,12}', str(f.get('src') or '')):
                    m = drop_problem(f)
                    if m: bad.append(f'{at}: [value] fact "{f.get("label")}": {m}')
    return bad


_GAME = []
def drop_problem(f):
    """private.fact_problem's game.drop branch, offline: the fact must quote the rate as the game data labels it"""
    if not _GAME:
        try:
            from game import Game
            _GAME.append(Game())
        except (ImportError, OSError, SystemExit) as e:
            _GAME.append(e)
    g = _GAME[0]
    if not hasattr(g, 'drop'): return f'no game data to check it against ({g})'
    item, npc = f['src'].split(':')[1:]
    r = g.drop(item, npc)
    if r is None: return f'no such drop in the game data (item {item} from creature {npc})'
    txt = ' '.join('' if f.get(k) is None else str(f.get(k)) for k in ('value', 'note'))   # as Postgres ->> reads them
    nums = [Decimal(x) for x in re.findall(r'(\d+(?:\.\d+)?)', txt.replace(',', ''), re.ASCII)]   # exact, as numeric compares
    if r['rate'] == 'forever':
        if not any(abs(n - Decimal(r['rate_pct'])) <= Decimal('0.05') for n in nums) or not any(n == r['corpses'] for n in nums):
            return f"the game data says {r['label']}: quote the rate as written there, with the corpses"
    elif r['rate'] == 'classic':
        if not re.search(r'\bclassic\b', txt.lower(), re.ASCII): return f"the game data has only a Classic rate ({r['label']}): say Classic"
    elif not re.search(r'\bunknown\b', txt.lower(), re.ASCII): return f"the game data has no rate ({r['label']}): say unknown"
    return None


if __name__ == '__main__':
    with open(sys.argv[1], encoding='utf-8') as f: data = json.load(f)
    problems = check(data)
    print('\n'.join(problems) if problems else f'ok, {len(data["cards"])} cards')
    sys.exit(1 if problems else 0)
