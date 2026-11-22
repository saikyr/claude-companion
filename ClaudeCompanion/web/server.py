#!/usr/bin/env python3
# Claude Companion app on macOS (and anywhere with Python 3; Windows uses server.ps1).
# macOS: open "Claude Companion.app" once; after that the server starts at login and the app is in the Dock.
# Same small local server as server.ps1, same addresses, so the page is identical:
#   http://localhost:47615   /api/ping  /api/stamp  /api/data  POST /api/snapshot
#                            /api/cards  /api/cards-state  POST /api/cards-state
# It serves the app and reads the game's saved file (ClaudeCompanion.lua) directly.
# Nothing is sent anywhere: it only answers this computer.
import glob, json, os, subprocess, sys, threading, time, urllib.request, webbrowser
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

WEB = os.path.dirname(os.path.abspath(__file__))
FOREVER = os.path.normpath(os.path.join(WEB, '..', '..', '..', '..'))   # .../_forever_
DATA_DIR = os.path.join(os.path.dirname(WEB), 'companion-data')
CARDS_DIR = os.path.join(DATA_DIR, 'from-claude')   # cards.json: Claude writes it; state.json: this app writes it
PORT = 47615
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
                if not save: return self.send(200, '{"stamp":null}', TYPES['.json'])
                st = os.stat(save)
                stamp = datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat()
                return self.send(200, json.dumps({'stamp': stamp, 'size': st.st_size}), TYPES['.json'])
            if not save: return self.send(404, 'no save yet')
            with open(save, 'rb') as f: return self.send(200, f.read(), 'application/octet-stream')
        if path in ('/api/cards', '/api/cards-state'):
            f = os.path.join(CARDS_DIR, 'cards.json' if path == '/api/cards' else 'state.json')
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
        target = {'/api/snapshot': (DATA_DIR, 'snapshot.json'), '/api/cards-state': (CARDS_DIR, 'state.json')}.get(self.path.split('?')[0])
        if not target or self.headers.get('X-CC') != '1' or n <= 0 or n > 20 * 1024 * 1024:
            return self.send(400, 'bad request')
        body = self.rfile.read(n)
        folder, name = target
        os.makedirs(folder, exist_ok=True)
        tmp = os.path.join(folder, name + '.tmp')
        with open(tmp, 'wb') as f: f.write(body)
        os.replace(tmp, os.path.join(folder, name))
        self.send(200, 'ok')


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


def serve(open_after):
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print(f'Claude Companion serving {URL} for {FOREVER}', flush=True)
    if not os.path.isdir(os.path.join(FOREVER, 'WTF')):
        print('Note: no WTF folder found next to Interface. Put ClaudeCompanion in _forever_/Interface/AddOns.', flush=True)
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
