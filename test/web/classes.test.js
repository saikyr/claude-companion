// Node test: gear scoring for every class and spec (js/weights.js, js/gear.js, js/advice.js), so a friend on
// any class gets sound advice: which tree a spec is (no talents yet, ties), each default's weights, weapon
// DPS per hand (main, off hand, ranged), what each class may wear (shields, relics, off-hand weapons) and
// Hunter ranged stats. No game, no browser: each case gets a made-up character and a tiny game-data pack.
//   node test/web/classes.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const WEB = path.join(__dirname, '../../ClaudeCompanion/web/js');
const SRC = Object.fromEntries(['weights.js', 'gear.js', 'advice.js'].map((f) => [f, fs.readFileSync(path.join(WEB, f), 'utf8')]));
const RULES = fs.readFileSync(path.join(WEB, '../data/rules.js'), 'utf8');

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };

const TREES = { WARRIOR: ['Arms', 'Fury', 'Protection'], ROGUE: ['Assassination', 'Combat', 'Subtlety'], HUNTER: ['Beast Mastery', 'Marksmanship', 'Survival'],
  MAGE: ['Arcane', 'Fire', 'Frost'], WARLOCK: ['Affliction', 'Demonology', 'Destruction'], PRIEST: ['Discipline', 'Holy', 'Shadow'],
  PALADIN: ['Holy', 'Protection', 'Retribution'], SHAMAN: ['Elemental', 'Enhancement', 'Restoration'], DRUID: ['Balance', 'Feral', 'Restoration'] };
const NAME = { WARRIOR: 'Warrior', ROGUE: 'Rogue', HUNTER: 'Hunter', MAGE: 'Mage', WARLOCK: 'Warlock', PRIEST: 'Priest', PALADIN: 'Paladin', SHAMAN: 'Shaman', DRUID: 'Druid' };
// what each class may wear, as the game's skill list names it (Classic proficiencies)
const SKILLS = {
  WARRIOR: ['Swords', 'Two-Handed Swords', 'Axes', 'Maces', 'Daggers', 'Bows', 'Thrown', 'Cloth', 'Leather', 'Mail', 'Plate Mail', 'Shield', 'Dual Wield'],
  PALADIN: ['Swords', 'Two-Handed Swords', 'Maces', 'Two-Handed Maces', 'Cloth', 'Leather', 'Mail', 'Plate Mail', 'Shield'],
  HUNTER: ['Bows', 'Guns', 'Axes', 'Two-Handed Axes', 'Staves', 'Daggers', 'Cloth', 'Leather', 'Mail', 'Dual Wield'],
  ROGUE: ['Daggers', 'Swords', 'Bows', 'Thrown', 'Cloth', 'Leather'],
  PRIEST: ['Maces', 'Staves', 'Daggers', 'Wands', 'Cloth'], MAGE: ['Swords', 'Staves', 'Daggers', 'Wands', 'Cloth'], WARLOCK: ['Swords', 'Staves', 'Daggers', 'Wands', 'Cloth'],
  SHAMAN: ['Maces', 'Staves', 'Axes', 'Daggers', 'Cloth', 'Leather', 'Mail', 'Shield'],
  DRUID: ['Maces', 'Staves', 'Daggers', 'Cloth', 'Leather'],
};
const skillRows = (cls) => SKILLS[cls].map((name) => ({ name, skillLineCategoryID: name === 'Dual Wield' ? 6 : /Cloth|Leather|Mail|Plate|Shield/.test(name) ? 8 : 6 }));

