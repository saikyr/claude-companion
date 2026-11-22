#!/usr/bin/env python3
# Claude Companion app on macOS (and anywhere with Python 3; Windows uses server.ps1).
# macOS: open "Claude Companion.app" once; after that the server starts at login and the app is in the Dock.
# Same small local server as server.ps1, same addresses, so the page is identical:
#   http://localhost:47615   /api/ping  /api/stamp  /api/data  POST /api/snapshot
#                            /api/cards  /api/cards-state  POST /api/cards-state
#                            /api/settings  POST /api/settings
# It serves the app and reads the game's saved file (ClaudeCompanion.lua) directly.
# Nothing is sent anywhere: it only answers this computer.
import glob, json, os, shutil, subprocess, sys, tempfile, threading, time, urllib.error, urllib.request, webbrowser
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

WEB = os.path.dirname(os.path.abspath(__file__))
FOREVER = os.path.normpath(os.path.join(WEB, '..', '..', '..', '..'))   # .../_forever_
DATA_DIR = os.path.join(os.path.dirname(WEB), 'companion-data')
CARDS_DIR = os.path.join(DATA_DIR, 'from-claude')   # cards.json: Claude writes it; state.json: this app writes it
PORT = int(os.environ.get('CC_PORT') or 47615)   # CC_PORT: only for testing a second copy
# which computer this is: snapshot.json says so, because the PC and the Mac each keep their own save (#11)
import platform, socket
DEVICE_HOST = (socket.gethostname() or '').split('.')[0]
DEVICE_OS = 'mac' if sys.platform == 'darwin' else ('pc' if os.name == 'nt' else sys.platform)
URL = f'http://localhost:{PORT}/'
TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
         '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'}

_save = {'path': None, 'found': 0.0}
_lock = threading.Lock()


def find_save():
    # newest WTF/Account/<account>/SavedVariables/ClaudeCompanion.lua; looked up again at most every 30 s
    with _lock:
        p = _save['path']
        if not p or not os.path.isfile(p) or time.time() - _save['found'] > 30:
            hits = glob.glob(os.path.join(FOREVER, 'WTF', 'Account', '*', 'SavedVariables', 'ClaudeCompanion.lua'))
            _save['path'] = max(hits, key=os.path.getmtime) if hits else None
            _save['found'] = time.time()
        return _save['path']


