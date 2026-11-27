#!/usr/bin/env python3
# Claude Companion app on macOS (and anywhere with Python 3; Windows uses server.ps1).
# macOS: open "Claude Companion.app" once; after that the server starts at login and the app is in the Dock.
# Same small local server as server.ps1, same addresses, so the page is identical:
#   http://localhost:47615   /api/ping  /api/stamp  /api/data  POST /api/snapshot
#                            /api/cards  /api/cards-state  POST /api/cards-state
#                            /api/settings  POST /api/settings
#                            /api/sync  /api/sync-cache  (+ POST): js/sync.js's device key and its copy of the
#                            other computers' history, in companion-data/ (sync.json, sync-cache.json)
#                            /api/combatlog (the game's combat log, read only)  /api/combat (+ POST): js/combatlog.js's counts
#                            /api/claude (+ POST): Claude updating the cards after a save, in the background (#169)
# It serves the app and reads the game's saved file (ClaudeCompanion.lua) directly.
# The server itself only answers this computer. The page syncs history with the backend (js/sync.js).
import glob, json, os, re, shutil, subprocess, sys, tempfile, threading, time, uuid, urllib.error, urllib.parse, urllib.request, webbrowser
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

WEB = os.path.dirname(os.path.abspath(__file__))
FOREVER = os.path.normpath(os.path.join(WEB, '..', '..', '..', '..'))   # .../_forever_
DATA_DIR = os.path.join(os.path.dirname(WEB), 'companion-data')
CARDS_DIR = os.path.join(DATA_DIR, 'from-claude')   # cards.json: Claude writes it; state.json: this app writes it
PORT = int(os.environ.get('CC_PORT') or 47615)   # CC_PORT: only for testing a second copy
# which computer this is: snapshot.json says so, because the PC and the Mac each keep their own save (#11)
import socket
DEVICE_HOST = (socket.gethostname() or '').split('.')[0]
DEVICE_OS = 'mac' if sys.platform == 'darwin' else ('pc' if os.name == 'nt' else sys.platform)
URL = f'http://localhost:{PORT}/'
TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
         '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'}

COMBATLOG_NAME = re.compile(r'^WoWCombatLog[A-Za-z0-9_.-]*\.txt$')
COMBATLOG_CHUNK = 4 * 1024 * 1024
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


_sync_lock = threading.Lock()


def ensure_sync_key(path):
    # this install's sync device key (js/sync.js), made once, here: one place makes it, so an app
    # window and the hidden browser starting at the same moment can't each make their own
    with _sync_lock:
        st = read_json(path, None)
        if isinstance(st, dict) and len(str(st.get('key') or '')) >= 32: return
        st = st if isinstance(st, dict) else {}
        st['key'] = os.urandom(32).hex()
        write_json(path, st)


def stamp_of(path):
    # the save file's modified time; the page copies it into snapshot.json as saveModified
    return datetime.fromtimestamp(os.path.getmtime(path), timezone.utc).isoformat()


_game = {'at': 0.0, 'on': None}


