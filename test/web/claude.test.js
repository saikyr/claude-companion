// node test/web/claude.test.js
// Claude's read/write interface (docs/CLAUDE.md) against the real backend SQL (test/sql/backend.js):
// Claude posts From Claude cards as the account setting cc.claude.cards, every computer of the account
// gets them on its next pull, the player's choices come back as cc.claude.cardsState, Claude reads them
// from private.history, and none of it is reachable with the publishable key.
const S = require('../../ClaudeCompanion/web/js/sync.js');
const { sqlBackend } = require('../sql/backend.js');
const crypto = require('crypto');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function computer(fetch, name) {
  const files = { state: JSON.stringify({ key: crypto.randomBytes(32).toString('hex') }) };
  let now = Date.parse('2026-11-22T12:00:00Z');
  return { files, tick(ms) { now += ms; }, client: S.client({ fetch, now: () => now,
    loadState: async () => JSON.parse(files.state), saveState: async (s) => { files.state = JSON.stringify(s); },
    loadCache: async () => (files.cache ? JSON.parse(files.cache) : null), saveCache: async (c) => { files.cache = JSON.stringify(c); },
    device: { name, os: 'pc' } }) };
}
const save = () => ({ items: {}, chars: { 'Ana-Realm': { lastSeen: 1795000000, journal: [{ t: 1795000001, e: 'login' }], snap: { taken: 1795000000, character: { name: 'Ana' } } } } });

(async () => {
  const B = sqlBackend();
  try {
    const pc = computer(B.fetch, 'PC'), mac = computer(B.fetch, 'Mac');
    const localPc = {}, localMac = {};
    await pc.client.pull(localPc); await pc.client.push(save(), localPc);
    const code = (await pc.client.linkCode()).code;
    await mac.client.pull(localMac); await mac.client.link(code); await mac.client.pull(localMac);
    const account = JSON.parse(pc.files.state).account;
    check(/^[0-9a-f-]{36}$/.test(account || ''), "the account id is in the computer's sync state (snapshot.json sync.account)");

    // Claude writes cards
    const cards = JSON.stringify({ schema: 1, cards: [{ id: 'farm-1', kind: 'farm', title: 'Farm Felcloth', step: 'dungeon:Scholomance' }] });
    const put = JSON.parse(B.query(`select private.claude_put_setting(${q(account)}, 'cc.claude.cards', ${q(cards)})::text;`));
    check(put.account === account, 'Claude stores the cards on the account');
    const rPc = await pc.client.pull(localPc), rMac = await mac.client.pull(localMac);
    check(rPc.settings['cc.claude.cards'] === cards && rMac.settings['cc.claude.cards'] === cards, 'both computers get the cards on their next pull');
    Object.assign(localPc, rPc.settings); Object.assign(localMac, rMac.settings);
    await pc.client.push(save(), localPc);
    check(B.query("select count(*) || ' ' || coalesce(max(device_id::text), 'claude') from public.records where id = 'setting|cc.claude.cards';") === '1 claude', "a computer doesn't send Claude's cards back as its own");

    // a new version replaces the old one
    const cards2 = cards.replace('Farm Felcloth', 'Farm Felcloth (updated)');
    B.query(`select private.claude_put_setting(${q(account)}, 'cc.claude.cards', ${q(cards2)});`);
    check((await mac.client.pull(localMac)).settings['cc.claude.cards'] === cards2, 'an updated card list replaces the old one');

    // the player's choices come back
    const state = JSON.stringify({ schema: 1, cards: { 'farm-1': { state: 'done', at: '2026-11-22T12:05:00Z' } } });
    mac.tick(60000); localMac['cc.claude.cardsState'] = state; await mac.client.push(save(), localMac);
    check(B.query(`select data->>'v' from private.history where account = ${q(account)} and id = 'setting|cc.claude.cardsState';`) === state, 'Claude reads what the player did with the cards');
    check((await pc.client.pull(localPc)).settings['cc.claude.cardsState'] === state, 'the other computer shows the same choices');

    // limits
    const fails = (sql) => { try { B.query(sql); return ''; } catch (e) { return e.message; } };
    check(/only cc\.claude\.cards/.test(fails(`select private.claude_put_setting(${q(account)}, 'cc.gear.weights', 'x');`)), "Claude can't overwrite the player's own settings");
    check(/json/i.test(fails(`select private.claude_put_setting(${q(account)}, 'cc.claude.cards', 'not json');`)), 'cards must be JSON');
    check(/permission denied/.test(fails(`set role anon; select private.claude_put_setting(${q(account)}, 'cc.claude.cards', '{}');`)), "the publishable key can't call it");
  } finally { B.drop(); }
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