def stamp_of(path):
    # the save file's modified time; the page copies it into snapshot.json as saveModified
    return datetime.fromtimestamp(os.path.getmtime(path), timezone.utc).isoformat()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send(self, code, body, ctype='text/plain; charset=utf-8'):
        if isinstance(body, str): body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/ping': return self.send(200, 'claude-companion')
        if path in ('/api/stamp', '/api/data'):
            save = find_save()
            if path == '/api/stamp':
                # peers: the other computers' saves; the page loads them again when this changes
                dev = {'host': DEVICE_HOST, 'os': DEVICE_OS, 'device': DEV, 'peers': '|'.join(f"{p['device']}:{p['saveModified']}" for p in peers())}
                if not save: return self.send(200, json.dumps({'stamp': None, **dev}), TYPES['.json'])
                return self.send(200, json.dumps({'stamp': stamp_of(save), 'size': os.path.getsize(save), **dev}), TYPES['.json'])
            if not save: return self.send(404, 'no save yet')
            with open(save, 'rb') as f: return self.send(200, f.read(), 'application/octet-stream')
        if path == '/api/devices':
            return self.send(200, json.dumps(sync_status()), TYPES['.json'])
        if path == '/api/device-data':
            dev = (self.path.split('dev=', 1)[1] if 'dev=' in self.path else '').split('&')[0]
            f = os.path.join(DEVICES_DIR, dev, 'save.lua')
            if not re.fullmatch(r'[a-z0-9-]+', dev) or not os.path.isfile(f): return self.send(404, 'no such computer')
            with open(f, 'rb') as fh: return self.send(200, fh.read(), 'application/octet-stream')
        if path == '/api/update':
            return self.send(200, json.dumps(update_status(force='force=1' in self.path)), TYPES['.json'])
        if path in ('/api/cards', '/api/cards-state', '/api/settings'):
            f = {'/api/cards': os.path.join(CARDS_DIR, 'cards.json'), '/api/cards-state': os.path.join(CARDS_DIR, 'state.json'),
                 '/api/settings': os.path.join(DATA_DIR, 'settings.json')}[path]
            if not os.path.isfile(f): return self.send(204, b'')   # none yet
            with open(f, 'rb') as fh: return self.send(200, fh.read(), TYPES['.json'])
        rel = urllib.request.url2pathname(path.lstrip('/')) or 'index.html'
        full = os.path.realpath(os.path.join(WEB, rel))
        # only files inside the app folder, and never the server scripts
        if full.startswith(os.path.realpath(WEB) + os.sep) and os.path.isfile(full) and not full.endswith(('.ps1', '.py')):
            with open(full, 'rb') as f:
                return self.send(200, f.read(), TYPES.get(os.path.splitext(full)[1].lower(), 'text/plain; charset=utf-8'))
        self.send(404, 'not found')

    def do_POST(self):
        # the page's summary for Claude: ../companion-data/snapshot.json, and what you did with
        # Claude's cards: ../companion-data/from-claude/state.json (see SCHEMA.md there).
        # Only this app sends the X-CC header; a web page can't add it without the browser asking first.
        n = int(self.headers.get('Content-Length') or 0)
        if self.path.split('?')[0] == '/api/sync-config':
            # {"folder": "<a cloud drive folder>"} turns sync on (in a "Claude Companion" folder inside it), {"folder": null} off
            if self.headers.get('X-CC') != '1' or not 0 < n < 4096: return self.send(400, 'bad request')
            try: want = json.loads(self.rfile.read(n).decode('utf-8')).get('folder')
            except ValueError: return self.send(400, 'bad request')
            cfg = read_json(UPDATE_CFG, {})
            if want:
                if not os.path.isdir(want): return self.send(400, 'that folder does not exist')
                target = want if os.path.basename(os.path.normpath(want)) == 'Claude Companion' else os.path.join(want, 'Claude Companion')
                os.makedirs(target, exist_ok=True)
                cfg['sync'] = {'folder': target}
            else:
                cfg.pop('sync', None)
            write_json(UPDATE_CFG, cfg)
            _sync['nextPull'], _sync['pushed'] = 0.0, None
            try: os.remove(os.path.join(DEVICES_DIR, '.pushed'))   # publish again to the new place
            except OSError: pass
            return self.send(200, json.dumps(sync_status()), TYPES['.json'])
        if self.path.split('?')[0] in ('/api/update', '/api/update-auto'):
            if self.headers.get('X-CC') != '1': return self.send(400, 'bad request')
            if n: self.rfile.read(min(n, 4096))
            if self.path.startswith('/api/update-auto'):
                cfg = read_json(UPDATE_CFG, {})
                cfg['auto'] = 'on=1' in self.path
                write_json(UPDATE_CFG, cfg)
                return self.send(200, json.dumps(update_status()), TYPES['.json'])
            r = install_update()
            self.send(200, json.dumps(r), TYPES['.json'])
            if r.get('ok'): restart_soon()
            return
        target = {'/api/snapshot': (DATA_DIR, 'snapshot.json'), '/api/cards-state': (CARDS_DIR, 'state.json'),
                  '/api/settings': (DATA_DIR, 'settings.json')}.get(self.path.split('?')[0])
        if not target or self.headers.get('X-CC') != '1' or n <= 0 or n > 20 * 1024 * 1024:
            return self.send(400, 'bad request')
        body = self.rfile.read(n)
        folder, name = target
        os.makedirs(folder, exist_ok=True)
        tmp = os.path.join(folder, name + '.tmp')
        with open(tmp, 'wb') as f: f.write(body)
        os.replace(tmp, os.path.join(folder, name))
        self.send(200, 'ok')


