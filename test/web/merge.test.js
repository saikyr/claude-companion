// node test/web/merge.test.js [path to a real ClaudeCompanion.lua]
// Merges a save with a made-up "other computer" copy of it and checks the rules in js/merge.js.
const fs = require('fs');
const L = require('../../ClaudeCompanion/web/js/lua.js');
const { merge } = require('../../ClaudeCompanion/web/js/merge.js');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

function fixture() {
  const t = 1795000000;
  return { items: { a: { id: 1 } }, chars: { 'World-Atlas': {
    lastSeen: t + 1000, journal: [{ t: t + 1, e: 'login' }, { t: t + 10, e: 'kill', name: 'Wolf' }], sessions: [{ start: t, kills: 1 }],
    grinds: [], runs: [], notes: [], snap: { taken: t + 1000, character: { money: 100 } }, bank: { taken: t + 500 },
    professions: { Tailoring: { rank: 250, taken: t + 900 } }, taxi: { 'Stormwind, Elwynn': { last: t + 100 } },
    grind: { name: 'jinthaalor', start: t + 100, last: t + 900, kills: 50 },
    ah: { prices: { 4306: { id: 4306, obs: [{ t: t + 200, min: 100, src: 'scan' }] } }, sales: [{ t: t + 300, item: 'x', net: 5 }], lastScan: { t: t + 200 } } } } };
}

const file = process.argv[2];
const own = file ? L.parse(fs.readFileSync(file).toString('latin1')).ClaudeCompanionDB : fixture();
const key = Object.keys(own.chars)[0];
const c = own.chars[key];
const T = Math.max(c.lastSeen || 0, (c.snap || {}).taken || 0);
// the other computer: played 3 h later, with its own journal, a newer snapshot, a scan, a grind and a run
const mac = clone(own);
const m = mac.chars[key];
m.lastSeen = T + 3 * 3600;
m.snap = Object.assign({}, m.snap, { taken: T + 3 * 3600, character: Object.assign({}, (m.snap || {}).character, { money: 999999 }) });
m.journal = (m.journal || []).concat([{ t: T + 3600, e: 'login' }, { t: T + 3700, e: 'kill', name: 'Thaurissan Firewalker' }, { t: T + 3 * 3600, e: 'logout' }]);
m.grinds = (m.grinds || []).concat([{ name: 'thaurissan', start: T + 3600, finish: T + 7200, kills: 30 }]);
m.runs = (m.runs || []).concat([{ name: 'Blackrock Depths', start: T + 7300, finish: T + 9000, kills: 90, bosses: [] }]);
delete m.grind;
// the Dungeon Journal addon's boss log: this computer has one run in it, the other computer another
c.bossLog = { from: 'ForeverDungeonJournal', read: T, runs: (((c.bossLog || {}).runs) || []).concat([{ id: 'pc-run', dungeon: 'Blackrock Depths', start: T - 9000, bosses: [{ name: 'Lord Roccor', t: T - 8000 }] }]) };
m.bossLog = { from: 'ForeverDungeonJournal', read: T + 9000, runs: [{ id: 'mac-run', dungeon: 'Scholomance', start: T + 7300, bosses: [{ name: 'Rattlegore', t: T + 8000 }] }] };
m.ah = clone(m.ah || {}); m.ah.prices = m.ah.prices || {};
const pk = Object.keys(m.ah.prices)[0] || '4306';
m.ah.prices[pk] = m.ah.prices[pk] || { id: 4306, obs: [] };
m.ah.prices[pk].obs = (m.ah.prices[pk].obs || []).concat([{ t: T + 5000, min: 1, src: 'scan' }]);
m.ah.lastScan = { t: T + 5000, items: 1 };
m.professions = Object.assign({}, m.professions, { Tailoring: { rank: 265, taken: T + 4000 } });
m.taxi = Object.assign({}, m.taxi, { 'Talrendis Point, Azshara': { last: T + 4000, continent: 'Kalimdor' } });
// a running grind on this computer, last counted before the other computer's play
c.grind = c.grind || { name: 'jinthaalor', start: T - 3600, last: T - 60, kills: 241 };
c.grind.last = Math.min(c.grind.last || T - 60, T - 60);

const before = { journal: (c.journal || []).length, grinds: (c.grinds || []).length };
const priceObs = (((c.ah || {}).prices || {})[pk] || { obs: [] }).obs.length;
const out = merge(own, [{ dev: 'mac', db: mac }], 'pc');
const o = out.chars[key];
check(o.journal.length === before.journal + 3, `journal: union without duplicates (${before.journal} + 3 = ${o.journal.length})`);
check(o.journal.every((e, i, a) => i === 0 || (a[i - 1].t || 0) <= (e.t || 0)), 'journal in time order');
check(o.journal.filter((e) => e.dev === 'mac').length === 3, 'entries from the other computer are marked dev = mac');
check(o.snap.taken === T + 3 * 3600 && o.snap.character.money === 999999, 'bags, gear and gold from the computer that saw them last');
check(o.professions.Tailoring.rank === 265, 'Tailoring 265 from the newer reading');
check(o.taxi['Talrendis Point, Azshara'] && Object.keys(o.taxi).length === Object.keys(c.taxi || {}).length + 1, 'flight paths from both continents');
check(!o.grind, 'the stale running grind is not shown as running');
const stale = o.grinds.find((g) => g.ended === 'away' && g.name === c.grind.name);
check(stale && stale.finish === c.grind.last, 'it is listed as ended "away" at its last counted event');
check(o.grinds.some((g) => g.name === 'thaurissan') && o.runs.some((r) => r.name === 'Blackrock Depths' && r.start === T + 7300), "the other computer's grind and run are there");
check(o.bossLog && ['pc-run', 'mac-run'].every((id) => o.bossLog.runs.some((r) => r.id === id)) && o.bossLog.runs.length === c.bossLog.runs.length + 1,
  "boss logs from both computers: a run's bosses show on the other computer");
const merged = o.ah.prices[pk].obs;
check(merged.some((x) => x.t === T + 5000) && merged.length === priceObs + 1, 'price history from both');
check(o.ah.lastScan.t === T + 5000, 'last AH scan is the newest');
const again = merge(out, [{ dev: 'mac', db: mac }], 'pc').chars[key];
check(again.journal.length === o.journal.length && again.grinds.length === o.grinds.length, 'merging twice adds nothing');
check((own.chars[key].journal || []).length === before.journal && (own.chars[key].grinds || []).length === before.grinds, 'the input saves are not changed');
check(merge(own, [], 'pc') === own, 'no other computer: the save as it is');
// dual spec: a save with both specs reads as an array (index 0 = spec 1); one with only spec 2 as { 2: ... }.
// Merged, they must keep the game's numbers, or spec 2 shows up as spec 1 (the "Shadow is active" bug).
{
  const a = clone(own), b = clone(own);
  a.chars[key].lastSeen = T + 1; b.chars[key].lastSeen = T + 2;
  a.chars[key].specs = [{ name: 'Holy', talentsTaken: T }, { name: 'Shadow', talentsTaken: T }];
  b.chars[key].specs = { 2: { name: 'Shadow', talentsTaken: T + 50 } };
  const s = merge(a, [{ dev: 'mac', db: b }], 'pc').chars[key].specs;
  check(Object.keys(s).sort().join() === '1,2' && s[1].name === 'Holy' && s[2].name === 'Shadow' && s[2].talentsTaken === T + 50,
    `specs keep the game's numbers across computers (${Object.keys(s).join(', ')})`);
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
