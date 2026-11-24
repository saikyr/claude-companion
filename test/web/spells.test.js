// node test/web/spells.test.js
// The spell-rank check (js/spells.js): bar spells below the best rank you know, and the class trainer's list.
const S = require('../../ClaudeCompanion/web/js/spells.js');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };

const t = 1795000000;
const ch = {
  snap: { taken: t, activeSpec: 1, character: { level: 58 }, spellbook: [
    { name: 'Holy', spells: [
      { name: 'Flash Heal', rank: 'Rank 6', id: 10916 }, { name: 'Flash Heal', rank: 'Rank 7', id: 10917 },
      { name: 'Renew', rank: 'Rank 8', id: 10928 }, { name: 'Renew', rank: 'Rank 9', id: 10929 },
      { name: 'Heal', rank: 'Rank 4', id: 6064 }, { name: 'Fear Ward', rank: '', id: 6346 },
      { name: 'Spirit of Redemption', rank: '', id: 20711, passive: true }] }] },
  specs: {
    1: { barsTaken: t, actionBars: [
      { slot: 1, kind: 'spell', id: 10916, name: 'Flash Heal', key: '1' },   // rank 6 of 7: outdated
      { slot: 2, kind: 'spell', id: 10929, name: 'Renew' },                  // best
      { slot: 3, kind: 'spell', id: 6346, name: 'Fear Ward' },               // no ranks
      { slot: 4, kind: 'macro', id: 1, name: 'm' },
      { slot: 5, kind: 'spell', id: 99999, name: 'Renew' }] },              // id not in the spellbook
    2: { barsTaken: t, actionBars: [{ slot: 1, kind: 'spell', id: 10917, name: 'Flash Heal' }] },
  },
  trainer: { taken: t - 100, npc: 'High Priestess Laurena', level: 56, services: [
    { name: 'Renew', rank: 'Rank 9', status: 'used', level: 56 },
    { name: 'Flash Heal', rank: 'Rank 7', status: 'available', level: 56, cost: 30000 },   // known since: not to train
    { name: 'Greater Heal', rank: 'Rank 5', status: 'available', level: 58, cost: 38000 },
    { name: 'Prayer of Healing', rank: 'Rank 5', status: 'unavailable', level: 58, cost: 38000 }, // reached level since
    { name: 'Power Word: Shield', rank: 'Rank 10', status: 'unavailable', level: 60, cost: 40000 },
    { name: 'Holy Fire', rank: 'Rank 8', status: 'unavailable', level: 60, cost: 40000 }] },
};
const R = S.check(ch);
const s1 = R.specs.find((x) => x.spec === 1), s2 = R.specs.find((x) => x.spec === 2);
check(R.book.spells === 6, 'the spellbook counts active spells only (passive left out)');
check(s1 && s1.active && s1.spells === 4, 'spec 1 is active with 4 spells on its bars');
check(s1.outdated.length === 1 && s1.outdated[0].name === 'Flash Heal' && s1.outdated[0].rank === 6 && s1.outdated[0].best === 7 && s1.outdated[0].bestId === 10917 && s1.outdated[0].key === '1',
  'Flash Heal rank 6 on the bar is flagged: best known is rank 7');
check(s1.unranked.length === 1 && s1.unranked[0].slot === 5, 'a bar spell the spellbook has no id for is listed as unranked, not as outdated');
check(s2.outdated.length === 0, 'spec 2 holds the best rank');
check(R.train.map((x) => x.name).join() === 'Greater Heal,Prayer of Healing', 'to train: available ranks not in the spellbook, and ranks whose level was reached since the read');
check(R.trainCost === 76000, 'the cost to train them all');
check(R.later.map((x) => x.name).join() === 'Holy Fire,Power Word: Shield' && R.later[0].level === 60, 'later: ranks for a higher level, by level then name');
check(R.trainer && R.trainer.npc === 'High Priestess Laurena', 'the trainer it came from');
const none = S.check({ snap: ch.snap, specs: ch.specs });
check(none.trainer === null && none.train.length === 0 && none.specs.length === 2, 'no trainer read yet: bars still checked, nothing to train');
check(S.check({}).specs.length === 0, 'an empty character gives an empty check');
// arrays (a Lua 1..n list read as a JS array) are handled too
check(S.check({ snap: { spellbook: [{ spells: [{ name: 'Smite', rank: 'Rank 2', id: 591 }] }] }, specs: { 1: { actionBars: [] } } }).book.spells === 1, 'spellbook as arrays');
// a low rank kept beside the best one is on purpose (a cheap heal): not flagged
const both = S.check({ snap: ch.snap, specs: { 1: { actionBars: [{ slot: 1, kind: 'spell', id: 10916 }, { slot: 2, kind: 'spell', id: 10917 }] } } });
check(both.specs[0].outdated.length === 0, 'rank 6 beside rank 7 on the same bars is left alone');
// the spellbook lists only the top rank: the slot's own saved rank still shows the old one
const top = S.check({ snap: { spellbook: [{ spells: [{ name: 'Flash Heal', rank: 'Rank 7', id: 10917 }] }] },
  specs: { 1: { actionBars: [{ slot: 4, kind: 'spell', id: 10916, name: 'Flash Heal', rank: 'Rank 6' }] } } });