# ---------------------------------------------------------------- updates
# The app updates itself from the project's "stable" branch: each tested build is pushed there
# (tools/publish-stable.py) as the ClaudeCompanion folder plus BUILD.json, which lists every file's
# SHA-256. The server checks the branch's newest commit every 30 minutes (and when the page asks), and
# installs it by itself when "auto" is on (the default), or when you click Install. Every file is
# checked against BUILD.json before anything is copied.
# Installing: download, check the zip has the whole addon, copy the current addon folder to a backup
# (the last 5 are kept), then copy the new files over it. Never touched: companion-data/ (your
# snapshot, settings, Claude's cards; only its SCHEMA.md is updated) and the game's saved data (WTF/).
# Files the release doesn't have are left alone. Afterwards the server restarts itself on the new code;
# the addon's own Lua takes effect at the next /reload in game.
# The repository is private, so downloads need a GitHub token: companion-data/update.json "token",
# else CC_GITHUB_TOKEN, else the GitHub CLI's (`gh auth token`). A public repository needs none.
REPO = 'saikyr/claude-companion'
ADDON = os.path.dirname(WEB)
UPDATE_CFG = os.path.join(DATA_DIR, 'update.json')      # {repo, auto, token}: yours, never shipped or overwritten
INSTALLED = os.path.join(DATA_DIR, 'installed.json')    # {tag, at, backup}: which release is installed
REQUIRED = ['ClaudeCompanion.toc', 'Core.lua', 'Journal.lua', 'web/index.html', 'web/js/app.js', 'web/server.py', 'web/server.ps1']
if sys.platform == 'darwin': BACKUPS = os.path.expanduser('~/Library/Application Support/Claude Companion/backups')
elif os.name == 'nt': BACKUPS = os.path.join(os.environ.get('LOCALAPPDATA', os.path.expanduser('~')), 'Claude Companion', 'backups')
else: BACKUPS = os.path.expanduser('~/.local/share/claude-companion/backups')
_upd = {'checked': 0.0, 'latest': None, 'error': None, 'busy': False, 'last': None}


def read_json(path, default):
    try:
        with open(path, encoding='utf-8') as f: return json.load(f)
    except (OSError, ValueError): return default


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f: json.dump(data, f, indent=1)
    os.replace(tmp, path)


def upd_cfg():
    # where updates come from: web/channel.json, written by the build (the private repository for
    # Gabriel's builds, the public download repository for everyone else's); update.json can override
    c = {'repo': REPO, 'auto': True, 'branch': 'stable', 'api': 'https://api.github.com'}   # api: only changed for testing
    c.update({k: v for k, v in read_json(os.path.join(WEB, 'channel.json'), {}).items() if k in ('repo', 'branch')})
    c.update(read_json(UPDATE_CFG, {}))
    return c


def gh_token(cfg):
    if cfg.get('token'): return cfg['token']
    if os.environ.get('CC_GITHUB_TOKEN'): return os.environ['CC_GITHUB_TOKEN']
    for gh in (shutil.which('gh'), '/opt/homebrew/bin/gh', '/usr/local/bin/gh'):
        if gh and os.path.isfile(gh):
            try:
                r = subprocess.run([gh, 'auth', 'token'], capture_output=True, text=True, timeout=10)
                if r.returncode == 0 and r.stdout.strip(): return r.stdout.strip()
            except Exception: pass
    return None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None


def gh_get(url, tok, accept='application/vnd.github+json'):
    req = urllib.request.Request(url, headers={'Accept': accept, 'User-Agent': 'claude-companion', 'X-GitHub-Api-Version': '2022-11-28'})
    if tok: req.add_header('Authorization', 'Bearer ' + tok)
    if accept == 'application/octet-stream':
        # assets redirect to a signed download link, which must be fetched without the token
        try:
            with urllib.request.build_opener(_NoRedirect).open(req, timeout=30) as r: return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (301, 302, 303, 307, 308): raise
            with urllib.request.urlopen(urllib.request.Request(e.headers['Location'], headers={'User-Agent': 'claude-companion'}), timeout=300) as r:
                return r.read()
    with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read().decode('utf-8'))


def check_update(force=False):
    if not force and time.time() - _upd['checked'] < 15 * 60: return _upd['latest']
    cfg = upd_cfg()
    _upd['checked'] = time.time()
    try:
        c = gh_get(f"{cfg['api']}/repos/{cfg['repo']}/commits/{cfg['branch']}", gh_token(cfg))
        msg = (c.get('commit') or {}).get('message') or ''
        latest = {'tag': c['sha'][:12], 'sha': c['sha'], 'name': msg.split('\n')[0][:120] or c['sha'][:12],
                  'published': ((c.get('commit') or {}).get('committer') or {}).get('date'), 'notes': msg[:3000]}
        _upd['latest'], _upd['error'] = latest, None
    except urllib.error.HTTPError as e:
        if e.code == 422:   # the branch doesn't exist yet: nothing published, not a problem
            _upd['latest'], _upd['error'] = None, None
            return None
        _upd['error'] = ('GitHub said %d. ' % e.code) + ('The repository is private: add a token (see companion-data/SCHEMA.md, update.json), or sign in with the GitHub CLI.' if e.code in (401, 403, 404) else '')
    except Exception as e:
        _upd['error'] = 'Could not reach GitHub: %s' % e
    return _upd['latest']


