// Node test for enchant advice (js/enchants.js, #147): reading an enchant's text as stats, which enchants fit which
// item, where the stats come from (the game first, Classic data labelled), and one spec's slots: the enchant on
// each, empty ones, and the best you can get or apply now. No game, no browser.
//   node test/web/enchants.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const WEB = path.join(__dirname, '../../ClaudeCompanion/web/js');

const ctx = { console, document: { addEventListener() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, Object, JSON, Math, Number, String, Array, Set, Date, RegExp, isFinite };
ctx.window = ctx;
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(path.join(WEB, f), 'utf8'), ctx, { filename: f });
let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };

// ---------------------------------------------------------------- a made-up character and pack
const tip = (...l) => l.map((x) => ({ l: x }));
const ITEMS = {
  // a robe with the Classic "Superior Mana" enchant id, whose tooltip says what Forever made of it
  'item:100:913': { id: 100, name: 'Robe', class: 4, subclass: 1, loc: 'INVTYPE_ROBE', tip: tip('Robe', 'Enchanted: +6 Intellect', 'Chest') },
  'item:101': { id: 101, name: 'Cuffs', class: 4, subclass: 1, loc: 'INVTYPE_WRIST', tip: tip('Cuffs') },
  'item:102:1888': { id: 102, name: 'Cloak', class: 4, subclass: 1, loc: 'INVTYPE_CLOAK', tip: tip('Cloak') },
  'item:103': { id: 103, name: 'Ring', class: 4, subclass: 0, loc: 'INVTYPE_FINGER', tip: tip('Ring') },
  'item:104:8489': { id: 104, name: 'Pants', class: 4, subclass: 1, loc: 'INVTYPE_LEGS', tip: tip('Pants', 'Enchanted: Spellthread') },
  'item:105': { id: 105, name: 'Greatstaff', class: 2, subclass: 10, loc: 'INVTYPE_2HWEAPON', tip: [{ l: '90 - 140 Damage', r: 'Speed 3.00' }] },
  'item:900': { id: 900, name: 'Arcanum of Focus', class: 0, subclass: 8, tip: tip('Arcanum of Focus') },
};
const BY_ID = {}; Object.entries(ITEMS).forEach(([k, it]) => (BY_ID[it.id] = Object.assign({ key: k }, it)));
const INV = { INVTYPE_ROBE: 20, INVTYPE_WRIST: 9, INVTYPE_CLOAK: 16, INVTYPE_FINGER: 11, INVTYPE_LEGS: 7, INVTYPE_2HWEAPON: 17 };
const GD = {
  stat: { 5: 'Intellect', 6: 'Spirit', 7: 'Stamina', 41: 'Healing', 45: 'Spell power', 101: 'Fire resistance' },
  items: {},
  // [name, q, ilvl, req, inv, , , bind, stats, class, tooltip, src, subclass]
  how: { 900: 'Quest · Libram of Focus' },
  req: {},
  recipes: {
    13917: ['Enchant Chest - Superior Mana', 'Enchanting', [11145], '', [], [], [[11175, 1]], 230],
    20009: ['Enchant Bracer - Superior Spirit', 'Enchanting', [16207], '', [5001], [], [[16204, 3]], null],
    20011: ['Enchant Bracer - Superior Stamina', 'Enchanting', [16207], '', [], [], [[16203, 4]], 290],
    23802: ['Enchant Bracer - Healing Power', 'Enchanting', [16207], '', [5002], [], [[14344, 2]], null],
    20014: ['Enchant Cloak - Greater Resistance', 'Enchanting', [16207], '', [], [], [[16203, 2]], 265],
    20036: ['Enchant 2H Weapon - Major Intellect', 'Enchanting', [16207], '', [], [], [[16203, 12]], 300],
    13695: ['Enchant 2H Weapon - Impact', 'Enchanting', [11130], '', [], [], [[11176, 4]], 225],
  },
  enchants: {
    913: ['Superior Mana', 'Permanently enchant a piece of chest armor to give +65 mana.', [[13917, 4, 31, 1048608]], []],
    // one enchant, two formulas for two slots: each formula's own slot
    1884: ['Superior Spirit', 'Permanently enchants bracers to give +9 Spirit.', [[20009, 4, 30, 512], [20010, 4, 30, 256]], []],
    1886: ['Superior Stamina', 'Permanently enchants bracers to give +9 Stamina.', [[20011, 4, 30, 512]], []],
    2566: ['Healing Power', 'Permanently enchants bracers to increase the effects of your healing spells by 24.', [[23802, 4, 30, 512]], []],
    1888: ['Greater Resistance', 'Permanently enchant a cloak to give 5 to all resistances.', [[20014, 4, 30, 65536]], []],
    2544: ['Arcanum of Focus', 'Permanently adds +8 to your Healing and Damage from spells to a leg or head slot item.', [], [[900, 4, 31, 130]]],
    1904: ['Major Intellect', 'Permanently enchant a Two-Handed Melee Weapon to add 9 to intellect.', [[20036, 2, 1378, 0]], []],
    1897: ['Impact', 'Permanently enchant a Two-handed Melee Weapon to do 5 additional points of damage.', [[13695, 2, 1378, 0]], []],
  },
};
const PACK = { 101: ['Cuffs', 2, 60, 55, 9, 0, 0, 2, [], 4, [], 'e', 1], 5001: ['Formula: Enchant Bracer - Superior Spirit', 2, 60, 0, 0, 0, 0, 0, [], 9, [], '', 0], 5002: ['Formula: Enchant Bracer - Healing Power', 3, 60, 0, 0, 0, 0, 0, [], 9, [], '', 0] };
let BAGS = { 900: 0 };
const CH = {
  professions: { Enchanting: { name: 'Enchanting', rank: 300, recipes: [
    // Forever renamed this one; the game's description says what it gives there
    { id: 13917, name: 'Enchant Chest - Superior Intellect', reagents: [{ id: 11175, need: 1 }], tools: [{ name: 'Runed Truesilver Rod', met: true }] },
    { id: 20011, name: 'Enchant Bracer - Superior Stamina', reagents: [{ id: 16203, need: 4 }], tools: [{ name: 'Runed Arcanite Rod', met: false }] },
    // a formula Forever added, known only from the game
    { id: 1248498, name: 'Enchant Bracer - Lesser Healing Power', desc: 'Permanently enchant bracers to increase healing done by spells by up to 15.', reagents: [{ id: 11176, need: 2 }], tools: [] },
  ] } },
};
const esc = (s) => String(s == null ? '' : s);
const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
ctx.CC = { V: {}, api: {
  get CH() { return CH; }, STATE: {}, GD, esc, arr,
  item: (k) => ITEMS[k] || null, byId: (id) => BY_ID[id] || null, gdItem: (id) => PACK[id] || null, gdSourceLines: () => [],
  anyItemName: (id) => (BY_ID[id] || {}).name || (PACK[id] || [])[0] || '#' + id, itemLink: (id) => '#' + id, ownedCount: (id) => BAGS[id] || 0,
} };
ctx.CC.advice = { invOf: (it) => INV[it.loc] || 0 };
ctx.CC.gear = { packSub: (g) => g[12], raidSource: () => false };
load('weights.js');
load('enchants.js');
const E = ctx.CC.enchants, W = ctx.CCWeights;

