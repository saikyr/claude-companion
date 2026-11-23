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
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all spell-rank checks pass');
