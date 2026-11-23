#!/usr/bin/env python3
r"""The weekly correction audit (docs/COACHING.md, "Corrections and the weekly audit").

A Claude thread reads the week's project chat and writes a log: a header with the period and how many
messages the player sent, then one table row per correction (the format is in COACHING.md). This script
checks the log and counts the corrections by root cause, per 100 of the player's messages, next to the
baseline (docs/audit-baseline.json: 12 to 22 Nov 2026, before the foundation rebuild). A cause that rose
is a rule that isn't holding.

  python3 tools/audit.py week.md                    report (exit 1 if the log is malformed)
  python3 tools/audit.py week.md --json             the same as JSON
  python3 tools/audit.py log.md --baseline --period FROM TO --messages N
                                                    print a baseline file (counts only, no quotes)

A week with no corrections says so with a line "No corrections." (a log with no rows is refused
otherwise). A | inside a quote is written \|.
"""
import argparse, datetime, json, os, re, sys

CAUSES = ['NO_DATA_READ', 'FEATURE_UNKNOWN', 'MEMORY_STALE', 'GUESS_NO_SOURCE', 'RULE_NOT_FOLLOWED', 'RULE_MISSING', 'SHALLOW',
          'WRONG_QUESTION', 'COORDINATOR_ANSWERED', 'COORDINATOR_RELAY', 'CONTEXT_LOST', 'TOOLING', 'OTHER']
BASELINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'audit-baseline.json')
ROW = re.compile(r'^\|\s*(\d+)\s*\|')
DATE = re.compile(r'^\d\d-\d\d \d\d:\d\d(-\d\d:\d\d)?$')
ISO = re.compile(r'^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?Z$')
MAX_WORDS = 25
UP, DOWN = 1.25, 0.75   # a cause "rose" when its rate is 25% over the baseline's (primary or any), on 3+ corrections;
                        # it "fell" when under 75% of a baseline that had 3+
LOOKS_LIKE_ROW = re.compile(r'^\s*\|?\s*\d+\s*\|')


def iso(x):
    try: return datetime.datetime.strptime(x.replace('Z', ''), '%Y-%m-%dT%H:%M' + (':%S' if x.count(':') == 2 else '')) if ISO.match(x) else None
    except ValueError: return None


def cells_of(line):
    return [c.strip().replace('\\|', '|') for c in re.split(r'(?<!\\)\|', line.strip().strip('|'))]


def parse(text):
    """(header, rows, problems): header {period: [from, to], messages}, rows [{n, date, quote, what, causes, top}]."""
    header, rows, problems = {}, [], []
    empty = False
    for i, line in enumerate(text.splitlines(), 1):
        m = re.match(r'^Period:\s*(\S+)\s+to\s+(\S+)\s*$', line)
        if m:
            if 'period' in header: problems.append(f'line {i}: a second Period line')
            header['period'] = [m.group(1), m.group(2)]
            a, b = iso(m.group(1)), iso(m.group(2))
            if not (a and b): problems.append(f'line {i}: the period is two UTC times like 2026-11-23T00:00Z')
            elif a >= b: problems.append(f'line {i}: the period ends before it starts')
            continue
        m = re.match(r'^His messages:\s*(\d+)\s*$', line)
        if m:
            if 'messages' in header: problems.append(f'line {i}: a second "His messages" line')
            header['messages'] = int(m.group(1))
            if header['messages'] <= 0: problems.append(f'line {i}: his message count must be more than 0')
            continue
        if line.strip() == 'No corrections.': empty = True; continue
        if not ROW.match(line):
            if LOOKS_LIKE_ROW.match(line): problems.append(f'line {i}: a row starts with "| <number> |" at the start of the line')
            continue
        cells = cells_of(line)
        if len(cells) != 6: problems.append(f'line {i}: a row has 6 cells (#, date, quote, what went wrong, root cause, TOP), not {len(cells)}'); continue
        n, date, quote, what, cause, top = cells
        causes = [c.strip() for c in re.split(r'[+,]', cause) if c.strip()]
        bad = [c for c in causes if c not in CAUSES]
        if not causes: problems.append(f'line {i}: no root cause')
        if bad: problems.append(f'line {i}: unknown cause {", ".join(bad)} (one of: {" ".join(CAUSES)})')
        if not DATE.match(date): problems.append(f'line {i}: date is MM-DD HH:MM (UTC), not "{date}"')
        else:
            p = header.get('period'); a = iso(p[0]) if p else None
            try:
                when = datetime.datetime(a.year if a else 2000, int(date[:2]), int(date[3:5]), int(date[6:8]), int(date[9:11]))
                if a and when < a.replace(second=0) - datetime.timedelta(minutes=1): when = when.replace(year=a.year + 1)   # a week over New Year
                b = iso(p[1]) if p else None
                if a and b and not (a - datetime.timedelta(minutes=1) <= when <= b + datetime.timedelta(minutes=1)):
                    problems.append(f'line {i}: {date} is outside the period')
            except ValueError: problems.append(f'line {i}: {date} is not a real date and time')
        if not quote: problems.append(f'line {i}: the quote is empty')
        long = [q for q in quote.split(' / ') if len(q.split()) > MAX_WORDS]
        if long: problems.append(f'line {i}: a quoted message is over {MAX_WORDS} words: trim it')
        if not what: problems.append(f'line {i}: say what went wrong')
        if top not in ('', 'TOP'): problems.append(f'line {i}: TOP is "TOP" or empty')
        rows.append({'n': int(n), 'date': date, 'quote': quote, 'what': what, 'causes': causes, 'top': top == 'TOP'})
    nums = [r['n'] for r in rows]
    if len(set(nums)) != len(nums): problems.append('row numbers repeat')
    if not rows and not empty: problems.append('no correction rows: write "No corrections." if the week had none')
    if header.get('messages') and len(rows) > header['messages']: problems.append('more corrections than messages')
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
    rate = lambda n, m: 100 * n / m
    out = {'period': header['period'], 'messages': msgs, 'corrections': len(rows), 'per100': round(rate(len(rows), msgs), 1),
           'top': sum(r['top'] for r in rows), 'causes': [], 'rose': [], 'fell': []}
    bm = base['messages'] if base and base.get('messages') else None
    for c in CAUSES:
        bp, ba = ((base or {}).get('primary', {}).get(c), (base or {}).get('any', {}).get(c)) if bm else (None, None)
        row = {'cause': c, 'primary': primary[c], 'any': anyc[c], 'per100': round(rate(primary[c], msgs), 1), 'anyPer100': round(rate(anyc[c], msgs), 1),
               'baselinePer100': round(rate(bp, bm), 1) if bp is not None else None, 'baselineAnyPer100': round(rate(ba, bm), 1) if ba is not None else None}
        out['causes'].append(row)
        if bp is not None and ((primary[c] >= 3 and rate(primary[c], msgs) > rate(bp, bm) * UP)
                               or (ba is not None and anyc[c] >= 3 and rate(anyc[c], msgs) > rate(ba, bm) * UP)):
            out['rose'].append(c)
        elif bp is not None and bp >= 3 and rate(primary[c], msgs) < rate(bp, bm) * DOWN: out['fell'].append(c)
    if bm:
        out['baseline'] = {'period': base['period'], 'messages': base['messages'], 'corrections': base['corrections'],
                           'per100': round(100 * base['corrections'] / base['messages'], 1)}
    return out