// ---------------------------------------------------------------- text to stats
test('stat lines in each form the game and the pack write them', () => {
  const p = (t) => JSON.stringify(E.parse(t).st);
  assert.strictEqual(p('Enchanted: +9 Spirit'), '{"6":9}');
  assert.strictEqual(p('Enchanted: Healing +24'), '{"41":24}');
  assert.strictEqual(p('Permanently enchant a piece of chest armor to grant +4 to all stats.'), '{"3":4,"4":4,"5":4,"6":4,"7":4}');
  assert.strictEqual(p('Permanently enchant a cloak to give 5 to all resistances.'), '{"101":5,"102":5,"103":5,"104":5,"105":5}');
  assert.strictEqual(p('Permanently adds 10 Stamina, 10 Intellect, and increases healing by up to 24 to a leg or head slot item.'), '{"5":10,"7":10,"41":24}');
  assert.strictEqual(p('Permanently adds 15 Intellect and increases all healing and spell damage by up to 13 to a leg or head slot item.'), '{"5":15,"45":13}', 'spell power once, not healing too');
  assert.strictEqual(p('Permanently adds to a shoulder slot item increased healing done by magical spells and effects up to 31 and also increases your mana regen by 5 mana per 5 sec.'), '{"41":31,"43":5}');
  assert.strictEqual(p('Permanently adds 24 Ranged Attack Power, 10 Stamina, and 1% Chance to Hit to a leg or head slot item.'), '{"7":10,"39":24,"117":1}');
  assert.strictEqual(p('Use: Permanently increase the Stamina value by 5 and armor value by 40 of an item worn on the chest, legs, hands or feet. Only usable on items level 35 and above.'), '{"7":5,"100":40}', "a Forever armor kit's Use: line");
  assert.strictEqual(p('Permanently enchant a piece of chest armor to give +65 mana.'), '{"mana":65}');
  assert.strictEqual(p('Permanently enchant a Melee Weapon to do 1 additional point of damage.'), '{"wdmg":1}');
});
test("the game's short enchant names, number before or after, several stats at once (review of #147)", () => {
  const p = (t) => JSON.stringify(E.parse(t).st);
  assert.strictEqual(p('Enchanted: Healing and Spell Damage +8'), '{"45":8}');
  assert.strictEqual(p('Enchanted: +8 Healing and Spell Damage'), '{"45":8}');
  assert.strictEqual(p('Enchanted: +30 Spell Damage and Healing'), '{"45":30}');
  assert.strictEqual(p('Enchanted: Mana Regen +4/Stamina +10/Healing +24'), '{"7":10,"41":24,"43":4}');
  assert.strictEqual(p('Enchanted: Ranged Attack Power +24/Stamina +10/Hit +1%'), '{"7":10,"39":24,"117":1}');
  assert.strictEqual(p('Enchanted: Spell Damage +15/Spell Critical +1%'), '{"21":1,"42":15}');
  assert.strictEqual(p('Enchanted: Attack Power +26/Critical +1%'), '{"38":26,"116":1}');
  assert.strictEqual(p('Enchanted: Spell Hit +1%/Healing and Spell Damage +18'), '{"18":1,"45":18}');
  assert.strictEqual(p('Enchanted: Mana Regen 4 per 5 sec.'), '{"43":4}');
  assert.strictEqual(p('Enchanted: +2% Block'), '{"120":2}');
});
test('a name-only line the Classic data names otherwise is renamed on Forever, not given Classic numbers', () => {
  const saved = CH.professions; CH.professions = {};
  const r = E.info(913, 'Superior Intellect');
  assert.strictEqual(r.from, 'changed'); assert.strictEqual(r.any, false);
  assert.strictEqual(E.info(1888, 'Greater Resistance').from, 'classic', 'the Classic name: Classic numbers');
  assert.strictEqual(E.info(2544, 'Arcanum of Focus').from, 'classic', "the item's name");
  CH.professions = saved;
});
test('procs, speed and skills are effects, never stats', () => {
  const c = E.parse('Permanently enchant a melee weapon so that often when attacking in melee it heals for 75 to 125 and increases Strength by 100 for 15 sec.');
  assert.deepStrictEqual([JSON.stringify(c.st), c.effect], ['{}', true], 'Crusader: the 100 Strength is a proc');
  assert.strictEqual(E.parse('Permanently enchant gloves to grant a +1% attack speed bonus.').effect, true);
  assert.strictEqual(E.parse('Permanently enchant gloves to grant +5 skinning skill.').any, false);
  assert.strictEqual(E.parse('Permanently enchant a melee weapon to do 6 additional points of damage to Beasts.').any, false, 'slayer damage counts only against beasts');
});

