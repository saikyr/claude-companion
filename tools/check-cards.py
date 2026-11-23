#!/usr/bin/env python3
# Checks a From Claude cards file (companion-data/from-claude/cards.json) against the format in
# companion-data/SCHEMA.md before Claude writes it to the player's computer.
# The format, then the answer rules (tools/answer_rules.py: sources for numbers, rates with samples, profit
# only from flips, risk on farm cards, no banned tips). Online, Postgres runs the same rules and also
# compares every fact's number with its src (private.claude_put_setting refuses a list that fails).
#   python3 tools/check-cards.py path/to/cards.json      -> "ok, N cards" or the problems, exit 1
import json, os, re, sys
from datetime import datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from answer_rules import card_rules

KINDS = {'farm', 'flip', 'quest', 'gear', 'craft', 'route', 'note'}
STATUS = {'open', 'done', 'withdrawn'}
KEYS = {'id', 'kind', 'title', 'summary', 'status', 'created', 'updated', 'expires', 'character', 'where',
        'facts', 'items', 'steps', 'track', 'body', 'sources', 'step', 'risk'}


def iso(v):
    try: datetime.fromisoformat(str(v).replace('Z', '+00:00')); return True
    except ValueError: return False


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
        for k in ('summary', 'character', 'where', 'body', 'risk'):
            if c.get(k) is not None and not isinstance(c[k], str): bad.append(f'{at}: {k} must be text')
        if not all(isinstance(s, str) for s in c.get('steps', [])): bad.append(f'{at}: steps must be a list of text')
        if not all(isinstance(f, dict) and isinstance(f.get('label'), str) and isinstance(f.get('value'), str)
                   and set(f) <= {'label', 'value', 'note', 'src'} for f in c.get('facts', [])):
            bad.append(f'{at}: each fact needs label and value (text), and may have note and src')
        if not all(isinstance(i, dict) and isinstance(i.get('id'), int) and i['id'] > 0 for i in c.get('items', [])):
            bad.append(f'{at}: each item needs a numeric game item id')
        if not all(isinstance(s, dict) and isinstance(s.get('label'), str) and (s.get('url') is None or str(s['url']).startswith(('https://', 'http://'))) for s in c.get('sources', [])):
            bad.append(f'{at}: each source needs a label (and an http(s) url if any)')
        if c.get('step') is not None and not (isinstance(c['step'], str) and re.fullmatch(r'(quest|item|npc):\d+|(dungeon|zone):\S.*', c['step'])):
            bad.append(f'{at}: step is quest:<id>, item:<id>, npc:<id>, dungeon:<name> or zone:<name>')
        t = c.get('track')
        if t is not None and not (isinstance(t, dict) and isinstance(t.get('grind'), str) and all(isinstance(m, str) for m in t.get('mobs', []))):
            bad.append(f'{at}: track is {{"grind": "<name used with /cc start>", "mobs": [names]}}')
        if c.get('status', 'open') == 'open':           # a withdrawn or done card is no longer advice
            bad += [f'{at}: [{r}] {m}' for r, m in card_rules(c)]
    return bad


if __name__ == '__main__':
    with open(sys.argv[1], encoding='utf-8') as f: data = json.load(f)
    problems = check(data)
    print('\n'.join(problems) if problems else f'ok, {len(data["cards"])} cards')
    sys.exit(1 if problems else 0)
