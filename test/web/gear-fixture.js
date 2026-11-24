// A made-up save for the Gear and Stat weights pages: a level 59 Human Priest with a Holy (17/33/0) and a
// Shadow (17/0/33) spec, two gear sets, a few items in the bags and bank, and an Auction House scan with
// fixed-stat items and random-suffix greens (keyed the way the addon keys them: "id:of Healing").
// No personal data: the item ids are game items; names and numbers are invented.
//   const { saveLua } = require('./gear-fixture.js'); saveLua(nowSeconds[, { snap: {...more snapshot fields}, professions }])  ->  "ClaudeCompanionDB = {...}"
'use strict';

function lua(v, ind = '') {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  const pad = ind + '  ';
  const rows = Array.isArray(v) ? v.map((x, i) => `${pad}[${i + 1}] = ${lua(x, pad)},`) : Object.entries(v).map(([k, x]) => `${pad}[${JSON.stringify(k)}] = ${lua(x, pad)},`);
  return `{\n${rows.join('\n')}\n${ind}}`;
}

// a talent tree with `points` spread over nodes on a grid (the app lays trees out from x / y)
function tree(id, points) {
  const nodes = [];
  for (let i = 0; i < 16; i++) {
    const rank = Math.max(0, Math.min(5, points - i * 5));
    nodes.push({ node: id * 100 + i, x: 300 + (i % 4) * 600, y: 300 + Math.floor(i / 4) * 600, rank, max: 5, name: 'Talent ' + i, spell: 1000 + i, icon: 136223 });
  }
  return { id, nodes };
}
const spec = (a, b, c) => ({ specName: 'Priest', traits: { trees: [tree(1, a), tree(2, b), tree(3, c)] } });

