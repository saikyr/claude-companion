// node test/web/brief.test.js
// The brief (private.claude_brief, supabase/migrations/*_claude_brief.sql) against the real backend SQL
// (test/sql/backend.js): built from the newest snapshot of any of the account's computers, small, with
// its age; it copies the app's numbers (gph, gear gains, dungeon keep flags) and computes none; sales
// are revenue, flips are profit; parts asked for by name come in full; the publishable key can't call it.
const S = require('../../ClaudeCompanion/web/js/sync.js');
const { sqlBackend } = require('../sql/backend.js');
const crypto = require('crypto');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function computer(fetch, name, at) {
  const files = { state: JSON.stringify({ key: crypto.randomBytes(32).toString('hex') }) };
  return { files, client: S.client({ fetch, now: () => at,
    loadState: async () => JSON.parse(files.state), saveState: async (s) => { files.state = JSON.stringify(s); },
    loadCache: async () => (files.cache ? JSON.parse(files.cache) : null), saveCache: async (c) => { files.cache = JSON.stringify(c); },
    device: { name, os: 'pc' } }) };
}
const save = () => ({ items: {}, chars: { 'Ana-Realm': { lastSeen: 1795000000, journal: [{ t: 1795000001, e: 'login' }], snap: { taken: 1795000000, character: { name: 'Ana' } } } } });

const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const up = (i) => ({ slot: 'Slot ' + i, id: 1000 + i, name: 'Item ' + i, score: 50 + i, gain: i, source: 'dungeon', where: 'Somewhere', ah: null });
function snapshot(ageMs, extra) {
  return Object.assign({
    schema: 1, savedInGame: iso(ageMs), app: { build: 'abc123' },
    character: { name: 'Ana', level: 59, class: 'Priest', race: 'Human', faction: 'Alliance', money: 2079592, where: { zone: 'Stormwind City' }, hearth: 'Stormwind City' },
    gear: [
      { spec: 1, label: 'Holy', active: true, weightsName: 'Holy healing', comparedWith: 'what you wear', upgrades: [1, 2, 3, 4, 5, 6, 7, 8].map(up),
        preBis: [{ slot: 'Head', name: 'Devout Crown', status: 'missing', where: 'Scholomance' }, { slot: 'Chest', name: 'Robe', status: 'done' }],
        // #147: the app's enchants: an empty slot, two better ones, one already the best, one whose copy is unknown
        enchants: [
          { slot: 'Head', enchant: null, empty: true, best: { name: 'Lesser Arcanum of Rumination', gain: 16, where: 'Quest reward' } },
          { slot: 'Chest', enchant: { id: 913, name: '+65 Mana' }, empty: false, best: { name: 'Major Mana', gain: 3.7, where: 'Formula' } },
          { slot: 'Wrist', enchant: null, empty: true, best: { name: 'Healing Power', gain: 24, where: 'Formula' } },
          { slot: 'Back', enchant: { id: 1888, name: 'Greater Resistance' }, empty: false, best: null },
          { slot: 'Legs', enchant: 'unknown: not read yet', empty: false, gainUnknown: true, best: { name: 'Arcanum', gain: 16, where: 'Quest' } }] },
      { spec: 2, label: 'Shadow', active: false, weightsName: 'Shadow', upgrades: [up(9)], preBis: [] }],
    quests: [
      { id: 5089, title: "General Drakkisath's Command", level: 60, complete: false, dungeon: 'Blackrock Spire', keep: true, keepWhy: 'dungeon quest', rep: [],
        rewards: [{ name: 'Ring', how: 'choose', specs: [{ spec: 'Holy', gain: 0 }, { spec: 'Shadow', gain: 4.5 }] }] },
      { id: 1, title: 'Kill boars', level: 55, complete: true, dungeon: null, keep: false, rewards: [{ name: 'Old reward', how: 'get', specs: null }] },
      { id: 8470, title: 'Deadwood Ritual Totem', level: 55, complete: false, dungeon: null, keep: true, keepWhy: 'reputation toward rewards: Timbermaw Hold +150', rep: [{ faction: 'Timbermaw Hold', amount: 150 }] },
      { id: 5543, title: 'Blood Tinged Skies', level: 56, complete: false, dungeon: 'Stratholme', keep: true, keepWhy: 'dungeon quest (step: Of Love and Family)' }],
    grind: { running: null, recent: [
      { name: 'cultists', zones: ['Western Plaguelands'], start: new Date(Math.floor((NOW - 7200e3) / 1000) * 1000).toISOString(), finish: iso(3600e3), hours: 1, kills: 80, deaths: 0, gph: 400000, gph_low: 250000, gph_high: 520000, complete: true, incomplete: [] },
      { name: 'short', zones: ['Burning Steppes'], finish: iso(7200e3), hours: 0.1, kills: 5, deaths: 0, gph: 90000, gph_low: 80000, gph_high: 90000, complete: false, incomplete: ['under 10 minutes: too short to quote as a rate'] }] },
    runs: [{ name: 'Blackrock Depths', start: iso(9000e3), finish: iso(8000e3), hours: 0.8, kills: 90, bosses: ['Emperor'], gph: 300000, gph_low: 200000, gph_high: 350000, complete: true, incomplete: [] }],
    ah: { flips: { totals: { profit: 1087, flips: 1 } } },
    professions: [{ name: 'Tailoring', rank: 300, max: 300 }], cooldowns: [{ name: 'Mooncloth', readyAt: 1795400000 }],
    reputation: [{ name: 'Argent Dawn', standing: 5 }],
    caps: { checked: 1795000000, api: { GetLootSourceInfo: 'function' }, secret: { LoggingCombat: 'readable' }, loot: { slots: 2, sources: 2, value: 'readable' } },
  }, extra || {});
}