// A world for one character: the three engines in a fresh context. pack: { id: [name, q, ilvl, req, inv, icon,
// sell, bind, stats, class, tooltip, src, subclass] }; worn: { slot: pack id }; specs: { 1: [points per tree] }
function world(cls, { level = 60, specs = { 1: [0, 0, 0] }, pack = {}, worn = {}, skills } = {}) {
  const store = {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }, key: (i) => Object.keys(store)[i] };
  Object.defineProperty(localStorage, 'length', { get: () => Object.keys(store).length });
  const ctx = { console, localStorage, document: { addEventListener() {} } };
  ctx.window = ctx;
  vm.createContext(ctx);
  const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
  const CH = {
    snap: { taken: 1, activeSpec: 1, character: { name: 'Test', level, class: NAME[cls], classFile: cls, faction: 'Alliance' },
      skills: skills || skillRows(cls), bags: [], gearSets: [],
      equipped: Object.entries(worn).map(([slot, id]) => ({ slot: Number(slot), item: 'item:' + id })) },
    specs: Object.fromEntries(Object.entries(specs).map(([k, pts]) => [k, { pts }])),
  };
  const ITEMS = {};
  Object.entries(worn).forEach(([, id]) => { const g = pack[id]; ITEMS['item:' + id] = { id: Number(id), name: g[0], q: g[1], req: g[3], class: g[9], subclass: g[12], tip: arr(g[10]).map((l) => ({ l })) }; });
  ctx.CC = { V: {}, api: {
    get CH() { return CH; }, STATE: {}, esc: String, arr,
    GD: { items: pack, src: {}, vend: {}, quests: {}, how: Object.fromEntries(Object.keys(pack).map((k) => [k, 'World Drop'])), stat: {}, size: {} },
    item: (k) => ITEMS[k] || null, byId: (id) => ITEMS['item:' + id] || null, gdItem: (id) => pack[id] || null, gdSourceLines: () => [], itemGates: () => [], recipeLine: () => null,
    planPrice: () => null, anyItemName: (id) => (pack[id] || ['#' + id])[0], money: String, render() {}, deOutcome: () => null,
    specTrees: (sp) => (sp.pts ? sp.pts.map((points) => ({ points, nodes: [] })) : null), specLabel: () => null, TREE_NAMES: TREES,
  } };
  vm.runInContext(RULES, ctx);
  Object.entries(SRC).forEach(([f, s]) => vm.runInContext(s, ctx, { filename: f }));
  const G = ctx.CC.gear, W = ctx.CCWeights;
  const plan = (i = 1) => { const sp = G.specs().find((s) => s.i === i), pk = G.profileKey(sp); return G._plan(G.weightsFor(sp, pk), level, G.baseline(sp, pk), {}, false); };
  return { W, G, api: ctx.CC.api, ADV: ctx.CC.advice, CH, plan, slot: (P, name) => P.slots.find((s) => s.name === name), store };
}

// pack rows. inv: 13 one-hand, 14 shield, 15 bow, 17 two-hand, 21 main hand, 22 off-hand weapon, 23 held in off hand,
// 26 gun / crossbow / wand, 28 relic. class 2 weapon, 4 armor.
const weapon = (name, inv, sub, dps, stats = [], req = 50) => [name, 3, 55, req, inv, 0, 100, 2, stats, 2, [`(${dps.toFixed(1)} damage per second)`], 'e', sub];
const armor = (name, inv, sub, stats, tip = [], req = 50) => [name, 3, 55, req, inv, 0, 100, 2, stats, 4, tip, 'e', sub];

const { W } = world('WARRIOR');