def update_status(force=False):
    latest = check_update(force)
    inst = read_json(INSTALLED, {})
    cfg = upd_cfg()
    return {'installed': inst or None, 'latest': latest, 'available': bool(latest and latest['tag'] != inst.get('tag')),
            'auto': bool(cfg.get('auto', True)), 'busy': _upd['busy'], 'error': _upd['error'], 'last': _upd['last'],
            'checked': datetime.fromtimestamp(_upd['checked'], timezone.utc).isoformat() if _upd['checked'] else None}


def install_update():
    import zipfile
    if _upd['busy']: return {'ok': False, 'error': 'An update is already being installed.'}
    _upd['busy'] = True
    try:
        latest = check_update(force=True)
        if not latest: return {'ok': False, 'error': _upd['error'] or 'No build found.'}
        cfg = upd_cfg()
        data = gh_get(f"{cfg['api']}/repos/{cfg['repo']}/zipball/{latest['sha']}", gh_token(cfg), 'application/octet-stream')
        work = tempfile.mkdtemp(prefix='cc-update-')
        zpath = os.path.join(work, 'release.zip')
        with open(zpath, 'wb') as f: f.write(data)
        with zipfile.ZipFile(zpath) as z:
            for n in z.namelist():   # nothing may land outside the work folder
                if n.startswith('/') or '..' in n.replace('\\', '/').split('/'): raise ValueError('unsafe path in the zip: ' + n)
            z.extractall(os.path.join(work, 'x'))
        src = None
        for root, dirs, files in os.walk(os.path.join(work, 'x')):
            if 'ClaudeCompanion.toc' in files: src = root; break
        if not src: raise ValueError('the release zip has no ClaudeCompanion.toc')
        missing = [r for r in REQUIRED if not os.path.isfile(os.path.join(src, *r.split('/')))]
        if missing: raise ValueError('the build is missing ' + ', '.join(missing))
        # every file must match BUILD.json (next to the ClaudeCompanion folder): a broken download installs nothing
        import hashlib
        build = read_json(os.path.join(os.path.dirname(src), 'BUILD.json'), None)
        if not build or not isinstance(build.get('files'), dict): raise ValueError('the build has no BUILD.json')
        for rel, want in build['files'].items():
            fp = os.path.join(src, *rel.split('/'))
            if not os.path.isfile(fp): raise ValueError('the build is missing ' + rel)
            with open(fp, 'rb') as fh:
                if hashlib.sha256(fh.read()).hexdigest() != want: raise ValueError('checksum mismatch: ' + rel)
        # back up the current addon (without companion-data, which is never overwritten anyway)
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        backup = os.path.join(BACKUPS, f'ClaudeCompanion-{stamp}')
        shutil.copytree(ADDON, backup, ignore=shutil.ignore_patterns('companion-data', '__pycache__'))
        olds = sorted(d for d in os.listdir(BACKUPS) if d.startswith('ClaudeCompanion-'))
        for d in olds[:-5]: shutil.rmtree(os.path.join(BACKUPS, d), ignore_errors=True)
        copied = 0
        for root, dirs, files in os.walk(src):
            rel = os.path.relpath(root, src)
            parts = [] if rel == '.' else rel.split(os.sep)
            if parts[:1] == ['companion-data']:
                files = [f for f in files if parts == ['companion-data'] and f == 'SCHEMA.md']
            for f in files:
                dest = os.path.join(ADDON, *parts, f)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copy2(os.path.join(root, f), dest)
                if f == 'launcher' or f.endswith(('.command', '.sh')): os.chmod(dest, 0o755)   # zips don't keep the run bit
                copied += 1
        shutil.rmtree(work, ignore_errors=True)
        info = {'tag': latest['tag'], 'sha': latest['sha'], 'version': build.get('version'), 'at': datetime.now(timezone.utc).isoformat(), 'backup': backup, 'files': copied}
        write_json(INSTALLED, info)
        _upd['last'] = info
        print(f"updated to {latest['tag']} ({copied} files; backup {backup})", flush=True)
        return {'ok': True, **info}
    except Exception as e:
        print('update failed:', e, flush=True)
        return {'ok': False, 'error': str(e)}
    finally:
        _upd['busy'] = False


