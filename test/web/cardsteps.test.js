// node test/web/cardsteps.test.js
// The steps of a From Claude card (#163, js/cardsteps.js): each game check against a save, who ticked a step
// (you, the game, Claude) and an untick that sticks, Claude's order, and what changed between two saves
// (the claude_wake record js/sync.js sends).
'use strict';
const ST = require('../../ClaudeCompanion/web/js/cardsteps.js');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- the grammar (the same as tools/check-cards.py CHECK and the database gate)
check(same(ST.parse('quest:5089'), { kind: 'quest', id: 5089 }), 'quest:<id>');
check(same(ST.parse('item:14047x5'), { kind: 'item', id: 14047, count: 5 }) && ST.parse('item:14047').count === 1, 'item:<id> and item:<id>x<count>');
check(same(ST.parse('rep:Argent Dawn>=Honored'), { kind: 'rep', faction: 'Argent Dawn', standing: 6 }), 'rep:<faction>>=<standing>');
check(same(ST.parse('level:60'), { kind: 'level', level: 60 }) && same(ST.parse('skill:Tailoring>=300'), { kind: 'skill', name: 'Tailoring', rank: 300 }), 'level:<n>, skill:<profession>>=<n>');
check(['quest:x', 'rep:Argent Dawn>=9000', 'item:1x', 'level:', 'Quest:1', ' quest:1'].every((s) => ST.parse(s) === null), 'anything else is not a check');

// ---- the checks against a save
const CH = {
  snap: {
    taken: 1000, character: { name: 'Ana', level: 58 },
    completedQuests: [100, 5089],
    bags: [{ id: 0, items: [{ item: 'item:14047::::::::58:::::', count: 3 }, { item: 'item:14047::::::::58:::::', count: 1 }] }],
    equipped: [{ item: 'item:16695::::::::58:::::' }],
    reputation: [{ name: 'Factions', isHeader: true }, { name: 'Argent Dawn', reaction: 6 }, { name: 'Thorium Brotherhood', reaction: 4 }],
    skills: [{ name: 'Tailoring', rank: 285 }],
  },
  bank: { bags: [{ id: -1, items: [{ item: 'item:14047::::::::58:::::', count: 2 }] }] },
};
const cx = ST.contextOf(CH);
check(ST.met('quest:5089', cx) === true && ST.met('quest:7', cx) === false, 'a quest check reads the completed quests');
check(ST.met('item:14047x6', cx) === true && ST.met('item:14047x7', cx) === false, 'an item check counts bags and bank (4 + 2)');
check(ST.met('item:16695', cx) === true, 'an item worn counts');
check(ST.met('rep:Argent Dawn>=Honored', cx) === true && ST.met('rep:Argent Dawn>=Revered', cx) === false && ST.met('rep:Thorium Brotherhood>=Friendly', cx) === false, 'a rep check reads the standing');
check(ST.met('rep:Timbermaw Hold>=Neutral', cx) === null, "a faction you haven't met: can't tell");
check(ST.met('level:58', cx) === true && ST.met('level:60', cx) === false, 'a level check');
check(ST.met('skill:Tailoring>=285', cx) === true && ST.met('skill:Tailoring>=300', cx) === false && ST.met('skill:Alchemy>=1', cx) === false, 'a skill check');
check(ST.met('quest:5089', ST.contextOf({ snap: { character: { name: 'Ana', level: 1 } } })) === null, "no completed-quest list in the save: can't tell");

// ---- who ticked a step
const card = { id: 'p', steps: ['Kill Drakkisath', 'Get 6 Runecloth', 'Ask Claude', 'Hit Revered', 'Hand in'],
  doneWhen: ['quest:5089', 'item:14047x6', null, 'rep:Argent Dawn>=Revered'], stepsDone: [2] };
const keys = ST.stepKeys(card.steps);
let s = ST.stepsOf(card, new Set([4]), {}, cx);
check(same(s.map((x) => [x.done, x.by]), [[true, 'game'], [true, 'game'], [true, 'claude'], [false, null], [true, 'you']]), 'done in game, ticked by Claude, ticked by you, not done');
check(s[3].check === 'rep:Argent Dawn>=Revered' && s[3].met === false && s[2].check === null, 'each step carries its check and whether it passes');
s = ST.stepsOf(card, new Set(), { unticked: [keys[0], keys[2]] }, cx);
check(!s[0].done && !s[2].done && s[1].done, 'a step you unticked stays unticked, whoever ticked it');
s = ST.stepsOf(card, new Set([0]), { unticked: [keys[0]] }, cx);
check(s[0].done && s[0].by === 'you', 'your own tick wins over an old untick');
s = ST.stepsOf(card, new Set(), { auto: [keys[3]] }, cx);
check(s[3].done && s[3].by === 'game', "a check that passed on an earlier save stays done (the item used up, the rep spent)");
const moved = Object.assign({}, card, { steps: ['Hand in', ...card.steps.slice(0, 4)], doneWhen: [null, ...card.doneWhen] });
check(ST.stepsOf(moved, new Set(), { auto: [keys[3]] }, cx)[4].done, 'a remembered game tick follows its step when Claude reorders the steps');