// ---------------------------------------------------------------- which tree a spec is
test('no talent points yet: every class uses the tree it levels in, not its first tree', () => {
  const want = { WARRIOR: 'Arms', PALADIN: 'Retribution', HUNTER: 'Beast Mastery', ROGUE: 'Combat', PRIEST: 'Shadow', MAGE: 'Frost', WARLOCK: 'Affliction', SHAMAN: 'Enhancement', DRUID: 'Feral' };
  for (const cls of Object.keys(TREES)) {
    const { G } = world(cls, { level: 8 });
    const sp = G.specs()[0];
    assert.strictEqual(sp.tree, want[cls], `${cls}: ${sp.tree}`);
    assert.strictEqual(sp.treeWhy, 'none');
    const w = G.weightsFor(sp, G.profileKey(sp));
    assert(w && Object.keys(w).length >= 3, `${cls}: weights for a talentless character`);
  }
});
test('the biggest tree wins; a tie goes to the levelling tree when it is one of them', () => {
  for (const [cls, names] of Object.entries(TREES)) {
    names.forEach((t, i) => { const pts = [0, 0, 0]; pts[i] = 31; pts[(i + 1) % 3] = 20; assert.strictEqual(W.pickTree(cls, pts).tree, t, `${cls} ${pts}`); });
  }
  assert.deepStrictEqual(JSON.parse(JSON.stringify(W.pickTree('PALADIN', [20, 0, 20]))), { tree: 'Retribution', why: 'tie' });
  assert.strictEqual(W.pickTree('PRIEST', [20, 20, 0]).tree, 'Discipline', 'a tie without the levelling tree: the first of them');
  assert.strictEqual(W.pickTree('MAGE', null).why, 'unknown');
  assert.strictEqual(W.pickTree('MAGE', [10, 10]).why, 'unknown', 'two numbers for three trees: not trusted');
});
test('classic talent tabs, matched to trees by name, when the trait trees are missing', () => {
  const { G, CH } = world('DRUID');
  CH.specs = { 1: { talents: { tabs: [{ name: 'Feral Combat', points: 31 }, { name: 'Restoration', points: 20 }, { name: 'Balance', points: 0 }] } } };
  const sp = G.specs()[0];
  assert.strictEqual(sp.tree, 'Feral'); assert.deepStrictEqual(Array.from(sp.points), [0, 31, 20]);
});
test('trait trees the layout split into four groups: the widest gaps still find three trees', () => {
  const { G, CH, api } = world('PRIEST');
  const node = (x, rank) => ({ x, y: 100, rank });
  // tree 1 at 0-1800, tree 2 at 4000-5800 with an empty column (a 1200 gap inside it), tree 3 at 8000
  const nodes = [node(0, 5), node(600, 0), node(4000, 0), node(4600, 0), node(5800, 5), node(5800, 30), node(8000, 1)];
  CH.specs = { 1: { pts: null } };
  const groups = [[nodes[0], nodes[1]], [nodes[2], nodes[3]], [nodes[4], nodes[5]], [nodes[6]]];
  // the page's layout: one entry per group it found, each with its nodes and points
  api.specTrees = () => groups.map((ns) => ({ nodes: ns, points: ns.reduce((a, n) => a + n.rank, 0) }));
  const sp = G.specs()[0];
  assert.deepStrictEqual(Array.from(sp.points), [5, 35, 1]); assert.strictEqual(sp.tree, 'Holy');
});