def restart_soon():
    # start this server again on the new code: the same process, new program (the port is released)
    def go():
        time.sleep(1)
        try: os.execv(sys.executable, [sys.executable, os.path.abspath(__file__), '--serve'])
        except Exception as e: print('restart failed:', e, flush=True); os._exit(1)   # launchd then starts it again
    threading.Thread(target=go, daemon=True).start()


def auto_update():
    time.sleep(60)
    while True:
        try:
            st = update_status()
            if st['available'] and st['auto'] and not st['busy']:
                r = install_update()
                if r.get('ok'): restart_soon(); return
        except Exception as e:
            print('auto update:', e, flush=True)
        time.sleep(30 * 60)


# ---------------------------------------------------------------- one character on every computer
# The game keeps a separate save on each computer and writes it itself, so the saves can't be one
# file. Instead each computer's server publishes its save (and the app's settings and snapshot) to a
# store the person's computers share, and downloads the other computers' latest into
# companion-data/devices/<computer>/. The page merges them with this computer's save (js/merge.js)
# before showing anything or writing snapshot.json. Nothing is ever written to a save.
# The store is a folder inside a cloud drive the person's computers already sync (Google Drive for
# desktop, OneDrive, Dropbox, iCloud Drive), chosen once in the app (it lists the drives it finds) and
# kept in companion-data/update.json "sync": {"folder": "..."}; off until chosen. Each computer writes
# only its own subfolder, <folder>/<computer>/ (save.lua.gz, settings.json, snapshot.json.gz, then
# meta.json last, with the save's SHA-256), so two computers never write the same file and the drive
# never has a conflict to resolve. Everyone uses the same mechanism; no account beyond the drive.
# Stores are pluggable (put / versions / get): a hosted one could be added later.
# Settings (gear weights and picks) follow the computer where they changed last; the replaced file is
# kept as settings.json.bak.
import base64, gzip, hashlib, re
DEVICES_DIR = os.path.join(DATA_DIR, 'devices')
DEV = os.environ.get('CC_DEVICE') or re.sub(r'[^a-z0-9-]+', '-', DEVICE_HOST.lower()).strip('-') or 'computer'   # CC_DEVICE: tests only
SYNC_SECS = float(os.environ.get('CC_SYNC_SECS') or 15)   # tests only: how often to look
_sync = {'pushed': None, 'lastPush': None, 'lastPull': None, 'error': None, 'nextPull': 0.0}


def sync_cfg():
    s = upd_cfg().get('sync')
    return s if isinstance(s, dict) and s.get('folder') else None


class FolderStore:
    """<folder>/<computer>/ in a folder the computers already share."""
    def __init__(self, folder):
        self.root = os.path.expanduser(folder)
        if not os.path.isdir(self.root): raise ValueError(f'the sync folder {self.root} does not exist')

    def put(self, files):
        d = os.path.join(self.root, DEV)
        os.makedirs(d, exist_ok=True)
        for n, data in files.items():
            if n == 'meta.json': continue
            with open(os.path.join(d, n + '.tmp'), 'wb') as f: f.write(data)
            os.replace(os.path.join(d, n + '.tmp'), os.path.join(d, n))
        with open(os.path.join(d, 'meta.json.tmp'), 'wb') as f: f.write(files['meta.json'])   # last: it says the rest is complete
        os.replace(os.path.join(d, 'meta.json.tmp'), os.path.join(d, 'meta.json'))

    def versions(self):
        out = {}
        for dev in os.listdir(self.root):
            m = os.path.join(self.root, dev, 'meta.json')
            if os.path.isfile(m):
                with open(m, 'rb') as f: out[dev] = hashlib.sha256(f.read()).hexdigest()
        return out

    def get(self, dev, version, names):
        out = {}
        for n in names:
            p = os.path.join(self.root, dev, n)
            if os.path.isfile(p):
                with open(p, 'rb') as f: out[n] = f.read()
        return out


def open_store():
    s = sync_cfg()
    return FolderStore(s['folder']) if s else None