// ---- Claude's order
const T = (h) => new Date(Date.UTC(2026, 10, 26, h)).toISOString();
const list = [
  { id: 'new', updated: T(9) },
  { id: 'v2', order: 20, group: 'Virtuous plan', updated: T(1) },
  { id: 'old', updated: T(2) },
  { id: 'ah', order: 10, updated: T(3) },
  { id: 'v1', order: 5, group: 'Virtuous plan', updated: T(4) },
  { id: 'v3', order: 30, group: 'Virtuous plan', updated: T(5) },
];
const o = ST.ordered(list);
check(same(o.map((x) => x.card.id), ['v1', 'v2', 'v3', 'ah', 'new', 'old']), `ordered cards first, a group together where its first card sits, then the rest newest first (${o.map((x) => x.card.id)})`);
check(same(o.map((x) => x.place), ['start', 'next', 'later', 'later', null, null]), 'Start here, Next, After that');
check(same(o.map((x) => x.of), [[1, 3], [2, 3], [3, 3], null, null, null]), 'each card of a plan knows its place in it');
check(same(ST.ordered(list.filter((c) => c.id !== 'v1'), list).filter((x) => x.card.group).map((x) => x.of), [[2, 3], [3, 3]]), 'a plan counts its closed cards too: 2 of 3 once the first is done');
check(same(ST.ordered([{ id: 'a', updated: T(1) }, { id: 'b', updated: T(2) }]).map((x) => [x.card.id, x.place]), [['b', null], ['a', null]]), 'no order anywhere: newest first, as before');

// ---- what changed between two saves
const cards = (done, standing) => [{ id: 'p', title: 'Plan', standing: standing || 'open', steps: [{ i: 0, done: done.includes(0) }, { i: 1, done: done.includes(1) }] }];
const a = ST.digestOf(cx, cards([0]));
check(a.t === 1000 && a.name === 'Ana' && same(a.quests, [100, 5089]) && a.items[14047] === 6 && a.rep['Argent Dawn'] === 6, 'a save\'s digest');
const CH2 = JSON.parse(JSON.stringify(CH));
CH2.snap.taken = 1600; CH2.snap.character.level = 59; CH2.snap.completedQuests.push(5102);
CH2.snap.bags[0].items.splice(0, 1); CH2.snap.bags[0].items.push({ item: 'item:12345:::::', count: 2 });
CH2.snap.reputation[1].reaction = 7;
const b = ST.digestOf(ST.contextOf(CH2), cards([0, 1], 'finished'));
const names = (k, id) => (k === 'quest' && id === 5102 ? 'General Drakkisath' : k === 'item' && id === 12345 ? 'Test Item' : null);
const w = ST.wakeOf(a, b, names);
check(w && w.since === new Date(1000e3).toISOString() && w.at === new Date(1600e3).toISOString() && w.character === 'Ana', 'the change says from when to when');
check(same(w.level, { from: 58, to: 59 }) && same(w.questsDone, [{ id: 5102, title: 'General Drakkisath' }]), 'level and quests done, with titles');
check(same(w.itemsGained, [{ id: 12345, name: 'Test Item', from: 0, to: 2 }]) && same(w.itemsLost, [{ id: 14047, name: null, from: 6, to: 3 }]), 'items gained and lost');
check(same(w.rep, [{ faction: 'Argent Dawn', from: 'Honored', to: 'Revered' }]), 'reputation standings');
check(same(w.cards, [{ id: 'p', title: 'Plan', ticked: [1], closed: 'finished' }]), 'card steps newly ticked and a card that closed');
check(ST.wakeOf(a, Object.assign({}, a, { t: 2000 })) === null, 'nothing changed: no record');
check(ST.wakeOf(b, a) === null && ST.wakeOf(a, a) === null, 'an older or the same save: no record');
check(ST.wakeOf(a, Object.assign({}, b, { name: 'Alt' })) === null, 'another character: no record');

// ---- who made a card change (the wake's `you`): the player's own tick or close, not the game's check or Claude's stepsDone
const by = (who) => [{ id: 'p', title: 'Plan', standing: 'open', steps: [{ i: 0, done: true, by: 'game' }, { i: 1, done: true, by: who }] }];
const wy = ST.wakeOf(a, Object.assign(ST.digestOf(cx, by('you')), { t: 2000 })), wc = ST.wakeOf(a, Object.assign(ST.digestOf(cx, by('claude')), { t: 2000 }));
check(wy && wy.cards[0].you === true, `the player ticked a step: marked yours (${JSON.stringify(wy && wy.cards)})`);
check(wc && !wc.cards[0].you, `Claude ticked it: not yours (${JSON.stringify(wc && wc.cards)})`);
const wd = ST.wakeOf(a, Object.assign(ST.digestOf(cx, [{ id: 'p', title: 'Plan', standing: 'dismissed', closedBy: 'you', steps: [{ i: 0, done: true }] }]), { t: 2000 }));
check(wd && wd.cards[0].you === true, 'the player closed a card: marked yours');

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
