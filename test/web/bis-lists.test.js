// Node test: the app's own pre-BiS against published Forever lists (test/fixtures/bis-lists.json). With the
// real game-data pack and the real engines (js/weights.js, gear.js), a made-up level 60 character of each
// listed class and tree: every pick the lists agree on must be available (not filtered out as raid, PvP,
// not on Forever...) and shown for its slot (a pick or one of its alternatives). This catches a data or rule
// gap that hides gear. A pick the app's weights rank lower on purpose carries `disagree` (why), and is printed.
//   node test/web/bis-lists.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const WEB = path.join(__dirname, '../../ClaudeCompanion/web');
const LISTS = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/bis-lists.json'), 'utf8'));
const NAME = { WARRIOR: 'Warrior', ROGUE: 'Rogue', HUNTER: 'Hunter', MAGE: 'Mage', WARLOCK: 'Warlock', PRIEST: 'Priest', PALADIN: 'Paladin', SHAMAN: 'Shaman', DRUID: 'Druid' };
const TREES = { WARRIOR: ['Arms', 'Fury', 'Protection'], ROGUE: ['Assassination', 'Combat', 'Subtlety'], HUNTER: ['Beast Mastery', 'Marksmanship', 'Survival'],
  MAGE: ['Arcane', 'Fire', 'Frost'], WARLOCK: ['Affliction', 'Demonology', 'Destruction'], PRIEST: ['Discipline', 'Holy', 'Shadow'],
  PALADIN: ['Holy', 'Protection', 'Retribution'], SHAMAN: ['Elemental', 'Enhancement', 'Restoration'], DRUID: ['Balance', 'Feral', 'Restoration'] };
const SKILLS = {
  WARRIOR: ['Swords', 'Two-Handed Swords', 'Axes', 'Maces', 'Daggers', 'Bows', 'Thrown', 'Cloth', 'Leather', 'Mail', 'Plate Mail', 'Shield', 'Dual Wield'],
  PALADIN: ['Swords', 'Two-Handed Swords', 'Maces', 'Two-Handed Maces', 'Cloth', 'Leather', 'Mail', 'Plate Mail', 'Shield'],
  HUNTER: ['Bows', 'Guns', 'Axes', 'Two-Handed Axes', 'Staves', 'Daggers', 'Cloth', 'Leather', 'Mail', 'Dual Wield'],
  ROGUE: ['Daggers', 'Swords', 'Bows', 'Thrown', 'Cloth', 'Leather'],
  PRIEST: ['Maces', 'Staves', 'Daggers', 'Wands', 'Cloth'], MAGE: ['Swords', 'Staves', 'Daggers', 'Wands', 'Cloth'], WARLOCK: ['Swords', 'Staves', 'Daggers', 'Wands', 'Cloth'],
  SHAMAN: ['Maces', 'Staves', 'Axes', 'Daggers', 'Cloth', 'Leather', 'Mail', 'Shield'], DRUID: ['Maces', 'Staves', 'Daggers', 'Cloth', 'Leather'],
};
const data = {}; data.window = data; vm.createContext(data);
for (const f of ['data/gamedata.js', 'data/suffixes.js']) vm.runInContext(fs.readFileSync(path.join(WEB, f), 'utf8'), data, { filename: f });
const GD = data.GAMEDATA, SFX = data.GAMEDATA_SUFFIX;

function world(cls, tree, level) {
  const store = {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }, key: (i) => Object.keys(store)[i] };
  Object.defineProperty(localStorage, 'length', { get: () => Object.keys(store).length });
  const ctx = { console, localStorage, document: { addEventListener() {} }, GAMEDATA_SUFFIX: SFX };
  ctx.window = ctx; vm.createContext(ctx);
  const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
  const pts = TREES[cls].map((t) => (t === tree ? 31 : 0));
  const skills = SKILLS[cls].map((name) => ({ name, skillLineCategoryID: name === 'Dual Wield' ? 6 : /Cloth|Leather|Mail|Plate|Shield/.test(name) ? 8 : 6 }));
  const CH = { snap: { taken: 1, activeSpec: 1, character: { name: 'Test', level, class: NAME[cls], classFile: cls, faction: 'Alliance' }, skills, bags: [], gearSets: [], equipped: [] },
    specs: { 1: { pts } } };
  ctx.CC = { V: {}, api: {
    get CH() { return CH; }, STATE: {}, esc: String, arr, GD,
    item: () => null, byId: () => null, gdItem: (id) => GD.items[id] || null, gdSourceLines: () => [], itemGates: () => [], recipeLine: () => null,
    planPrice: () => null, anyItemName: (id) => (GD.items[id] || ['#' + id])[0], money: String, render() {}, deOutcome: () => null,
    specTrees: (sp) => sp.pts.map((points) => ({ points, nodes: [] })), specLabel: () => null, TREE_NAMES: TREES,
  } };
  vm.runInContext(fs.readFileSync(path.join(WEB, 'data/rules.js'), 'utf8'), ctx);
  for (const f of ['quests.js', 'weights.js', 'gear.js']) vm.runInContext(fs.readFileSync(path.join(WEB, 'js', f), 'utf8'), ctx, { filename: f });
  const G = ctx.CC.gear, sp = G.specs()[0], pk = G.profileKey(sp);
  return { G, sp, P: G._plan(G.weightsFor(sp, pk), level, G.baseline(sp, pk), {}, false) };
}

let failed = 0;
for (const L of LISTS.lists) {
  const { G, sp, P } = world(L.class, L.tree, L.level);
  console.log(`${L.class} ${L.tree} (weights ${G.profileKey(sp)})`);
  for (const p of L.picks) {
    const slot = P.slots.find((s) => s.name === p.slot);
    // what the app shows for the slot: its pick(s), then the alternatives (weapons after pairing a main hand
    // with an off hand against a two-hander)
    const shown = slot ? slot.targets.concat(slot.alts) : [];
    const at = shown.findIndex((y) => y.c.id === p.id), inPre = slot ? slot.pre.findIndex((y) => y.c.id === p.id) : -1;
    const why = G.availability(p.id);
    const top = shown.map((y) => `${y.c.name} ${y.s.toFixed(1)}`).join('; ');
    const ok = at >= 0 || !!p.disagree;
    if (!ok) failed++;
    const where = at >= 0 ? `shown #${at + 1} (${shown[at].s.toFixed(1)})` : inPre >= 0 ? `#${inPre + 1} of its slot (${slot.pre[inPre].s.toFixed(1)}), not shown` : 'not offered' + (why ? ` (${why})` : '');
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${p.slot}: ${p.name} ${where}${p.disagree && at < 0 ? '; known disagreement: ' + p.disagree : ''}${ok ? '' : '; shown: ' + top}`);
  }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
