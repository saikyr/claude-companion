// Node test for the app's stat weights (js/weights.js) and item advice (js/advice.js), run with the
// Gear tab's helpers (js/gear.js) against a made-up level 58 Warrior: no game, no browser.
//   node test/web/advice.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const WEB = path.join(__dirname, '../../ClaudeCompanion/web/js');

const store = {};
const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }, key: (i) => Object.keys(store)[i] };
Object.defineProperty(localStorage, 'length', { get: () => Object.keys(store).length });
const ctx = { console, localStorage, document: { addEventListener() {} }, Object, JSON, Math, Number, String, Array, Set, Date, RegExp, isFinite };
ctx.window = ctx;
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(path.join(WEB, f), 'utf8'), ctx, { filename: f });

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };

// ---------------------------------------------------------------- weights alone
load('weights.js');
const W = ctx.CCWeights;
test('every class and spec has a sourced default', () => {
  const trees = { WARRIOR: ['Arms', 'Fury', 'Protection'], ROGUE: ['Assassination', 'Combat', 'Subtlety'], HUNTER: ['Beast Mastery', 'Marksmanship', 'Survival'],
    MAGE: ['Arcane', 'Fire', 'Frost'], WARLOCK: ['Affliction', 'Demonology', 'Destruction'], PRIEST: ['Discipline', 'Holy', 'Shadow'],
    PALADIN: ['Holy', 'Protection', 'Retribution'], SHAMAN: ['Elemental', 'Enhancement', 'Restoration'], DRUID: ['Balance', 'Feral', 'Restoration'] };
  for (const [cls, ts] of Object.entries(trees)) for (const t of ts) {
    const id = W.defaultFor(cls, t), p = W.get(id);
    assert(p, `${cls} ${t} has no default`);
    assert(Object.keys(p.w).length >= 3, `${cls} ${t} has too few weights`);
    assert(p.src && p.src.label, `${cls} ${t} has no source`);
  }
  assert.strictEqual(Object.values(W.BUILTIN).filter((p) => p.src.url).length, 27, '27 guide-order profiles with a link (Priests use the worked-out ones)');
  // Priests: worked-out numbers with a reason for every stat, and the guide's order kept for comparison
  for (const t of ['Discipline', 'Holy', 'Shadow']) {
    const p = W.get(W.defaultFor('PRIEST', t));
    assert.strictEqual(p.name, t, `the Priest ${t} default is named ${t}`);
    Object.keys(p.w).filter((k) => !W.PCT[k]).forEach((k) => assert(p.why[k], `${t}: a reason for stat ${k}`));
    assert(p.guide && p.guide.order.length, `${t}: the guide order for comparison`);
  }
  assert(Object.values(W.BUILTIN).every((p) => !/guide order|mana model|project weights|:/.test(p.name)), 'plain profile names');
  assert(Object.values(W.BUILTIN).filter((p) => p.basis).every((p) => Object.values(p.basis).every((b) => !/× cost/.test(b))), 'reasons in plain words');
  assert(['healing', 'disc', 'shadow'].every((id) => Object.keys(W.BUILTIN[id].w).every((k) => !W.PCT[k])), 'worked-out profiles leave "%" lines to their rating');
});
test('weapon specs weigh weapon DPS at 14 attack power', () => {
  const arms = W.get('iv-arms');
  assert(arms.w.dps > 0 && Math.abs(arms.w.dps - arms.w[38] * 14) < 0.01);
  assert.strictEqual(W.get('iv-arcane').w.dps, undefined, 'casters do not weigh weapon DPS');
});
test('guide order shows in the numbers (per point of budget)', () => {
  const fire = W.get('iv-fire').w, cost = (k) => W.COST[k][0];
  assert(fire[31] / cost(31) > fire[45] / cost(45) && fire[45] > fire[32] / cost(32) && fire[5] > fire[6]);
  assert(fire[110] === fire[45] && !fire[111], 'fire mage counts fire damage, not shadow');
});
test('% lines count as rating', () => {
  assert.strictEqual(W.score({ 116: 1 }, { 32: 0.5 }), 7);
  assert.strictEqual(W.score({ 117: 1 }, { 31: 1 }), 10);
});
test('your own profiles: copy, edit, rename, reset, delete', () => {
  const id = W.create('WARRIOR', 'iv-arms');
  assert.strictEqual(W.get(id).name, 'Arms (mine)');
  W.set(id, 4, 2); assert.strictEqual(W.get(id).w[4], 2);
  W.set(id, 4, ''); assert.strictEqual(W.get(id).w[4], undefined);
  W.rename(id, 'Arms raid'); assert.strictEqual(W.get(id).name, 'Arms raid');
  W.reset(id); assert.strictEqual(W.get(id).w[4], W.get('iv-arms').w[4]);
  assert.strictEqual(W.custom('WARRIOR').length, 1);
  W.remove(id); assert.strictEqual(W.get(id), null);
});
test('the old "Your own weights" move into a profile once', () => {
  store['cc.gear.own.Tank.1'] = JSON.stringify({ 4: 1, 7: 0.5 });
  store['cc.gear.profile.Tank.1'] = 'own';
  const id = W.migrate('Tank', 1, 'WARRIOR');
  assert.strictEqual(store['cc.gear.profile.Tank.1'], id);
  assert.strictEqual(W.get(id).w[7], 0.5);
  assert.strictEqual(store['cc.gear.own.Tank.1'], undefined);
  W.remove(id); delete store['cc.gear.profile.Tank.1'];
});
test('the move points the page\'s own key (Name-Realm) at the new profile', () => {
  store['cc.gear.own.Tank.0'] = JSON.stringify({ 4: 1 });
  store['cc.gear.profile.Tank.0'] = 'own';
  const id = W.migrate('Tank', 0, 'WARRIOR', 'cc.gear.profile.Tank-Realm.spec1');
  assert.strictEqual(store['cc.gear.profile.Tank-Realm.spec1'], id);
  assert.strictEqual(store['cc.gear.profile.Tank.0'], undefined, 'the old per-index key is gone');
  W.remove(id); delete store['cc.gear.profile.Tank-Realm.spec1'];
});

