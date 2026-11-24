#!/usr/bin/env python3
"""Publish the checked-out build to a "stable" branch; every computer's app installs it by itself.

Run by CI (.github/workflows/publish.yml) after the tests pass on main, so no person or Claude
session has to publish by hand:

    python tools/publish-stable.py "what changed"                      # this repository's stable
    python tools/publish-stable.py --release dist "what changed"       # also the download zips
                                                                        # (tools/make-release.py)
    python tools/publish-stable.py --force --release dist "..."        # publish even if ClaudeCompanion/
                                                                        # is unchanged (manual runs)

A merge that changes nothing in ClaudeCompanion/ (docs, tests, CI, .claude/) is not published: the
build id would change for no reason and every computer would be asked to /reload.

The branch holds only the built addon: ClaudeCompanion/ exactly as it goes in Interface/AddOns
(with the game-data pack, web/data/gamedata.js), web/channel.json naming the repository and branch
the app should keep updating from, and BUILD.json: version, source branch and commit, and every
file's SHA-256, which the updater checks before it copies anything. Personal data is never packed.
Each publish is one commit on top of the previous build, so the branch is a history of builds.
"""
import hashlib, importlib.util, json, os, shutil, subprocess, sys, tempfile
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADDON = os.path.join(ROOT, 'ClaudeCompanion')
BRANCH = 'stable'
# where every build's download zips and latest.json go (publish.yml uploads them after this script)
DOWNLOADS = 'https://jucbngafdnyaizfxgplk.supabase.co/storage/v1/object/public/releases/'
_spec = importlib.util.spec_from_file_location('make_release', os.path.join(ROOT, 'tools', 'make-release.py'))
release = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(release)
NEVER = {'companion-data/snapshot.json', 'companion-data/settings.json', 'companion-data/update.json',
         'companion-data/sync.json', 'companion-data/sync-cache.json',
         'companion-data/installed.json', 'web/data.js', 'web/channel.json'}
# The Claude kit: a friend's Claude can't read this private repository, so the rules it follows ship in
# every build, in ClaudeCompanion/claude/ next to its own guide (claude/GUIDE.md, claude/SETUP.md).
# Copied from their one owner here, never kept as a second copy in git. A change to these alone is not a
# new build (no /reload asked for it): the kit goes out with the next build.
KIT = {'claude/COACHING.md': 'docs/COACHING.md', 'claude/FEATURES.md': 'docs/FEATURES.md',
       'claude/answer_rules.py': 'tools/answer_rules.py', 'claude/check-cards.py': 'tools/check-cards.py',
       'claude/check-answer.py': 'tools/check-answer.py',
       'claude/game.py': 'tools/game.py', 'claude/pack-to-rows.py': 'tools/pack-to-rows.py'}
# made at build time: rules.js as JSON for claude/game.py on a computer without node, with the sha of the
# rules.js it was made from (pack-to-rows.py uses it only while that matches)
_rspec = importlib.util.spec_from_file_location('pack_to_rows', os.path.join(ROOT, 'tools', 'pack-to-rows.py'))
pack_rows = importlib.util.module_from_spec(_rspec); _rspec.loader.exec_module(pack_rows)


def git(*a, cwd=ROOT, check=True):
    r = subprocess.run(['git', *a], cwd=cwd, capture_output=True, text=True)
    if check and r.returncode: sys.exit(f"git {' '.join(a)}: {r.stderr.strip()}")
    return r.stdout.strip()


def origin_repo():
    url = git('remote', 'get-url', 'origin')
    return url.rstrip('/').removesuffix('.git').split('github.com')[-1].lstrip(':/')


def stamp_build(path, sha):
    # the addon names the build it came from (Core.lua ns.BUILD), so the app can tell when the game
    # still runs the previous build's Lua and needs a /reload
    with open(path, 'rb') as f: src = f.read()
    line = b'ns.BUILD = "dev"'
    if src.count(line) != 1: sys.exit('Core.lua must have exactly one line ns.BUILD = "dev"')
    with open(path, 'wb') as f: f.write(src.replace(line, b'ns.BUILD = "' + sha[:12].encode() + b'"'))


