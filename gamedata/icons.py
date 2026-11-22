#!/usr/bin/env python3
"""Icon names for the app (web/js/icons.js): the game saves an icon as a file id, the icon CDN wants its name.

  python3 -I icons.py <community-listfile.csv> <out icons.js>

Source: the wowdev community listfile (github.com/wowdev/wow-listfile, releases/latest
community-listfile.csv): one "fileId;path" line per game file. Every interface/icons/*.blp becomes
fileId -> name. Other files (".blp.meta" sidecars, models, sounds) are left out.
"""
import json, re, sys

src, out = sys.argv[1], sys.argv[2]
ICON = re.compile(r'^(\d+);interface/icons/([^/]+)\.blp$')
icons = {}
with open(src, encoding='utf-8', errors='replace') as f:
    for line in f:
        m = ICON.match(line.rstrip('\r\n'))
        if m: icons[m[1]] = m[2]
if len(icons) < 30000:
    sys.exit(f'only {len(icons)} icons in {src}: the listfile download looks broken')
with open(out, 'w', encoding='utf-8') as f:
    f.write('window.CC_ICONS=' + json.dumps(dict(sorted(icons.items(), key=lambda kv: int(kv[0]))), separators=(',', ':')) + ';\n')
print(f'{len(icons)} icons -> {out}')
