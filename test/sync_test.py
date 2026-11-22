#!/usr/bin/env python3
"""End-to-end test of the save sync between computers, with no GitHub: a mock of GitHub's git-data
API (blobs, trees, commits, refs) and two throwaway copies of the addon, "pc" (server.ps1 on Windows,
else server.py) and "mac" (server.py), each with its own save. Checks that:
  - each computer publishes its save as one parentless commit on sync/<computer>
  - each downloads the other's save byte for byte, and offers it to the page (/api/stamp peers,
    /api/device-data), and doesn't download its own
  - the newer settings.json wins on both, and the replaced one is kept as settings.json.bak
  - neither save file is ever written
  - a new save is published again, and the other computer picks it up
    python test/sync_test.py  [path to a real ClaudeCompanion.lua to use as the pc save]
"""
import base64, hashlib, json, os, shutil, subprocess, sys, tempfile, threading, time, urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'ClaudeCompanion')
API_PORT = 47701
STORE = {'blobs': {}, 'trees': {}, 'commits': {}, 'refs': {}, 'n': 0}
LOCK = threading.Lock()


def new_sha(kind):
    STORE['n'] += 1
    return hashlib.sha1(f'{kind}{STORE["n"]}'.encode()).hexdigest()


class Git(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def reply(self, code, obj=None, raw=None):
        body = raw if raw is not None else json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)

    def authed(self):
        if self.headers.get('Authorization') != 'Bearer test-token': self.reply(404, {'message': 'Not Found'}); return False
        return True

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'{}')

    def do_POST(self):
        if not self.authed(): return
        p, b = self.path.split('/git/', 1)[1], self.body()
        with LOCK:
            if p == 'blobs':
                data = base64.b64decode(b['content']) if b.get('encoding') == 'base64' else b['content'].encode('utf-8')
                sha = new_sha('blob'); STORE['blobs'][sha] = data; return self.reply(201, {'sha': sha})
            if p == 'trees':
                sha = new_sha('tree'); STORE['trees'][sha] = b['tree']; return self.reply(201, {'sha': sha})
            if p == 'commits':
                sha = new_sha('commit'); STORE['commits'][sha] = b; return self.reply(201, {'sha': sha})
            if p == 'refs':
                if b['ref'] in STORE['refs']: return self.reply(422, {'message': 'exists'})
                STORE['refs'][b['ref']] = b['sha']; return self.reply(201, {'ref': b['ref']})
        self.reply(404, {})

    def do_PATCH(self):
        if not self.authed(): return
        ref = 'refs/' + self.path.split('/git/refs/', 1)[1]
        b = self.body()
        with LOCK:
            if ref not in STORE['refs']: return self.reply(422, {'message': 'Reference does not exist'})
            STORE['refs'][ref] = b['sha']
        self.reply(200, {'ref': ref})

    def do_GET(self):
        if not self.authed(): return
        p = self.path.split('/git/', 1)[1]
        with LOCK:
            if p.startswith('matching-refs/heads/sync/'):
                return self.reply(200, [{'ref': r, 'object': {'sha': s}} for r, s in STORE['refs'].items() if r.startswith('refs/heads/sync/')])
            if p.startswith('commits/'):
                c = STORE['commits'][p.split('/')[1]]; return self.reply(200, {'tree': {'sha': c['tree']}, 'parents': c['parents']})
            if p.startswith('trees/'):
                return self.reply(200, {'tree': STORE['trees'][p.split('/')[1]]})
            if p.startswith('blobs/'):
                return self.reply(200, raw=STORE['blobs'][p.split('/')[1]])
        self.reply(404, {})


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r: return r.read()


def make_copy(tmp, name, save_bytes, settings):
    base = os.path.join(tmp, name, '_forever_')
    addon = os.path.join(base, 'Interface', 'AddOns', 'ClaudeCompanion')
    shutil.copytree(SRC, addon, ignore=shutil.ignore_patterns('__pycache__', 'data', 'devices', 'snapshot.json', 'settings.json*', 'installed.json', 'update.json'))
    sv = os.path.join(base, 'WTF', 'Account', '1', 'SavedVariables')
    os.makedirs(sv)
    with open(os.path.join(sv, 'ClaudeCompanion.lua'), 'wb') as f: f.write(save_bytes)
    old = time.time() - 60
    os.utime(os.path.join(sv, 'ClaudeCompanion.lua'), (old, old))   # "the game finished writing a while ago"
    cd = os.path.join(addon, 'companion-data')
    os.makedirs(cd, exist_ok=True)
    with open(os.path.join(cd, 'update.json'), 'w') as f:
        json.dump({'repo': 'me/cc', 'api': f'http://127.0.0.1:{API_PORT}', 'token': 'test-token', 'auto': False, 'branch': 'none'}, f)
    with open(os.path.join(cd, 'settings.json'), 'w') as f: json.dump(settings, f)
    return addon, os.path.join(sv, 'ClaudeCompanion.lua')


