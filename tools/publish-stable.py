#!/usr/bin/env python3
"""Publish the checked-out build to a "stable" branch; every computer's app installs it by itself.

Run by CI (.github/workflows/publish.yml) after the tests pass on main, so no person or Claude
session has to publish by hand:

    python tools/publish-stable.py "what changed"                      # this repository's stable
    python tools/publish-stable.py --to owner/dist-repo "what changed" # also a public download repo
                                                                        # (push token in DIST_TOKEN)

The branch holds only the built addon: ClaudeCompanion/ exactly as it goes in Interface/AddOns
(with the game-data pack, web/data/gamedata.js), web/channel.json naming the repository and branch
the app should keep updating from, and BUILD.json: version, source branch and commit, and every
file's SHA-256, which the updater checks before it copies anything. Personal data is never packed.
Each publish is one commit on top of the previous build, so the branch is a history of builds.
"""
import hashlib, json, os, shutil, subprocess, sys, tempfile
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADDON = os.path.join(ROOT, 'ClaudeCompanion')
BRANCH = 'stable'
NEVER = {'companion-data/snapshot.json', 'companion-data/settings.json', 'companion-data/update.json',
         'companion-data/installed.json', 'web/data.js', 'web/channel.json'}


def git(*a, cwd=ROOT, check=True):
    r = subprocess.run(['git', *a], cwd=cwd, capture_output=True, text=True)
    if check and r.returncode: sys.exit(f"git {' '.join(a)}: {r.stderr.strip()}")
    return r.stdout.strip()


def origin_repo():
    url = git('remote', 'get-url', 'origin')
    return url.rstrip('/').removesuffix('.git').split('github.com')[-1].lstrip(':/')


def publish(repo, remote, notes, ver, src_branch, src_sha):
    work = tempfile.mkdtemp(prefix='cc-stable-')
    try:
        git('fetch', '-q', remote, BRANCH, check=False)
        have = git('ls-remote', remote, f'refs/heads/{BRANCH}', check=False)
        if have:
            git('fetch', '-q', remote, f'{BRANCH}:refs/cc-publish/{BRANCH}', check=False)
            git('worktree', 'add', '-q', '--detach', work, f'refs/cc-publish/{BRANCH}')
        else:
            git('worktree', 'add', '-q', '--detach', work)
            git('checkout', '-q', '--orphan', 'cc-publish-tmp', cwd=work)
        git('rm', '-rfq', '--ignore-unmatch', '.', cwd=work, check=False)
        for name in os.listdir(work):
            if name != '.git': (shutil.rmtree if os.path.isdir(os.path.join(work, name)) else os.remove)(os.path.join(work, name))
        files = {}
        for root, dirs, fs in os.walk(ADDON):
            dirs[:] = [d for d in dirs if d not in ('__pycache__', 'from-claude', 'devices')]
            for fn in fs:
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, ADDON).replace(os.sep, '/')
                if rel in NEVER or fn.endswith(('.pyc', '.tmp', '.bak')) or fn in ('.DS_Store', 'Thumbs.db'): continue
                if rel.startswith('companion-data/') and rel != 'companion-data/SCHEMA.md': continue
                dest = os.path.join(work, 'ClaudeCompanion', *rel.split('/'))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copy2(full, dest)
                with open(full, 'rb') as fh: files[rel] = hashlib.sha256(fh.read()).hexdigest()
        # the channel this build keeps updating from
        chan = json.dumps({'repo': repo, 'branch': BRANCH}, indent=1).encode()
        with open(os.path.join(work, 'ClaudeCompanion', 'web', 'channel.json'), 'wb') as f: f.write(chan)
        files['web/channel.json'] = hashlib.sha256(chan).hexdigest()
        build = {'version': ver, 'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'channel': {'repo': repo, 'branch': BRANCH},
                 'from': {'branch': src_branch, 'commit': src_sha}, 'notes': notes, 'files': dict(sorted(files.items()))}
        with open(os.path.join(work, 'BUILD.json'), 'w', encoding='utf-8') as f: json.dump(build, f, indent=1)
        with open(os.path.join(work, '.gitattributes'), 'w') as f: f.write('* -text\n')   # byte-exact: the checksums must match
        with open(os.path.join(work, 'README.md'), 'w', encoding='utf-8') as f:
            f.write('# Claude Companion builds\n\nTested builds of the Claude Companion addon and app, published automatically. '
                    'Nothing personal is in here. The app installs new builds by itself; see BUILD.json for this one.\n')
        git('add', '-A', cwd=work)
        if not git('status', '--porcelain', cwd=work): print(f'{repo}: no change'); return
        git('-c', 'user.name=Claude Companion builds', '-c', 'user.email=builds@users.noreply.github.com',
            'commit', '-q', '-m', f'Build {ver} from {src_branch} {src_sha[:10]}: {notes}', cwd=work)
        git('push', '-q', remote, f'HEAD:refs/heads/{BRANCH}', cwd=work)
        print(f'{repo}: published {len(files)} files to {BRANCH} ({git("rev-parse", "--short", "HEAD", cwd=work)})')
    finally:
        git('worktree', 'remove', '--force', work, check=False)
        git('update-ref', '-d', f'refs/cc-publish/{BRANCH}', check=False)
        shutil.rmtree(work, ignore_errors=True)


def main():
    args = sys.argv[1:]
    to = None
    if args[:1] == ['--to']: to, args = args[1], args[2:]
    notes = ' '.join(args).strip() or 'New build.'
    if not os.path.isfile(os.path.join(ADDON, 'web', 'data', 'gamedata.js')):
        sys.exit('missing ClaudeCompanion/web/data/gamedata.js (see gamedata/README.md)')
    if git('status', '--porcelain', '--untracked-files=no'):
        sys.exit('commit your changes first: the build names the commit it came from')
    ver = '0'
    with open(os.path.join(ADDON, 'ClaudeCompanion.toc'), encoding='utf-8') as f:
        for line in f:
            if line.startswith('## Version:'): ver = line.split(':', 1)[1].strip()
    src_branch, src_sha = git('rev-parse', '--abbrev-ref', 'HEAD'), git('rev-parse', 'HEAD')
    publish(origin_repo(), 'origin', notes, ver, src_branch, src_sha)
    if to:
        tok = os.environ.get('DIST_TOKEN')
        if not tok: sys.exit('--to needs a push token in DIST_TOKEN')
        publish(to, f'https://x-access-token:{tok}@github.com/{to}.git', notes, ver, src_branch, src_sha)


if __name__ == '__main__':
    main()
