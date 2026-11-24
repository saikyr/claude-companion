#!/usr/bin/env python3
"""The Claude kit as a build ships it (tools/publish-stable.py assemble): claude/game.py and claude/check-cards.py
run from the built addon folder on a computer without node (a friend's), give what the repository's copies give,
and refuse a rules.json made from another rules.js.

    python3 test/kit_test.py
"""
import importlib.util, json, os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('publish_stable', os.path.join(ROOT, 'tools', 'publish-stable.py'))
pub = importlib.util.module_from_spec(spec); spec.loader.exec_module(pub)
failed = 0


def check(ok, what):
    global failed
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok: failed += 1


def run(script, *args, env=None):
    return subprocess.run([sys.executable, '-I', script, *args], capture_output=True, text=True, env=env)


work = tempfile.mkdtemp(prefix='kit-')
try:
    files = pub.assemble(work, 'o/r', '', '0.0.0', 'main', '0' * 40)
    kit = os.path.join(work, 'ClaudeCompanion', 'claude')
    check(all(f in files for f in ('claude/game.py', 'claude/pack-to-rows.py', 'claude/rules.json')), 'the build ships game.py, pack-to-rows.py and rules.json, with checksums')
    # no node: a PATH holding only python3
    bin_ = os.path.join(work, 'bin'); os.makedirs(bin_)
    os.symlink(sys.executable, os.path.join(bin_, 'python3'))
    nonode = dict(os.environ, PATH=bin_)
    check(shutil.which('node', path=nonode['PATH']) is None, 'the test runs without node on the PATH')

    def out(base, *args, env=None):
        r = run(os.path.join(base, 'game.py'), *args, env=env)
        return r.returncode, r.stdout, r.stderr
    for args in (['quest', '5803'], ['instance', 'Scholomance'], ['drop', '2378', '202'], ['item', 'Skeleton Finger']):
        k = out(kit, *args, env=nonode)
        t = out(os.path.join(ROOT, 'tools'), *args)
        check(k[0] == 0 and k[1] == t[1] and json.loads(k[1]), f"kit game.py {' '.join(args)} without node = the repository's ({k[2].strip()[:200]})")

    # the example cards, with the pack's own Skeleton Finger rate (it changes with every weekly rebuild), as cards-gate.test.js does
    gd = pub.pack_rows.load_js(os.path.join(ROOT, 'ClaudeCompanion', 'web', 'data', 'gamedata.js'), 'GAMEDATA')[0]
    fing = next(r for r in gd['src']['2378'] if r[2] == 202 and r[10] == 'f' and r[12] > 0)
    with open(os.path.join(ROOT, 'test', 'fixtures', 'cards.json'), encoding='utf-8') as f:
        text = f.read().replace('36.36%', f'{fing[3]}%').replace('220 corpses', f'{fing[12]} corpses')
    cards = os.path.join(work, 'cards.json')
    with open(cards, 'w', encoding='utf-8') as f: f.write(text)
    r = run(os.path.join(kit, 'check-cards.py'), cards, env=nonode)
    check(r.returncode == 0 and r.stdout.startswith('ok'), f'kit check-cards.py passes the fixture cards without node ({r.stdout.strip()[:200]})')
    bad = os.path.join(work, 'bad.json')
    with open(bad, 'w') as f:
        json.dump({'schema': 1, 'cards': [{'id': 'x', 'kind': 'farm', 'title': 'Fingers', 'risk': 'low',
                   'facts': [{'label': 'Drop rate', 'value': '50% (12 corpses)', 'src': 'game.drop:2378:202'}]}]}, f)
    r = run(os.path.join(kit, 'check-cards.py'), bad, env=nonode)
    check(r.returncode == 1 and 'quote the rate as written there' in r.stdout, f'kit check-cards.py refuses a drop rate the pack doesn\'t have ({r.stdout.strip()[:200]})')

    # the same answer in every run (Python orders sets differently each run): a quest whose objective names two instances
    multi = [out(kit, 'quest', '96075', env=dict(nonode, PYTHONHASHSEED=str(i)))[1] for i in (1, 2, 3)]
    check(len(set(multi)) == 1 and json.loads(multi[0]), 'game.py quest gives the same keep in every run')
    # a Forever rate quoted rounded by 0.05 passes, as in Postgres (exact numbers, not floats)
    five = next((k, r) for k, rows in gd['src'].items() for r in rows
                if r[0] == 'drop' and r[10] == 'f' and r[11] == 'm' and r[12] > 0 and len(str(r[3]).split('.')[-1]) == 2 and str(r[3]).endswith('5'))
    up = format(round(float(five[1][3]) + 0.05, 1), '.1f')
    edge = [{'label': 'Drop rate', 'value': f'{up}% ({five[1][12]} corpses)', 'src': f'game.drop:{five[0]}:{five[1][2]}'}]
    odd = [{'label': 'Drop rate', 'value': f'{five[1][3]}% ({five[1][12]} corpses)', 'note': 5, 'src': f'game.drop:{five[0]}:{five[1][2]}'},
           {'label': 'Num', 'value': 36.2, 'src': 'game.drop:2378:202'}]
    for name, facts, want in (('rounded by 0.05', edge, 'ok'), ('a number where text belongs', odd, 'value must be')):
        with open(bad, 'w') as f: json.dump({'schema': 1, 'cards': [{'id': 'x', 'kind': 'farm', 'title': 'Farm', 'risk': 'low', 'facts': facts}]}, f)
        r = run(os.path.join(kit, 'check-cards.py'), bad, env=nonode)
        check(not r.stderr and (r.stdout.startswith('ok') if want == 'ok' else 'label and value (text)' in r.stdout),
              f'check-cards.py, {name} ({five[1][3]}% quoted {up}%): {(r.stdout + r.stderr).strip()[:200]}')

    rules = os.path.join(work, 'ClaudeCompanion', 'web', 'data', 'rules.js')
    with open(rules, 'a', encoding='utf-8') as f: f.write('\n// changed\n')
    k = out(kit, 'quest', '5803', env=nonode)
    check(k[0] != 0 and 'another rules.js' in k[2], f'a rules.json made from another rules.js is refused ({k[2].strip()[:200]})')
finally:
    shutil.rmtree(work, ignore_errors=True)
print(f'\n{failed} failed' if failed else '\nall passed')
sys.exit(1 if failed else 0)
