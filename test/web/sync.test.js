// node test/web/sync.test.js [path to a real ClaudeCompanion.lua]
// History sync (js/sync.js) against an in-memory copy of the backend's rules
// (supabase/migrations/*_sync.sql): register, push (history written once, mutable rows replaced),
// pull (cursor, own mutable rows left out), link codes. Two computers, offline, re-sends, settings.
// With BACKEND=live it runs the same steps against the real Supabase project (tools/sync-roundtrip.sh).
const fs = require('fs');
const L = require('../../ClaudeCompanion/web/js/lua.js');
const S = require('../../ClaudeCompanion/web/js/sync.js');
const crypto = require('crypto');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

const { memoryBackend } = require('./sync-backend.js');

// one computer: its own companion-data (state + cache files)
function computer(fetch, name, os) {
  const files = {};
  let now = Date.parse('2026-11-22T12:00:00Z');
  return { files, tick(ms) { now += ms; }, client: S.client({ fetch, now: () => now, crypto: crypto.webcrypto,
    loadState: async () => (files.state ? JSON.parse(files.state) : null), saveState: async (s) => { files.state = JSON.stringify(s); },
    loadCache: async () => (files.cache ? JSON.parse(files.cache) : null), saveCache: async (c) => { files.cache = JSON.stringify(c); },
    device: { name, os } }) };
}

function fixture() {
  const t = 1795000000;
  return { items: {}, chars: { 'World-Atlas': {
    lastSeen: t + 1000, journal: [{ t: t + 1, e: 'login' }, { t: t + 10, e: 'kill', name: 'Wolf' }, { t: t + 10, e: 'kill', name: 'Wolf' }],
    sessions: [{ start: t, finish: t + 900, kills: 2 }], grinds: [], runs: [], notes: [], history: [{ t: t + 1000, level: 58, money: 5 }],
    snap: { taken: t + 1000, character: { money: 100 } }, grind: { name: 'jinthaalor', start: t + 100, last: t + 900, kills: 50 },
    ah: { prices: { 4306: { id: 4306, obs: [{ t: t + 200, min: 100, src: 'scan' }] } }, sales: [{ t: t + 300, item: 'x', net: 5 }], buys: [], posts: [] } } } };
}