check(top.specs[0].outdated.length === 1 && top.specs[0].outdated[0].rank === 6, "an old rank is seen from the slot's own rank when the spellbook has only the top one");
// a trainer service with no rank, learned since: not to train
const fw = S.check({ snap: ch.snap, specs: {}, trainer: { level: 58, services: [{ name: 'Fear Ward', status: 'available', level: 20 }] } });
check(fw.train.length === 0, 'an unranked service in the spellbook is not to train');
check(R.known.some((k) => k.name === 'Flash Heal' && k.rank === 7) && !R.known.some((k) => k.name === 'Fear Ward'), 'known: the best rank of each ranked spell');

// #122: spells only a book teaches, and the group buffs' reagents. A made-up pack: codexes with and without a
// source, a mage tome, a pet grimoire; the real one: every class's books from the shipped pack
globalThis.GAMERULES = { buffReagents: [{ cls: 'PRIEST', spells: ['Prayer of Fortitude', 'Prayer of Shadow Protection'], item: 17029, name: 'Sacred Candle' }] };
const book = (name, req) => [name, 3, req, req, 0, 0, 0, 0, [], 9, [], '', 0];
const gd = { items: { 17413: book('Codex: Prayer of Fortitude', 48), 17414: book('Codex: Prayer of Fortitude II', 60), 22393: book('Codex: Prayer of Shadow Protection', 60),
    1084: book('Codex of Renew', 8), 18600: book('Tome of Arcane Brilliance', 56), 16302: book('Grimoire of Firebolt (Rank 2)', 8), 9001: book('Codex of Flash Heal VII', 56) },
  src: { 17413: [['drop', 'Anvilrage Warden', 1, 0, 0, 0, 0, 'Blackrock Depths', null, null, 'f']], 17414: [['drop', 'Warpwood Tangler', 2, 0, 0, 0, 0, 'Dire Maul', null, null, 'f']],
    22393: [['drop', 'x', 3, 0, 0, 0, 0, 'Scholomance', null, null, 'c']], 18600: [['drop', 'y', 4, 0, 0, 0, 0, 'Scholomance', null, null, 'f']], 9001: [['drop', 'z', 5, 0, 0, 0, 0, '', null, null, 'c']] },
  vend: { 16302: [['Spackle', 'Stormwind City', 0, 0, 0, 1, '', 'A']] }, teach: {} };
const pr = JSON.parse(JSON.stringify(ch)); pr.snap.character = { level: 58, classFile: 'PRIEST' };
pr.snap.spellbook[0].spells.push({ name: 'Prayer of Fortitude', rank: 'Rank 1', id: 21562 });
const PB = S.check(pr, gd).books;
check(PB.now.length === 0 && PB.later.map((b) => b.item).sort().join() === '17414,22393', `books: Prayer of Fortitude II and Prayer of Shadow Protection at 60, rank 1 known (${JSON.stringify(PB)})`);
check(!PB.later.concat(PB.now).some((b) => b.item === 1084 || b.item === 18600 || b.item === 16302), 'a book with no source, another class\'s tome, a pet grimoire: left out');
check(!PB.later.concat(PB.now).some((b) => b.item === 9001), 'a book for a rank you know (Flash Heal 7) is not missing');
check(PB.later[0].sources[0].name === 'Warpwood Tangler' && PB.later[0].sources[0].forever && PB.later[0].rank === 2, 'a book carries its sources (Forever-seen or Classic) and its rank');
pr.snap.character.level = 60;
check(S.check(pr, gd).books.now.length === 2, 'at 60 they are books to get now');
const RG = S.check(pr, gd).reagents;
check(RG.length === 1 && RG[0].spell === 'Prayer of Fortitude' && RG[0].have === 0, 'a group buff you know with no Sacred Candle in your bags is flagged');
pr.snap.bags = [{ id: 0, items: [{ slot: 1, item: 'item:17029::::::::60', count: 7 }] }];
check(S.check(pr, gd).reagents[0].have === 7, 'and counted when you carry some');
check(S.check(ch).books.now.length === 0 && Array.isArray(S.check(ch).reagents), 'no pack, no class: no books, no crash');
// raid-only books are kept apart; a book with a raid and a dungeon source shows the dungeon first
globalThis.GAMERULES = Object.assign({}, globalThis.GAMERULES, { instances: { raids: ['Molten Core', 'Scholomance'] } });
gd.src[17414].unshift(['drop', 'Raider', 9, 0, 0, 0, 0, 'Molten Core', null, null, 'f']);
const RB = S.check(pr, gd).books;
check(RB.raid.map((b) => b.item).join() === '22393' && !RB.now.some((b) => b.item === 22393), `a book only a raid gives is under raid (${JSON.stringify(RB.raid.map((b) => b.item))})`);
const pf2 = RB.now.find((b) => b.item === 17414);
check(pf2 && !pf2.raid && pf2.sources[0].name === 'Warpwood Tangler' && pf2.sources[1].raid === true, 'a book with a dungeon source too: not raid, dungeon source first');
globalThis.GAMERULES = { buffReagents: globalThis.GAMERULES.buffReagents };
// the real pack: the three priest books the issue names are found by their names
const fs = require('fs'), vm = require('vm'), path = require('path');
const dc = {}; dc.window = dc; vm.createContext(dc);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../ClaudeCompanion/web/data/gamedata.js'), 'utf8'), dc);
const real = S.check(Object.assign({}, pr, { snap: Object.assign({}, pr.snap, { spellbook: [{ name: 'Holy', spells: [{ name: 'Renew', rank: 'Rank 9', id: 1 }] }] }) }), dc.GAMEDATA).books.now.map((b) => b.item);
check([17413, 17414, 22393].every((id) => real.includes(id)), `the shipped pack: Codex: Prayer of Fortitude I and II and Prayer of Shadow Protection (${real.join(', ')})`);
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all spell-rank checks pass');
