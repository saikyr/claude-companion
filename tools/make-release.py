#!/usr/bin/env python3
"""The download zips for a first install, one per system, from a build (tools/publish-stable.py):

    ClaudeCompanion-Windows.zip   Install Claude Companion.bat, READ ME.txt, files/ (the addon + installer)
    ClaudeCompanion-Mac.zip       Install Claude Companion.app (the addon inside it), READ ME.txt

The installers (installer/) find the game, copy the addon in and open the app; from then on the app
updates itself. CI runs this after every publish and uploads the zips plus latest.json (which names the
build; the updaters read it, and the Windows zip is also what they install) to the public download
folder (.github/workflows/publish.yml, supabase/functions/publish-build).

    python tools/make-release.py <out dir>         a build of this checkout (no publish; for tests)
    (publish-stable.py --release <out dir> calls make_zips with the published build)
"""
import json, os, shutil, sys, tempfile, zipfile
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INST = os.path.join(ROOT, 'installer')
MAC_APP = 'Install Claude Companion.app'
EXEC = ('Contents/MacOS/install', 'Contents/MacOS/launcher')   # files that must keep the run bit


def _add(z, path, arc):
    zi = zipfile.ZipInfo(arc, date_time=(2026, 1, 1, 0, 0, 0))   # fixed time: the same build, the same zip
    zi.create_system = 3   # Unix, so Archive Utility on a Mac keeps the permissions below
    mode = 0o755 if arc.endswith(EXEC) else 0o644
    zi.external_attr = (0o100000 | mode) << 16
    zi.compress_type = zipfile.ZIP_DEFLATED
    with open(path, 'rb') as f: z.writestr(zi, f.read())


def _tree(z, src, arc):
    for root, dirs, files in os.walk(src):
        dirs.sort()
        for fn in sorted(files):
            full = os.path.join(root, fn)
            _add(z, full, arc + '/' + os.path.relpath(full, src).replace(os.sep, '/'))


def make_zips(build, out, stable_sha=None, name=None):
    """build: a folder with ClaudeCompanion/ and BUILD.json (publish-stable.py's work tree)."""
    with open(os.path.join(build, 'BUILD.json'), encoding='utf-8') as f: b = json.load(f)
    os.makedirs(out, exist_ok=True)
    stage = tempfile.mkdtemp(prefix='cc-release-')
    try:
        pay = os.path.join(stage, 'payload')
        shutil.copytree(os.path.join(build, 'ClaudeCompanion'), os.path.join(pay, 'ClaudeCompanion'))
        shutil.copy2(os.path.join(build, 'BUILD.json'), pay)
        with open(os.path.join(pay, 'FILES.txt'), 'w', encoding='utf-8', newline='\n') as f: f.write('\n'.join(sorted(b['files'])) + '\n')
        if stable_sha:   # becomes companion-data/installed.json, so the updater knows this build is in
            info = {'tag': stable_sha[:12], 'sha': stable_sha, 'version': b.get('version'), 'build': b.get('build'),
                    'at': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'by': 'installer'}
            with open(os.path.join(pay, 'install-info.json'), 'w', encoding='utf-8') as f: json.dump(info, f, indent=1)
        readme = os.path.join(INST, 'READ ME.txt')
        ver = b.get('version', '')

        win = os.path.join(out, 'ClaudeCompanion-Windows.zip')
        with zipfile.ZipFile(win, 'w') as z:
            _add(z, os.path.join(INST, 'windows', 'Install Claude Companion.bat'), 'Install Claude Companion.bat')
            _add(z, readme, 'READ ME.txt')
            _add(z, os.path.join(INST, 'windows', 'install.ps1'), 'files/install.ps1')
            for fn in sorted(os.listdir(pay)):
                p = os.path.join(pay, fn)
                if os.path.isdir(p): _tree(z, p, 'files/' + fn)
                else: _add(z, p, 'files/' + fn)

        mac = os.path.join(out, 'ClaudeCompanion-Mac.zip')
        app = os.path.join(stage, MAC_APP)
        shutil.copytree(os.path.join(INST, 'mac', MAC_APP), app)
        res = os.path.join(app, 'Contents', 'Resources')
        os.makedirs(res, exist_ok=True)   # the icon is the app's own (kept once, in the addon)
        shutil.copy2(os.path.join(build, 'ClaudeCompanion', 'web', 'Claude Companion.app', 'Contents', 'Resources', 'AppIcon.icns'), res)
        shutil.copytree(pay, os.path.join(app, 'Contents', 'Resources', 'payload'))
        with zipfile.ZipFile(mac, 'w') as z:
            _tree(z, app, MAC_APP)
            _add(z, readme, 'READ ME.txt')
        if stable_sha:   # latest.json for the download folder: what the installed apps' updaters read
            m = {'tag': stable_sha[:12], 'sha': stable_sha, 'version': ver, 'build': b.get('build'), 'name': name or f'Build {ver}',
                 'published': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'zip': 'latest/ClaudeCompanion-Windows.zip',
                 'mac': 'latest/ClaudeCompanion-Mac.zip'}
            with open(os.path.join(out, 'latest.json'), 'w', encoding='utf-8') as f: json.dump(m, f, indent=1)
        print(f'release {ver}: {win} ({os.path.getsize(win) // 1024} KB), {mac} ({os.path.getsize(mac) // 1024} KB)')
        return [win, mac]
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def main():
    if len(sys.argv) != 2: sys.exit(__doc__)
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    import importlib.util
    spec = importlib.util.spec_from_file_location('publish_stable', os.path.join(ROOT, 'tools', 'publish-stable.py'))
    ps = importlib.util.module_from_spec(spec); spec.loader.exec_module(ps)
    work = tempfile.mkdtemp(prefix='cc-build-')
    try:
        ver = '0'
        with open(os.path.join(ROOT, 'ClaudeCompanion', 'ClaudeCompanion.toc'), encoding='utf-8') as f:
            for line in f:
                if line.startswith('## Version:'): ver = line.split(':', 1)[1].strip()
        sha = ps.git('rev-parse', 'HEAD')
        ps.assemble(work, ps.origin_repo() if ps.git('remote', check=False) else 'local/checkout', 'local build', ver, 'local', sha)
        make_zips(work, sys.argv[1], None)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    main()