def game_running():
    # is this game client running? (the app says "in game" instead of only "saved N ago"); checked at most every 10 s
    if time.time() - _game['at'] < 10: return _game['on']
    _game['at'] = time.time()
    try:
        if os.name == 'nt': return None
        out = subprocess.run(['ps', '-axo', 'comm='], capture_output=True, text=True, timeout=5).stdout
        root = os.path.realpath(FOREVER)
        _game['on'] = any(l.strip().startswith(root) or l.strip().startswith(FOREVER) for l in out.splitlines())
    except Exception: _game['on'] = None
    return _game['on']


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

    # Only this computer's own page may talk to the server. The socket is on 127.0.0.1 already, but a web
    # page could point its own domain at 127.0.0.1 (DNS rebinding) and then read the save and the sync key
    # as same-origin. Its requests carry that domain as Host, so anything but localhost is turned away
    # (Windows' HttpListener does the same for server.ps1, whose prefix is http://localhost:<port>/).
    def foreign_host(self):
        if (self.headers.get('Host') or '').lower() in (f'localhost:{PORT}', f'127.0.0.1:{PORT}'): return False
        self.send(400, 'bad host')
        return True

    def do_GET(self):
        if self.foreign_host(): return
        path = self.path.split('?')[0]
        if path == '/api/ping': return self.send(200, 'claude-companion')
        if path in ('/api/stamp', '/api/data'):
            save = find_save()
            if path == '/api/stamp':
                dev = {'host': DEVICE_HOST, 'os': DEVICE_OS, 'game': game_running()}
                if not save: return self.send(200, json.dumps({'stamp': None, **dev}), TYPES['.json'])
                return self.send(200, json.dumps({'stamp': stamp_of(save), 'size': os.path.getsize(save), **dev}), TYPES['.json'])
            if not save: return self.send(404, 'no save yet')
            with open(save, 'rb') as f: return self.send(200, f.read(), 'application/octet-stream')
        if path == '/api/update':
            return self.send(200, json.dumps(update_status(force='force=1' in self.path)), TYPES['.json'])
        if path == '/api/combatlog':
            return self.combatlog()
        if path == '/api/claude':
            return self.send(200, json.dumps(run_status(check='check=1' in self.path)), TYPES['.json'])
        if path in ('/api/cards', '/api/cards-state', '/api/settings', '/api/sync', '/api/sync-cache', '/api/combat'):
            f = {'/api/cards': os.path.join(CARDS_DIR, 'cards.json'), '/api/cards-state': os.path.join(CARDS_DIR, 'state.json'),
                 '/api/settings': os.path.join(DATA_DIR, 'settings.json'), '/api/sync': os.path.join(DATA_DIR, 'sync.json'),
                 '/api/sync-cache': os.path.join(DATA_DIR, 'sync-cache.json'), '/api/combat': os.path.join(DATA_DIR, 'combat.json')}[path]
            if path == '/api/sync': ensure_sync_key(f)
            if not os.path.isfile(f): return self.send(204, b'')   # none yet
            with open(f, 'rb') as fh: return self.send(200, fh.read(), TYPES['.json'])
        rel = urllib.request.url2pathname(path.lstrip('/')) or 'index.html'
        if rel == 'index.html' and 'background=1' not in self.path: PAGE['loaded'] = True
        full = os.path.realpath(os.path.join(WEB, rel))
        # only files inside the app folder, and never the server scripts
        if full.startswith(os.path.realpath(WEB) + os.sep) and os.path.isfile(full) and not full.endswith(('.ps1', '.py')):
            with open(full, 'rb') as f:
                return self.send(200, f.read(), TYPES.get(os.path.splitext(full)[1].lower(), 'text/plain; charset=utf-8'))
        self.send(404, 'not found')

    # The game's combat log (_forever_/Logs/WoWCombatLog*.txt, written only while /combatlog is on), read
    # by js/combatlog.js: no ?file= lists the logs, newest first; ?file=<name>&from=<byte> gives up to
    # 4 MB from there. Only names the game gives its logs, only that folder; the page keeps per-creature
    # counts from it and nothing else (no player names, no lines).
    def combatlog(self):
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        logs = os.path.join(FOREVER, 'Logs')
        name = (q.get('file') or [None])[0]
        if name is None:
            out = []
            for h in glob.glob(os.path.join(logs, 'WoWCombatLog*.txt')):
                if not COMBATLOG_NAME.fullmatch(os.path.basename(h)): continue
                try: out.append({'name': os.path.basename(h), 'size': os.path.getsize(h), 'mtime': int(os.path.getmtime(h))})
                except OSError: pass   # the game removed it meanwhile
            out = sorted(out, key=lambda x: x['mtime'], reverse=True)[:20]
            return self.send(200, json.dumps({'files': out}), TYPES['.json'])
        try: start = max(0, int((q.get('from') or ['0'])[0]))
        except ValueError: return self.send(400, 'bad from')
        full = os.path.join(logs, name)
        if not COMBATLOG_NAME.fullmatch(name) or not os.path.isfile(full): return self.send(404, 'no such log')
        with open(full, 'rb') as f:
            f.seek(min(start, os.fstat(f.fileno()).st_size))
            return self.send(200, f.read(COMBATLOG_CHUNK), 'application/octet-stream')

    def do_POST(self):
        if self.foreign_host(): return
        # the page's summary for Claude: ../companion-data/snapshot.json, and what you did with
        # Claude's cards: ../companion-data/from-claude/state.json (see SCHEMA.md there).
        # Only this app sends the X-CC header; a web page can't add it without the browser asking first.
        n = int(self.headers.get('Content-Length') or 0)
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
        if self.path.split('?')[0] == '/api/claude':
            if self.headers.get('X-CC') != '1' or n <= 0 or n > 2 * 1024 * 1024: return self.send(400, 'bad request')
            try: body = json.loads(self.rfile.read(n).decode('utf-8'))
            except ValueError: return self.send(400, 'bad request')
            r = claude_post(body if isinstance(body, dict) else {})
            return self.send(200, json.dumps(r), TYPES['.json']) if r is not None else self.send(400, 'bad request')
        target = {'/api/snapshot': (DATA_DIR, 'snapshot.json'), '/api/cards-state': (CARDS_DIR, 'state.json'),
                  '/api/settings': (DATA_DIR, 'settings.json'), '/api/sync': (DATA_DIR, 'sync.json'),
                  '/api/sync-cache': (DATA_DIR, 'sync-cache.json'), '/api/combat': (DATA_DIR, 'combat.json'),
                  '/api/claude-cards': (RUN_DIR, 'cards-now.json')}.get(self.path.split('?')[0])
        if not target or self.headers.get('X-CC') != '1' or n <= 0 or n > write_cap(self.path.split('?')[0]):
            return self.send(400, 'bad request')
        folder, name = target
        os.makedirs(folder, exist_ok=True)
        # one temp file per request: the server is threaded, and two writes of the same file sharing one temp
        # name could rename a half-written copy into place (an empty snapshot.json)
        tmp = os.path.join(folder, '%s.%d.%s.tmp' % (name, threading.get_ident(), uuid.uuid4().hex[:8]))
        with open(tmp, 'wb') as f:
            left = n
            while left > 0:
                chunk = self.rfile.read(min(left, 1024 * 1024))
                if not chunk: break
                f.write(chunk); left -= len(chunk)
        if left > 0:
            os.remove(tmp)
            return self.send(400, 'bad request')
        os.replace(tmp, os.path.join(folder, name))
        self.send(200, 'ok')


def write_cap(path):
    # what the page may save: 20 MB a file, but sync-cache.json holds every record of the account (an account
    # with a few weeks of AH scans: 250,000 records, 81 MB on 27 Nov), so it may be up to 400 MB
    return (400 if path == '/api/sync-cache' else 20) * 1024 * 1024


