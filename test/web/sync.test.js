// node test/web/sync.test.js [path to a real ClaudeCompanion.lua]
// History sync: js/sync.js against the real backend SQL (supabase/migrations, on a plain Postgres:
// test/sql/backend.js; needs PGHOST / PGPORT / PGUSER). Two and three computers: register, push
// (history written once, replaced rows replaced), pull (cursor, shadowed copies left out), linking,
// settings (newest wins; the joined account's win), offline, overlapping pushes, link-code limits.
const fs = require('fs');
const L = require('../../ClaudeCompanion/web/js/lua.js');
const S = require('../../ClaudeCompanion/web/js/sync.js');
const { sqlBackend } = require('../sql/backend.js');
const crypto = require('crypto');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

// one computer: its own companion-data (state + cache files) and its own clock
function computer(fetch, name, os) {
  const files = { state: JSON.stringify({ key: crypto.randomBytes(32).toString('hex') }) };   // the local server makes the key
  let now = Date.parse('2026-11-22T12:00:00Z');
  return { files, tick(ms) { now += ms; }, client: S.client({ fetch, now: () => now,
    loadState: async () => (files.state ? JSON.parse(files.state) : null), saveState: async (s) => { files.state = JSON.stringify(s); },
    loadCache: async () => (files.cache ? JSON.parse(files.cache) : null), saveCache: async (c) => { files.cache = JSON.stringify(c); },
    device: { name, os } }) };
}
// one sync, the way the app does it: pull, apply settings, push
async function sync(pc, db, local) {
  const r = await pc.client.pull(local);
  Object.assign(local || {}, r.settings);
  await pc.client.push(db, local);
  return r;
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
  const arrOf = (x) => (Array.isArray(x) ? x : x ? Object.values(x) : []);
  const B = sqlBackend();
  const count = (where) => Number(B.query(`select count(*) from public.records ${where || ''}`));
  try {
    // ---- records: stable ids, identical events kept apart, size limits
    const r1 = S.recordsOf(base, 'devA'), r2 = S.recordsOf(clone(base), 'devA');
    check(JSON.stringify(r1.map((r) => r.id)) === JSON.stringify(r2.map((r) => r.id)), `ids are stable (${r1.length} records)`);
    check(new Set(r1.map((r) => r.id)).size === r1.length, 'every record has its own id (identical events in one second stay apart)');
    check(r1.every((r) => r.id.length <= 400 && JSON.stringify(r.data).length <= (r.kind === 'now' ? 2097152 : 65536)), 'every record fits the backend limits');
    const c0 = base.chars[key];
    const obsN = Object.values((c0.ah || {}).prices || {}).reduce((a, p) => a + (p.obs ? Object.keys(p.obs).length : 0), 0);
    check(r1.filter((r) => r.kind === 'ah_obs').length === obsN, `one record per AH price observation (${obsN})`);
    const perComputer = (r) => r.kind === 'live' || r.kind === 'now';
    const sameOther = S.recordsOf(base, 'devB').filter((r) => !perComputer(r)).map((r) => r.id);
    check(JSON.stringify(sameOther) === JSON.stringify(r1.filter((r) => !perComputer(r)).map((r) => r.id)), 'the same history from another computer has the same ids');

    // ---- two computers, each on its own first
    const pc = computer(B.fetch, 'Gab', 'pc'), mac = computer(B.fetch, 'MacBook', 'mac');
    const pcDb = clone(base), macDb = clone(base);
    const T = Math.max(c0.lastSeen || 0, (c0.snap || {}).taken || 0);
    const m = macDb.chars[key];
    m.lastSeen = T + 3 * 3600;
    m.snap = Object.assign({}, m.snap, { taken: T + 3 * 3600 });
    m.journal = arrOf(m.journal).concat([{ t: T + 3600, e: 'login' }, { t: T + 3700, e: 'kill', name: 'Thaurissan Firewalker' }, { t: T + 3700, e: 'kill', name: 'Thaurissan Firewalker' }]);
    m.grinds = arrOf(m.grinds).concat([{ name: 'thaurissan', start: T + 3600, finish: T + 7200, kills: 30 }]);
    m.runs = arrOf(m.runs).concat([{ name: 'Blackrock Depths', start: T + 7300, finish: T + 9000, kills: 90, bosses: [] }]);
    m.ah = Object.assign({}, m.ah, { sales: arrOf((m.ah || {}).sales).concat([{ t: T + 9100, item: 'Robe', net: 100000 }]) });
    delete m.grind;
    m.run = { name: 'Stratholme', start: T + 10000, last: T + 10800, kills: 12 };
    const pcSet = { 'cc.weights.v1': 'PC custom weights' }, macSet = { 'cc.weights.v1': 'Mac defaults', 'cc.gear.pick': 'mac only' };

    await sync(pc, pcDb, pcSet);
    const nPc = count();
    check(nPc === r1.length + 1, `first sync sends the whole save once, then settings (${nPc} rows)`);
    const again = await pc.client.push(pcDb, pcSet);
    check(again <= 30, `pushing the same save again sends almost nothing (${again}: records at the last second, to be safe)`);
    await pc.client.push(pcDb, pcSet);
    check(count() === nPc, 're-sending never duplicates');

    // offline: nothing is lost and nothing is marked sent
    B.down = true;
    let threw = false;
    try { await sync(mac, macDb, macSet); } catch (e) { threw = true; }
    check(threw && !JSON.parse(mac.files.state).account, 'offline: the sync fails and nothing is marked sent');
    B.down = false;
    mac.tick(60000);
    await sync(mac, macDb, macSet);
    check(pc.client.state.account !== mac.client.state.account, 'each install starts with its own account');

    // ---- the Mac joins the PC's account
    const bad = [];
    for (let i = 0; i < 11; i++) { try { await mac.client.link('WRONG' + i); } catch (e) { bad.push(e.message); } }
    check(bad.length === 11 && /too many wrong codes/.test(bad[10]), 'wrong link codes: refused, and blocked after 10 in an hour');
    B.query("update private.link_attempts set at = now() - interval '2 hours'");
    const code = await pc.client.linkCode();
    check(/^[A-HJ-NP-Z2-9]{8}$/.test(code.code), 'link codes: 8 letters and digits without I, O, 0, 1');
    // the Mac's cards.json (a friend's Claude) went to its own account before the link: it goes again to the new one (#83)
    const macCards = JSON.stringify({ schema: 1, cards: [{ id: 'mac-card', title: 'From the Mac', updated: '2026-11-24T10:00:00Z' }] });
    const sentBefore = await mac.client.pushCards(macCards);
    await mac.client.link(code.code);
    check(pc.client.state.account === mac.client.state.account, 'a link code joins the Mac to the PC\'s account');
    const sentAfter = await mac.client.pushCards(macCards);
    const joinedCards = B.query(`select data->>'v' from public.records where id = 'setting|cc.claude.cards' and account_id = '${pc.client.state.account}'`);
    check(sentBefore && sentBefore.ok && sentAfter && sentAfter.ok && /mac-card/.test(joinedCards || ''), "after a link, the computer's cards.json is sent again, to the account it joined");
    let reuse = false; try { await computer(B.fetch, 'x', 'pc').client.link(code.code); } catch (e) { reuse = true; }
    check(reuse, 'a link code works once');
    await sync(mac, macDb, macSet);
    check(macSet['cc.weights.v1'] === 'PC custom weights', `the Mac takes the account's settings when it joins ("${macSet['cc.weights.v1']}")`);
    await sync(pc, pcDb, pcSet);
    check(pcSet['cc.weights.v1'] === 'PC custom weights', `the PC keeps its own settings ("${pcSet['cc.weights.v1']}")`);
    check(pcSet['cc.gear.pick'] === 'mac only', 'a setting only the Mac had reaches the PC');

    // the merged view on the PC: its own save + the Mac's history
    const vc = pc.client.view(pcDb).chars[key];
    const kills = arrOf(vc.journal).filter((e) => e.e === 'kill' && e.name === 'Thaurissan Firewalker' && e.t === T + 3700).length;
    check(kills === 2, `the Mac's two identical kills both show, once each (${kills})`);
    check(arrOf(vc.grinds).some((g) => g.name === 'thaurissan' && g.start === T + 3600), 'the Mac\'s grind shows on the PC');
    check(arrOf(vc.runs).some((g) => g.name === 'Blackrock Depths'), 'the Mac\'s dungeon run shows on the PC');
    check(arrOf((vc.ah || {}).sales).some((x) => x.item === 'Robe'), 'the Mac\'s AH sale shows on the PC');
    const ownJournal = arrOf(c0.journal).length;
    check(arrOf(vc.journal).length === ownJournal + 3, `journal = this save + the Mac's 3 new events, no duplicates (${arrOf(vc.journal).length})`);
    check(vc.run && vc.run.name === 'Stratholme', 'the Mac played last: its dungeon run in progress shows as running on the PC too');
    const newestSnap = Math.max(pcDb.chars[key].snap.taken, macDb.chars[key].snap.taken);
    check(vc.snap.taken === newestSnap, 'the "now" parts come from the computer that saved last');
    check(!arrOf(pcDb.chars[key].journal).some((e) => e && e.dev), 'the save itself is never changed');
    const mv = mac.client.view(macDb).chars[key];
    check(!c0.grind || (!mv.grind && arrOf(mv.grinds).some((g) => g.name === c0.grind.name && g.start === c0.grind.start && g.ended === 'away')),
      'on the Mac, the PC\'s older running grind shows as ended "away"');
    const fresh = clone(pcDb); fresh.chars[key].journal = [];
    check(arrOf(pc.client.view(fresh).chars[key].journal).length >= ownJournal, 'history this computer already sent comes back if its save loses it');

    // a finished run that changes later (its last loot) reaches the other computer
    m.runs[m.runs.length - 1] = Object.assign({}, m.runs[m.runs.length - 1], { kills: 95, finish: T + 9100 });
    await sync(mac, macDb, macSet);
    await sync(pc, pcDb, pcSet);
    const run = arrOf(pc.client.view(pcDb).chars[key].runs).filter((x) => x.name === 'Blackrock Depths');
    check(run.length === 1 && run[0].kills === 95, `a run changed after it was sent: the PC gets the new version, once (${run.map((x) => x.kills)})`);

    // settings later: the newest change wins
    pc.tick(5 * 60000); pcSet['cc.weights.v1'] = 'PC newer';
    await sync(pc, pcDb, pcSet);
    await sync(mac, macDb, macSet);
    check(macSet['cc.weights.v1'] === 'PC newer', 'a setting changed on the PC reaches the Mac');
    pc.tick(60000); pcSet['cc.weights.v1'] = 'PC at 12:06';
    mac.tick(10 * 60000); macSet['cc.weights.v1'] = 'Mac at 12:11';
    await sync(pc, pcDb, pcSet);
    await sync(mac, macDb, macSet);
    await sync(pc, pcDb, pcSet);
    check(pcSet['cc.weights.v1'] === 'Mac at 12:11' && macSet['cc.weights.v1'] === 'Mac at 12:11', `both changed it: the newer change wins on both (${pcSet['cc.weights.v1']} / ${macSet['cc.weights.v1']})`);

    // cc.claude.cards has one writer, Claude: a stale copy on a computer never goes out (#107)
    B.query(`select private.claude_put_setting('${pc.client.state.account}', 'cc.claude.cards', '{"schema":1,"cards":[{"id":"new-1","kind":"note","title":"new"}]}');`);
    pcSet['cc.claude.cards'] = '{"schema":1,"cards":[{"id":"old-1","kind":"note","title":"old"}]}';
    pc.tick(60000); await pc.client.push(pcDb, pcSet);
    check(/new/.test(B.query(`select data->>'v' from public.records where id = 'setting|cc.claude.cards'`)), 'a stale cc.claude.cards on a computer is never pushed over Claude\'s');
    await sync(mac, macDb, macSet);
    check(/new/.test(macSet['cc.claude.cards'] || ''), 'and the other computer gets Claude\'s cards');
    const stale = { id: 'setting|cc.claude.cards', char: '*', kind: 'setting', t: 9e9, mutable: true, data: { k: 'cc.claude.cards', v: 'old build', t: 9e9 } };
    await B.fetch('/rpc/cc_push', { body: JSON.stringify({ p_key: JSON.parse(pc.files.state).key, p_records: [stale] }) });
    check(/new/.test(B.query(`select data->>'v' from public.records where id = 'setting|cc.claude.cards'`)), 'the database ignores cc.claude.cards from a computer (an older build)');
    // #150: a page on the Mac loads an older copy of Claude's cards (settings.json written by another page)
    // after the cursor has passed Claude's write: the account's copy comes back, on this page and on a new one
    macSet['cc.claude.cards'] = '{"schema":1,"cards":[{"id":"old-1","kind":"note","title":"old"}]}';
    await sync(mac, macDb, macSet);
    check(/new/.test(macSet['cc.claude.cards'] || ''), 'an older copy of Claude\'s cards on a computer is replaced by the account\'s at the next pull (#150)');
    const macPage = { files: mac.files, client: S.client({ fetch: B.fetch, now: () => Date.parse('2026-11-22T13:00:00Z'),
      loadState: async () => JSON.parse(mac.files.state), saveState: async (s) => { mac.files.state = JSON.stringify(s); },
      loadCache: async () => (mac.files.cache ? JSON.parse(mac.files.cache) : null), saveCache: async (c) => { mac.files.cache = JSON.stringify(c); },
      device: { name: 'MacBook', os: 'mac' } }) };
    const stateNow = JSON.parse(mac.files.state);
    const cacheNow = JSON.parse(mac.files.cache); cacheNow.after = Number(B.query('select max(seq) from public.records'));   // the cursor is past Claude's write
    mac.files.cache = JSON.stringify(cacheNow);
    stateNow.settings['cc.claude.cards'] = '{"schema":1,"cards":[{"id":"old-1","kind":"note","title":"old"}]}';   // another page wrote sync.json
    mac.files.state = JSON.stringify(stateNow);
    const pageSet = Object.assign({}, macSet, { 'cc.claude.cards': '{"schema":1,"cards":[{"id":"old-1","kind":"note","title":"old"}]}' });
    const rowsBefore = count(), rp = await sync(macPage, macDb, pageSet);
    check(/new/.test(pageSet['cc.claude.cards'] || '') && /new/.test(rp.settings['cc.claude.cards'] || ''), 'a new page whose files hold an older copy asks the account once and shows Claude\'s current cards (#150)');
    check(/new/.test(B.query(`select data->>'v' from public.records where id = 'setting|cc.claude.cards'`)) && count() === rowsBefore, 'and sends nothing back');
    check(/only cc\.claude\.cards/.test(await B.fetch('/rpc/cc_claude_setting', { body: JSON.stringify({ p_key: JSON.parse(mac.files.state).key, p_k: 'cc.weights.v1' }) }).then((r) => r.text())), 'the account copy look-up reads Claude\'s cards only');
    check(/unknown device/.test(await B.fetch('/rpc/cc_claude_setting', { body: JSON.stringify({ p_key: 'x'.repeat(64), p_k: 'cc.claude.cards' }) }).then((r) => r.text())), 'and needs a device key');
    delete pcSet['cc.claude.cards']; delete macSet['cc.claude.cards'];

    // a running grind replaces its one live row
    pcDb.chars[key].grind = Object.assign({ name: 'g', start: T }, pcDb.chars[key].grind, { kills: 99 });
    await sync(pc, pcDb, pcSet);
    check(count(`where kind = 'live' and device_id = '${pc.client.state.device}'`) === 1 && B.query(`select data->'grind'->>'kills' from public.records where kind = 'live' and device_id = '${pc.client.state.device}'`) === '99',
      'a running grind updates its one live row');

    // a third computer joins; it sees everything once, and a big first save goes in batches
    const third = computer(B.fetch, 'Laptop', 'pc');
    const big = clone(base); big.chars[key].journal = Array.from({ length: 2600 }, (_, i) => ({ t: T + 20000 + i, e: 'kill', name: 'Mob' + (i % 7) }));
    const thirdSet = { 'cc.weights.v1': 'laptop default' };
    await sync(third, big, thirdSet);
    await third.client.link((await pc.client.linkCode()).code);
    await sync(third, big, thirdSet);
    check(thirdSet['cc.weights.v1'] === 'Mac at 12:11', `the third computer takes the account's newest setting (${thirdSet['cc.weights.v1']})`);
    const tv = third.client.view(big).chars[key];
    check(arrOf(tv.grinds).filter((g) => g.name === 'thaurissan' && g.start === T + 3600).length === 1, 'it sees the Mac\'s grind once');

    // overlapping pushes: a push that started first but commits last must still reach a computer that
    // pulled in between (the pull cursor is the row number, so rows must commit in number order)
    const rows = (tag, n) => Array.from({ length: n }, (_, i) => ({ id: `${key}|journal|${T + 60000 + i}|${tag}${i}`, char: key, kind: 'journal', t: T + 60000 + i, data: { t: T + 60000 + i, e: 'loot', name: tag + i } }));
    const slow = B.queryAsync('begin;\n' + B.sqlOf('cc_push', { p_key: JSON.parse(pc.files.state).key, p_records: rows('slow', 50) }) + '\nselect pg_sleep(1.5);\ncommit;');
    await new Promise((ok) => setTimeout(ok, 400));
    await mac.client.push({ chars: {} }, null);                       // nothing; makes sure the Mac is registered
    await B.fetch('/rpc/cc_push', { body: JSON.stringify({ p_key: JSON.parse(mac.files.state).key, p_records: rows('fast', 50) }) });
    await third.client.pull(null);                                    // pulls while the slow push may still be open
    await slow;
    await third.client.pull(null);
    const got = (tag) => Object.values(third.client.cache.recs).filter((x) => x.kind === 'journal' && String((x.data || {}).name).startsWith(tag)).length;
    check(got('slow') === 50 && got('fast') === 50, `overlapping pushes: a push that commits late still reaches the others (${got('slow')} + ${got('fast')} of 100)`);

    // closed to the API: nothing but the functions
    // ---- "now": a computer not played on lately shows what the character has now (the other's newer save)
    {
      const T = 1796000000;
      const pcDb = clone(base), macDb = clone(base);
      pcDb.chars[key].snap = Object.assign({}, pcDb.chars[key].snap, { taken: T + 5000, bags: { marker: 'from the PC' } });
      pcDb.chars[key].lastSeen = T + 5000;
      macDb.chars[key].snap = Object.assign({}, macDb.chars[key].snap, { taken: T, bags: { marker: 'old, on the Mac' } });
      await sync(pc, pcDb, {});
      await mac.client.pull(null);
      const v = mac.client.view(macDb).chars[key];
      check(v.snap.taken === T + 5000 && v.snap.bags.marker === 'from the PC', 'the Mac shows the bags and gear the PC saved last');
      check(macDb.chars[key].snap.bags.marker === 'old, on the Mac', 'its own save is untouched');
      macDb.chars[key].snap = Object.assign({}, macDb.chars[key].snap, { taken: T + 9000, bags: { marker: 'newer, on the Mac' } });
      check(mac.client.view(macDb).chars[key].snap.bags.marker === 'newer, on the Mac', 'once the Mac saves later, its own wins');
      const nowRows = B.query(`select count(*) from public.records where kind = 'now'`);
      await pc.client.pull(null);
      check(!Object.values(pc.client.cache.recs).some((x) => x.kind === 'now' && x.dev === pc.client.state.device), `a computer doesn't pull its own "now" back (${nowRows} rows)`);
    }
    // ---- snapshots: each computer's "now" online for Claude, one row per computer, never pulled
    const snap = { schema: 1, written: '2026-11-22T15:30:00Z', by: 'app', savedInGame: '2026-11-22T15:29:50Z',
      character: { name: 'Gabriel', where: { zone: 'Felwood', x: 0.5, y: 0.4 } }, quests: [{ id: 1, title: 'Cleansing Felwood' }] };
    check(await pc.client.pushSnapshot(snap), 'a computer sends its snapshot');
    check(!(await pc.client.pushSnapshot(Object.assign({}, snap, { written: '2026-11-22T15:31:00Z', by: 'background' }))), 'the same snapshot again (a new write time only) is not sent');
    await pc.client.pushSnapshot(Object.assign({}, snap, { quests: [] }));
    const snaps = B.query(`select count(*) || '|' || max(data->>'savedInGame') || '|' || max(jsonb_array_length(data->'quests')) from public.records where kind = 'snapshot'`);
    check(snaps === '1|2026-11-22T15:29:50Z|0', `one current snapshot per computer, replaced when it changes (${snaps})`);
    const hist = B.query(`select count(*) from private.history where kind = 'snapshot' and data->'character'->'where'->>'zone' = 'Felwood'`);
    check(hist === '1', 'Claude reads it in private.history');
    const before = Object.values(mac.client.cache.recs).filter((x) => x.kind === 'snapshot').length;
    await mac.client.pull(null);
    check(before === 0 && !Object.values(mac.client.cache.recs).some((x) => x.kind === 'snapshot'), 'other computers don\'t pull it');
    const huge = 'x'.repeat(100000);
    await pc.client.pushSnapshot(Object.assign({}, snap, { big: huge }));
    check(B.query(`select length(data->>'big') from public.records where kind = 'snapshot'`) === '100000', 'a snapshot may be bigger than a history record');
    let forged = false;
    try { await B.fetch(S.CONFIG.url + '/rest/v1/rpc/cc_push', { body: JSON.stringify({ p_key: pc.files.state && JSON.parse(pc.files.state).key, p_records: [{ id: 'snapshot|someone-else', char: '*', kind: 'snapshot', t: 1, data: { big: huge }, mutable: true }] }) }).then(async (r) => { if (!r.ok) throw new Error(await r.text()); }); } catch (e) { forged = /bad record/.test(e.message); }
    check(forged, 'a big record must be this computer\'s own snapshot');
    // a long session or run carries every item looted (27 Nov: one save held a tracker over 64 KB, refused, and every
    // newer record waited behind it): trackers up to 1 MB; a record the backend still refuses is named and set aside
    {
      const big = computer(B.fetch, 'Long', 'pc');
      const db = clone(base), c = db.chars[key], t0 = 1796000000;
      c.runs = [{ start: t0, name: 'Blackrock Depths', groupLoot: Array.from({ length: 3000 }, (_, i) => ({ t: t0 + i, item: 'Item ' + i, who: 'Someone-Server' })) }];
      c.notes = [{ t: t0 + 5, text: 'n'.repeat(70000) }];
      c.journal = [...arrOf(c.journal), { t: t0 + 10, e: 'login' }];
      await sync(big, db, null);
      const dev = big.client.state.device, st = big.client.status;
      check(Number(B.query(`select octet_length(data::text) from public.records where device_id = '${dev}' and kind = 'run'`)) > 65536,
        'a dungeon run over 64 KB is taken (trackers up to 1 MB)');
      check(B.query(`select count(*) from public.records where device_id = '${dev}' and kind = 'journal' and t = ${t0 + 10}`) === '1' &&
        B.query(`select count(*) from public.records where device_id = '${dev}' and kind = 'note'`) === '0',
        'a record the backend refuses is set aside, and everything newer still goes');
      check(st.ok !== false && st.refused.length === 1 && st.refused[0].kind === 'note' && /data is \d+ bytes, at most 65536 for note/.test(st.refused[0].why),
        `the System tab is told which record and why (${JSON.stringify(st.refused.map((r) => r.why))})`);
      const sentAgain = [];
      const counting = computer(async (u, o) => { if (/cc_push/.test(u)) sentAgain.push(...JSON.parse(o.body).p_records.map((r) => r.kind)); return B.fetch(u, o); }, 'x', 'pc');
      counting.files.state = big.files.state;
      await counting.client.push(db, null);
      check(!sentAgain.includes('note'), 'and it is not sent again while it is unchanged');
    }
    let closed = 0;
    for (const sql of ['select count(*) from public.records', 'select count(*) from public.accounts', 'select count(*) from private.link_codes', "insert into public.records(account_id,id,char_key,kind,data) values (gen_random_uuid(),'x','x','x','{}')"]) {
      try { B.query('set role anon; ' + sql); } catch (e) { closed++; }
    }
    check(closed === 4, 'the API role can\'t read or write any table directly');
    // sync turned off on one computer: nothing goes out or comes in; back on, what waited goes
    {
      const quiet = computer(B.fetch, 'Friend', 'pc');
      await quiet.client.setOff(true);
      const before = B.query('select count(*) from public.records');
      let stopped = 0;
      for (const f of [() => quiet.client.pull(null), () => quiet.client.push(clone(base), null), () => quiet.client.pushSnapshot({ app: 1 })]) {
        try { await f(); } catch (e) { if (e.off) stopped++; }
      }
      check(stopped === 3 && B.query('select count(*) from public.records') === before && !JSON.parse(quiet.files.state).device,
        'sync turned off: this computer registers nothing, sends nothing and fetches nothing');
      check(await quiet.client.isOff(), 'sync off is kept in this computer\'s sync.json');
      await quiet.client.setOff(false);
      await sync(quiet, clone(base), null);
      check(!(await quiet.client.isOff()) && Number(B.query(`select count(*) from public.records where device_id = '${quiet.client.state.device}'`)) > 0,
        'turned back on, it registers and sends what waited');
    }
    // what a new save changed, for Claude (#163): one claude_wake record per new save with something new, the
    // first save only remembered, an older or unchanged save nothing; two computers seeing one save send one record
    {
      const W = require('../../ClaudeCompanion/web/js/cardsteps.js');
      const pc = computer(B.fetch, 'WakePC', 'pc'), mac = computer(B.fetch, 'WakeMac', 'mac');
      await sync(pc, clone(base), null); await sync(mac, clone(base), null);
      await mac.client.link((await pc.client.linkCode()).code);
      const ch = (t, quests, level) => ({ snap: { taken: t, character: { name: 'Wakey', level }, completedQuests: quests } });
      const wakes = () => Number(B.query(`select count(*) from private.history where kind = 'claude_wake' and account = '${pc.client.state.account}'`));
      const d1 = W.digestOf(W.contextOf(ch(1000, [1], 50)), []), d2 = W.digestOf(W.contextOf(ch(2000, [1, 2], 51)), []);
      check(await pc.client.pushWake(d1) === null && wakes() === 0 && JSON.parse(pc.files.state).wake.Wakey.t === 1000, 'the first save is only remembered');
      await mac.client.pushWake(d1);
      const w = await pc.client.pushWake(d2, (k, id) => (k === 'quest' ? 'Quest ' + id : null));
      const row = JSON.parse(B.query(`select json_build_object('id', id, 't', t, 'data', data) from private.history where kind = 'claude_wake' and account = '${pc.client.state.account}'`));
      check(w && wakes() === 1 && row.id === 'claude_wake|Wakey|2000' && row.t === 2000 && JSON.stringify(row.data.questsDone) === '[{"id":2,"title":"Quest 2"}]' && row.data.level.to === 51,
        `a new save with a quest done sends one claude_wake record (${JSON.stringify(row)})`);
      await mac.client.pushWake(d2);
      check(wakes() === 1, 'the other computer seeing the same save adds no second record');
      check(await pc.client.pushWake(d1) === null && await pc.client.pushWake(W.digestOf(W.contextOf(ch(3000, [1, 2], 51)), [])) === null && wakes() === 1,
        'an older save, or a new one where nothing changed: no record');
      // an alt played in between: each character keeps its own save before
      const alt = { snap: { taken: 3500, character: { name: 'Altie', level: 10 }, completedQuests: [9] } };
      await pc.client.pushWake(W.digestOf(W.contextOf(alt), []));
      await pc.client.pushWake(W.digestOf(W.contextOf(ch(4000, [1, 2, 3], 51)), []));
      check(wakes() === 2, 'after playing an alt, the next save of the first character still sends what changed');
    }
    // a retired account: its computers are refused
    B.query(`update public.accounts set retired = true where id = '${third.client.state.account}'`);
    let refused = false; try { await third.client.pull(null); } catch (e) { refused = /unknown device/.test(e.message); }
    check(refused, 'a retired account\'s computers are refused');
  } finally { B.drop(); }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
