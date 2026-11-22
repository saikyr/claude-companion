#!/usr/bin/env python3
"""Publish the checked-out, tested build to the "stable" branch; every computer's app installs it by itself.

    python tools/publish-stable.py "what changed, one line"

The stable branch holds only the built addon: ClaudeCompanion/ exactly as it goes in Interface/AddOns,
with the game-data pack (ClaudeCompanion/web/data/gamedata.js, from gamedata/build.sh or the installed
copy), and BUILD.json: version, source branch and commit, and every file's SHA-256, which the updater
checks before it copies anything. Personal data is never packed (snapshot, settings, update token,
installed.json, Claude's cards). Run the tests first (test/README.txt).
"""
import hashlib, json, os, shutil, subprocess, sys, tempfile
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADDON = os.path.join(ROOT, 'ClaudeCompanion')
BRANCH = 'stable'
NEVER = {'companion-data/snapshot.json', 'companion-data/settings.json', 'companion-data/update.json', 'companion-data/installed.json', 'web/data.js'}


def git(*a, cwd=ROOT, check=True):
    r = subprocess.run(['git', *a], cwd=cwd, capture_output=True, text=True)
    if check and r.returncode: sys.exit(f"git {' '.join(a)}: {r.stderr.strip()}")
    return r.stdout.strip()


def main():
    notes = ' '.join(sys.argv[1:]).strip() or 'New build.'
    if not os.path.isfile(os.path.join(ADDON, 'web', 'data', 'gamedata.js')):
        sys.exit('missing ClaudeCompanion/web/data/gamedata.js (see gamedata/README.md)')
    if git('status', '--porcelain', '--untracked-files=no'):
        sys.exit('commit your changes first: the build names the commit it came from')
    ver = '0'
    with open(os.path.join(ADDON, 'ClaudeCompanion.toc'), encoding='utf-8') as f:
        for line in f:
            if line.startswith('## Version:'): ver = line.split(':', 1)[1].strip()
    src_branch, src_sha = git('rev-parse', '--abbrev-ref', 'HEAD'), git('rev-parse', 'HEAD')
    work = tempfile.mkdtemp(prefix='cc-stable-')
    try:
        git('fetch', '-q', 'origin', BRANCH, check=False)
        have = git('rev-parse', '--verify', '-q', f'origin/{BRANCH}', check=False)
        if have: git('worktree', 'add', '-q', '-B', BRANCH, work, f'origin/{BRANCH}')
        else: git('worktree', 'add', '-q', '--detach', work); git('checkout', '-q', '--orphan', BRANCH, cwd=work); git('rm', '-rfq', '.', cwd=work, check=False)
        for name in os.listdir(work):
            if name != '.git': (shutil.rmtree if os.path.isdir(os.path.join(work, name)) else os.remove)(os.path.join(work, name))
        files = {}
        for root, dirs, fs in os.walk(ADDON):
            dirs[:] = [d for d in dirs if d not in ('__pycache__', 'from-claude')]
            for fn in fs:
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, ADDON).replace(os.sep, '/')
                if rel in NEVER or fn.endswith(('.pyc', '.tmp')) or fn in ('.DS_Store', 'Thumbs.db'): continue
                if rel.startswith('companion-data/') and rel != 'companion-data/SCHEMA.md': continue
                dest = os.path.join(work, 'ClaudeCompanion', *rel.split('/'))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copy2(full, dest)
                with open(full, 'rb') as fh: files[rel] = hashlib.sha256(fh.read()).hexdigest()
        build = {'version': ver, 'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'from': {'branch': src_branch, 'commit': src_sha},
                 'notes': notes, 'files': dict(sorted(files.items()))}
        with open(os.path.join(work, 'BUILD.json'), 'w', encoding='utf-8') as f: json.dump(build, f, indent=1)
        with open(os.path.join(work, '.gitattributes'), 'w') as f: f.write('* -text\n')   # byte-exact: the checksums must match
        git('add', '-A', cwd=work)
        git('commit', '-q', '-m', f'Build {ver} from {src_branch} {src_sha[:10]}: {notes}', cwd=work)
        git('push', '-q', 'origin', f'HEAD:{BRANCH}', cwd=work)
        print(f'published {len(files)} files to {BRANCH}: {git("rev-parse", "--short", "HEAD", cwd=work)}')
    finally:
        git('worktree', 'remove', '--force', work, check=False)
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    main()