# ---------------------------------------------------------------- updates
# The app updates itself from the project's "stable" branch: each tested build is pushed there
# (tools/publish-stable.py) as the ClaudeCompanion folder plus BUILD.json, which lists every file's
# SHA-256. The server checks the branch's newest commit every 30 minutes (and when the page asks), and
# installs it by itself when "auto" is on (the default), or when you click Install. Every file is
# checked against BUILD.json before anything is copied.
# Installing: download, check the zip has the whole addon, copy the current addon folder to a backup
# (the last 5 are kept), then copy the new files over it. Never touched: companion-data/ (your
# snapshot, settings, Claude's cards; only its SCHEMA.md is updated) and the game's saved data (WTF/).
# Files an older build had and this one doesn't are removed (they are in the backup). Afterwards the server restarts itself on the new code;
# the addon's own Lua takes effect at the next /reload in game.
# Builds name where they keep updating from in web/channel.json: "url", the public download folder
# (latest.json + the zip; no token, the normal case), else a GitHub repository's stable branch, which
# for the private repository needs a token: companion-data/update.json "token", else CC_GITHUB_TOKEN,
# else the GitHub CLI's (`gh auth token`).
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
    tmp = '%s.%d.%s.tmp' % (path, threading.get_ident(), uuid.uuid4().hex[:8])
    with open(tmp, 'w', encoding='utf-8') as f: json.dump(data, f, indent=1)
    os.replace(tmp, path)


def upd_cfg():
    # where updates come from: web/channel.json, written by the build (the private repository for
    # Gabriel's builds, the public download repository for everyone else's); update.json can override
    c = {'repo': REPO, 'auto': True, 'branch': 'stable', 'api': 'https://api.github.com'}   # api: only changed for testing
    c.update({k: v for k, v in read_json(os.path.join(WEB, 'channel.json'), {}).items() if k in ('repo', 'branch', 'url')})
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
    # downloads (zipballs) answer 415 to "application/octet-stream": ask for */* and follow the redirect
    req = urllib.request.Request(url, headers={'Accept': '*/*' if accept == 'application/octet-stream' else accept, 'User-Agent': 'claude-companion',
                                               'X-GitHub-Api-Version': '2022-11-28'})
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
    if cfg.get('url'): return check_url(cfg)
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


_game_build = {'key': None, 'build': None}


def builds():
    # which build the app runs (web/channel.json, written by the build) and which the game ran at its
    # last save (the addon writes ClaudeCompanionDB.addonBuild): they differ until a /reload in game
    app = read_json(os.path.join(WEB, 'channel.json'), {}).get('build')
    game, path = None, find_save()
    if path:
        key = (path, os.path.getmtime(path))
        if _game_build['key'] != key:
            m = None
            try:
                with open(path, 'rb') as f: m = re.search(rb'\["addonBuild"\]\s*=\s*"([0-9A-Za-z]{1,40})"', f.read())
            except OSError: pass
            _game_build.update(key=key, build=m.group(1).decode() if m else '')   # '': a save from before 1.5
        game = _game_build['build']
    return {'app': app, 'game': game}


def check_url(cfg):
    # the public download folder (web/channel.json "url"): latest.json names the newest build and its zip.
    # Public to read, so no token is ever sent there.
    base = cfg['url'].rstrip('/') + '/'
    try:
        m = gh_get(base + 'latest.json', None)
        latest = {'tag': str(m['tag']), 'sha': m['sha'], 'name': str(m.get('name') or m['tag'])[:120], 'published': m.get('published'),
                  'notes': str(m.get('name') or '')[:3000], 'build': m.get('build'), 'zip': base + m['zip']}
        _upd['latest'], _upd['error'] = latest, None
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):   # nothing published there yet: not a problem
            _upd['latest'], _upd['error'] = None, None
            return None
        _upd['error'] = 'The download folder said %d.' % e.code
    except Exception as e:
        _upd['error'] = 'Could not reach the download folder: %s' % e
    return _upd['latest']


def update_status(force=False):
    latest = check_update(force)
    inst = read_json(INSTALLED, {})
    cfg = upd_cfg()
    return {'installed': inst or None, 'latest': latest, 'available': bool(latest and latest['tag'] != inst.get('tag')), 'builds': builds(),
            'auto': bool(cfg.get('auto', True)), 'busy': _upd['busy'], 'error': _upd['error'], 'last': _upd['last'],
            'checked': datetime.fromtimestamp(_upd['checked'], timezone.utc).isoformat() if _upd['checked'] else None}


def prune(addon, ship):
    # files in the addon folder that the build doesn't have (outside companion-data/): left over from an
    # older build, so they go (the backup made just before keeps them). Returns how many were removed.
    n = 0
    for root, dirs, files in os.walk(addon, topdown=True):
        rel = os.path.relpath(root, addon).replace(os.sep, '/')
        if rel == 'companion-data' or rel.startswith('companion-data/'): dirs[:] = []; continue
        for f in files:
            r = f if rel == '.' else rel + '/' + f
            if r not in ship:
                try: os.remove(os.path.join(root, f)); n += 1
                except OSError: pass
    for root, dirs, files in os.walk(addon, topdown=False):   # then folders left empty
        if root != addon and not os.listdir(root) and not os.path.relpath(root, addon).startswith('companion-data'):
            try: os.rmdir(root)
            except OSError: pass
    return n


