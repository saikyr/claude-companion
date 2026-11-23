#!/usr/bin/env python3
"""The weekly correction audit (docs/COACHING.md, "Corrections and the weekly audit").

A Claude thread reads the week's project chat and writes a log: a header with the period and how many
messages the player sent, then one table row per correction (the format is in COACHING.md). This script
checks the log and counts the corrections by root cause, per 100 of the player's messages, next to the
baseline (docs/audit-baseline.json: 12 to 22 Nov 2026, before the foundation rebuild). A cause that rose
is a rule that isn't holding.

  python3 tools/audit.py week.md                    report (exit 1 if the log is malformed)
  python3 tools/audit.py week.md --json             the same as JSON
  python3 tools/audit.py log.md --baseline --period FROM TO --messages N
                                                    print a baseline file (counts only, no quotes)
"""
import json, os, re, sys

CAUSES = ['NO_DATA_READ', 'FEATURE_UNKNOWN', 'MEMORY_STALE', 'GUESS_NO_SOURCE', 'RULE_NOT_FOLLOWED', 'RULE_MISSING', 'SHALLOW',
          'WRONG_QUESTION', 'COORDINATOR_ANSWERED', 'COORDINATOR_RELAY', 'CONTEXT_LOST', 'TOOLING', 'OTHER']
BASELINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'audit-baseline.json')
ROW = re.compile(r'^\|\s*(\d+)\s*\|')
DATE = re.compile(r'^\d\d-\d\d \d\d:\d\d(-\d\d:\d\d)?$')
ISO = re.compile(r'^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?Z$')
MAX_WORDS = 25
UP = 1.25          # a cause "rose" when its rate is 25% over the baseline's, on at least 3 corrections


def parse(text):
    """(header, rows, problems): header {period: [from, to], messages}, rows [{n, date, quote, what, causes, top}]."""
    header, rows, problems = {}, [], []
    for i, line in enumerate(text.splitlines(), 1):
        m = re.match(r'^Period:\s*(\S+)\s+to\s+(\S+)\s*$', line)
        if m:
            header['period'] = [m.group(1), m.group(2)]
            for x in m.groups():
                if not ISO.match(x): problems.append(f'line {i}: the period is two UTC times like 2026-11-23T00:00Z')
            continue
        m = re.match(r'^His messages:\s*(\d+)\s*$', line)
        if m: header['messages'] = int(m.group(1)); continue
        if not ROW.match(line): continue
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if len(cells) != 6: problems.append(f'line {i}: a row has 6 cells (#, date, quote, what went wrong, root cause, TOP), not {len(cells)}'); continue
        n, date, quote, what, cause, top = cells
        causes = [c.strip() for c in re.split(r'[+,]', cause) if c.strip()]
        bad = [c for c in causes if c not in CAUSES]
        if not causes: problems.append(f'line {i}: no root cause')
        if bad: problems.append(f'line {i}: unknown cause {", ".join(bad)} (one of: {" ".join(CAUSES)})')
        if not DATE.match(date): problems.append(f'line {i}: date is MM-DD HH:MM (UTC), not "{date}"')
        if not quote: problems.append(f'line {i}: the quote is empty')
        long = [q for q in quote.split(' / ') if len(q.split()) > MAX_WORDS]
        if long: problems.append(f'line {i}: a quoted message is over {MAX_WORDS} words: trim it')
        if not what: problems.append(f'line {i}: say what went wrong')
        if top not in ('', 'TOP'): problems.append(f'line {i}: TOP is "TOP" or empty')
        rows.append({'n': int(n), 'date': date, 'quote': quote, 'what': what, 'causes': causes, 'top': top == 'TOP'})
    nums = [r['n'] for r in rows]
    if len(set(nums)) != len(nums): problems.append('row numbers repeat')
    return header, rows, problems


def counts(rows):
    primary = {c: 0 for c in CAUSES}
    anyc = {c: 0 for c in CAUSES}
    for r in rows:
        if r['causes'] and r['causes'][0] in primary: primary[r['causes'][0]] += 1
        for c in set(r['causes']):
            if c in anyc: anyc[c] += 1
    return primary, anyc


def report(header, rows, base):
    primary, anyc = counts(rows)
    msgs = header['messages']
    per = lambda n: round(100 * n / msgs, 1) if msgs else None
    out = {'period': header['period'], 'messages': msgs, 'corrections': len(rows), 'per100': per(len(rows)),
           'top': sum(r['top'] for r in rows), 'causes': [], 'rose': []}
    for c in CAUSES:
        b = (base or {}).get('primary', {}).get(c)
        bper = round(100 * b / base['messages'], 1) if base and b is not None else None
        row = {'cause': c, 'primary': primary[c], 'any': anyc[c], 'per100': per(primary[c]), 'baselinePer100': bper}
        out['causes'].append(row)
        if bper is not None and primary[c] >= 3 and row['per100'] > bper * UP: out['rose'].append(c)
    if base:
        out['baseline'] = {'period': base['period'], 'messages': base['messages'], 'corrections': base['corrections'],
                           'per100': round(100 * base['corrections'] / base['messages'], 1)}
    return out


def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    if not args: print(__doc__); return 2
    text = open(args[0], encoding='utf-8').read()
    header, rows, problems = parse(text)
    if '--baseline' in argv:
        i = argv.index('--period'); header['period'] = [argv[i + 1], argv[i + 2]]
        header['messages'] = int(argv[argv.index('--messages') + 1])
        problems = [p for p in problems if 'over %d words' % MAX_WORDS not in p]   # the first log trimmed quotes by hand
    for k, why in (('period', 'a "Period: <from> to <to>" line'), ('messages', 'a "His messages: <n>" line')):
        if k not in header: problems.append(f'the log needs {why}')
    if problems:
        print('\n'.join(problems)); return 1
    if '--baseline' in argv:
        primary, anyc = counts(rows)
        print(json.dumps({'about': 'Corrections in the project chat before the foundation rebuild (docs/COACHING.md). Counts only.',
                          'period': header['period'], 'messages': header['messages'], 'corrections': len(rows),
                          'top': sum(r['top'] for r in rows), 'primary': primary, 'any': anyc}, indent=1))
        return 0
    base = json.load(open(BASELINE, encoding='utf-8')) if os.path.exists(BASELINE) else None
    r = report(header, rows, base)
    if '--json' in argv: print(json.dumps(r, indent=1)); return 0
    b = r.get('baseline')
    print(f"{r['period'][0]} to {r['period'][1]}: {r['corrections']} corrections in {r['messages']} messages "
          f"({r['per100']} per 100; baseline {b['per100'] if b else '-'}), {r['top']} marked TOP")
    print(f"{'cause':<22}{'primary':>8}{'any':>6}{'per 100':>9}{'baseline':>10}")
    for c in r['causes']:
        flag = '  ROSE' if c['cause'] in r['rose'] else ''
        print(f"{c['cause']:<22}{c['primary']:>8}{c['any']:>6}{c['per100']:>9}{c['baselinePer100'] if c['baselinePer100'] is not None else '-':>10}{flag}")
    print('rose: ' + (', '.join(r['rose']) if r['rose'] else 'none'))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