// ---------------------------------------------------------------- the engine, a level 58 Warrior
const tip = (...l) => l.map((x) => ({ l: x }));
const ITEMS = {
  'item:1': { id: 1, name: 'Old Greatsword', q: 2, ilvl: 50, req: 48, class: 2, subclass: 8, loc: 'INVTYPE_2HWEAPON', sell: 5000, stats: { ITEM_MOD_STRENGTH_SHORT: 10 }, tip: tip('Old Greatsword', '(40.0 damage per second)') },
  'item:2': { id: 2, name: 'New Greatsword', q: 3, ilvl: 58, req: 55, class: 2, subclass: 8, loc: 'INVTYPE_2HWEAPON', sell: 9000, bind: 2, stats: { ITEM_MOD_STRENGTH_SHORT: 10 }, tip: tip('New Greatsword', '(50.0 damage per second)') },
  'item:3': { id: 3, name: 'Ring A', q: 2, ilvl: 50, req: 45, class: 4, subclass: 0, loc: 'INVTYPE_FINGER', sell: 100, stats: { ITEM_MOD_STRENGTH_SHORT: 5 }, tip: tip('Ring A') },
  'item:4': { id: 4, name: 'Ring B', q: 2, ilvl: 50, req: 45, class: 4, subclass: 0, loc: 'INVTYPE_FINGER', sell: 100, stats: { ITEM_MOD_STRENGTH_SHORT: 3 }, tip: tip('Ring B') },
  'item:5': { id: 5, name: 'Ring C', q: 3, ilvl: 55, req: 50, class: 4, subclass: 0, loc: 'INVTYPE_FINGER', sell: 100, stats: { ITEM_MOD_STRENGTH_SHORT: 8, ITEM_MOD_HIT_RATING_SHORT: 10 }, tip: tip('Ring C') },
  'item:6': { id: 6, name: 'Silk Robe', q: 2, ilvl: 50, req: 45, class: 4, subclass: 1, loc: 'INVTYPE_ROBE', sell: 800, bind: 2, stats: { ITEM_MOD_INTELLECT_SHORT: 20 }, tip: tip('Silk Robe') },
  'item:7': { id: 7, name: 'Lost Letter', q: 1, class: 12, subclass: 0, sell: 0, tip: tip('Lost Letter', 'Quest Item') },
  'item:8': { id: 8, name: 'Vault Key', q: 1, class: 13, subclass: 0, sell: 0, tip: tip('Vault Key') },
  'item:9': { id: 9, name: 'Broken Fang', q: 0, class: 15, subclass: 0, sell: 300, tip: tip('Broken Fang') },
  'item:10': { id: 10, name: 'Future Helm', q: 3, ilvl: 63, req: 60, class: 4, subclass: 4, loc: 'INVTYPE_HEAD', sell: 2000, stats: { ITEM_MOD_STRENGTH_SHORT: 30 }, tip: tip('Future Helm') },
  'item:11': { id: 11, name: 'Plate Cap', q: 2, ilvl: 40, req: 35, class: 4, subclass: 4, loc: 'INVTYPE_HEAD', sell: 400, stats: { ITEM_MOD_STRENGTH_SHORT: 6 }, tip: tip('Plate Cap') },
  'item:12': { id: 12, name: 'Runecloth', q: 1, class: 7, subclass: 0, sell: 400, tip: tip('Runecloth') },
};
// items you don't own, as the game-data pack has them: [name, q, ilvl, req, inv, , , bind, stats, class, tooltip, src, subclass]
const PACK = { 20: ['Reward Helm', 3, 58, 50, 1, 0, 0, 1, [[4, 20]], 4, [], 'e', 4], 21: ['Reward Robe', 2, 55, 50, 20, 0, 0, 1, [[5, 20]], 4, [], 'e', 1] };
const BY_ID = {}; Object.entries(ITEMS).forEach(([k, it]) => (BY_ID[it.id] = Object.assign({ key: k }, it)));
const CH = {
  snap: {
    taken: 1, activeSpec: 1,
    character: { name: 'Tank', level: 58, class: 'Warrior', classFile: 'WARRIOR', faction: 'Alliance' },
    skills: [{ name: 'Two-Handed Swords', skillLineCategoryID: 6 }, { name: 'Plate Mail', skillLineCategoryID: 8 }, { name: 'Mail', skillLineCategoryID: 8 }],
    equipped: [{ slot: 16, slotName: 'MainHand', item: 'item:1' }, { slot: 11, slotName: 'Finger1', item: 'item:3' }, { slot: 12, slotName: 'Finger2', item: 'item:4' }, { slot: 1, slotName: 'Head', item: 'item:11' }],
    bags: [{ id: 0, slots: 16, items: [2, 5, 6, 7, 8, 9, 10, 12].map((n, i) => ({ slot: i + 1, item: 'item:' + n, count: 1 })) }],
    gearSets: [],
  },
  specs: { 1: { tree: 'Arms' } },
  ah: { prices: { 6: { id: 6, obs: [{ src: 'scan', min: 30000, med: 30000, qty: 4, t: 1 }] } } },
};
const esc = (s) => String(s == null ? '' : s);
const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
ctx.CC = { V: {}, api: {
  get CH() { return CH; }, STATE: {}, GD: { items: {}, src: {}, vend: {}, quests: {}, how: {}, stat: {} }, esc, arr,
  item: (k) => ITEMS[k] || null, byId: (id) => BY_ID[id] || null, gdItem: (id) => PACK[id] || null, gdSourceLines: () => [], itemGates: () => [], recipeLine: () => null,
  planPrice: (id) => { const p = CH.ah.prices[id]; return p ? p.obs[0].med : null; }, anyItemName: (id) => (BY_ID[id] || {}).name || '#' + id,
  anyItemIcon: () => '', itemIcon: () => '', money: (c) => String(c), render() {}, deOutcome: () => null,
  specTrees: (sp) => [{ points: sp.tree === 'Arms' ? 31 : 0 }, { points: 5 }, { points: 15 }], specLabel: (sp) => sp.tree, TREE_NAMES: { WARRIOR: ['Arms', 'Fury', 'Protection'] },
} };
load('../data/rules.js'); load('gear.js'); load('advice.js');
const ADV = ctx.CC.advice;
const flag = (n) => ADV.of('item:' + n);
test('a better two-hander is an upgrade for Arms', () => { assert.strictEqual(flag(2).flag, 'up'); assert.match(flag(2).words, /Arms/); });
test('a ring that beats the weaker worn ring is an upgrade', () => { const v = flag(5); assert.strictEqual(v.flag, 'up'); assert.strictEqual(v.specs[0].vs.id, 4, 'compared with the weaker ring'); });
test('cloth a Warrior cannot wear: sold the best way (AH beats vendor)', () => { const v = flag(6); assert.strictEqual(v.flag, 'ah'); assert.match(v.why, /can't use/); });
test('quest items and keys are kept, never sold', () => { assert.strictEqual(flag(7).flag, 'keep'); assert.strictEqual(flag(8).flag, 'keep'); assert.match(flag(8).words, /key/); });
test('grey items go to a vendor', () => { assert.strictEqual(flag(9).flag, 'sell'); });
test('gear above your level is an upgrade later', () => { assert.strictEqual(flag(10).flag, 'up'); assert.strictEqual(flag(10).later, 60); });
test('trade goods get no advice', () => { assert.strictEqual(flag(12).flag, null); });
test('worn items carry no flag', () => { assert.strictEqual(flag(1).flag, null); });
test('best from what you own: the two best rings, and the better weapon', () => {
  const b = ADV.bestOwned(ctx.CC.gear.specs()[0]);
  const rings = b.rows.find((r) => r.name === 'Ring');
  assert.strictEqual(JSON.stringify(rings.best.map((p) => p.it.id)), "[5,3]");
  assert(rings.gain > 0);
  const weap = b.rows.find((r) => r.name === 'Weapons');
  assert.strictEqual(weap.best[0].it.id, 2);
  assert(!b.rows.find((r) => r.name === 'Head').best.some((p) => p.it.id === 10), 'level 60 helm left out at 58');
});
test('character sheet: the weaker ring slot is marked', () => { const h = ADV.slotHint(12); assert(h && h.name === 'Ring C'); assert.strictEqual(ADV.slotHint(11), null); });
test('snapshot lists flagged items with their reasons', () => {
  const s = ADV.snapshot();
  assert(s.find((x) => x.name === 'Silk Robe' && x.flag === 'ah' && x.value === 28500));
  assert(!s.find((x) => x.name === 'Lost Letter'), 'kept items are not listed');
});

test('quest rewards you do not own are scored per spec by the same engine', () => {
  const r = ADV.rate(20);
  assert.strictEqual(r.name, 'Reward Helm');
  const arms = r.specs.find((x) => x.spec === 'Arms');
  assert(arms && arms.canWear && arms.slot === 'Head' && arms.gain > 0, 'a better plate helm is an Arms upgrade over the worn cap');
  assert.strictEqual(arms.vs.id, 11);
  assert(ADV.rate(21).specs.every((x) => !x.canWear), 'cloth: scored, but a Warrior cannot wear it');
  assert.match(ADV.rewardLine(20), /Arms \+/);
  assert.strictEqual(ADV.rewardLine(21), '');
  assert.strictEqual(ADV.rate('item:5').specs[0].gain > 0, true, 'an owned item by its key');
});

// ---------------------------------------------------------------- weapons: two-hander, one-hander + off hand, dual wield
Object.assign(ITEMS, {
  'item:30': { id: 30, name: 'Keen Sword', q: 3, ilvl: 55, req: 50, class: 2, subclass: 7, loc: 'INVTYPE_WEAPON', sell: 100, stats: { ITEM_MOD_STRENGTH_SHORT: 8 }, tip: tip('Keen Sword') },
  'item:31': { id: 31, name: 'Spare Sword', q: 2, ilvl: 50, req: 45, class: 2, subclass: 7, loc: 'INVTYPE_WEAPON', sell: 100, stats: { ITEM_MOD_STRENGTH_SHORT: 6 }, tip: tip('Spare Sword') },
  'item:32': { id: 32, name: 'Parry Blade', q: 2, ilvl: 50, req: 45, class: 2, subclass: 7, loc: 'INVTYPE_WEAPONOFFHAND', sell: 100, stats: { ITEM_MOD_STRENGTH_SHORT: 5 }, tip: tip('Parry Blade') },
  'item:33': { id: 33, name: 'Tower Shield', q: 2, ilvl: 50, req: 45, class: 4, subclass: 6, loc: 'INVTYPE_SHIELD', sell: 100, stats: { ITEM_MOD_STRENGTH_SHORT: 4 }, tip: tip('Tower Shield') },
});
Object.entries(ITEMS).forEach(([k, it]) => (BY_ID[it.id] = Object.assign({ key: k }, it)));
const SK = CH.snap.skills.slice();
const setup = (n, extraSkills, equipped, bagIds) => {
  CH.snap.taken = n;
  CH.snap.skills = SK.concat([{ name: 'One-Handed Swords', skillLineCategoryID: 6 }, { name: 'Shield', skillLineCategoryID: 8 }], extraSkills);
  CH.snap.equipped = equipped;
  CH.snap.bags = [{ id: 0, slots: 16, items: bagIds.map((id, i) => ({ slot: i + 1, item: 'item:' + id, count: 1 })) }];
};
const G = ctx.CC.gear;
const planFor = () => { const sp = G.specs()[0], pk = G.profileKey(sp); return G._plan(G.weightsFor(sp, pk), 58, G.baseline(sp, pk), {}, false); };
const slot = (P, name) => P.slots.find((s) => s.name === name);
test('a worn two-hander: a better two-hander counts, the off hand is blocked', () => {
  setup(10, [], [{ slot: 16, slotName: 'MainHand', item: 'item:1' }], [2, 30, 33]);
  const P = planFor();
  assert(slot(P, 'Off hand').blocked, 'off hand blocked under a two-hander');
  assert(slot(P, 'Main hand').ups.some((y) => y.c.id === 2), 'the better two-hander is a main-hand upgrade');
  assert(ADV.rate('item:33').specs[0].blocked, 'a shield is measured as blocked, not as a loss');
});
test('one-hander + shield: a two-hander must beat both', () => {
  setup(11, [], [{ slot: 16, slotName: 'MainHand', item: 'item:30' }, { slot: 17, slotName: 'SecondaryHand', item: 'item:33' }], [2]);
  const sp = G.specs()[0], C = ADV.compute(), c = C.ctxs[0];
  const m = ADV.rate('item:2').specs.find((x) => x.spec === 'Arms');
  const s = (k) => W.score(ADV.statsOf(k), c.w);
  assert(Math.abs(m.gain - (s('item:2') - s('item:30') - s('item:33'))) < 0.01, 'two-hander gain = its score minus main hand and off hand');
  assert(sp);
});
test('without Dual Wield: no one-hander or off-hand weapon in the off hand', () => {
  setup(12, [], [{ slot: 16, slotName: 'MainHand', item: 'item:30' }], [31, 32, 33]);
  const oh = slot(planFor(), 'Off hand');
  assert(!oh.pre.some((y) => y.c.id === 31 || y.c.id === 32), 'one-hander and off-hand weapon left out of the off hand');
  assert(oh.pre.some((y) => y.c.id === 33), 'the shield counts');
  assert(ADV.rate('item:32').specs.every((x) => !x.canWear), 'an off-hand weapon needs Dual Wield');
  assert.strictEqual(ADV.rate('item:31').specs[0].slot, 'Main hand');
});
test('with Dual Wield: a second one-hander is an off-hand upgrade', () => {
  setup(13, [{ name: 'Dual Wield', skillLineCategoryID: 6 }], [{ slot: 16, slotName: 'MainHand', item: 'item:30' }], [31, 32]);
  const oh = slot(planFor(), 'Off hand');
  assert(oh.ups.some((y) => y.c.id === 31), 'a one-hander in the off hand');
  assert(oh.ups.some((y) => y.c.id === 32), 'an off-hand weapon');
  const m = ADV.rate('item:31').specs.find((x) => x.spec === 'Arms');
  assert.strictEqual(m.slot, 'Off hand', 'measured where it gains most: the empty off hand');
  assert(m.gain > 0);
  const weap = ADV.bestOwned(G.specs()[0]).rows.find((r) => r.name === 'Weapons');
  assert.strictEqual(JSON.stringify(weap.best.map((p) => p.it.id)), '[30,31]', 'best owned: two one-handers');
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
