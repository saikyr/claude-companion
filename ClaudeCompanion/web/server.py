#!/usr/bin/env python3
# Claude Companion app on macOS (and anywhere with Python 3; Windows uses server.ps1).
# Same small local server as server.ps1, same addresses, so the page is identical:
#   http://localhost:47615   /api/ping  /api/stamp  /api/data  POST /api/snapshot
# It serves the app and reads the game's saved file (ClaudeCompanion.lua) directly.
# Nothing is sent anywhere: it only answers this computer.
import glob, json, os, subprocess, sys, threading, time, urllib.request, webbrowser
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

WEB = os.path.dirname(os.path.abspath(__file__))
FOREVER = os.path.normpath(os.path.join(WEB, '..', '..', '..', '..'))   # .../_forever_
DATA_DIR = os.path.join(os.path.dirname(WEB), 'companion-data')
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
        rel = urllib.request.url2pathname(path.lstrip('/')) or 'index.html'
        full = os.path.realpath(os.path.join(WEB, rel))
        # only files inside the app folder, and never the server scripts
        if full.startswith(os.path.realpath(WEB) + os.sep) and os.path.isfile(full) and not full.endswith(('.ps1', '.py')):
            with open(full, 'rb') as f:
                return self.send(200, f.read(), TYPES.get(os.path.splitext(full)[1].lower(), 'text/plain; charset=utf-8'))
        self.send(404, 'not found')

    def do_POST(self):
        # the page's summary for Claude: ../companion-data/snapshot.json (see SCHEMA.md there).
        # Only this app sends the X-CC header; a web page can't add it without the browser asking first.
        n = int(self.headers.get('Content-Length') or 0)
        if self.path.split('?')[0] != '/api/snapshot' or self.headers.get('X-CC') != '1' or n <= 0 or n > 20 * 1024 * 1024:
            return self.send(400, 'bad request')
        body = self.rfile.read(n)
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = os.path.join(DATA_DIR, 'snapshot.json.tmp')
        with open(tmp, 'wb') as f: f.write(body)
        os.replace(tmp, os.path.join(DATA_DIR, 'snapshot.json'))
        self.send(200, 'ok')


def open_app():
    if sys.platform == 'darwin':
        # Chrome or Edge open it as its own app window; otherwise the default browser
        for app in ('Google Chrome', 'Microsoft Edge'):
            if os.path.isdir(f'/Applications/{app}.app'):
                subprocess.Popen(['open', '-na', app, '--args', f'--app={URL}']); return
        subprocess.Popen(['open', URL]); return
    webbrowser.open(URL)


def running():
    try:
        with urllib.request.urlopen(URL + 'api/ping', timeout=2) as r: return r.read() == b'claude-companion'
    except Exception: return False


if __name__ == '__main__':
    if running(): open_app(); sys.exit(0)            # already running: just open another window
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print(f'\n  Claude Companion is running.\n  App: {URL}\n  Game folder: {FOREVER}\n  Leave this window open (it can stay minimised). Close it to stop.\n')
    if not os.path.isdir(os.path.join(FOREVER, 'WTF')):
        print('  Note: no WTF folder found next to Interface. Put ClaudeCompanion in _forever_/Interface/AddOns.\n')
    if '--no-open' not in sys.argv: open_app()
    try: srv.serve_forever()
    except KeyboardInterrupt: pass
