// The app's data files are complete and agree with each other (CI: "Game data complete").
//   node test/web/data.test.js
// One owner per kind of data (docs/ARCHITECTURE.md, Data sources). This checks the files the app ships:
//   data/gamedata.js  the pack (QuestieDB Forever, endgametools, ForeverDB), gamedata/build.sh
//   data/suffixes.js  random-suffix rolls (foreverchanges.pro), gamedata/suffixes.py
//   js/icons.js       icon file id -> name (wowdev community listfile), gamedata/icons.py
//   data/rules.js     game rules no source ships per item (hand-kept, each with its source)
// The pack's own shape and known facts are gamedata/test_pack.py (also run in CI).
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const WEB = path.join(__dirname, '../../ClaudeCompanion/web');
const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
for (const f of ['data/gamedata.js', 'data/suffixes.js', 'js/icons.js', 'data/rules.js']) {
  vm.runInContext(fs.readFileSync(path.join(WEB, f), 'utf8'), ctx, { filename: f });
}
const GD = ctx.GAMEDATA, SFX = ctx.GAMEDATA_SUFFIX, ICONS = ctx.CC_ICONS, RULES = ctx.GAMERULES;
let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); } };
const n = (o) => Object.keys(o || {}).length;

// ---------------------------------------------------------------- every domain is there
test('pack has every domain the app reads', () => {
  for (const k of ['items', 'src', 'quests', 'vend', 'npcs', 'stat', 'sets', 'size', 'how']) assert.ok(GD[k] && n(GD[k]) > 0, 'missing ' + k);
  for (const k of ['quests_npcs_sources', 'item_tooltips', 'drop_rates_icons_reward_split']) assert.ok(GD.from && GD.from[k], 'no source named for ' + k);
});
test('items: >25,000, >10,000 with Forever client tooltips', () => {
  assert.ok(n(GD.items) > 25000, n(GD.items));
  assert.ok(Object.values(GD.items).filter((r) => r[11] === 'e').length > 10000);
});
test('quests: >6,000, each giver and turn-in names an NPC or object', () => {
  assert.ok(n(GD.quests) > 6000);
  const bad = Object.entries(GD.quests).filter(([, q]) => [].concat(q.from || [], q.to || []).some((w) => !w[1]));
  assert.strictEqual(bad.length, 0, bad.slice(0, 3).map((x) => x[0]).join(', '));
});
test('NPCs: >15,000 with name, levels and rank; quest givers are in the NPC table', () => {
  assert.ok(n(GD.npcs) > 15000, n(GD.npcs));
  const bad = Object.entries(GD.npcs).filter(([, r]) => !(Array.isArray(r) && r.length === 9 && r[0] && Array.isArray(r[6])));
  assert.strictEqual(bad.length, 0, 'bad rows ' + bad.slice(0, 3).map((x) => x[0]));
  const missing = new Set();
  for (const q of Object.values(GD.quests)) for (const w of [].concat(q.from || [], q.to || [])) if (w[5] === 'npc' && !GD.npcs[w[0]]) missing.add(w[0]);
  assert.strictEqual(missing.size, 0, [...missing].slice(0, 5).join(', '));
  assert.ok(Object.values(GD.npcs).filter((r) => r[6].length).length > 8000, 'spawn points');
});
test('drop rates: >5,000 items, every rate a percentage and labelled Forever or Classic', () => {
  const rows = Object.values(GD.src).flat().filter((r) => r[3] != null);
  assert.ok(new Set(Object.entries(GD.src).filter(([, rs]) => rs.some((r) => r[3] != null)).map(([k]) => k)).size > 5000);
  assert.ok(rows.every((r) => r[3] > 0 && r[3] <= 100 && (r[11] === 'm' || r[11] === 'c' || r[11] === '')));
});
test('vendors: >3,500 items, every row names the vendor', () => {
  assert.ok(n(GD.vend) > 3500);
  assert.ok(Object.values(GD.vend).flat().every((v) => v[0]));
});

// ---------------------------------------------------------------- files agree with each other
test('every icon the pack names has a name in icons.js', () => {
  const miss = new Set(Object.values(GD.items).map((r) => r[5]).filter((i) => i && !ICONS[i]));
  assert.strictEqual(miss.size, 0, [...miss].slice(0, 5).join(', '));
});
test('icons.js: >30,000 icons, only real icon names', () => {
  assert.ok(n(ICONS) > 30000);
  const bad = Object.values(ICONS).filter((v) => !/^[^/]+$/.test(v) || /\.(blp|meta)$/.test(v));
  assert.strictEqual(bad.length, 0, bad.slice(0, 3).join(', '));
});
test('random-suffix rolls: >1,000 bases, each a pack item, each roll a known suffix and stat', () => {
  assert.ok(SFX && SFX.names.length > 30 && n(SFX.items) > 1000);
  const bad = Object.entries(SFX.items).filter(([id, rolls]) => !GD.items[id] || rolls.some(([i, st]) => !SFX.names[i] || st.some(([s]) => !GD.stat[s])));
  assert.strictEqual(bad.length, 0, bad.slice(0, 3).map((x) => x[0]).join(', '));
});

// ---------------------------------------------------------------- hand-kept rules
test('rules: standings and reputation floors line up', () => {
  assert.strictEqual(RULES.standing.length, 9); assert.strictEqual(RULES.repFloor.length, 9);
  for (let i = 2; i < 9; i++) assert.ok(RULES.repFloor[i] > RULES.repFloor[i - 1]);
  assert.ok(RULES.ahCut > 0 && RULES.ahCut < 0.2);
});
test('rules: disenchant tables cover item levels without gaps, chances add up to 1', () => {
  const D = RULES.disenchant;
  assert.ok(D.from);
  for (const k of ['armor', 'weapon', 'rare', 'epic']) {
    const t = D[k];
    for (let i = 0; i < t.length; i++) {
      if (i) assert.strictEqual(t[i][0], t[i - 1][1] + 1, `${k}: gap after ${t[i - 1][1]}`);
      const sum = t[i][2].reduce((a, m) => a + m[1], 0);
      assert.ok(Math.abs(sum - 1) < 0.011, `${k} ${t[i][0]}-${t[i][1]}: chances add up to ${sum}`);
    }
  }
  for (let i = 1; i < D.skill.length; i++) assert.ok(D.skill[i][0] > D.skill[i - 1][0] && D.skill[i][1] > D.skill[i - 1][1]);
});

// ---------------------------------------------------------------- freshness (a note, not a failure)
const days = (t) => Math.round((Date.now() / 1000 - t) / 86400);
for (const [f, t] of [['gamedata.js', GD.built], ['suffixes.js', SFX.built]]) {
  if (days(t) > 30) console.log(`::warning::${f} was built ${days(t)} days ago: rebuild with gamedata/build.sh`);
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