// ---------------------------------------------------------------- where the numbers come from
test("the item's own Enchanted: line wins over Classic data", () => {
  const i = E.info(913, 'Enchanted: +6 Intellect');
  assert.strictEqual(i.from, 'game'); assert.strictEqual(JSON.stringify(i.st), '{"5":6}');
});
test('a formula Forever renamed: Classic numbers are not used for it, until the game describes it', () => {
  const i = E.info(913, null);
  assert.strictEqual(i.from, 'changed'); assert.strictEqual(i.any, false);
  CH.professions.Enchanting.recipes[0].desc = 'Permanently enchant a piece of chest armor to grant +6 Intellect.';
  const j = E.info(913, null);
  assert.strictEqual(j.from, 'formula'); assert.strictEqual(JSON.stringify(j.st), '{"5":6}');
  delete CH.professions.Enchanting.recipes[0].desc;
});
test("an enchant the game names but Classic data doesn't have: named, not scored", () => {
  const i = E.info(8489, 'Spellthread');
  assert.strictEqual(i.name, 'Spellthread'); assert.strictEqual(i.from, 'unknown'); assert.strictEqual(i.any, false);
});
test('the masks: bracer enchants fit bracers, not rings; two-hander enchants not one-handers', () => {
  assert(E.fitsMask([4, 30, 512], { cls: 4, sub: 1, inv: 9 }));
  assert(!E.fitsMask([4, 30, 512], { cls: 4, sub: 0, inv: 11 }));
  assert(E.fitsMask([2, 1378, 0], { cls: 2, sub: 10, inv: 17 }), 'a staff is a two-hander');
  assert(!E.fitsMask([2, 1378, 0], { cls: 2, sub: 15, inv: 13 }), 'a dagger is not');
  assert.strictEqual(JSON.stringify(E.nameFit('Enchant Bracer - Lesser Healing Power')), '[4,0,512]');
  assert(E.fitsMask([2, 0, 65536], { cls: 4, sub: 1, inv: 16 }), 'a mask by slot alone decides by slot');
  const boots = { id: 106, key: 'item:106' };
  ITEMS['item:106'] = { id: 106, name: 'Boots', class: 4, subclass: 1, loc: 'INVTYPE_FEET', tip: tip('Boots') };
  INV.INVTYPE_FEET = 8;
  GD.recipes[20010] = ['Enchant Boots - Superior Spirit', 'Enchanting', [], '', [], [], [], 300];
  const c = E.candidates(boots).map((x) => x.name + '/' + x.formula.id).join();
  assert.strictEqual(c, 'Superior Spirit/20010', 'boots take the boots formula, not the bracer one (' + c + ')');
  delete ITEMS['item:106']; delete GD.recipes[20010];
});

