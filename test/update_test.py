#!/usr/bin/env python3
"""End-to-end test of the self-updater, for server.py and (on Windows) server.ps1, with no GitHub:
a mock GitHub API serves a "stable" branch whose zipball is this checkout's ClaudeCompanion folder
plus a marker file and BUILD.json (SHA-256 of every file). A corrupted build is refused first. A throwaway copy of the addon (with fake personal data in companion-data) is served on
a spare port; the test asks for the update status, installs, and checks:
  - the update was offered, and installed (marker present, installed.json written)
  - companion-data (snapshot, settings, update.json, cards) is untouched, SCHEMA.md is updated
  - a backup of the old addon was made, without companion-data
  - the API call carried the token and the redirected download did not
  - the server came back up on its own after the restart
    python test/update_test.py            (server.py)
    python test/update_test.py --ps1      (server.ps1, Windows)
"""
import hashlib, io, json, os, shutil, subprocess, sys, tempfile, threading, time, urllib.request, zipfile
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'ClaudeCompanion')
PS1 = '--ps1' in sys.argv
API_PORT, APP_PORT = 47700, 47616 if not PS1 else 47617
seen = {'api_auth': None, 'dl_auth': 'unset'}


def build_zip(corrupt=False):
    files = {}
    for root, dirs, fs in os.walk(SRC):
        dirs[:] = [d for d in dirs if d not in ('__pycache__', 'from-claude', 'data')]
        for f in fs:
            rel = os.path.relpath(os.path.join(root, f), SRC).replace(os.sep, '/')
            if rel.startswith('companion-data/'): continue
            files[rel] = open(os.path.join(root, f), 'rb').read()
    files['web/UPDATE_MARKER.txt'] = b'new build'
    files['companion-data/SCHEMA.md'] = b'# new schema'
    sums = {k: hashlib.sha256(v).hexdigest() for k, v in files.items()}
    files['companion-data/settings.json'] = b'{"evil": "must not be copied"}'   # not in BUILD.json, never copied anyway
    if corrupt: files['Core.lua'] = files['Core.lua'] + b'-- damaged in transit'
    top = 'me-cc-abc123/'   # GitHub zipballs put everything in one top folder
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w', zipfile.ZIP_DEFLATED) as z:
        for k, v in files.items(): z.writestr(top + 'ClaudeCompanion/' + k, v)
        z.writestr(top + 'BUILD.json', json.dumps({'version': '1.4.0', 'files': sums}))
    return b.getvalue()


ZIP = {'good': build_zip(), 'bad': build_zip(corrupt=True)}
SERVE = {'which': 'bad'}


class GitHub(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def do_GET(self):
        if self.path.startswith('/repos/me/cc/zipball/'):
            if self.headers.get('Accept') == 'application/octet-stream':   # what GitHub really does
                self.send_response(415); self.end_headers(); return
            seen['api_auth'] = self.headers.get('Authorization')
            self.send_response(302); self.send_header('Location', f'http://127.0.0.1:{API_PORT}/dl/release.zip'); self.end_headers(); return
        if self.path.startswith('/dl/'):
            seen['dl_auth'] = self.headers.get('Authorization')
            z = ZIP[SERVE['which']]
            self.send_response(200); self.send_header('Content-Length', str(len(z))); self.end_headers(); self.wfile.write(z); return
        if self.path.startswith('/repos/me/cc/commits/stable'):
            if self.headers.get('Authorization') != 'Bearer test-token':
                self.send_response(404); self.end_headers(); return
            body = json.dumps({'sha': 'abc123def4567890abc123def4567890abc123de', 'commit': {'message': 'Build 1.4.0 from pc-build: test', 'committer': {'date': '2026-11-22T00:00:00Z'}}}).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body); return
        self.send_response(404); self.end_headers()


def get(url, post=False):
    req = urllib.request.Request(url, data=b'{}' if post else None, headers={'X-CC': '1'} if post else {}, method='POST' if post else 'GET')
    with urllib.request.urlopen(req, timeout=120) as r: return r.read().decode('utf-8')


