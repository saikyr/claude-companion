#!/usr/bin/env python3
"""Load the game-data pack into the database (publish workflow only; supabase/functions/publish-game).

    python3 tools/pack-to-rows.py --out dist/game
    GAME_TOKEN=<GitHub OIDC token> python3 tools/upload-game.py dist/game [--url URL]

Skips when the database already has this pack. Each chunk is one request into the slot reads are not
using; reads switch to it only when the last call (finish) has counted every row, so a failed run leaves
the old pack whole and in use, and the next run loads again.
"""
import json, os, sys, time, urllib.request

URL = 'https://jucbngafdnyaizfxgplk.supabase.co/functions/v1/publish-game'


def call(url, token, body, tries=4):
    data = json.dumps(body, separators=(',', ':')).encode('utf-8')
    for n in range(tries):
        req = urllib.request.Request(url, data=data, method='POST',
                                     headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            msg = e.read().decode('utf-8', 'replace')
            if e.code < 500 or n == tries - 1: raise SystemExit(f'{body.get("action")} {body.get("table", "")}: HTTP {e.code} {msg}')
        except urllib.error.URLError as e:
            if n == tries - 1: raise SystemExit(f'{body.get("action")}: {e}')
        time.sleep(2 ** n)


def main():
    d = sys.argv[1]
    url = sys.argv[sys.argv.index('--url') + 1] if '--url' in sys.argv else URL
    token = os.environ['GAME_TOKEN']
    meta = json.load(open(os.path.join(d, 'pack.json'), encoding='utf-8'))
    have = call(url, token, {'action': 'status'}).get('pack')
    if have == meta['hash']:
        print(f'game data {have} already loaded'); return
    total = 0
    for f in meta['files']:
        rows = json.load(open(os.path.join(d, f['file']), encoding='utf-8'))
        total += call(url, token, {'action': 'load', 'pack': meta['hash'], 'table': f['table'], 'rows': rows}).get('rows') or 0
    done = call(url, token, {'action': 'finish', 'pack': meta['hash'], 'meta': {k: meta[k] for k in ('hash', 'built', 'from', 'counts')}})
    print(f'game data {meta["hash"]} loaded ({total} rows; was {have}): {json.dumps(done.get("counts"))}')


if __name__ == '__main__':
    main()