def assemble(work, repo, notes, ver, src_branch, src_sha):
    # the build: ClaudeCompanion/ as it goes in AddOns, web/channel.json, BUILD.json (also used by make-release.py)
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
            if rel == 'Core.lua': stamp_build(dest, src_sha)
            with open(dest, 'rb') as fh: files[rel] = hashlib.sha256(fh.read()).hexdigest()
    with open(os.path.join(ADDON, 'web', 'data', 'rules.js'), encoding='utf-8') as fh: rtext = fh.read()
    rjson = json.dumps({'sha': pack_rows.rules_sha(rtext), 'rules': pack_rows.rules_obj(rtext)}, ensure_ascii=False).encode('utf-8')
    with open(os.path.join(work, 'ClaudeCompanion', 'claude', 'rules.json'), 'wb') as fh: fh.write(rjson)
    files['claude/rules.json'] = hashlib.sha256(rjson).hexdigest()
    for rel, src in KIT.items():
        dest = os.path.join(work, 'ClaudeCompanion', *rel.split('/'))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(os.path.join(ROOT, *src.split('/')), dest)
        with open(dest, 'rb') as fh: files[rel] = hashlib.sha256(fh.read()).hexdigest()
    # the channel this build keeps updating from
    # (and which build it is: the app compares it with the build the game last saved with)
    # "url": the public download folder (supabase/functions/publish-build), what installed apps read;
    # repo/branch: the same builds on GitHub, for a computer whose update.json asks for them
    chan = json.dumps({'url': DOWNLOADS, 'repo': repo, 'branch': BRANCH, 'version': ver, 'build': src_sha[:12]}, indent=1).encode()
    with open(os.path.join(work, 'ClaudeCompanion', 'web', 'channel.json'), 'wb') as f: f.write(chan)
    files['web/channel.json'] = hashlib.sha256(chan).hexdigest()
    build = {'version': ver, 'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'channel': {'repo': repo, 'branch': BRANCH},
             'from': {'branch': src_branch, 'commit': src_sha}, 'build': src_sha[:12], 'notes': notes, 'files': dict(sorted(files.items()))}
    with open(os.path.join(work, 'BUILD.json'), 'w', encoding='utf-8') as f: json.dump(build, f, indent=1)
    with open(os.path.join(work, '.gitattributes'), 'w') as f: f.write('* -text\n')   # byte-exact: the checksums must match
    with open(os.path.join(work, 'README.md'), 'w', encoding='utf-8') as f:
        f.write('# Claude Companion builds\n\nTested builds of the Claude Companion addon and app, published automatically. '
                'Nothing personal is in here. The app installs new builds by itself; see BUILD.json for this one.\n')
    return files


def unchanged_since(work, src_sha):
    # the commit the current stable build came from, if nothing the build is made of (ClaudeCompanion/)
    # changed since then: a merge that only touches docs, tests, CI or .claude/ is not a new build, so
    # it doesn't stamp a new build id and every computer isn't asked to /reload for nothing
    try:
        with open(os.path.join(work, 'BUILD.json'), encoding='utf-8') as f: prev = json.load(f)['from']['commit']
    except (OSError, ValueError, KeyError, TypeError): return None
    if not prev or subprocess.run(['git', 'cat-file', '-e', prev + '^{commit}'], cwd=ROOT, capture_output=True).returncode: return None
    same = subprocess.run(['git', 'diff', '--quiet', prev, src_sha, '--', 'ClaudeCompanion'], cwd=ROOT).returncode == 0
    return prev if same else None


def publish(repo, remote, notes, ver, src_branch, src_sha, release_dir=None, force=False):
    """Returns True when a build was published, False when nothing the build is made of changed."""
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
        prev = None if force or not have else unchanged_since(work, src_sha)
        if prev:
            print(f'{repo}: nothing in ClaudeCompanion/ changed since build {prev[:12]}; not published')
            return False
        git('rm', '-rfq', '--ignore-unmatch', '.', cwd=work, check=False)
        for name in os.listdir(work):
            if name != '.git': (shutil.rmtree if os.path.isdir(os.path.join(work, name)) else os.remove)(os.path.join(work, name))
        assemble(work, repo, notes, ver, src_branch, src_sha)
        git('add', '-A', cwd=work)
        if not git('status', '--porcelain', cwd=work): print(f'{repo}: no change')
        else:
            git('-c', 'user.name=Claude Companion builds', '-c', 'user.email=builds@users.noreply.github.com',
                'commit', '-q', '-m', f'Build {ver} from {src_branch} {src_sha[:10]}: {notes}', cwd=work)
            git('push', '-q', remote, f'HEAD:refs/heads/{BRANCH}', cwd=work)
            print(f'{repo}: published to {BRANCH} ({git("rev-parse", "--short=12", "HEAD", cwd=work)})')
        # the download zips for a first install: the same build, plus which stable commit it is
        if release_dir: release.make_zips(work, release_dir, git('rev-parse', 'HEAD', cwd=work), git('log', '-1', '--format=%s', cwd=work))
        return True
    finally:
        git('worktree', 'remove', '--force', work, check=False)
        git('update-ref', '-d', f'refs/cc-publish/{BRANCH}', check=False)
        shutil.rmtree(work, ignore_errors=True)


def main():
    args = sys.argv[1:]
    rel, force = None, False
    if args[:1] == ['--force']: force, args = True, args[1:]
    if args[:1] == ['--release']: rel, args = args[1], args[2:]
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
    done = publish(origin_repo(), 'origin', notes, ver, src_branch, src_sha, rel, force)
    # publish.yml uploads the download zips only when there is a new build
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as f: f.write(f"published={'true' if done else 'false'}\n")


if __name__ == '__main__':
    main()