// ---------------------------------------------------------------- the default weights, per class
const def = (cls, tree, nth = 0) => W.forClass(cls, tree).filter((p) => p.trees.includes(tree))[nth];
test('casters and healers give nothing for Strength, attack power or weapon DPS', () => {
  const list = [['MAGE', 'Arcane'], ['MAGE', 'Fire'], ['MAGE', 'Frost'], ['WARLOCK', 'Affliction'], ['WARLOCK', 'Demonology'], ['WARLOCK', 'Destruction'],
    ['PRIEST', 'Discipline'], ['PRIEST', 'Holy'], ['PRIEST', 'Shadow'], ['PALADIN', 'Holy'], ['SHAMAN', 'Elemental'], ['SHAMAN', 'Restoration'],
    ['DRUID', 'Balance'], ['DRUID', 'Restoration']];
  for (const [cls, t] of list) {
    const w = W.get(W.defaultFor(cls, t)).w;
    for (const k of [4, 38, 39, 'dps', 'rdps']) assert(!w[k], `${cls} ${t}: weighs ${k}`);
    assert(w[45] > 0, `${cls} ${t}: spell power counts`);
  }
});
test('healers count healing; damage casters count their own schools', () => {
  for (const [cls, t] of [['PRIEST', 'Holy'], ['PRIEST', 'Discipline'], ['PALADIN', 'Holy'], ['SHAMAN', 'Restoration'], ['DRUID', 'Restoration']]) {
    const w = W.get(W.defaultFor(cls, t)).w; assert(w[41] > 0 && w[41] === w[45], `${cls} ${t}: healing = spell power`);
  }
  const school = { 110: 'fire', 111: 'shadow', 112: 'frost', 113: 'arcane', 114: 'nature', 115: 'holy' };
  const want = { 'MAGE/Fire': [110], 'MAGE/Frost': [112], 'MAGE/Arcane': [113], 'WARLOCK/Affliction': [111], 'PRIEST/Shadow': [111], 'DRUID/Balance': [113, 114], 'SHAMAN/Elemental': [110, 112, 114] };
  for (const [k, ids] of Object.entries(want)) {
    const [cls, t] = k.split('/'), w = W.get(W.defaultFor(cls, t)).w;
    Object.keys(school).forEach((id) => assert.strictEqual(!!w[id], ids.includes(Number(id)), `${k}: ${school[id]} damage`));
  }
});
test('melee specs weigh their melee weapon, not the ranged one', () => {
  for (const [cls, t] of [['WARRIOR', 'Arms'], ['WARRIOR', 'Fury'], ['ROGUE', 'Assassination'], ['ROGUE', 'Combat'], ['ROGUE', 'Subtlety'],
    ['PALADIN', 'Retribution'], ['SHAMAN', 'Enhancement'], ['DRUID', 'Feral']]) {
    const w = def(cls, t).w;
    assert(w.dps > 0, `${cls} ${t}: melee DPS`); assert(!w.rdps, `${cls} ${t}: no ranged DPS`);
    assert(!w[5] || ['PALADIN', 'SHAMAN'].includes(cls), `${cls} ${t}: no Intellect`);
  }
});
test('Hunters: ranged specs weigh the bow, Survival both; ranged attack power counts', () => {
  for (const t of ['Beast Mastery', 'Marksmanship']) {
    const w = W.get(W.defaultFor('HUNTER', t)).w;
    assert(w.rdps > 0 && !w.dps, `${t}: ranged DPS only`); assert(w[39] > 0 && w[39] === w[38], `${t}: ranged attack power = attack power`);
    assert(!w[4], `${t}: Strength gives no ranged attack power`);
  }
  const sv = W.get(W.defaultFor('HUNTER', 'Survival')).w;
  assert(sv.dps > 0 && sv.rdps > 0 && sv[4] > 0, 'Survival: melee and ranged DPS, Strength for melee attack power');
});
test('stats a guide does not rank still count for the attack power they give', () => {
  for (const t of TREES.ROGUE) { const w = W.get(W.defaultFor('ROGUE', t)).w; assert(Math.abs(w[4] - w[38]) < 0.001, `Rogue ${t}: 1 Strength = 1 attack power`); }
});
test('tanks always count armor', () => {
  for (const p of [def('WARRIOR', 'Protection', 0), def('WARRIOR', 'Protection', 1), W.get(W.defaultFor('PALADIN', 'Protection')), def('DRUID', 'Feral', 1)]) assert(p.w[100] > 0, p.name);
});
test('every default for every class: only known stats, positive finite numbers, a reason for each', () => {
  const known = new Set(Object.values(W.S).map(String).concat(['110', '111', '112', '113', '114', '115', 'dps', 'rdps']));
  for (const p of Object.values(W.BUILTIN)) {
    for (const [k, v] of Object.entries(p.w)) {
      assert(known.has(k), `${p.cls} ${p.name}: unknown stat ${k}`);
      assert(v > 0 && isFinite(v), `${p.cls} ${p.name}: ${k} = ${v}`);
      assert((p.why || p.basis || {})[k], `${p.cls} ${p.name}: no reason for ${k}`);
    }
  }
});