async function main() {
  const file = process.argv[2];
  const real = file ? L.parse(fs.readFileSync(file).toString('latin1')).ClaudeCompanionDB : null;
  const base = real || fixture();
  const key = Object.keys(base.chars)[0];

  // ---- records: stable ids, identical events kept apart, size limits
  const r1 = S.recordsOf(base, 'devA'), r2 = S.recordsOf(clone(base), 'devA');
  check(JSON.stringify(r1.map((r) => r.id)) === JSON.stringify(r2.map((r) => r.id)), `ids are stable (${r1.length} records)`);
  check(new Set(r1.map((r) => r.id)).size === r1.length, 'every record has its own id (identical events in one second stay apart)');
  check(r1.every((r) => r.id.length <= 400 && JSON.stringify(r.data).length <= 65536), 'every record fits the backend limits');
  const c0 = base.chars[key];
  const obsN = Object.values((c0.ah || {}).prices || {}).reduce((a, p) => a + (p.obs ? Object.keys(p.obs).length : 0), 0);
  check(r1.filter((r) => r.kind === 'ah_obs').length === obsN, `one record per AH price observation (${obsN})`);
  const sameOther = S.recordsOf(base, 'devB').filter((r) => !r.mutable).map((r) => r.id);
  check(JSON.stringify(sameOther) === JSON.stringify(r1.filter((r) => !r.mutable).map((r) => r.id)), 'the same history from another computer has the same ids (no duplicates when both saves have it)');

  // ---- two computers
  const B = memoryBackend();
  const pc = computer(B.fetch, 'Gab', 'pc'), mac = computer(B.fetch, 'MacBook', 'mac');
  const pcDb = clone(base), macDb = clone(base);
  // the Mac played later: its own events, a grind, a run, a sale
  const T = Math.max(c0.lastSeen || 0, (c0.snap || {}).taken || 0);
  const m = macDb.chars[key];
  m.lastSeen = T + 3 * 3600;
  m.snap = Object.assign({}, m.snap, { taken: T + 3 * 3600 });
  const arrOf = (x) => (Array.isArray(x) ? x : x ? Object.values(x) : []);
  m.journal = arrOf(m.journal).concat([{ t: T + 3600, e: 'login' }, { t: T + 3700, e: 'kill', name: 'Thaurissan Firewalker' }, { t: T + 3700, e: 'kill', name: 'Thaurissan Firewalker' }]);
  m.grinds = arrOf(m.grinds).concat([{ name: 'thaurissan', start: T + 3600, finish: T + 7200, kills: 30 }]);
  m.runs = arrOf(m.runs).concat([{ name: 'Blackrock Depths', start: T + 7300, finish: T + 9000, kills: 90, bosses: [] }]);
  m.ah = Object.assign({}, m.ah, { sales: arrOf((m.ah || {}).sales).concat([{ t: T + 9100, item: 'Robe', net: 100000 }]) });
  delete m.grind;
  m.run = { name: 'Stratholme', start: T + 10000, last: T + 10800, kills: 12 };

  const nPc = await pc.client.push(pcDb, { 'cc.weights.v1': '{"a":1}' });
  check(nPc === r1.length + 1, `first push sends the whole save once (${nPc})`);
  const again = await pc.client.push(pcDb, { 'cc.weights.v1': '{"a":1}' });
  check(again <= 30, `pushing the same save again sends almost nothing (${again}: only records at the last second, to be safe)`);
  const stored0 = B.records.size;
  await pc.client.push(pcDb, {});
  check(B.records.size === stored0, 're-sending never duplicates');

  // offline: the Mac can't reach the backend; nothing is lost
  B.down = true;
  let threw = false;
  try { await mac.client.push(macDb, {}); } catch (e) { threw = true; }
  check(threw && !JSON.parse(mac.files.state || '{}').account && !Object.keys(JSON.parse(mac.files.state || '{}').sent || {}).length, 'offline: the push fails and nothing is marked sent');
  B.down = false;
  // the two computers are different accounts until they're linked
  await mac.client.push(macDb, {});
  check(pc.client.state.account !== mac.client.state.account, 'each install starts with its own account');
  const code = await pc.client.linkCode();
  await mac.client.link(code.code);
  check(pc.client.state.account === mac.client.state.account, 'a link code joins the Mac to the PC\'s account');
  const macPull = await mac.client.pull();
  check(macPull.settings['cc.weights.v1'] === '{"a":1}', 'settings from the PC reach the Mac');
  await mac.client.push(macDb, {});
  const r = await pc.client.pull();
  check(r.changed > 0, `the PC gets the Mac's records (${r.changed})`);

  // the merged view on the PC: its own save + the Mac's history
  const v = pc.client.view(pcDb);
  const vc = v.chars[key];
  const kills = arrOf(vc.journal).filter((e) => e.e === 'kill' && e.name === 'Thaurissan Firewalker' && e.t === T + 3700).length;
  check(kills === 2, `the Mac's two identical kills both show, once each (${kills})`);
  check(arrOf(vc.grinds).some((g) => g.name === 'thaurissan'), 'the Mac\'s grind shows on the PC');
  check(arrOf(vc.runs).some((g) => g.name === 'Blackrock Depths'), 'the Mac\'s dungeon run shows on the PC');
  check(arrOf((vc.ah || {}).sales).some((s) => s.item === 'Robe'), 'the Mac\'s AH sale shows on the PC');
  const ownJournal = arrOf(c0.journal).length;
  check(arrOf(vc.journal).length === ownJournal + 3, `journal = this save + the Mac's 3 new events, no duplicates (${arrOf(vc.journal).length})`);
  check(vc.run && vc.run.name === 'Stratholme', 'the Mac played last: its dungeon run in progress shows as running on the PC too');
  check(vc.snap.taken === pcDb.chars[key].snap.taken, 'the "now" parts are this computer\'s own save');
  check(JSON.stringify(pcDb) === JSON.stringify(clone(pcDb)) && !pcDb.chars[key].journal.some((e) => e && e.dev), 'the save itself is never changed');

  // the Mac's view: the PC's grind in progress ended "away" (the Mac played after it)
  const mv = mac.client.view(macDb).chars[key];
  check(!c0.grind || (!mv.grind && arrOf(mv.grinds).some((g) => g.name === c0.grind.name && g.start === c0.grind.start && g.ended === 'away')), 'on the Mac, the PC\'s older running grind shows as ended "away"');

  // a cleared save keeps its history: the PC's own records come back
  const fresh = clone(pcDb); fresh.chars[key].journal = [];
  const pc2v = pc.client.view(fresh).chars[key];
  check(arrOf(pc2v.journal).length >= ownJournal, 'history this computer already sent comes back if its save loses it');

  // live state replaces itself; history never changes
  pcDb.chars[key].grind.kills = 99;
  const n2 = await pc.client.push(pcDb, {});
  const live = [...B.records.values()].filter((x) => x.kind === 'live' && x.dev === pc.client.state.device);
  check(live.length === 1 && live[0].data.grind.kills === 99 && n2 >= 1, 'a running grind updates its one live record');

  // a third computer, with a big first push in batches
  const third = computer(B.fetch, 'Laptop', 'pc');
  const big = clone(base); big.chars[key].journal = Array.from({ length: 2600 }, (_, i) => ({ t: T + 20000 + i, e: 'kill', name: 'Mob' + (i % 7) }));
  const n3 = await third.client.push(big, {});
  check(n3 > 2600, `a big save goes in batches (${n3})`);

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
