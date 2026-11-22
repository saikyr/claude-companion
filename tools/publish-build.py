#!/usr/bin/env python3
"""Publish the checked-out, tested build as a GitHub release, so every computer's app installs it by itself.

    python tools/publish-build.py "what changed, one line"

Packs ClaudeCompanion/ exactly as it goes in Interface/AddOns, with the game-data pack
(ClaudeCompanion/web/data/gamedata.js, from gamedata/build.sh or the last release), into
dist/ClaudeCompanion-<version>-<build>.zip, and runs `gh release create build-<build>` with it.
Refuses to ship personal data (snapshot, settings, update token, installed.json, cards state).
Run the tests first: the harness (test/README.txt), `node test/web/advice.test.js`, `node --check` on the JS.
"""
import os, subprocess, sys, zipfile
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADDON = os.path.join(ROOT, 'ClaudeCompanion')
NEVER = {'companion-data/snapshot.json', 'companion-data/settings.json', 'companion-data/update.json', 'companion-data/installed.json', 'web/data.js'}


def main():
    notes = ' '.join(sys.argv[1:]).strip() or 'New build.'
    if not os.path.isfile(os.path.join(ADDON, 'web', 'data', 'gamedata.js')):
        sys.exit('missing ClaudeCompanion/web/data/gamedata.js (see gamedata/README.md)')
    ver = '0'
    with open(os.path.join(ADDON, 'ClaudeCompanion.toc'), encoding='utf-8') as f:
        for line in f:
            if line.startswith('## Version:'): ver = line.split(':', 1)[1].strip()
    build = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M')
    sha = subprocess.run(['git', '-C', ROOT, 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()
    branch = subprocess.run(['git', '-C', ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'], capture_output=True, text=True).stdout.strip()
    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    out = os.path.join(ROOT, 'dist', f'ClaudeCompanion-{ver}-{build}.zip')
    n = 0
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(ADDON):
            dirs[:] = [d for d in dirs if d not in ('__pycache__', 'from-claude')]
            for fn in files:
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, ADDON).replace(os.sep, '/')
                if rel in NEVER or fn.endswith(('.pyc', '.tmp')) or fn in ('.DS_Store', 'Thumbs.db'): continue
                if rel.startswith('companion-data/') and rel != 'companion-data/SCHEMA.md': continue
                info = zipfile.ZipInfo.from_file(full, 'ClaudeCompanion/' + rel)
                if rel.endswith(('MacOS/launcher', '.command', '.sh')): info.external_attr = 0o755 << 16   # keep the Mac launcher runnable
                with open(full, 'rb') as fh: z.writestr(info, fh.read(), zipfile.ZIP_DEFLATED)
                n += 1
    print(f'{out}: {n} files, {os.path.getsize(out) // 1024} KB')
    tag = f'build-{build}'
    body = f'{notes}\n\nBuilt from `{branch}` at {sha}. The app installs it by itself (or click Install); then /reload in game.'
    subprocess.run(['gh', 'release', 'create', tag, out, '--repo', 'saikyr/claude-companion', '--title', f'Claude Companion {ver} ({build})',
                    '--notes', body, '--target', subprocess.run(['git', '-C', ROOT, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()], check=True)
    print('published', tag)


if __name__ == '__main__':
    main()
