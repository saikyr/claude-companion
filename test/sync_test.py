#!/usr/bin/env python3
"""End-to-end test of the save sync between computers through a shared cloud-drive folder.
Two throwaway copies of the addon, "pc" (server.ps1 on Windows, else server.py) and "mac"
(server.py), each with its own save, and one temp folder standing in for the cloud drive. Checks:
  - the app turns sync on with one call (POST /api/sync-config), making "Claude Companion" in the drive
  - each computer writes only its own subfolder (save.lua.gz, settings.json, snapshot.json.gz, meta.json)
  - each reads the other's save byte for byte and offers it to the page (/api/stamp peers,
    /api/device-data), and never copies its own
  - the newer settings.json wins on both; the replaced one is kept as settings.json.bak
  - neither save file is ever written
  - a new save is published again and the other computer picks it up
  - a half-written save (meta says one thing, the file another) is not taken
    python test/sync_test.py  [path to a real ClaudeCompanion.lua to use as the pc save]
"""
import gzip, json, os, shutil, subprocess, sys, tempfile, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'ClaudeCompanion')


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r: return r.read()


def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST', headers={'X-CC': '1', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())


def make_copy(tmp, name, save_bytes, settings):
    base = os.path.join(tmp, name, '_forever_')
    addon = os.path.join(base, 'Interface', 'AddOns', 'ClaudeCompanion')
    shutil.copytree(SRC, addon, ignore=shutil.ignore_patterns('__pycache__', 'data', 'devices', 'snapshot.json', 'settings.json*', 'installed.json', 'update.json'))
    sv = os.path.join(base, 'WTF', 'Account', '1', 'SavedVariables')
    os.makedirs(sv)
    with open(os.path.join(sv, 'ClaudeCompanion.lua'), 'wb') as f: f.write(save_bytes)
    old = time.time() - 60
    os.utime(os.path.join(sv, 'ClaudeCompanion.lua'), (old, old))   # the game finished writing a while ago
    cd = os.path.join(addon, 'companion-data')
    os.makedirs(cd, exist_ok=True)
    with open(os.path.join(cd, 'update.json'), 'w') as f: json.dump({'auto': False, 'branch': 'none', 'api': 'http://127.0.0.1:9'}, f)
    with open(os.path.join(cd, 'settings.json'), 'w') as f: json.dump(settings, f)
    with open(os.path.join(cd, 'snapshot.json'), 'w') as f: json.dump({'schema': 1, 'from': name}, f)
    return addon, os.path.join(sv, 'ClaudeCompanion.lua')