// ---------------------------------------------------------------- weapon DPS per hand
test('weapon DPS: full in the main hand, half in the off hand, the ranged number in the Ranged slot', () => {
  const w = { dps: 2, rdps: 3 };
  assert.strictEqual(W.score({ dps: 10 }, w, 'Main hand'), 20);
  assert.strictEqual(W.score({ dps: 10 }, w, 'Off hand'), 10);
  assert.strictEqual(W.score({ dps: 10 }, w, 17), 10, 'game slot numbers work too');
  assert.strictEqual(W.score({ dps: 10 }, w, 'Ranged'), 30);
  assert.strictEqual(W.score({ dps: 10 }, { dps: 2 }, 'Ranged'), 0, 'no ranged number: a ranged weapon\'s DPS counts nothing');
});
test('a Beast Mastery Hunter: the bow\'s DPS matters, a melee weapon is a stat stick', () => {
  const pack = { 1: weapon('Sharp Bow', 15, 2, 30), 2: weapon('Plain Bow', 15, 2, 20), 3: weapon('Huge Axe', 17, 1, 60), 4: weapon('Agile Staff', 17, 10, 20, [[3, 20]]), 5: weapon('Dull Staff', 17, 10, 10) };
  const { plan, slot } = world('HUNTER', { specs: { 1: [31, 20, 0] }, pack, worn: { 18: 2, 16: 5 } });
  const P = plan();
  assert(slot(P, 'Ranged').ups.some((y) => y.c.id === 1), 'the faster bow is an upgrade');
  const mh = slot(P, 'Main hand').ups;
  assert(mh.some((y) => y.c.id === 4), 'the Agility staff is an upgrade');
  assert(!mh.some((y) => y.c.id === 3), 'a high-DPS axe with no stats is not');
});
test('a Rogue: a faster bow with no stats is no upgrade; the off hand counts half its DPS', () => {
  const pack = { 1: weapon('Sharp Bow', 15, 2, 30), 2: weapon('Plain Bow', 15, 2, 20), 3: weapon('Dagger A', 13, 15, 40), 4: weapon('Dagger B', 13, 15, 30) };
  const { plan, slot, W: W2, ADV } = world('ROGUE', { specs: { 1: [0, 31, 20] }, pack, worn: { 18: 2, 16: 3, 17: 4 } });
  const P = plan();
  assert(!slot(P, 'Ranged').ups.length, 'no ranged upgrade from DPS alone');
  const oh = slot(P, 'Off hand'), w = W2.get(W2.defaultFor('ROGUE', 'Combat')).w;
  assert(Math.abs(oh.cur[0].s - 30 * w.dps * W2.OFF_HAND_DPS) < 0.01, 'off-hand dagger: half its DPS');
  const best = ADV.bestOwned({ i: 1 }).rows.find((r) => r.name === 'Weapons');
  assert.strictEqual(best.best[0].it.id, 3, 'best owned: the faster dagger in the main hand');
});
test('a caster\'s wand: its DPS is not scored, its stats are', () => {
  const pack = { 1: weapon('Fast Wand', 26, 19, 40), 2: weapon('Smart Wand', 26, 19, 20, [[5, 5]]) };
  const { plan, slot } = world('MAGE', { specs: { 1: [0, 0, 31] }, pack });
  const r = slot(plan(), 'Ranged');
  assert(r.ups[0].c.id === 2 && !r.ups.some((y) => y.c.id === 1));
});