def cloud_drives():
    """Cloud-drive folders on this computer, for the app to offer (Google Drive first)."""
    home, out = os.path.expanduser('~'), []
    def add(kind, path):
        if path and os.path.isdir(path) and not any(o['path'] == path for o in out): out.append({'kind': kind, 'path': path})
    if sys.platform == 'darwin':
        cs = os.path.join(home, 'Library', 'CloudStorage')
        for d in sorted(os.listdir(cs)) if os.path.isdir(cs) else []:
            p = os.path.join(cs, d)
            if d.startswith('GoogleDrive-'): add('Google Drive', os.path.join(p, 'My Drive'))
            elif d.startswith('OneDrive'): add('OneDrive', p)
            elif d.startswith('Dropbox'): add('Dropbox', p)
        add('iCloud Drive', os.path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'))
    elif os.name == 'nt':
        import string
        for L in string.ascii_uppercase:
            add('Google Drive', f'{L}:\My Drive')
        add('Google Drive', os.path.join(home, 'Google Drive', 'My Drive')); add('Google Drive', os.path.join(home, 'My Drive'))
        add('OneDrive', os.environ.get('OneDrive')); add('Dropbox', os.path.join(home, 'Dropbox'))
        add('iCloud Drive', os.path.join(home, 'iCloudDrive'))
    else:
        add('Dropbox', os.path.join(home, 'Dropbox'))
    return out


def push_save(store, save):
    with open(save, 'rb') as f: raw = f.read()
    meta = {'device': DEV, 'host': DEVICE_HOST, 'os': DEVICE_OS, 'saveModified': stamp_of(save), 'uploaded': datetime.now(timezone.utc).isoformat(),
            'sha256': hashlib.sha256(raw).hexdigest(), 'size': len(raw)}
    files = {'save.lua.gz': gzip.compress(raw, mtime=0)}
    sfile = os.path.join(DATA_DIR, 'settings.json')
    if os.path.isfile(sfile):
        with open(sfile, 'rb') as f: files['settings.json'] = f.read()
        meta['settingsModified'] = datetime.fromtimestamp(os.path.getmtime(sfile), timezone.utc).isoformat()
    snap = os.path.join(DATA_DIR, 'snapshot.json')
    if os.path.isfile(snap):   # the merged picture the app wrote: Claude can read it from the store
        with open(snap, 'rb') as f: files['snapshot.json.gz'] = gzip.compress(f.read(), mtime=0)
    files['meta.json'] = json.dumps(meta, indent=1).encode('utf-8')
    store.put(files)
    return meta


def pull_peers(store):
    for dev, version in store.versions().items():
        if dev == DEV or not re.fullmatch(r'[a-z0-9-]+', dev): continue
        folder = os.path.join(DEVICES_DIR, dev)
        have = read_json(os.path.join(folder, 'meta.json'), {})
        if have.get('version') == version: continue
        got = store.get(dev, version, ['meta.json', 'save.lua.gz', 'settings.json'])
        if 'meta.json' not in got or 'save.lua.gz' not in got: continue
        meta = json.loads(got['meta.json'].decode('utf-8'))
        raw = gzip.decompress(got['save.lua.gz'])
        if hashlib.sha256(raw).hexdigest() != meta.get('sha256'): raise ValueError(f'{dev}: the save arrived damaged or half-written')
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, 'save.lua.tmp'), 'wb') as f: f.write(raw)
        os.replace(os.path.join(folder, 'save.lua.tmp'), os.path.join(folder, 'save.lua'))
        # settings: the computer where they changed last wins; the replaced file is kept as .bak
        if 'settings.json' in got and meta.get('settingsModified'):
            mine = os.path.join(DATA_DIR, 'settings.json')
            mine_t = datetime.fromtimestamp(os.path.getmtime(mine), timezone.utc).isoformat() if os.path.isfile(mine) else ''
            if meta['settingsModified'] > mine_t:
                json.loads(got['settings.json'].decode('utf-8'))
                if os.path.isfile(mine): shutil.copy2(mine, mine + '.bak')
                with open(mine + '.tmp', 'wb') as f: f.write(got['settings.json'])
                os.replace(mine + '.tmp', mine)
        meta['version'] = version
        meta['downloaded'] = datetime.now(timezone.utc).isoformat()
        write_json(os.path.join(folder, 'meta.json'), meta)
        print(f"sync: got {dev}'s save of {meta.get('saveModified')}", flush=True)