(async () => {
  const B = sqlBackend();
  try {
    const pc = computer(B.fetch, 'PC', NOW), mac = computer(B.fetch, 'Mac', NOW);
    const localPc = {}, localMac = {};
    await pc.client.pull(localPc); await pc.client.push(save(), localPc);
    const code = (await pc.client.linkCode()).code;
    await mac.client.pull(localMac); await mac.client.link(code); await mac.client.pull(localMac);
    const account = JSON.parse(pc.files.state).account;
    const brief = (parts) => JSON.parse(B.query(`select private.claude_brief(${q(account)}${parts ? ', array[' + parts.map(q).join(',') + ']' : ''})::text;`));

    check(brief().meta.snapshot === null, 'no snapshot online yet: the brief says so');

    // the PC's snapshot is 3 hours old, the Mac's 5 minutes: the brief reads the Mac's
    await pc.client.pushSnapshot(snapshot(3 * 3600e3, { character: { name: 'Old', level: 58 } }));
    await mac.client.pushSnapshot(snapshot(5 * 60e3, { app: { build: 'def456' } }));
    const b = brief();
    const size = JSON.stringify(b).length;
    check(b.meta.computer === 'Mac' && b.character.name === 'Ana', 'the brief reads the newest snapshot of any computer');
    check(b.meta.ageMinutes >= 4 && b.meta.ageMinutes <= 6 && b.meta.stale === false, `its age in minutes, not stale (${b.meta.ageMinutes})`);
    check(b.meta.computers.length === 2 && b.meta.computers.map((c) => c.build).sort().join() === 'abc123,def456', 'every computer and its build');
    check(size < 6144, `the default brief is small (${size} bytes)`);
    check(b.character.gold === 207.96, 'gold in gold (207.96)');

    // gear: the app's own gains, top 3 with the total, every spec
    check(b.specs.length === 2 && b.specs[0].spec === 'Holy' && b.specs[1].spec === 'Shadow', 'every spec');
    check(b.specs[0].upgrades.length === 3 && b.specs[0].upgrades[0].gain === 8 && b.specs[0].upgrades[2].gain === 6 && b.specs[0].upgradesTotal >= 5, 'top 3 upgrades by the app\'s gain, with the total');
    check(b.specs[0].preBisMissing.length === 1 && b.specs[0].preBisMissing[0].name === 'Devout Crown', 'pre-BiS still missing');
    const en = b.specs[0].enchants;
    check(en && JSON.stringify(en.empty) === '["Head","Wrist"]' && en.better.map((x) => x.slot).join() === 'Wrist,Head,Chest' && en.better[2].now === '+65 Mana' && en.better[0].gain === 24,
      `enchants: the empty slots and the biggest gains from a better one, the app's numbers (${JSON.stringify(en)})`);
    check(b.specs[1].enchants == null, 'enchants: none for a snapshot from a build before them');
    await mac.client.pushSnapshot(snapshot(5 * 60e3, { app: { build: 'abc123' }, gear: [{ spec: 1, label: 'Holy', upgrades: [Object.assign(up(1), { where: 'World Drop · From creatures of its level, anywhere; the fastest way is the auction house' })],
      preBis: [{ slot: 'Back', name: 'Amplifying Cloak', status: 'missing', where: 'Boss Drop · Magister Kalendris · Dire Maul · Level 54–60 · 5 players' }] }] }));
    const w = brief();
    check(w.specs[0].upgrades[0].where === 'World Drop · From creatures of its level, anywhere' && w.specs[0].preBisMissing[0].where === 'Boss Drop · Magister Kalendris · Dire Maul', 'default where: its first clause');
    check(/the fastest way/.test(brief(['specs']).specs[0].upgrades[0].where), 'asked for by name: the whole where');
    check(!('computers' in w.meta) && w.meta.build === 'abc123' && brief(['character']).meta.computers.length === 2, 'one build on every computer: computers left out (asked for by name: listed)');
    await mac.client.pushSnapshot(snapshot(5 * 60e3, { app: { build: 'def456' } }));

    // quests: keep flags and rewards per spec
    const dq = b.quests.find((x) => x.id === 5089), oq = b.quests.find((x) => x.id === 1);
    check(dq.keep === true && dq.dungeon === 'Blackrock Spire' && !('keepWhy' in dq) && oq.keep === false, 'dungeon quests keep their keep flag and dungeon (keepWhy left out when it only says dungeon quest)');
    check(brief(['quests']).quests.find((x) => x.id === 5089).keepWhy === 'dungeon quest', 'asked for by name, keepWhy is there');
    const rq = b.quests.find((x) => x.id === 8470), sq = b.quests.find((x) => x.id === 5543);
    check(rq.keepWhy === 'rep: Timbermaw Hold +150' && !('rep' in rq) && sq.keepWhy === 'step: Of Love and Family' && sq.dungeon === 'Stratholme', 'default keepWhy is short: rep: <faction>, step: <quest> next to its dungeon');
    check(!('level' in rq) && brief(['quests']).quests.find((x) => x.id === 8470).level === 55 && brief(['quests']).quests.find((x) => x.id === 8470).keepWhy === 'reputation toward rewards: Timbermaw Hold +150', 'asked for by name: level and the whole keepWhy');
    check(b.meta.quote.some((x) => /game\.item/.test(x)), 'the brief points at the game schema for game facts');
    check(dq.rewards[0].upgradeFor.length === 1 && dq.rewards[0].upgradeFor[0].spec === 'Shadow', 'a reward lists the specs it is an upgrade for (Shadow, not Holy)');
    check(oq.unscored.join() === 'Old reward' && !oq.rewards, 'a reward the app did not score is named in unscored');
    check(brief(['quests']).quests.find((x) => x.id === 1).rewards[0].scored === false, 'asked for by name, the reward says scored false');

    // gold: profit only from flips, sales are revenue, gph copied
    B.query(`insert into public.records (account_id, id, device_id, char_key, kind, t, data) select ${q(account)}, 'sale' || g, null, 'Ana-Realm', 'ah_sale',
      ${Math.round(NOW / 1000) - 3600}, jsonb_build_object('net', 5000, 'item', 'Thing') from generate_series(1, 3) g;`);
    B.query(`insert into public.records (account_id, id, device_id, char_key, kind, t, data) values (${q(account)}, 'oldsale', null, 'Ana-Realm', 'ah_sale',
      ${Math.round(NOW / 1000) - 30 * 86400}, '{"net": 99999}');`);
    const g = brief(['gold']).gold;
    check(g.flips.profit === 1087, 'profit is the flips total');
    check(g.sales7d.revenue === 15000 && g.sales7d.sales === 3 && /revenue/.test(g.sales7d.label) && /not profit/.test(g.sales7d.label), 'sales in the last 7 days, labelled revenue not profit');
    const m = g.measured;
    B.query(`insert into public.records (account_id, id, device_id, char_key, kind, t, data) select a.id, 'sale1', null, 'Ana-Realm', 'ah_sale',
      ${Math.round(NOW / 1000) - 3600}, '{"net": 5000}' from public.accounts a where a.id <> ${q(account)} limit 1;`);
    check(B.query("select count(*) from public.records where id = 'sale1';") === '2' && brief(['gold']).gold.sales7d.revenue === 15000, 'a sale held twice (both computers before they were linked) counts once');
    check(m[0].start && !('mobs' in m[0]), 'a measured grind has its start (for a card src); no grind record yet, so no mobs');
    B.query(`insert into public.records (account_id, id, device_id, char_key, kind, t, data) values (${q(account)}, 'Ana-Realm|grind|g1', null, 'Ana-Realm', 'grind', ${Math.floor((NOW - 7200e3) / 1000)},
      jsonb_build_object('name', 'cultists', 'start', ${Math.floor((NOW - 7200e3) / 1000)}, 'killsBy', '{"Scarlet Cultist": 50, "Scarlet Monk": 20, "Rat": 1, "Dog": 9}'::jsonb));`);
    B.query(`insert into public.records (account_id, id, device_id, char_key, kind, t, data) values (${q(account)}, 'Ana-Realm|grind|odd', null, 'Ana-Realm', 'grind', 1,
      '{"name": "cultists", "start": 1e20, "killsBy": {"X": 1}}'::jsonb), (${q(account)}, 'Ana-Realm|grind|odd2', null, 'Ana-Realm', 'grind', 2, '{"name": "cultists", "start": "soon", "killsBy": {}}'::jsonb);`);
    const mobs = brief(['gold']).gold.measured[0].mobs;
    check(Array.isArray(mobs) && mobs.length === 3 && mobs[0].name === 'Scarlet Cultist' && mobs[0].kills === 50 && mobs[2].name === 'Dog', 'and the mobs it killed, from its grind record (top 3)');
    check(brief().gold.measured[0].mobs.join() === 'Scarlet Cultist ×50,Scarlet Monk ×20,Dog ×9', 'default: the mobs as "<name> ×<kills>"');
    check(brief(['gold']).gold.measured[0].what === 'grind' && !('what' in brief().gold.measured[0]) && !('end' in brief().gold.measured[0]) && brief(['gold']).gold.measured[0].end, 'default: no what on grinds, no end; asked for by name, end is there');
    check(!('deaths' in m[0]), '0 deaths are left out');
    check(m.length === 3 && m[0].name === 'cultists' && m[0].gph === 400000 && m[0].gph_low === 250000 && m[0].gph_high === 520000, "measured grinds and runs, newest first, with the app's gph range");
    check(m[1].complete === false && /under 10 minutes/.test(m[1].incomplete[0]), 'an incomplete grind says why');
    check(m.some((x) => x.what === 'run' && x.bosses === 1), 'runs are measured too');

    // spells (#122): what the class still lacks, in the default brief
    await mac.client.pushSnapshot(snapshot(5 * 60e3, { app: { build: 'def456' }, spells: { train: [{ name: 'Renew', rank: 'Rank 9', level: 56, cost: 30000 }], trainCost: 30000,
      books: { now: [{ item: 17413, book: 'Codex: Prayer of Fortitude', spell: 'Prayer of Fortitude', rank: 1, req: 48, ah: 25000,
        sources: [{ kind: 'drop', name: 'Anvilrage Warden', zone: 'Blackrock Depths', forever: false }, { kind: 'drop', name: 'X', zone: 'Y', forever: true }] }],
        later: [], raid: [{ item: 1, book: 'Codex of Renew X' }, { item: 2, book: 'Codex of Greater Heal V' }] },
      reagents: [{ spell: 'Prayer of Fortitude', item: 17029, name: 'Sacred Candle', have: 0 }, { spell: 'Prayer of Shadow Protection', item: 17029, name: 'Sacred Candle', have: 5 }] } }));
    const sp = brief().spells;
    check(sp.train === 1 && sp.trainCost === 30000 && sp.books.length === 1 && sp.books[0].item === 17413 && sp.books[0].ah === 25000 && !('rank' in sp.books[0]),
      `the default brief has the spells to train and the books to get (${JSON.stringify(sp)})`);
    check(sp.books[0].from === 'Anvilrage Warden, Blackrock Depths (Classic data)' && sp.booksRaid === 2 && !('booksLater' in sp), 'a book\'s first source, labelled Classic when not seen on Forever; raid books counted');
    check(sp.noReagent.length === 1 && sp.noReagent[0].spell === 'Prayer of Fortitude', 'a group buff with no reagent in the bags');
    check(brief(['spells']).spells.books.now[0].sources.length === 2, 'asked for by name: the whole spells block');
    check(JSON.stringify(brief()).length < 6144, 'still small with spells');
    await mac.client.pushSnapshot(snapshot(5 * 60e3, { app: { build: 'def456' } }));
    check(!('spells' in brief()), 'an older snapshot without spells: left out');

    // parts by name, in full
    const p = brief(['specs', 'rep']);
    check(p.specs[0].upgrades.length === 8 && p.rep.length === 1 && !p.quests, 'parts asked for come in full, and only those');
    check(!('savedParts' in b.character), 'per-part save times left out of the default brief');
    check(b.quests.every((q) => q.complete !== false && !(Array.isArray(q.rewards) && q.rewards.length === 0) && q.rewardsNoGain !== 0), 'the default brief leaves out empty and default quest fields');
    check(brief().caps.loot.sources === 2 && brief().caps.LoggingCombat === 'readable', 'caps: what the game lets the addon read');

    // a snapshot without gear advice says so, so nobody scores gear by hand
    await mac.client.pushSnapshot(snapshot(60e3, { gear: [] }));
    check(brief().meta.quote.some((x) => /never score gear by hand/.test(x)), 'no gear advice in the snapshot: the brief says so');

    // a snapshot from an older build: no keep flags, no gph. Unknown, never false, and the brief says so
    const old = snapshot(30e3);
    old.quests = old.quests.map(({ keep, dungeon, ...rest }) => rest);
    old.grind.recent = old.grind.recent.map(({ gph, gph_low, gph_high, complete, incomplete, ...rest }) => rest);
    await mac.client.pushSnapshot(old);
    const ob = brief();
    check(ob.quests.every((x) => x.keep === 'unknown') && ob.meta.quote.some((x) => /never suggest dropping/.test(x)), 'no keep flag in an older snapshot: keep is "unknown", with a warning');
    check(ob.meta.quote.some((x) => /no gph/.test(x)), 'no gph in an older snapshot: the brief says so');

    // stale
    B.query(`update public.records set t = t - 7200 where kind = 'snapshot';`);
    check(brief().meta.stale === true, 'older than an hour: stale');

    const fails = (sql) => { try { B.query(sql); return ''; } catch (e) { return e.message; } };
    check(/permission denied/.test(fails(`set role anon; select private.claude_brief(${q(account)});`)), "the publishable key can't call it");
    check(/no such account/.test(fails(`select private.claude_brief('00000000-0000-0000-0000-000000000000');`)), 'an unknown account is an error');
  } finally { B.drop(); }
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
