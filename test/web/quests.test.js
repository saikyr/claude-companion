// Node test for which quests you can do (js/quests.js) and the Gear page leaving out rewards you already took
// (js/gear.js candidates), on the real game-data pack and a made-up level 59 Alliance Priest. No browser.
//   node test/web/quests.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const WEB = path.join(__dirname, '../../ClaudeCompanion/web');

const ctx = { console, localStorage: { getItem: () => null, setItem() {} }, document: { addEventListener() {} }, Object, JSON, Math, Number, String, Array, Set, Map, Date, RegExp, isFinite };
ctx.window = ctx;
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(path.join(WEB, f), 'utf8'), ctx, { filename: f });
load('data/gamedata.js'); load('data/rules.js');
const GD = ctx.GAMEDATA;

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };

const CH = { snap: {
  taken: 1, character: { name: 'Test', level: 59, class: 'Priest', classFile: 'PRIEST', faction: 'Alliance' },
  skills: [{ name: 'Cloth', skillLineCategoryID: 8 }, { name: 'Staves', skillLineCategoryID: 6 }, { name: 'Wands', skillLineCategoryID: 6 }],
  completedQuests: [3801, 3802], quests: [{ id: 5089, title: "General Drakkisath's Command", complete: false }],
  reputation: [{ name: 'Argent Dawn', reaction: 4, currentStanding: 1200 }],
} };
const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
ctx.CC = { V: {}, api: { get CH() { return CH; }, STATE: {}, GD, arr, esc: String, gdItem: (id) => GD.items[id] || null } };
load('js/weights.js'); load('js/quests.js'); load('js/gear.js');
const Q = ctx.CC.quests;
const set = (patch) => { Object.assign(CH.snap, patch); CH.snap.taken++; };

test('faction and class: QuestieDB masks decide who can take a quest', () => {
  assert.ok(Q.forYou(8909), 'An Earnest Proposition, the Priest one (Alliance)');
  assert.ok(!Q.forYou(8906), 'the Hunter one is not for a Priest');
  assert.ok(!Q.forYou(8916), 'the Horde Priest one is not for the Alliance');
  assert.ok(Q.forYou(4743), 'Seal of Ascension: anyone');
});
test('done, in your log, open, or later with the reason', () => {
  assert.strictEqual(Q.status(3802).state, 'done');
  assert.strictEqual(Q.status(5089).state, 'active');
  const seal = Q.status(4743);
  assert.strictEqual(seal.state, 'later', 'the second Seal of Ascension needs the first');
  assert.deepStrictEqual(Array.from(seal.steps), [4742, 4743]);
  assert.ok(seal.why.some((w) => w.kind === 'steps' && w.first === 4742 && w.count === 1));
  set({ completedQuests: [3801, 3802, 4742] });
  assert.strictEqual(Q.status(4743).state, 'open', 'with the first step done, the second is open');
  assert.strictEqual(Q.status(8909).state, 'open', 'T0.5 starts at 58: open at 59');
});
test('a chain walks back to its first step you have not done', () => {
  const st = Q.status(6502);
  assert.strictEqual(st.steps[st.steps.length - 1], 6502, 'ends with the goal');
  assert.strictEqual(st.first, 4182, 'the Alliance Onyxia chain starts at Dragonkin Menace');
  assert.ok(st.steps.length >= 10);
  set({ completedQuests: [3801, 3802, 4742, 4182, 4183, 4184, 4185, 4186, 4223, 4224, 4241, 4242, 4264, 4282] });
  assert.deepStrictEqual(Array.from(Q.chain(6502)), [4322, 6402, 6403, 6501, 6502], 'picks up where you are');
});
test('a reputation need you lack is a reason, with the standing', () => {
  const id = Object.keys(GD.quests).find((k) => { const q = GD.quests[k]; return arr(q.repReq)[0] && q.repReq[0][0] === 'Argent Dawn' && q.repReq[0][1] >= 3000 && Q.forYou(k) && !arr(q.prev).length; });
  assert.ok(id, 'an Argent Dawn quest that needs Friendly or more');
  const g = Q.repGap(id);
  assert.ok(g && g.faction === 'Argent Dawn' && g.have === 1200 && g.standing, JSON.stringify(g));
  assert.ok(Q.status(id).why.some((w) => w.kind === 'rep'));
});
test('a chain needs the highest level of its steps, not only the first', () => {
  const lowSave = CH.snap.character.level; CH.snap.character.level = 45; CH.snap.taken++;
  const yw = Object.keys(GD.quests).find((k) => GD.quests[k].t === "Yashiro's Windwalk" && Q.forYou(k));
  assert.ok(yw, "Yashiro's Windwalk is in the pack");
  assert.ok(Q.status(yw).why.some((w) => w.kind === 'level' && w.level >= 50), "Yashiro's Windwalk is not open at 45");
  CH.snap.character.level = lowSave; CH.snap.taken++;
});
test('a profession quest: not for you without the profession; a skill gap with it', () => {
  const bs = Object.keys(GD.quests).find((k) => { const q = GD.quests[k]; return Array.isArray(q.skill) && q.skill[0] === 164 && q.skill[1] >= 200 && Q.forYou(k) && !arr(q.prev).length; });
  assert.ok(bs, 'a Blacksmithing quest');
  assert.strictEqual(Q.status(bs).state, 'no', 'a Priest without Blacksmithing');
  CH.snap.skills = CH.snap.skills.concat([{ name: 'Blacksmithing', rank: 100 }]); CH.snap.taken++;
  assert.ok(Q.status(bs).why.some((w) => w.kind === 'skill' && w.prof === 'Blacksmithing' && w.have === 100));
  CH.snap.skills = CH.snap.skills.filter((x) => x.name !== 'Blacksmithing'); CH.snap.taken++;
});
test('Gear: a quest reward you already took is no longer a source; one still to do is', () => {
  const use = { 2: [10, 19], 4: [0, null, 1] };
  const before = ctx.CC.gear._candidates(use, 'Priest');
  assert.ok(before.byId['12344'], 'Seal of Ascension (ring) counts while its quest is still to do');
  set({ completedQuests: CH.snap.completedQuests.concat([4743]) });
  const after = ctx.CC.gear._candidates(use, 'Priest');
  assert.ok(!after.byId['12344'], 'and not once you took it');
  assert.ok(after.skipped['quest reward you already took (or not for you)'] > 0);
});
test('Gear: a class quest reward for another class is not a source', () => {
  const use = { 2: [10, 19], 4: [0, null, 1, 2, 3] };
  const c = ctx.CC.gear._candidates(use, 'Priest');
  // 22004 is the Rogue T0.5 reward (Darkmantle): only the Rogue quests give it
  assert.ok(Q.rewardQuests(22004).every((q) => !Q.forYou(q)));
  assert.ok(!c.byId['22004'], 'another class only');
});