// ---------------------------------------------------------------- who wears what
test('shields: only classes with the Shield skill, even when the pack files one as Miscellaneous', () => {
  const pack = { 1: armor('Misfiled Shield', 14, 0, [[7, 10], [100, 1500]], ['Off Hand', 'Shield']), 2: armor('Orb', 23, 0, [[5, 5]], ['Held In Off-hand']) };
  for (const cls of Object.keys(TREES)) {
    const { plan, slot, G } = world(cls, { specs: { 1: [31, 0, 0] }, pack });
    assert.strictEqual(G.packSub(pack[1]), 6, 'read as a shield');
    const ids = slot(plan(), 'Off hand').pre.map((y) => y.c.id);
    assert.strictEqual(ids.includes(1), ['WARRIOR', 'PALADIN', 'SHAMAN'].includes(cls), `${cls}: shield ${ids.includes(1) ? 'offered' : 'not offered'}`);
    assert(ids.includes(2), `${cls}: a held-in-off-hand item is for anyone`);
  }
});
test('a tooltip armor type beats the pack\'s subclass', () => {
  const { G } = world('MAGE');
  assert.strictEqual(G.packSub(armor('Boots', 8, 3, [], ['Feet', 'Cloth'])), 1);
  assert.strictEqual(G.packSub(armor('Boots', 8, 3, [])), 3, 'no type line: the pack\'s');
  assert.strictEqual(G.packSub(['x', 1, 1, 1, 8, 0, 0, 0, [], 4, ['Cloth'], 'f', 3]), 3, 'ForeverDB-only tooltips are not read');
});
test('relics: each class its own (Libram, Idol, Totem), nobody else', () => {
  const pack = { 7: armor('Libram', 28, 7, [[5, 1]]), 8: armor('Idol', 28, 8, [[5, 1]]), 9: armor('Totem', 28, 9, [[5, 1]]) };
  const mine = { PALADIN: 7, DRUID: 8, SHAMAN: 9 };
  for (const cls of Object.keys(TREES)) {
    const { plan, slot } = world(cls, { specs: { 1: [31, 0, 0] }, pack });
    const ids = slot(plan(), 'Ranged').pre.map((y) => y.c.id);
    assert.strictEqual(JSON.stringify(ids), JSON.stringify(mine[cls] ? [mine[cls]] : []), cls);
  }
});
test('off-hand weapons only with Dual Wield; two-handers for anyone with the skill', () => {
  const pack = { 1: weapon('Sword', 13, 7, 30, [[4, 5]]), 2: weapon('Parry Dagger', 22, 15, 20, [[3, 5]]) };
  for (const cls of ['WARRIOR', 'ROGUE', 'HUNTER', 'PALADIN', 'MAGE']) {
    const { plan, slot } = world(cls, { specs: { 1: [31, 0, 0] }, pack });
    const ids = slot(plan(), 'Off hand').pre.map((y) => y.c.id), dual = ['WARRIOR', 'ROGUE', 'HUNTER'].includes(cls);
    assert.strictEqual(ids.includes(2), dual && cls !== 'PALADIN' && SKILLS[cls].includes('Daggers'), `${cls}: off-hand dagger`);
    if (!dual) assert(!ids.includes(1), `${cls}: no one-hander in the off hand`);
  }
});
test('a Protection Warrior: a plate chest beats a cloth robe with the same stats', () => {
  const pack = { 1: armor('Plate Chest', 5, 4, [[7, 20], [100, 600]]), 2: armor('Cloth Robe', 20, 1, [[7, 20], [100, 80]]) };
  for (const nth of [0, 1]) {
    const { G, plan, slot } = world('WARRIOR', { specs: { 1: [0, 5, 31] }, pack });
    if (nth) G.setProfile(G.specs()[0], def('WARRIOR', 'Protection', 1).id);
    assert.strictEqual(slot(plan(), 'Chest').pre[0].c.id, 1, `profile ${nth}`);
  }
});

// ---------------------------------------------------------------- your own profiles from before per-hand DPS
test('a Hunter\'s own profile from before: its DPS number moves to the bow once', () => {
  const { W: W2, store } = world('HUNTER');
  store['cc.weights.v1'] = JSON.stringify({ profiles: { u1: { id: 'u1', cls: 'HUNTER', own: true, name: 'Mine', w: { 3: 1, dps: 3 }, from: 'iv-bm' }, u2: { id: 'u2', cls: 'WARRIOR', own: true, name: 'War', w: { dps: 3 }, from: 'iv-arms' } } });
  const p = W2.get('u1');
  assert.strictEqual(p.w.rdps, 3); assert.strictEqual(p.w.dps, undefined, 'copied from a ranged spec: the melee weapon no longer counts');
  assert.strictEqual(W2.get('u2').w.dps, 3, 'other classes keep theirs');
  W2.set('u1', 'rdps', 0);
  assert.strictEqual(W2.get('u1').w.rdps, undefined, 'an edit after the move stays');
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