// ---------------------------------------------------------------- one spec's slots
const w = { 5: 1, 6: 0.5, 7: 0.3, 41: 0.6, 45: 0.9, 101: 0.1, 102: 0.1, 103: 0.1, 104: 0.1, 105: 0.1, dps: 0.2 };
const base = { short: 'what you wear', worn: {
  5: { id: 100, key: 'item:100:913' }, 9: { id: 101, key: 'item:101' }, 15: { id: 102, key: 'item:102:1888' }, 11: { id: 103, key: 'item:103' },
  7: { id: 104, key: 'item:104:8489' }, 16: { id: 105, key: 'item:105' } } };
test('each enchantable slot is listed with its enchant; a ring is not; an unenchanted bracer is flagged', () => {
  const rows = E.plan(w, base);
  assert.strictEqual(rows.map((r) => r.name).join(), 'Back,Chest,Wrist,Legs,Main hand');
  const wr = rows.find((r) => r.name === 'Wrist');
  assert.strictEqual(wr.empty, true); assert.strictEqual(wr.cur, null);
  const ch = rows.find((r) => r.name === 'Chest');
  assert.strictEqual(ch.cur.name, '+6 Intellect'); assert.strictEqual(ch.curS, 6);
  assert.strictEqual(rows.find((r) => r.name === 'Legs').cur.name, 'Spellthread', 'named from the game');
});
test('the best enchant for a slot, and the best you can apply now (a formula you know, an item in your bags)', () => {
  const wr = E.plan(w, base).find((r) => r.name === 'Wrist');
  assert.strictEqual(wr.best.name, 'Healing Power'); assert.strictEqual(+wr.best.d.toFixed(1), 14.4);
  assert.strictEqual(wr.best.how, 'formula'); assert.strictEqual(wr.best.taughtBy, 5002);
  assert.strictEqual(wr.bestNow.name, 'Lesser Healing Power', "Forever's own formula, scored from the game's description");
  assert.strictEqual(+wr.bestNow.d.toFixed(1), 9);
  const ss = wr.options.find((c) => c.name === 'Superior Stamina');
  assert.strictEqual(ss.how, 'known'); assert.strictEqual(ss.tools[0].met, false, "the game's own tools");
});
test('an item that applies an enchant counts as yours only while it is in your bags', () => {
  const s = E.summary(w, base);
  assert(!s.some((r) => r.bestYouCanApplyNow && r.bestYouCanApplyNow.how === 'item'));
  assert.strictEqual(s.find((r) => r.slot === 'Legs').best.name, 'Arcanum of Focus');
  BAGS = { 900: 1 };
  const t = E.summary(w, base).find((r) => r.slot === 'Legs');
  assert.strictEqual(t.bestYouCanApplyNow.name, 'Arcanum of Focus'); assert.strictEqual(t.bestYouCanApplyNow.item.inBags, true);
  BAGS = { 900: 0 };
});
test('weapon damage counts as DPS at the weapon speed; the snapshot says where each number is from', () => {
  const mh = E.plan(w, base).find((r) => r.name === 'Main hand');
  const imp = mh.options.find((c) => c.name === 'Impact');
  assert.strictEqual(+imp.s.toFixed(3), +(5 / 3 * 0.2).toFixed(3));
  assert.strictEqual(mh.best.name, 'Major Intellect');
  const s = E.summary(w, base);
  const back = s.find((r) => r.slot === 'Back');
  assert.strictEqual(back.enchant.statsFrom, 'classic'); assert.strictEqual(back.isBest, true);
  assert.strictEqual(s.find((r) => r.slot === 'Wrist').enchant, null);
  assert.strictEqual(s.find((r) => r.slot === 'Wrist').empty, true);
  assert.match(s.find((r) => r.slot === 'Wrist').best.where, /Formula: Enchant Bracer - Healing Power/);
});
test('an enchant on now with unknown stats: gains over it are unknown, not counted from nothing', () => {
  const legs = E.summary(w, base).find((r) => r.slot === 'Legs');
  assert.strictEqual(legs.enchant.name, 'Spellthread'); assert.strictEqual(legs.gainUnknown, true); assert.strictEqual(legs.isBest, false);
  assert.strictEqual(E.summary(w, base).find((r) => r.slot === 'Chest').gainUnknown, undefined);
});
test('an enchant on now that nothing beats is the best', () => {
  const s = E.summary(w, { worn: { 15: { id: 102, key: 'item:102:1888' } } });
  assert.strictEqual(s[0].isBest, true);
});
test('a set copy only guessed (another copy, or in the bank) is unknown, not its enchant or empty', () => {
  const s = E.summary(w, { worn: { 9: { id: 101, key: 'item:101', guess: true } } });
  assert.match(s[0].enchant, /^unknown/); assert.strictEqual(s[0].empty, false); assert.strictEqual(s[0].gainUnknown, true);
  const b = E.summary(w, { worn: { 9: { id: 101, key: 'item:101', guess: true, bank: true } } });
  assert.match(b[0].enchant, /in your bank/);
});
test("an item whose copy the game didn't name: its enchant is unknown, not empty", () => {
  const s = E.summary(w, { worn: { 9: { id: 101, key: undefined } } });
  assert.match(s[0].enchant, /^unknown/); assert.strictEqual(s[0].empty, false);
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