const SLOT = { 1: 'Head', 2: 'Neck', 3: 'Shoulder', 5: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrist', 10: 'Hands', 11: 'Finger1', 12: 'Finger2', 13: 'Trinket1', 14: 'Trinket2', 15: 'Back', 16: 'MainHand', 17: 'OffHand', 18: 'Ranged' };
// what the Shadow set wears (and what is worn now), then the Holy ("heals") set's differences
const SHADOW = { 1: 14111, 2: 279833, 3: 14112, 5: 14136, 6: 254073, 7: 14144, 8: 14108, 9: 254067, 10: 254101, 11: 7553, 12: 12543, 13: 276744, 14: 270276, 15: 15603, 16: 11922, 17: 11904, 18: 20082 };
const HEALS = Object.assign({}, SHADOW, { 7: 10807, 9: 254061, 11: 273031, 13: 19990, 14: 11819, 17: 11262, 18: 17745 });

function saveLua(now, extra) {
  const item = (id) => `item:${id}::::::::59:::::`;
  const items = {
    // in the bags: Theka's Last Breath (a trinket the Holy set doesn't use); in the bank: Devout Mantle
    [item(274641)]: { id: 274641, key: item(274641), name: "Theka's Last Breath", q: 3, ilvl: 47, req: 42, class: 4, subclass: 0, loc: 'INVTYPE_TRINKET', bind: 1,
      stats: { ITEM_MOD_MANA_REGENERATION_SHORT: 6 }, tip: [{ l: "Theka's Last Breath" }, { l: 'Equip: Restores 6 mana per 5 sec.' }] },
    [item(16695)]: { id: 16695, key: item(16695), name: 'Devout Mantle', q: 3, ilvl: 60, req: 55, class: 4, subclass: 1, loc: 'INVTYPE_SHOULDER', bind: 1,
      stats: { ITEM_MOD_INTELLECT_SHORT: 21, ITEM_MOD_SPIRIT_SHORT: 9, ITEM_MOD_STAMINA_SHORT: 4, ITEM_MOD_SPELL_HEALING_DONE_SHORT: 11 }, tip: [{ l: 'Devout Mantle' }] },
  };
  const scanT = now - 2 * 3600;
  const obs = (med, qty) => [{ t: scanT, min: Math.round(med * 0.8), med, qty, n: qty, src: 'scan' }];
  const prices = {};
  const sell = (key, name, q, med, qty) => { prices[key] = { id: Number(key.split(':')[0]), suffix: key.includes(':') ? key.split(':')[1] : null, name, q, last: scanT, obs: obs(med, qty) }; };
  // random-suffix greens, one key per roll
  sell('10210:of Healing', 'Elegant Mantle of Healing', 2, 38500, 3);
  sell('10180:of Healing', 'Mystical Belt of Healing', 2, 9999, 2);
  sell('10219:of the Prophet', 'Elegant Circlet of the Prophet', 2, 31600, 1);
  sell('9879:of Healing', 'Sorcerer Bracelets of Healing', 2, 10500, 4);
  sell('15278:of Healing', 'Solstice Staff of Healing', 2, 59900, 1);
  sell('14337:of the Owl', 'Eternal Cord of the Owl', 2, 38000, 1);
  sell('7524:of the Channeler', 'Gossamer Cape of the Channeler', 2, 12000, 2);
  sell('15431:of Healing', 'Peerless Leggings of Healing', 2, 75600, 2);
  sell('6543:of Shadow Wrath', 'Willow Bracers of Shadow Wrath', 2, 4550, 5);
  // the same item's own key mixes every roll: the app must not read it as one roll
  sell('10210', 'Elegant Mantle of Healing', 2, 20000, 9);
  // a fixed-stat world-drop epic
  sell('812', 'Glowing Brightwood Staff', 4, 950000, 1);
  // gone: the newest scan found none
  prices['14252:of Healing'] = { id: 14252, name: 'Lunar Coronet of Healing', q: 2, obs: [{ t: scanT - 86400, min: 9000, qty: 1, src: 'scan' }, { t: scanT, qty: 0, src: 'scan' }] };
  const set = (id, name, map) => ({ id, name, icon: 1234, equipped: id === 1, numItems: 17, numEquipped: 17, numInBags: 0, numLost: 0,
    items: Object.entries(map).map(([slot, x]) => ({ id: x, slot: Number(slot), slotName: SLOT[slot] })) });
  const ch = {
    key: 'Testpriest-Realm',
    snap: {
      taken: now - 600, version: 1, activeSpec: 1,
      character: { name: 'Testpriest', race: 'Human', class: 'Priest', classFile: 'PRIEST', faction: 'Alliance', level: 59, xp: 75624, xpMax: 209800, money: 1362396,
        where: { zone: 'Stormwind City', map: 1453, x: 50, y: 50 }, hearth: 'Stormwind City' },
      equipped: Object.entries(SHADOW).map(([slot, id]) => ({ slot: Number(slot), slotName: SLOT[slot], item: item(id), count: 1 })),
      gearSets: [set(0, 'heals', HEALS), set(1, 'shadow', SHADOW)],
      bags: [{ id: 0, items: [{ slot: 1, item: item(274641), count: 1 }] }],
      skills: [{ name: 'Cloth', rank: 1, skillLineCategoryID: 8 }, { name: 'Daggers', rank: 295, skillLineCategoryID: 6 }, { name: 'Maces', rank: 280, skillLineCategoryID: 6 },
        { name: 'Staves', rank: 290, skillLineCategoryID: 6 }, { name: 'Wands', rank: 295, skillLineCategoryID: 6 }, { name: 'Tailoring', rank: 268 }, { name: 'Enchanting', rank: 276 }],
      // a complete quest whose rewards the game read back empty (#98): the pack's rewards are scored
      quests: [{ id: 7488, title: "Lethtendris's Web", level: 57, complete: 1, rewards: { items: [], choices: [], money: 17000 } }],
      reputation: [{ name: 'Stormwind', reaction: 7 }, { name: 'Timbermaw Hold', reaction: 3 }, { name: 'Argent Dawn', reaction: 4 }],
      // spell ranks (js/spells.js): Flash Heal rank 6 sits on spec 1's bar while rank 7 is known
      spellbook: [{ name: 'Holy', spells: [{ name: 'Flash Heal', rank: 'Rank 6', id: 10916, icon: 135907 }, { name: 'Flash Heal', rank: 'Rank 7', id: 10917, icon: 135907 },
        { name: 'Renew', rank: 'Rank 9', id: 10929, icon: 135953 }] }],
    },
    specs: { 1: Object.assign(spec(17, 33, 0), { barsTaken: now - 600, actionBars: [{ slot: 1, kind: 'spell', id: 10916, name: 'Flash Heal', icon: 135907, key: '1' },
      { slot: 2, kind: 'spell', id: 10929, name: 'Renew', icon: 135953, key: '2' }] }), 2: spec(17, 0, 33) },
    trainer: { taken: now - 3600, npc: 'High Priestess Laurena', class: 'PRIEST', level: 59, services: [
      { name: 'Greater Heal', rank: 'Rank 5', status: 'available', level: 58, cost: 38000 },
      { name: 'Holy Fire', rank: 'Rank 8', status: 'unavailable', level: 60, cost: 40000 }] },
    bank: { taken: now - 86400, bags: [{ id: -1, items: [{ slot: 1, item: item(16695), count: 1 }] }] },
    ah: { lastScan: { t: scanT, auctions: 31000, items: 7300 }, prices },
  };
  if (extra && extra.snap) Object.assign(ch.snap, extra.snap);
  if (extra && extra.professions) ch.professions = extra.professions;
  if (extra && extra.grinds) ch.grinds = extra.grinds;
  if (extra && extra.caps) ch.caps = extra.caps;
  return 'ClaudeCompanionDB = ' + lua({ schema: 1, chars: { [ch.key]: ch }, items, spells: {}, npcs: {}, quests: {} });
}
module.exports = { saveLua };