def peers():
    out = []
    if os.path.isdir(DEVICES_DIR):
        for dev in sorted(os.listdir(DEVICES_DIR)):
            m = read_json(os.path.join(DEVICES_DIR, dev, 'meta.json'), None)
            if m and os.path.isfile(os.path.join(DEVICES_DIR, dev, 'save.lua')):
                out.append({k: m.get(k) for k in ('device', 'host', 'os', 'saveModified', 'uploaded', 'downloaded')})
    return out


def sync_status():
    s = sync_cfg()
    return {'here': DEV, 'enabled': bool(s), 'folder': s['folder'] if s else None, 'drives': cloud_drives(), 'peers': peers(), 'lastPush': _sync['lastPush'], 'lastPull': _sync['lastPull'], 'error': _sync['error']}


def sync_loop():
    state = os.path.join(DEVICES_DIR, '.pushed')
    while True:
        time.sleep(SYNC_SECS)
        if not sync_cfg(): continue
        try:
            store = open_store()
            save = find_save()
            # publish this computer's save once the game has finished writing it (10 s quiet)
            if save and time.time() - os.path.getmtime(save) > 10:
                stamp = stamp_of(save)
                pushed = _sync['pushed'] or (open(state).read().strip() if os.path.isfile(state) else None)
                if stamp != pushed:
                    push_save(store, save)
                    os.makedirs(DEVICES_DIR, exist_ok=True)
                    with open(state, 'w') as f: f.write(stamp)
                    _sync['pushed'], _sync['lastPush'] = stamp, datetime.now(timezone.utc).isoformat()
                    print('sync: published the save of', stamp, flush=True)
            if time.time() >= _sync['nextPull']:
                _sync['nextPull'] = time.time() + SYNC_SECS * 4
                pull_peers(store)
                _sync['lastPull'] = datetime.now(timezone.utc).isoformat()
            _sync['error'] = None
        except Exception as e:
            _sync['error'] = str(e)[:300]


# ---------------------------------------------------------------- starting and opening
# Daily use: the app is installed from the browser as its own app (Dock / Launchpad), and this
# server starts by itself at login, hidden (a LaunchAgent), so there is no Terminal window.
# "Claude Companion.app" (next to this file) runs `server.py` once to set that up, restart the
# server after an update, and open the app.
#   server.py             set up the login item, (re)start the server, open the app   (macOS)
#   server.py --serve     just serve (what the login item runs)
#   server.py --uninstall remove the login item and stop the server
LABEL = 'com.claude-companion.server'
AGENT = os.path.expanduser(f'~/Library/LaunchAgents/{LABEL}.plist')
LOG = os.path.expanduser('~/Library/Logs/Claude Companion.log')
LAUNCHER_ID = 'com.claude-companion.launcher'      # our own .app: never "open" it from here


def installed_app():
    # the app as installed from Chrome, Edge or Safari (File > Add to Dock): Apple keeps Safari's in ~/Applications
    import plistlib
    for d in ('~/Applications/Chrome Apps.localized', '~/Applications/Edge Apps.localized', '~/Applications'):
        p = os.path.expanduser(os.path.join(d, 'Claude Companion.app'))
        try:
            with open(os.path.join(p, 'Contents', 'Info.plist'), 'rb') as f:
                if plistlib.load(f).get('CFBundleIdentifier') != LAUNCHER_ID: return p
        except (OSError, ValueError): pass
    return None


def open_app():
    if sys.platform == 'darwin':
        app = installed_app()
        # not installed yet: the default browser, where the page offers to install it as an app
        subprocess.Popen(['open', app or URL]); return
    webbrowser.open(URL)


def running():
    try:
        with urllib.request.urlopen(URL + 'api/ping', timeout=2) as r: return r.read() == b'claude-companion'
    except Exception: return False


def launchctl(*args):
    return subprocess.run(['launchctl', *args], capture_output=True, text=True)


def mac_setup():
    import plistlib
    py = '/usr/bin/python3' if os.path.exists('/usr/bin/python3') else sys.executable
    job = {'Label': LABEL, 'ProgramArguments': [py, os.path.abspath(__file__), '--serve'], 'WorkingDirectory': WEB,
           'RunAtLoad': True, 'KeepAlive': {'SuccessfulExit': False}, 'ProcessType': 'Interactive',
           'StandardOutPath': LOG, 'StandardErrorPath': LOG}
    os.makedirs(os.path.dirname(AGENT), exist_ok=True)
    with open(AGENT, 'wb') as f: plistlib.dump(job, f)
    domain = f'gui/{os.getuid()}'
    launchctl('bootout', f'{domain}/{LABEL}')          # stop the old copy, so an update takes effect
    stop_other_copies()
    for _ in range(20):                                 # bootstrap can fail for a moment right after bootout
        r = launchctl('bootstrap', domain, AGENT)
        if r.returncode == 0: break
        time.sleep(0.25)
    else: raise SystemExit('could not start the login item: ' + (r.stderr or r.stdout).strip())
    for _ in range(40):
        if running(): return
        time.sleep(0.25)
    raise SystemExit(f'the server did not start; see {LOG}')


