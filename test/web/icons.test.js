// node test/web/icons.test.js
// The app's own icons (js/app.js UI_ICON, PROF_ICON, CLASS_ICON) are real icon files of the original client:
// each name is in the icon list (js/icons.js, wowdev listfile) with a file id from the 1.x range, so no icon
// from a later expansion slips in. Other files name their icons through A.uiIcon, never a hard-coded name.
'use strict';
const fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '../../ClaudeCompanion/web');
global.window = {};
require(path.join(WEB, 'js/icons.js'));
const byName = {};
for (const [id, n] of Object.entries(window.CC_ICONS)) if (!(n in byName) || +id < byName[n]) byName[n] = +id;
const CLASSIC_MAX = 137000;   // the original client's icons are file ids 132089..136xxx
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };

const app = fs.readFileSync(path.join(WEB, 'js/app.js'), 'utf8');
for (const map of ['UI_ICON', 'PROF_ICON', 'CLASS_ICON']) {
  const m = new RegExp(`const ${map} = \\{([\\s\\S]*?)\\};`).exec(app);
  check(!!m, `${map} found in app.js`);
  if (!m) continue;
  const names = [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]).filter((n) => /_/.test(n));
  check(names.length > 5, `${map}: ${names.length} icons`);
  names.forEach((n) => check(byName[n] != null && byName[n] < CLASSIC_MAX, `${map}: ${n} is an original-client icon (file ${byName[n]})`));
}
// faction banners chosen in uiIcon
['inv_bannerpvp_01', 'inv_bannerpvp_02'].forEach((n) => check(byName[n] < CLASSIC_MAX, `${n} is an original-client icon`));
// no other file hard-codes an icon name for a tab, step or card
for (const f of ['next.js', 'cards.js', 'gear.js', 'advice.js', 'runs.js', 'claude.js']) {
  const s = fs.readFileSync(path.join(WEB, 'js', f), 'utf8');
  const hard = [...s.matchAll(/'((?:inv|spell|ability|trade)_[a-z0-9_]+)'/g)].map((x) => x[1]);
  check(!hard.length, `${f}: no hard-coded icon names${hard.length ? ' (' + hard.join(', ') + ')' : ''}`);
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
