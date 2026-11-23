# python3 test/audit_test.py
# The weekly correction audit (tools/audit.py, docs/COACHING.md): a good log is counted against the
# baseline and a cause that rose is named; a malformed log is refused with the line; the baseline file
# matches the cause list and holds counts only.
import json, os, subprocess, sys, tempfile
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
TOOL = os.path.join(ROOT, 'tools', 'audit.py')
failed = 0
def check(ok, what):
    global failed
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok: failed += 1
def run(*args, text=None):
    path = args[0]
    if text is not None:
        fd, path = tempfile.mkstemp(suffix='.md'); os.write(fd, text.encode()); os.close(fd)
    r = subprocess.run([sys.executable, TOOL, path] + list(args[1:]), capture_output=True, text=True)
    if text is not None: os.remove(path)
    return r

week = os.path.join(ROOT, 'test', 'fixtures', 'audit-week.md')
r = run(week, '--json')
check(r.returncode == 0, 'a good log is counted')
j = json.loads(r.stdout)
c = {x['cause']: x for x in j['causes']}
check(j['corrections'] == 6 and j['messages'] == 50 and j['per100'] == 12.0 and j['top'] == 1, 'totals, per 100 of his messages, TOP')
check(c['COORDINATOR_ANSWERED']['primary'] == 3 and c['COORDINATOR_ANSWERED']['per100'] == 6.0, 'the first cause is the primary one')
check(c['MEMORY_STALE']['any'] == 1 and c['MEMORY_STALE']['primary'] == 0 and c['GUESS_NO_SOURCE']['any'] == 1, 'later causes count under "any" (+ and , both split)')
check(j['rose'] == ['COORDINATOR_ANSWERED'], f'a cause over the baseline by 25% on 3+ corrections is named ({j["rose"]})')
check(j['baseline']['corrections'] == 138 and c['SHALLOW']['baselinePer100'] == round(100 * 30 / 690, 1), 'compared with the 12-22 Nov baseline')
check('ROSE' in run(week).stdout, 'the text report marks it')

good = open(week).read()
cases = [
    ('an unknown cause', good.replace('| WRONG_QUESTION |', '| MISREAD |'), 'unknown cause MISREAD'),
    ('a bad date', good.replace('11-24 02:10', '24 Nov'), 'date is MM-DD HH:MM'),
    ('a quote over 25 words', good.replace('again?', ' '.join(['word'] * 26)), 'over 25 words'),
    ('a missing cell', good.replace('| Answered about bags. | WRONG_QUESTION |', '| WRONG_QUESTION |'), '6 cells'),
    ('no message count', good.replace('His messages: 50\n', ''), 'His messages'),
    ('no period', good.replace('Period: 2026-11-23T00:00Z to 2026-11-30T00:00Z\n', ''), 'Period'),
    ('a repeated row number', good.replace('| 6 | 11-27', '| 5 | 11-27'), 'repeat'),
    ('an indented row', good.replace('| 6 | 11-27', '  | 6 | 11-27'), 'a row starts with'),
    ('a date that does not exist', good.replace('11-24 02:10', '13-45 99:99'), 'not a real date'),
    ('a row outside the period', good.replace('11-27 20:00', '12-15 20:00'), 'outside the period'),
    ('a reversed period', good.replace('2026-11-23T00:00Z to 2026-11-30T00:00Z', '2026-11-30T00:00Z to 2026-11-23T00:00Z'), 'ends before'),
    ('zero messages', good.replace('His messages: 50', 'His messages: 0'), 'more than 0'),
    ('more corrections than messages', good.replace('His messages: 50', 'His messages: 3'), 'more corrections than messages'),
    ('two periods', good.replace('His messages: 50', 'Period: 2026-11-23T00:00Z to 2026-11-30T00:00Z\nHis messages: 50'), 'second Period'),
    ('no rows at all', good.split('| # |')[0], 'No corrections.'),
]
for name, text, want in cases:
    r = run('x', text=text)
    check(r.returncode == 1 and want in r.stdout, f'refused: {name}' + ('' if want in r.stdout else f' ({r.stdout.strip()[:120]})'))

r = run('x', '--json', text=good.split('| # |')[0] + 'No corrections.\n')
check(r.returncode == 0 and json.loads(r.stdout)['corrections'] == 0, 'a week with "No corrections." is a valid log')
r = run('x', '--json', text=good.replace('is that really the best one?', 'is A \\| B really the best?'))
check(r.returncode == 0, 'a \\| inside a quote is part of the quote')
r = run(week, '--baseline', '--period', 'foo', 'bar', '--messages', '690')
check(r.returncode == 1 and 'needs --period' in r.stdout, 'a baseline with a bad period is refused, not a crash')
r = run(week, '--baseline', '--messages', '690')
check(r.returncode == 1, 'a baseline without --period is refused')
check(c['COORDINATOR_ANSWERED']['baselineAnyPer100'] == round(100 * 30 / 690, 1), 'any-cause rates are compared too')
base = json.load(open(os.path.join(ROOT, 'docs', 'audit-baseline.json')))
import importlib.util
spec = importlib.util.spec_from_file_location('audit', TOOL); A = importlib.util.module_from_spec(spec); spec.loader.exec_module(A)
check(list(base['primary']) == A.CAUSES and sum(base['primary'].values()) == base['corrections'], 'the baseline has every cause, and its counts add up')
check(not any(k in base for k in ('rows', 'quotes')) and 'verbatim' not in json.dumps(base), 'the baseline holds counts only, no quotes')
coaching = open(os.path.join(ROOT, 'docs', 'COACHING.md')).read()
check(all(('| ' + c + ' |') in coaching for c in A.CAUSES), 'COACHING.md defines every cause')
print(f'\n{failed} failed' if failed else '\nall passed')
sys.exit(1 if failed else 0)