def install_update():
    import zipfile
    if _upd['busy']: return {'ok': False, 'error': 'An update is already being installed.'}
    _upd['busy'] = True
    try:
        latest = check_update(force=True)
        if not latest: return {'ok': False, 'error': _upd['error'] or 'No build found.'}
        cfg = upd_cfg()
        if latest.get('zip'): data = gh_get(latest['zip'], None, 'application/octet-stream')
        else: data = gh_get(f"{cfg['api']}/repos/{cfg['repo']}/zipball/{latest['sha']}", gh_token(cfg), 'application/octet-stream')
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
        if latest.get('build') and build.get('build') != latest['build']: raise ValueError('the download is a different build than announced; trying again later')
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
        # copy exactly the build's files (BUILD.json), then remove what an earlier build had and this one
        # doesn't, so no old file lingers; companion-data/ is yours and only its SCHEMA.md is the build's
        ship = set(build['files'])
        copied = 0
        for rel in sorted(ship):
            parts = rel.split('/')
            if parts[0] == 'companion-data' and rel != 'companion-data/SCHEMA.md': continue
            dest = os.path.join(ADDON, *parts)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy2(os.path.join(src, *parts), dest)
            if parts[-1] == 'launcher' or rel.endswith(('.command', '.sh')): os.chmod(dest, 0o755)   # zips don't keep the run bit
            copied += 1
        removed = prune(ADDON, ship)
        shutil.rmtree(work, ignore_errors=True)
        info = {'tag': latest['tag'], 'sha': latest['sha'], 'version': build.get('version'), 'at': datetime.now(timezone.utc).isoformat(), 'backup': backup, 'files': copied, 'removed': removed,
                'build': build.get('build')}
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
    port_error()
    raise SystemExit(f'the server did not start; see {LOG}')


PORT_ERROR = (f"Claude Companion couldn't start its server on port {PORT}. Is another program using it? "
              'Close that program, then open Claude Companion again.')


def port_taken():
    # something other than this app answers or listens on the port
    if running(): return False
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try: s.bind(('127.0.0.1', PORT)); return False
        except OSError: return True


def port_error():
    # said where the player looks (the same words as server.ps1's Show-PortError); only when the port is taken
    if not port_taken(): return
    print(PORT_ERROR, flush=True)
    if sys.platform == 'darwin':
        msg = PORT_ERROR.replace('\\', '\\\\').replace('"', '\\"')
        subprocess.run(['osascript', '-e', f'display dialog "{msg}" with title "Claude Companion" buttons {{"OK"}} default button "OK"'],
                       capture_output=True)


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


# Has an app window loaded the page since this server started? The server restarts after every
# update, so a window left open from before still runs the old page (it can't reload itself if it
# predates that code). Until one loads, the hidden browser runs after each new save even though a
# window wrote snapshot.json, so the current page's work (sync, the snapshot online) still happens.
PAGE = {'loaded': False}


def background_due(stamp, tried, snap, page_loaded, age):
    # a save not tried yet, at least 10 s old (an open, current window writes the snapshot within
    # seconds), and either no snapshot of it yet or no window since this server started
    return stamp != tried and age >= 10 and (stamp != snap or not page_loaded)


def background_snapshot():
    tried = None
    while True:
        time.sleep(5)
        try:
            save = find_save()
            if not save: continue
            stamp = stamp_of(save)
            # up to date, already tried, or saved under 10 s ago (an open app window writes it within seconds)
            forced = PAGE.pop('force', False)   # a Claude run wrote cards.json: a page has to send it (claude_runner)
            if not forced and not background_due(stamp, tried, snapshot_stamp(), PAGE['loaded'], time.time() - os.path.getmtime(save)): continue
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


# ---------------------------------------------------------------- Claude updates the cards (#169)
# Opt-in, per computer (System tab). After a save whose change is worth it (js/cardsteps.js worthRun), the page
# posts it here (POST /api/claude {action: 'save'}) and this server starts the player's own Claude Code, signed in
# with their own Claude plan, in the background: `claude -p` in the addon folder with claude/REFRESH.md as its
# instructions. It can read the folder and write only companion-data/from-claude/ (no commands, no web, no MCP
# servers, no user or project settings: RUN_ARGS, plus --restricted where the installed Claude Code has it). It writes the whole card list to cards.draft.json; when it
# exits, the draft becomes cards.json, the page sends that through the account's card gate (js/sync.js pushCards,
# public.cc_put_cards) and saves the answer in from-claude/state.json `upload`. A refusal goes back to the same
# Claude session (--resume) with what the gate said, at most twice. One run at a time; saves during a run give one
# more run after it; at most RUN_CAP runs a day. The same in server.ps1 (test/web/server-api.test.js runs both).
# Everything it keeps is in companion-data/claude-run/ (SCHEMA.md, "Claude updates the cards").
RUN_DIR = os.path.join(DATA_DIR, 'claude-run')
RUN_STATE = os.path.join(RUN_DIR, 'state.json')
RUN_CAP, RUN_TIMEOUT, RUN_FIXES, RUN_GATE_WAIT, RUN_TURNS = 24, 15 * 60, 2, 180, 40
RUN_PROMPT = 'The game saved. Follow claude/REFRESH.md exactly.'
RUN_FIX = 'The card check refused your cards (now companion-data/from-claude/cards.json). Read companion-data/claude-run/run.json (refusal), fix exactly what it names, and write the whole list to companion-data/from-claude/cards.draft.json again.'
# The limits come from flags every recent Claude Code has: no settings files (so no hooks, plugins or allow rules of
# the player's own), no MCP servers, no skills, only the file tools (and never a command or the web), reads that
# dontAsk lets through only inside the addon folder, and one file it may write. --restricted (Claude Code 2.1.248)
# adds its own hardening on top, only where `claude --help` lists it: an older Claude Code stops at an unknown option.
# Before a run, claude_flags() checks every flag here against `claude --help`: a Claude Code without one of them gets
# no run and the System tab says which flag and what to do.
RUN_ARGS = ['--setting-sources=', '--strict-mcp-config', '--disable-slash-commands', '--tools', 'Read,Glob,Grep,Write,Edit',
            '--disallowedTools', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch',
            '--allowedTools', 'Read(./**)', 'Edit(./companion-data/from-claude/cards.draft.json)',
            '--permission-mode', 'dontAsk', '--max-turns', str(RUN_TURNS), '--output-format', 'json']