def main():
    results = []
    def check(ok, what): results.append(ok); print(('PASS ' if ok else 'FAIL ') + what)
    gh = ThreadingHTTPServer(('127.0.0.1', API_PORT), GitHub)
    threading.Thread(target=gh.serve_forever, daemon=True).start()
    tmp = tempfile.mkdtemp(prefix='cc-updtest-')
    addon = os.path.join(tmp, '_forever_', 'Interface', 'AddOns', 'ClaudeCompanion')
    os.makedirs(os.path.join(tmp, '_forever_', 'WTF'))
    shutil.copytree(SRC, addon, ignore=shutil.ignore_patterns('__pycache__', 'data'))
    cd = os.path.join(addon, 'companion-data')
    os.makedirs(os.path.join(cd, 'from-claude'), exist_ok=True)
    personal = {'snapshot.json': '{"mine": 1}', 'settings.json': '{"cc.gear": "mine"}', 'from-claude/cards.json': '{"cards": []}'}
    for k, v in personal.items():
        with open(os.path.join(cd, k), 'w') as f: f.write(v)
    cfg = {'repo': 'me/cc', 'api': f'http://127.0.0.1:{API_PORT}', 'token': 'test-token', 'auto': False}
    with open(os.path.join(cd, 'update.json'), 'w') as f: json.dump(cfg, f)
    old_server = open(os.path.join(addon, 'web', 'server.py'), 'rb').read()
    env = dict(os.environ, CC_PORT=str(APP_PORT), LOCALAPPDATA=os.path.join(tmp, 'local'), HOME=os.path.join(tmp, 'home'))
    os.makedirs(env['HOME'], exist_ok=True)
    if PS1:
        cmd = ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', os.path.join(addon, 'web', 'server.ps1'), '-Serve']
    else:
        cmd = [sys.executable, os.path.join(addon, 'web', 'server.py'), '--serve']
    proc = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f'http://127.0.0.1:{APP_PORT}/' if not PS1 else f'http://localhost:{APP_PORT}/'
    try:
        for _ in range(60):
            try:
                if get(base + 'api/ping') == 'claude-companion': break
            except Exception: time.sleep(0.5)
        st = json.loads(get(base + 'api/update?force=1'))
        check(st.get('available') is True and (st.get('latest') or {}).get('tag') == 'abc123def456', 'update offered: ' + json.dumps({k: st.get(k) for k in ('available', 'error')}))
        # a build damaged in transit (one file doesn't match BUILD.json) installs nothing
        before = open(os.path.join(addon, 'Core.lua'), 'rb').read()
        r = json.loads(get(base + 'api/update', post=True))
        check(r.get('ok') is False and 'checksum' in (r.get('error') or ''), 'damaged build refused: ' + str(r.get('error'))[:80])
        check(open(os.path.join(addon, 'Core.lua'), 'rb').read() == before and not os.path.exists(os.path.join(addon, 'web', 'UPDATE_MARKER.txt'))
              and not os.path.exists(os.path.join(cd, 'installed.json')), 'nothing changed after the refused build')
        SERVE['which'] = 'good'
        r = json.loads(get(base + 'api/update', post=True))
        check(r.get('ok') is True, 'installed: ' + json.dumps(r)[:200])
        check(os.path.isfile(os.path.join(addon, 'web', 'UPDATE_MARKER.txt')), 'new files copied')
        for k, v in personal.items():
            check(open(os.path.join(cd, k)).read() == v, 'companion-data/' + k + ' untouched')
        check(json.load(open(os.path.join(cd, 'update.json'))) == cfg, 'update.json (token) untouched')
        check(open(os.path.join(cd, 'SCHEMA.md')).read() == '# new schema', 'SCHEMA.md updated')
        inst = json.load(open(os.path.join(cd, 'installed.json')))
        check(inst.get('tag') == 'abc123def456' and inst.get('version') == '1.4.0', 'installed.json names the build')
        b = inst.get('backup') or ''
        check(os.path.isdir(b) and os.path.isfile(os.path.join(b, 'web', 'server.py')) and not os.path.exists(os.path.join(b, 'companion-data')),
              'backup made, without companion-data: ' + b)
        check(seen['api_auth'] == 'Bearer test-token' and seen['dl_auth'] is None, f"token sent to the API, not to the download ({seen['api_auth']!r}, {seen['dl_auth']!r})")
        # the server restarts itself on the new code
        up = False
        time.sleep(2)
        for _ in range(40):
            try:
                if get(base + 'api/ping') == 'claude-companion': up = True; break
            except Exception: pass
            time.sleep(0.5)
        check(up, 'server back up after the restart')
        st2 = json.loads(get(base + 'api/update?force=1')) if up else {}
        check(st2.get('available') is False, 'after the update nothing more is offered')
    finally:
        # stop every copy of the test server (the restarted one is a new process on Windows)
        if PS1:
            subprocess.run(['powershell', '-NoProfile', '-Command',
                            f"Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object {{ $_.CommandLine -like '*{tmp}*' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }}"])
        else:
            proc.kill()
            if os.name == 'nt':
                subprocess.run(['powershell', '-NoProfile', '-Command',
                                f"Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object {{ $_.CommandLine -like '*{tmp}*' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }}"])
        gh.shutdown()
        time.sleep(1)
        shutil.rmtree(tmp, ignore_errors=True)
    print(f'{sum(results)}/{len(results)} passed')
    sys.exit(0 if all(results) else 1)


if __name__ == '__main__':
    main()