def main():
    results = []
    def check(ok, what): results.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + what)
    gh = ThreadingHTTPServer(('127.0.0.1', API_PORT), Git)
    threading.Thread(target=gh.serve_forever, daemon=True).start()
    tmp = tempfile.mkdtemp(prefix='cc-synctest-')
    pc_save = open(sys.argv[1], 'rb').read() if len(sys.argv) > 1 else b'ClaudeCompanionDB = {\n["chars"] = {\n["World-Atlas"] = {\n["lastSeen"] = 1795000000,\n},\n},\n}\n'
    mac_save = b'ClaudeCompanionDB = {\n["chars"] = {\n["World-Atlas"] = {\n["lastSeen"] = 1795009999,\n["journal"] = {\n{\n["t"] = 1795009000,\n["e"] = "login",\n},\n},\n},\n},\n}\n'
    pc_addon, pc_sv = make_copy(tmp, 'pc', pc_save, {'cc.gear.profile': 'old-on-pc'})
    time.sleep(1.2)
    mac_addon, mac_sv = make_copy(tmp, 'mac', mac_save, {'cc.gear.profile': 'newer-on-mac'})
    procs = []
    env = dict(os.environ, CC_SYNC_SECS='1', LOCALAPPDATA=os.path.join(tmp, 'local'))
    use_ps = os.name == 'nt'
    pc_cmd = (['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', os.path.join(pc_addon, 'web', 'server.ps1'), '-Serve'] if use_ps
              else [sys.executable, os.path.join(pc_addon, 'web', 'server.py'), '--serve'])
    procs.append(subprocess.Popen(pc_cmd, env=dict(env, CC_PORT='47621', CC_DEVICE='pc'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    procs.append(subprocess.Popen([sys.executable, os.path.join(mac_addon, 'web', 'server.py'), '--serve'], env=dict(env, CC_PORT='47622', CC_DEVICE='mac'),
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    pc_url, mac_url = 'http://localhost:47621/', 'http://127.0.0.1:47622/'
    try:
        def both_have():
            return (os.path.isfile(os.path.join(pc_addon, 'companion-data', 'devices', 'mac', 'save.lua')) and
                    os.path.isfile(os.path.join(mac_addon, 'companion-data', 'devices', 'pc', 'save.lua')))
        for _ in range(90):
            if both_have(): break
            time.sleep(1)
        print('  (pc server: ' + ('server.ps1' if use_ps else 'server.py') + ', mac server: server.py)')
        check(set(STORE['refs']) == {'refs/heads/sync/pc', 'refs/heads/sync/mac'}, 'each computer published to sync/<computer>: ' + ', '.join(sorted(STORE['refs'])))
        check(all(not STORE['commits'][s]['parents'] for s in STORE['refs'].values()), 'the sync commits have no parent (the repository does not grow)')
        check(both_have(), "each computer downloaded the other's save")
        got_mac = open(os.path.join(pc_addon, 'companion-data', 'devices', 'mac', 'save.lua'), 'rb').read()
        got_pc = open(os.path.join(mac_addon, 'companion-data', 'devices', 'pc', 'save.lua'), 'rb').read()
        check(got_mac == mac_save and got_pc == pc_save, 'byte for byte')
        check(not os.path.exists(os.path.join(pc_addon, 'companion-data', 'devices', 'pc')), "a computer doesn't download its own save")
        st = json.loads(get(pc_url + 'api/stamp'))
        check(st.get('device') == 'pc' and str(st.get('peers', '')).startswith('mac:'), 'the page is told about the other save: peers = ' + str(st.get('peers')))
        check(get(pc_url + 'api/device-data?dev=mac') == mac_save, 'and can load it (/api/device-data)')
        dv = json.loads(get(mac_url + 'api/devices'))
        check(dv.get('here') == 'mac' and [p['device'] for p in dv.get('peers', [])] == ['pc'] and not dv.get('error'), '/api/devices: ' + json.dumps({k: dv.get(k) for k in ('here', 'error')}))
        s_pc = json.load(open(os.path.join(pc_addon, 'companion-data', 'settings.json')))
        s_mac = json.load(open(os.path.join(mac_addon, 'companion-data', 'settings.json')))
        check(s_pc.get('cc.gear.profile') == 'newer-on-mac' and s_mac.get('cc.gear.profile') == 'newer-on-mac', 'the newer settings win on both computers')
        check(os.path.isfile(os.path.join(pc_addon, 'companion-data', 'settings.json.bak')), 'the replaced settings are kept as settings.json.bak')
        check(open(pc_sv, 'rb').read() == pc_save and open(mac_sv, 'rb').read() == mac_save, 'neither save file was written')
        # a new save on the mac is published and reaches the pc
        newer = mac_save.replace(b'1795009999', b'1795019999')
        with open(mac_sv, 'wb') as f: f.write(newer)
        t = time.time() - 30; os.utime(mac_sv, (t + 15, t + 15))
        for _ in range(60):
            if open(os.path.join(pc_addon, 'companion-data', 'devices', 'mac', 'save.lua'), 'rb').read() == newer: break
            time.sleep(1)
        check(open(os.path.join(pc_addon, 'companion-data', 'devices', 'mac', 'save.lua'), 'rb').read() == newer, "the mac's next save reached the pc")
    finally:
        for p in procs: p.kill()
        if os.name == 'nt':
            subprocess.run(['powershell', '-NoProfile', '-Command',
                            f"Get-CimInstance Win32_Process | Where-Object {{ $_.CommandLine -like '*{tmp}*' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }}"])
        gh.shutdown(); time.sleep(1)
        shutil.rmtree(tmp, ignore_errors=True)
    results = [r for r in results]
    print(f'{sum(results)}/{len(results)} passed')
    sys.exit(0 if all(results) else 1)


if __name__ == '__main__':
    main()