# what --help must name; --max-turns works but --help doesn't list it (2.1.332), so only a run's "unknown option" tells
RUN_NEED = [f for f in (a.split('=')[0] for a in RUN_ARGS if a.startswith('--')) if f != '--max-turns'] + ['dontAsk']
RUN_EXTRA = '--restricted'
# a key in the environment would bill an API account instead of the player's plan (claude -p always uses one)
RUN_ENV_DROP = ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN')
_run = {'proc': None, 'job': None, 'started': 0.0, 'queue': None, 'gate': None, 'signed': None, 'signedAt': 0.0}
_run_lock = threading.RLock()


def claude_exe():
    # CC_CLAUDE: only for tests. The installer puts it in ~/.local/bin and doesn't change PATH (nor does launchd's)
    for p in (os.environ.get('CC_CLAUDE'), shutil.which('claude'), os.path.expanduser('~/.local/bin/claude')):
        if p and os.path.isfile(p) and os.access(p, os.X_OK): return p
    return None


def claude_env():
    env = dict(os.environ)
    for k in RUN_ENV_DROP: env.pop(k, None)
    return env


def help_has(text, word):
    return re.search(r'(?<![\w-])' + re.escape(word) + r'(?![\w-])', text) is not None


def claude_flags(exe):
    # which of the run's flags the installed Claude Code knows, from its --help; kept until the program changes
    # (an update replaces it). {'version', 'missing': [flags], 'restricted'}; missing None when --help didn't answer
    try:
        real = os.path.realpath(exe); s = os.stat(real); key = (real, s.st_mtime, s.st_size)
    except OSError: key = (exe,)
    with _run_lock:
        if _run.get('flagsKey') == key: return _run['flags']
    out = {'version': None, 'missing': None, 'restricted': False}
    try:
        h = subprocess.run([exe, '--help'], capture_output=True, text=True, timeout=30, env=claude_env(), cwd=os.path.dirname(WEB),
                           stdin=subprocess.DEVNULL)
        text = (h.stdout or '') + (h.stderr or '')
        if h.returncode == 0 and '--print' in text:
            out['missing'] = [f for f in RUN_NEED if not help_has(text, f)]
            out['restricted'] = help_has(text, RUN_EXTRA)
        v = subprocess.run([exe, '--version'], capture_output=True, text=True, timeout=30, env=claude_env(), cwd=os.path.dirname(WEB),
                           stdin=subprocess.DEVNULL)
        m = re.search(r'\d+\.\d+\.\d+', v.stdout or '')
        out['version'] = m.group(0) if m else None
    except Exception: pass
    with _run_lock: _run['flagsKey'], _run['flags'] = key, out
    return out


def too_old(version, flags):
    return (f'Claude Code {version or "(version unknown)"} on this computer is too old for the card updates: it has no '
            + ', '.join(flags) + '. System tab, Update Claude Code')


def utc_now(): return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def run_state():
    st = read_json(RUN_STATE, {})
    return st if isinstance(st, dict) else {}


def run_save(st): write_json(RUN_STATE, st)


# Older Claude Code could sign you out when a short command (`claude auth status`) exited during a token refresh: the
# server rotated the refresh token and the new one was never saved (Claude Code 2.1.301 and 2.1.317 fixed it). A run
# then fails with "401 OAuth access token has expired". So: `claude auth status` runs at most once per server start
# and when the System tab waits for a sign-in, it is never killed, and an older Claude Code is updated first.
RUN_MIN = (2, 1, 317)
AUTH_FAILED = ('failed to authenticate', 'not logged in', 'please run /login', 'login expired', 'invalid api key', 'oauth token',
               'access token has expired', 'token has expired', 'token revoked', 'authentication_error', 'claude auth login')


def ver_tuple(v):
    try: return tuple(int(x) for x in str(v).split('.')[:3])
    except (TypeError, ValueError): return None


def cred_stamp():
    # when the stored sign-in last changed (Windows and Linux keep it in a file; macOS in the keychain: None)
    cfg = (run_state().get('claude') or {}).get('config') or os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude')
    try: return os.path.getmtime(os.path.join(cfg, '.credentials.json'))
    except OSError: return None