def stop_other_copies():
    # a copy started some other way (the old Terminal launcher) would keep the port with old code
    r = subprocess.run(['lsof', '-nP', f'-iTCP:{PORT}', '-sTCP:LISTEN', '-t'], capture_output=True, text=True)
    for pid in r.stdout.split():
        cmd = subprocess.run(['ps', '-o', 'command=', '-p', pid], capture_output=True, text=True).stdout
        if 'server.py' in cmd and int(pid) != os.getpid(): subprocess.run(['kill', pid])
    for _ in range(20):
        if not running(): return
        time.sleep(0.25)


def uninstall():
    launchctl('bootout', f'gui/{os.getuid()}/{LABEL}')
    if os.path.exists(AGENT): os.remove(AGENT)
    stop_other_copies()
    print('Claude Companion will no longer start at login, and its server is stopped.')


# ---------------------------------------------------------------- snapshot in the background (#3)
# snapshot.json is built by the app page (one implementation, js/claude.js). When the game saves and
# no app window wrote a snapshot for that save, the server has a hidden (headless) Chrome or Edge
# load the page once, which writes it. The page also keeps its settings (gear weights and picks) in
# companion-data/settings.json, so the hidden one gives the same advice. No such browser: the snapshot
# waits for the app window, and Claude sees that from saveModified.
BROWSERS = {
    'darwin': ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
               '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
}
PROFILE = os.path.join(tempfile.gettempdir(), 'claude-companion-background')


def headless_browser():
    for p in BROWSERS.get(sys.platform, []):
        if os.path.isfile(p): return p
    for name in ('google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'):
        p = shutil.which(name)
        if p: return p
    return None


def snapshot_stamp():
    try:
        with open(os.path.join(DATA_DIR, 'snapshot.json'), encoding='utf-8') as f: return json.load(f).get('saveModified')
    except (OSError, ValueError): return None


def background_snapshot():
    tried = None
    while True:
        time.sleep(5)
        try:
            save = find_save()
            if not save: continue
            stamp = stamp_of(save)
            # up to date, already tried, or saved under 10 s ago (an open app window writes it within seconds)
            if stamp in (tried, snapshot_stamp()) or time.time() - os.path.getmtime(save) < 10: continue
            tried = stamp
            exe = headless_browser()
            if not exe: continue
            args = [exe, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
                    f'--user-data-dir={PROFILE}', '--virtual-time-budget=20000', '--dump-dom', URL + '?background=1']
            if sys.platform.startswith('linux') and os.geteuid() == 0: args.insert(1, '--no-sandbox')
            subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
            print(f'background snapshot for the save of {stamp}: ' + ('written' if snapshot_stamp() == stamp else 'not written'), flush=True)
        except Exception as e:
            print('background snapshot:', e, flush=True)


def serve(open_after):
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print(f'Claude Companion serving {URL} for {FOREVER}', flush=True)
    if not os.path.isdir(os.path.join(FOREVER, 'WTF')):
        print('Note: no WTF folder found next to Interface. Put ClaudeCompanion in _forever_/Interface/AddOns.', flush=True)
    threading.Thread(target=background_snapshot, daemon=True).start()
    threading.Thread(target=auto_update, daemon=True).start()
    threading.Thread(target=sync_loop, daemon=True).start()
    if open_after: open_app()
    try: srv.serve_forever()
    except KeyboardInterrupt: pass


if __name__ == '__main__':
    if '--uninstall' in sys.argv: uninstall()
    elif '--serve' in sys.argv:
        if running(): sys.exit(0)                       # already serving (exit 0: launchd leaves it be)
        serve(open_after=False)
    elif sys.platform == 'darwin':
        mac_setup(); open_app()
    else:                                               # Linux and others: serve here and open the app
        if running(): open_app(); sys.exit(0)
        serve(open_after='--no-open' not in sys.argv)