test('raid content: the quest, or an earlier step set in a raid, done or not', () => {
  assert.ok(Q.raid(9257), 'Atiesh (Legendary sort, its earlier step a raid quest)');
  assert.ok(Q.raid(8745), "Treasure of the Timeless One: its chain runs through Molten Core and Blackwing Lair");
  assert.ok(Q.raid(8790), 'Imperial Qiraji Regalia: set in the Temple of Ahn\'Qiraj');
  assert.ok(!Q.raid(5942), 'Hidden Treasures, after The Battle of Darrowshire (a raid-group quest outdoors): pre-raid');
  assert.ok(!Q.raid(4765), 'Delivery to Ridgewell (Upper Blackrock Spire chain): pre-raid');
  assert.ok(!Q.raid(8999), 'Saving the Best for Last (dungeon set 0.5): pre-raid');
});
test('Gear: raid quest rewards are no pre-BiS source (Atiesh, the Qiraji staves, Fang of Korialstrasz)', () => {
  const use = { 2: [4, 10, 15, 19], 4: [0, null, 1] };
  const c = ctx.CC.gear._candidates(use, 'Priest');
  for (const id of ['22631', '21275', '21273', '21523']) assert.ok(!c.byId[id], GD.items[id][0] + ' left out');
  // kept, with why: shown under "Raid, PvP and not in game yet", never a target
  const atiesh = c.later.find((x) => x.id === 22631);
  assert.ok(atiesh && atiesh.avail === 'raid', 'Atiesh kept as raid content');
  assert.ok(c.later.some((x) => x.avail === 'unseen'), 'items Forever is not known to have yet are kept too');
  assert.ok(c.later.every((x) => !c.byId[x.key]), 'never also a source for now or pre-BiS');
  assert.ok(c.later.some((x) => GD.items[x.key][11] === 'f' && x.avail === 'unseen' && !x.seen), 'gear with ForeverDB stats only (no Forever client tooltip) is kept as not seen yet');
  // the Forever client's own tooltips, or ForeverDB's stats for an item Forever was seen giving (Tier 0.5 spec sets)
  const seenGiving = (id) => (GD.src[id] || []).some((r) => r[10] === 'f');
  assert.ok(Object.values(c.byId).every((x) => x.g[11] === 'e' || (x.g[11] === 'f' && seenGiving(String(x.id)))), 'upgrades and pre-BiS only from client tooltips, or ForeverDB stats Forever was seen giving');
  assert.ok(c.byId['226955'], 'Virtuous Epaulets (Forever\'s Shadow Tier 0.5, ForeverDB stats, from the Twilight set box) is a source');
});

// #144: an item a quest you are on still needs, named in its objectives or a later step of its chain for you
test('items a quest in progress needs: A Supernatural Device in the log keeps the Devout Gloves (Just Compensation)', () => {
  set({ quests: [{ id: 8922, title: 'A Supernatural Device', complete: false, objectives: [{ text: 'Sealed Blood Container: 0/1' }] }], completedQuests: [8909] });
  const g = Q.neededFor('Devout Gloves');
  assert.ok(g && g.title === 'Just Compensation', JSON.stringify(g));
  assert.ok(Q.neededFor('Devout Belt'), 'the belt too');
  assert.ok(Q.neededFor('Sealed Blood Container'), 'the log quest\'s own objective');
  assert.strictEqual(Q.neededFor('Wildheart Gloves'), null, 'the Druid step is not for a Priest');
  assert.strictEqual(Q.neededFor('Devout Glove'), null, 'whole names only ("Devout Glove" is not in "Devout Gloves")');
  set({ quests: [], completedQuests: [3801, 3802] });
  assert.strictEqual(Q.neededFor('Devout Gloves'), null, 'with no quest of the chain in the log, nothing is kept for it');
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