def auth_status(exe):
    # `claude auth status`, never killed (a kill during a token refresh is what signed people out): after 60 s the
    # answer is "not known yet" and the command finishes on its own
    p = subprocess.Popen([exe, 'auth', 'status'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
                         text=True, env=claude_env())
    try: out, _ = p.communicate(timeout=60)
    except subprocess.TimeoutExpired:
        threading.Thread(target=p.communicate, daemon=True).start()
        return None
    try: d = json.loads(out or '{}')
    except ValueError: d = {}
    if d.get('configDirectory'):
        st = run_state(); c = st.get('claude') if isinstance(st.get('claude'), dict) else {}
        if c.get('config') != d['configDirectory']: c['config'] = d['configDirectory']; st['claude'] = c; run_save(st)
    return bool(d.get('loggedIn')) and p.returncode == 0


def signed_in(force=False):
    # signed in to Claude on this computer? A run that failed to sign in marks it (state.json `signin`) until the sign-in
    # changes (Reconnect) or a run works. Otherwise `claude auth status`, asked once per server start, and again only
    # while the System tab waits for a sign-in (force)
    exe = claude_exe()
    if not exe: return None
    need = run_state().get('signin')
    if isinstance(need, dict) and need.get('needed'):
        stamp = cred_stamp()
        changed = stamp is not None and stamp != need.get('cred')
        # no file to watch (macOS): after Reconnect, the keychain's answer
        if not changed and stamp is None and force and need.get('connect') and auth_status(exe): changed = True
        if not changed: return False
        st = run_state(); st.pop('signin', None); run_save(st)
        with _run_lock: _run['signed'], _run['signedAt'] = True, time.time()
        return True
    with _run_lock:
        if _run['signedAt'] and not (force and _run['signed'] is not True): return _run['signed']
    ok = auth_status(exe)
    with _run_lock: _run['signed'], _run['signedAt'] = ok, time.time()
    return ok


def sign_in_needed(why):
    st = run_state()
    st['signin'] = {'needed': True, 'at': utc_now(), 'why': why[:300], 'cred': cred_stamp()}
    run_save(st)
    with _run_lock: _run['signed'], _run['signedAt'] = False, time.time()


def claude_update(exe, version):
    # an older Claude Code than RUN_MIN: `claude update`, hidden, at most once a day for a version (the player's own
    # install; Claude Code updates itself the same way when it runs in a terminal)
    st = run_state(); c = st.get('claude') if isinstance(st.get('claude'), dict) else {}
    tried = c.get('update') or {}
    if tried.get('from') == version and str(tried.get('at') or '')[:10] == utc_now()[:10]: return
    c['update'] = {'at': utc_now(), 'from': version}; st['claude'] = c; run_save(st)
    try:
        r = subprocess.run([exe, 'update'], capture_output=True, text=True, timeout=600, env=claude_env(), stdin=subprocess.DEVNULL)
        res = {'ok': r.returncode == 0, 'out': ((r.stdout or '') + (r.stderr or '')).strip()[-300:]}
    except Exception as e: res = {'ok': False, 'out': str(e)[:300]}
    with _run_lock: _run['flagsKey'] = None
    st = run_state(); c = st.get('claude') if isinstance(st.get('claude'), dict) else {}
    c['update'] = dict(c.get('update') or {}, **res); st['claude'] = c; run_save(st)
    print(f'claude update from {version}: {res}', flush=True)


def run_status(check=False):
    exe = claude_exe()
    signed = signed_in(check) if exe else None   # first (it may clear `signin`), and outside the lock: auth status can take a while
    st = run_state()
    today = st.get('today') or {}
    with _run_lock:
        out = {'on': bool(st.get('on')), 'claude': bool(exe), 'signedIn': signed,
               'running': _run['proc'] is not None, 'started': st.get('started') if _run['proc'] else None,
               'queued': _run['queue'] is not None, 'checking': _run['gate'] is not None,
               'last': st.get('last'), 'tooOld': None, 'signin': st.get('signin') if isinstance(st.get('signin'), dict) else None, 'runs': today.get('n', 0) if today.get('date') == utc_now()[:10] else 0, 'cap': RUN_CAP,
               'digests': st.get('digests') or {}}
    if exe and out['signedIn']:
        f = claude_flags(exe)
        if f['missing']: out['tooOld'] = {'version': f['version'], 'missing': f['missing']}
    return out


def sync_off():
    return bool((read_json(os.path.join(DATA_DIR, 'sync.json'), {}) or {}).get('off'))


def run_queue(job):
    # one run waits at most: a newer save replaces what it carries (the run reads the newest snapshot anyway)
    with _run_lock:
        q = _run['queue']
        if q and q.get('why') == 'refused' and job.get('why') != 'refused': return
        _run['queue'] = job


def cards_now():
    # claude-run/cards-now.json, the list the run rewrites, as written by the page at the save; then cards.json on top,
    # card by card where it is newer (`updated`): a run that ended after the page wrote the list (one queued behind
    # it) starts from the cards that run wrote, not from the list before them
    path = os.path.join(RUN_DIR, 'cards-now.json')
    now = read_json(path, None)
    if not (isinstance(now, dict) and isinstance(now.get('cards'), list)): return None
    mine = read_json(os.path.join(CARDS_DIR, 'cards.json'), None)
    mine = [c for c in (mine.get('cards') if isinstance(mine, dict) else None) or [] if isinstance(c, dict) and c.get('id')]
    if not mine: return now
    at = {c.get('id'): i for i, c in enumerate(now['cards']) if isinstance(c, dict)}
    changed = False
    for c in mine:
        i = at.get(c['id'])
        if i is None: now['cards'].append(c); changed = True
        elif str(c.get('updated') or '') > str(now['cards'][i].get('updated') or ''): now['cards'][i] = c; changed = True
    if changed: write_json(path, now)
    return now


def card_ids(d): return {c.get('id') for c in d['cards'] if isinstance(c, dict)}


def run_start(job):
    st = run_state()

    def last(why):   # not started, and why
        st['last'] = {'at': utc_now(), 'ok': False, 'why': job.get('why'), 'error': why}
        run_save(st)
    if not st.get('on'): return
    exe = claude_exe()
    if not exe: return last('Claude Code is not installed on this computer (System tab: Connect)')
    if sync_off(): return last('sync is off on this computer: the cards are checked online, so turn sync on')
    if (st.get('signin') or {}).get('needed'): return last('signed out of Claude on this computer: System tab, Reconnect')
    flags = claude_flags(exe)
    v = ver_tuple(flags['version'])
    if v and v < RUN_MIN:
        claude_update(exe, flags['version'])
        flags = claude_flags(exe)
        st = run_state()
    if flags['missing']: return last(too_old(flags['version'], flags['missing']))
    day = utc_now()[:10]
    today = st.get('today') if (st.get('today') or {}).get('date') == day else {'date': day, 'n': 0}
    if today['n'] >= RUN_CAP and job.get('why') != 'refused': return last(f'{RUN_CAP} runs today already: the next one waits for tomorrow (UTC)')
    os.makedirs(RUN_DIR, exist_ok=True)
    draft = os.path.join(CARDS_DIR, 'cards.draft.json')
    if job.get('why') != 'refused' and os.path.exists(draft): os.remove(draft)
    if job.get('why') != 'refused': cards_now()
    write_json(os.path.join(RUN_DIR, 'run.json'), {'schema': 1, 'now': utc_now(), 'why': job.get('why'), 'wake': job.get('wake'),
                                                   'refusal': job.get('refusal'), 'fix': job.get('fixes', 0)})
    args = ([exe, '-p', RUN_FIX if job.get('resume') else RUN_PROMPT] + ([RUN_EXTRA] if flags['restricted'] else []) + RUN_ARGS
            + (['--resume', job['resume']] if job.get('resume') else []))
    out = open(os.path.join(RUN_DIR, 'out.json'), 'w', encoding='utf-8')
    err = open(os.path.join(RUN_DIR, 'err.txt'), 'w', encoding='utf-8')
    try:
        proc = subprocess.Popen(args, cwd=os.path.dirname(WEB), env=claude_env(), stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                                start_new_session=(os.name != 'nt'))
    except OSError as e:
        out.close(); err.close()
        return last(f'Claude Code did not start: {e}')
    today['n'] += 1
    st['today'], st['started'] = today, utc_now()
    st['claude'] = dict(st.get('claude') if isinstance(st.get('claude'), dict) else {}, version=flags['version'], restricted=flags['restricted'])
    run_save(st)
    with _run_lock: _run.update(proc=proc, job=job, started=time.time(), files=(out, err))
    print(f'claude run started ({job.get("why")})', flush=True)


def run_finish():
    with _run_lock:
        proc, job, files = _run['proc'], _run['job'], _run.get('files')
    for f in files or (): f.close()
    res = read_json(os.path.join(RUN_DIR, 'out.json'), None)
    res = res if isinstance(res, dict) else {}
    try:
        with open(os.path.join(RUN_DIR, 'err.txt'), encoding='utf-8', errors='replace') as f: err = f.read()[-2000:]
    except OSError: err = ''
    text = (str(res.get('result') or '') + ' ' + err).lower()
    last = {'at': utc_now(), 'started': run_state().get('started'), 'why': job.get('why'), 'code': proc.returncode,
            'session': res.get('session_id'), 'turns': res.get('num_turns'), 'denied': len(res.get('permission_denials') or [])}
    failed = proc.returncode != 0 or bool(res.get('is_error'))
    signed_out = failed and (res.get('api_error_status') in (401, 403) and any(x in text for x in AUTH_FAILED) or any(x in text for x in AUTH_FAILED[:3]))
    draft, wrote = os.path.join(CARDS_DIR, 'cards.draft.json'), False
    if proc.returncode == 0 and not res.get('is_error') and os.path.exists(draft):
        try:
            with open(draft, encoding='utf-8') as f: d = json.load(f)
            if not (isinstance(d, dict) and isinstance(d.get('cards'), list)): raise ValueError('no cards list')
            # a card left out would be taken off every computer: every card the run was given must still be there
            given = read_json(os.path.join(RUN_DIR, 'cards-now.json'), None)
            if isinstance(given, dict) and isinstance(given.get('cards'), list):
                gone = card_ids(given) - card_ids(d)
                if gone: raise ValueError('it left out %d card%s' % (len(gone), '' if len(gone) == 1 else 's'))
            target = os.path.join(CARDS_DIR, 'cards.json')
            with open(draft, 'rb') as f: new_bytes = f.read()
            try:
                with open(target, 'rb') as f: same = f.read() == new_bytes
            except OSError: same = False
            os.replace(draft, target)
            wrote, last['cards'] = not same, len(d['cards'])
            if same: last['gate'] = 'no change'
        except (OSError, ValueError) as e:
            last['error'] = f'the cards Claude wrote were not used ({e})'
            os.replace(draft, os.path.join(CARDS_DIR, 'cards.draft.bad.json'))
    elif proc.returncode != 0 or res.get('is_error'):
        unknown = re.findall(r"unknown option '([^']+)'", err)
        if unknown:
            # --help named it but the run didn't take it: ask again before the next run
            with _run_lock: _run['flagsKey'] = None
            last['error'] = too_old((run_state().get('claude') or {}).get('version'), unknown)
        elif signed_out: last['error'] = 'signed out of Claude on this computer: System tab, Reconnect'
        else: last['error'] = 'Claude stopped: ' + (str(res.get('result') or err).strip()[:300] or f'exit {proc.returncode}')
    last['ok'], last['wrote'] = 'error' not in last, wrote
    st = run_state(); st['last'] = last; run_save(st)
    with _run_lock:
        _run.update(proc=None, job=None, files=None)
        if wrote:
            # the page sends the new file through the gate; no window open: the hidden browser does it
            _run['gate'] = {'since': last['at'], 'until': time.time() + RUN_GATE_WAIT, 'session': last['session'], 'fixes': job.get('fixes', 0)}
            PAGE['force'] = True
    if signed_out: sign_in_needed(str(res.get('result') or err).strip())
    elif not failed and (run_state().get('signin') or {}).get('needed'):
        st = run_state(); st.pop('signin', None); run_save(st)
    print(f'claude run ended: {last}', flush=True)


def run_gate():
    # how the gate took the new cards.json: from-claude/state.json `upload`, written by the page after the send
    with _run_lock: g = _run['gate']
    if not g: return
    up = (read_json(os.path.join(CARDS_DIR, 'state.json'), {}) or {}).get('upload') or {}
    fresh = isinstance(up, dict) and str(up.get('at') or '') >= g['since'].replace('Z', '')[:19]
    if not fresh:
        if time.time() > g['until']:
            st = run_state(); (st.get('last') or {})['gate'] = 'not sent yet: it goes with the next sync'; run_save(st)
            with _run_lock: _run['gate'] = None
        return
    with _run_lock: _run['gate'] = None
    st = run_state(); last = st.get('last') or {}
    last['gate'] = 'ok' if up.get('ok') else ('refused: ' + str(up.get('error') or '')[:500]) if up.get('refused') else 'not sent: ' + str(up.get('error') or '')[:300]
    run_save(st)
    if up.get('refused') and g['session'] and g['fixes'] < RUN_FIXES:
        run_queue({'why': 'refused', 'refusal': up.get('error'), 'resume': g['session'], 'fixes': g['fixes'] + 1})


def claude_runner():
    while True:
        time.sleep(2)
        try:
            with _run_lock: proc, started = _run['proc'], _run['started']
            if proc is not None:
                if proc.poll() is None:
                    if time.time() - started > RUN_TIMEOUT: proc.kill()
                    continue
                run_finish()
            run_gate()
            with _run_lock:
                job = _run['queue'] if _run['gate'] is None else None
                if job: _run['queue'] = None
            if job: run_start(job)
        except Exception as e:
            print('claude run:', e, flush=True)


def run_save_digest(body):
    # the page's news after a save: this character's digest (kept for the next save's change) and whether the change
    # is worth a run. Before it, the page wrote every card it has to claude-run/cards-now.json (POST /api/claude-cards,
    # as it is: Claude rewrites that list)
    st = run_state()
    name, digest = body.get('name'), body.get('digest')
    if not name or not isinstance(digest, dict): return
    digests = st.get('digests') if isinstance(st.get('digests'), dict) else {}
    prev = digests.get(name) or {}
    if (digest.get('t') or 0) <= (prev.get('t') or 0): return   # another window already told this save
    digests[name] = digest; st['digests'] = digests; run_save(st)
    if body.get('worth') and st.get('on'): run_queue({'why': 'save', 'wake': body.get('wake')})


def claude_connect():
    # the player's own sign-in, in a window they can see: install Claude Code first if it isn't here
    exe = claude_exe()
    st = run_state()
    if isinstance(st.get('signin'), dict): st['signin']['connect'] = utc_now(); run_save(st)
    if sys.platform == 'darwin':
        import shlex
        # installed: update it first (a version without a flag the run needs gets no run: claude_flags); the sign-in
        # only when it isn't signed in
        signed = bool(exe) and signed_in(True)
        login = '' if signed else (shlex.quote(exe) if exe else '~/.local/bin/claude') + ' auth login'
        cmd = ('echo "Claude Companion: ' + ('updating Claude Code' if signed else 'signing in to Claude') + ', for the cards updates."; ' +
               (shlex.quote(exe) + ' update; ' if exe else 'curl -fsSL https://claude.ai/install.sh | bash && ') + login)
        subprocess.Popen(['osascript', '-e', f'tell application "Terminal" to do script {json.dumps(cmd)}', '-e', 'tell application "Terminal" to activate'])
        with _run_lock: _run['signedAt'], _run['flagsKey'] = 0.0, None
        return {'ok': True}
    return {'ok': False, 'error': 'Open a terminal and run: ' + ('claude update, then claude auth login' if exe else 'curl -fsSL https://claude.ai/install.sh | bash, then claude auth login')}


def claude_post(body):
    a = body.get('action')
    if a in ('on', 'off'):
        st = run_state(); st['on'] = a == 'on'; run_save(st)
    elif a == 'connect': return claude_connect()
    elif a == 'run': run_queue({'why': 'asked'})
    elif a == 'save': run_save_digest(body)
    else: return None
    return run_status()


def serve(open_after):
    try: srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError:
        # another program holds the port. Exit 0, so launchd doesn't restart this copy over and over; the
        # one opening the app (mac_setup, or this when it opens the app) tells the player (#18)
        if open_after: port_error()
        else: print(PORT_ERROR, flush=True)
        sys.exit(0)
    print(f'Claude Companion serving {URL} for {FOREVER}', flush=True)
    if not os.path.isdir(os.path.join(FOREVER, 'WTF')):
        print('Note: no WTF folder found next to Interface. Put ClaudeCompanion in _forever_/Interface/AddOns.', flush=True)
    if os.environ.get('CC_BACKGROUND') != '0':          # CC_BACKGROUND=0: only for tests (no hidden browser)
        threading.Thread(target=background_snapshot, daemon=True).start()
    threading.Thread(target=auto_update, daemon=True).start()
    threading.Thread(target=claude_runner, daemon=True).start()
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