def main(argv):
    ap = argparse.ArgumentParser(description='The weekly correction audit (docs/COACHING.md).')
    ap.add_argument('log')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--baseline', action='store_true', help='print a baseline file from this log')
    ap.add_argument('--period', nargs=2, metavar=('FROM', 'TO'))
    ap.add_argument('--messages', type=int)
    a = ap.parse_args(argv)
    text = open(a.log, encoding='utf-8').read()
    header, rows, problems = parse(text)
    if a.baseline:
        if not a.period or not a.messages or a.messages <= 0 or not all(iso(x) for x in a.period):
            print('--baseline needs --period FROM TO (UTC times like 2026-11-12T18:27Z) and --messages N (more than 0)'); return 1
        header['period'], header['messages'] = a.period, a.messages
        # the first log trimmed quotes by hand and has no header lines
        problems = [p for p in problems if 'over %d words' % MAX_WORDS not in p and 'outside the period' not in p]
    for k, why in (('period', 'a "Period: <from> to <to>" line'), ('messages', 'a "His messages: <n>" line')):
        if k not in header: problems.append(f'the log needs {why}')
    if problems:
        print('\n'.join(problems)); return 1
    if a.baseline:
        primary, anyc = counts(rows)
        print(json.dumps({'about': 'Corrections in the project chat before the foundation rebuild (docs/COACHING.md). Counts only.',
                          'period': header['period'], 'messages': header['messages'], 'corrections': len(rows),
                          'top': sum(r['top'] for r in rows), 'primary': primary, 'any': anyc}, indent=1))
        return 0
    base = json.load(open(BASELINE, encoding='utf-8')) if os.path.exists(BASELINE) else None
    r = report(header, rows, base)
    if a.json: print(json.dumps(r, indent=1)); return 0
    b = r.get('baseline')
    dash = lambda v: '-' if v is None else v
    print(f"{r['period'][0]} to {r['period'][1]}: {r['corrections']} corrections in {r['messages']} messages "
          f"({r['per100']} per 100; baseline {b['per100'] if b else '-'}), {r['top']} marked TOP")
    print(f"{'cause':<22}{'primary':>8}{'any':>6}{'per 100':>9}{'baseline':>10}{'any/100':>9}{'baseline':>10}")
    for c in r['causes']:
        flag = '  ROSE' if c['cause'] in r['rose'] else '  fell' if c['cause'] in r['fell'] else ''
        print(f"{c['cause']:<22}{c['primary']:>8}{c['any']:>6}{c['per100']:>9}{dash(c['baselinePer100']):>10}{c['anyPer100']:>9}{dash(c['baselineAnyPer100']):>10}{flag}")
    print('rose: ' + (', '.join(r['rose']) or 'none') + '; fell: ' + (', '.join(r['fell']) or 'none'))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