def main():
    results = []
    def check(ok, what): results.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + what)
    tmp = tempfile.mkdtemp(prefix='cc-synctest-')
    drive = os.path.join(tmp, 'Google Drive', 'My Drive')
    os.makedirs(drive)
    pc_save = open(sys.argv[1], 'rb').read() if len(sys.argv) > 1 else b'ClaudeCompanionDB = {\n["chars"] = {\n["World-Atlas"] = {\n["lastSeen"] = 1795000000,\n},\n},\n}\n'
    mac_save = b'ClaudeCompanionDB = {\n["chars"] = {\n["World-Atlas"] = {\n["lastSeen"] = 1795009999,\n["journal"] = {\n{\n["t"] = 1795009000,\n["e"] = "login",\n},\n},\n},\n},\n}\n'
    pc_addon, pc_sv = make_copy(tmp, 'pc', pc_save, {'cc.gear.profile': 'old-on-pc'})
    time.sleep(1.2)
    mac_addon, mac_sv = make_copy(tmp, 'mac', mac_save, {'cc.gear.profile': 'newer-on-mac'})
    env = dict(os.environ, CC_SYNC_SECS='1', LOCALAPPDATA=os.path.join(tmp, 'local'))
    use_ps = os.name == 'nt'
    pc_cmd = (['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', os.path.join(pc_addon, 'web', 'server.ps1'), '-Serve'] if use_ps
              else [sys.executable, os.path.join(pc_addon, 'web', 'server.py'), '--serve'])
    procs = [subprocess.Popen(pc_cmd, env=dict(env, CC_PORT='47621', CC_DEVICE='pc'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
             subprocess.Popen([sys.executable, os.path.join(mac_addon, 'web', 'server.py'), '--serve'], env=dict(env, CC_PORT='47622', CC_DEVICE='mac'),
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)]
    pc_url, mac_url = 'http://localhost:47621/', 'http://127.0.0.1:47622/'
    store = os.path.join(drive, 'Claude Companion')
    try:
        for url in (pc_url, mac_url):
            for _ in range(60):
                try:
                    if get(url + 'api/ping') == b'claude-companion': break
                except Exception: time.sleep(0.5)
        print('  (pc server: ' + ('server.ps1' if use_ps else 'server.py') + ', mac server: server.py)')
        off = json.loads(get(pc_url + 'api/devices'))
        check(off.get('enabled') is False, 'sync is off until chosen')
        for url in (pc_url, mac_url):
            r = post(url + 'api/sync-config', {'folder': drive})
            check(r.get('enabled') and r.get('folder') == store, f'turned on with one call, into {os.path.basename(store)}: ' + str(r.get('folder')))
        def both_have():
            return (os.path.isfile(os.path.join(pc_addon, 'companion-data', 'devices', 'mac', 'save.lua')) and
                    os.path.isfile(os.path.join(mac_addon, 'companion-data', 'devices', 'pc', 'save.lua')))
        for _ in range(60):
            if both_have(): break
            time.sleep(1)
        check(sorted(os.listdir(store)) == ['mac', 'pc'], 'each computer has its own subfolder: ' + ', '.join(sorted(os.listdir(store))))
        check(sorted(os.listdir(os.path.join(store, 'pc'))) == ['meta.json', 'save.lua.gz', 'settings.json', 'snapshot.json.gz'],
              'pc wrote save, settings, snapshot and meta: ' + ', '.join(sorted(os.listdir(os.path.join(store, 'pc')))))
        snap_raw = gzip.decompress(open(os.path.join(store, 'pc', 'snapshot.json.gz'), 'rb').read())
        check(json.loads(snap_raw.decode('utf-8-sig')).get('from') == 'pc', 'the snapshot is readable from the drive: ' + repr(snap_raw[:60]))
        check(both_have(), "each computer copied the other's save")
        check(open(os.path.join(pc_addon, 'companion-data', 'devices', 'mac', 'save.lua'), 'rb').read() == mac_save and
              open(os.path.join(mac_addon, 'companion-data', 'devices', 'pc', 'save.lua'), 'rb').read() == pc_save, 'byte for byte')
        check(not os.path.exists(os.path.join(pc_addon, 'companion-data', 'devices', 'pc')), "a computer doesn't copy its own save")
        st = json.loads(get(pc_url + 'api/stamp'))
        check(st.get('device') == 'pc' and str(st.get('peers', '')).startswith('mac:'), 'the page is told about the other save: peers = ' + str(st.get('peers')))
        check(get(pc_url + 'api/device-data?dev=mac') == mac_save, 'and can load it (/api/device-data)')
        s_pc = json.load(open(os.path.join(pc_addon, 'companion-data', 'settings.json')))
        s_mac = json.load(open(os.path.join(mac_addon, 'companion-data', 'settings.json')))
        check(s_pc.get('cc.gear.profile') == 'newer-on-mac' and s_mac.get('cc.gear.profile') == 'newer-on-mac', 'the newer settings win on both computers')
        check(os.path.isfile(os.path.join(pc_addon, 'companion-data', 'settings.json.bak')), 'the replaced settings are kept as settings.json.bak')
        check(open(pc_sv, 'rb').read() == pc_save and open(mac_sv, 'rb').read() == mac_save, 'neither save file was written')
        # a half-written save on the drive (new data, old meta) is not taken
        meta_before = open(os.path.join(store, 'mac', 'meta.json'), 'rb').read()
        with open(os.path.join(store, 'mac', 'meta.json'), 'w') as f:
            m = json.loads(meta_before); m['saveModified'] = 'half'; json.dump(m, f)
        with open(os.path.join(store, 'mac', 'save.lua.gz'), 'wb') as f: f.write(gzip.compress(b'broken'))
        time.sleep(8)
        check(open(os.path.join(pc_addon, 'companion-data', 'devices', 'mac', 'save.lua'), 'rb').read() == mac_save, 'a half-written save is not taken')
        # the mac's next save reaches the pc
        newer = mac_save.replace(b'1795009999', b'1795019999')
        with open(mac_sv, 'wb') as f: f.write(newer)
        t = time.time() - 30; os.utime(mac_sv, (t + 15, t + 15))
        for _ in range(40):
            if open(os.path.join(pc_addon, 'companion-data', 'devices', 'mac', 'save.lua'), 'rb').read() == newer: break
            time.sleep(1)
        check(open(os.path.join(pc_addon, 'companion-data', 'devices', 'mac', 'save.lua'), 'rb').read() == newer, "the mac's next save reached the pc")
    finally:
        for p in procs: p.kill()
        if os.name == 'nt':
            subprocess.run(['powershell', '-NoProfile', '-Command',
                            f"Get-CimInstance Win32_Process | Where-Object {{ $_.CommandLine -like '*{tmp}*' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }}"])
        time.sleep(1)
        shutil.rmtree(tmp, ignore_errors=True)
    print(f'{sum(results)}/{len(results)} passed')
    sys.exit(0 if all(results) else 1)


if __name__ == '__main__':
    main()
