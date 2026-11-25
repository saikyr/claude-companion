// node test/web/sync-browser.js <port> <companion-data folder>
// The real app page in Chromium, its backend calls answered by the real backend SQL on a test
// Postgres (test/sql/backend.js; PGHOST / PGPORT / PGUSER): the page
// registers, pushes its save, gets another computer's history after linking, shows it, and writes
// sync.account into snapshot.json. Needs a running server.py on <port> with a save (see the CI step).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium } = require('playwright');
const S = require('../../ClaudeCompanion/web/js/sync.js');
const { sqlBackend } = require('../sql/backend.js');
const [port, dataDir] = process.argv.slice(2);
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
(async () => {
  const B = sqlBackend();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route(S.CONFIG.url + '/**', async (route) => {
    let r;
    try { r = await B.fetch(route.request().url(), { body: route.request().postData() }); } catch (e) { return route.abort('internetdisconnected'); }
    route.fulfill({ status: r.status, contentType: 'application/json', body: await r.text(), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto(`http://localhost:${port}/#system`);
  await page.waitForFunction(() => window.CC && window.CC.sync && window.CC.sync.status.ok === true, null, { timeout: 30000 });
  const st = JSON.parse(fs.readFileSync(path.join(dataDir, 'sync.json'), 'utf8'));
  check(st.key && st.key.length === 64 && st.account && st.device, 'the page registered and kept its key in companion-data/sync.json');
  const sent = Number(B.query('select count(*) from public.records'));
  check(sent > 0, `the page sent its save (${sent} records)`);
  const key = await page.evaluate(() => Object.keys(window.CC.api.RAW.chars)[0]);
  // another computer, linked to this one, with history this save doesn't have
  const files = { s: { key: crypto.randomBytes(32).toString('hex') } };
  const mac = S.client({ fetch: B.fetch, now: () => Date.now(), device: { name: 'MacBook', os: 'mac' },
    loadState: async () => files.s || null, saveState: async (s) => { files.s = s; }, loadCache: async () => null, saveCache: async () => {} });
  const t = 1795400000;
  await mac.push({ chars: { [key]: { lastSeen: t, journal: [{ t, e: 'kill', name: 'Browser Test Mob' }], grinds: [{ name: 'browser test grind', start: t - 600, finish: t, kills: 1, loot: { 14047: { id: 14047, item: 'item:14047::::::::7:999:::::::::', name: 'Runecloth', q: 1, count: 3 } } }] } } }, {});
  const { code } = B.call('cc_link_code', { p_key: st.key });
  await mac.link(code);
  // a computer that joins takes the account's settings; a setting changed there afterwards spreads
  await mac.pull({});
  await mac.push({ chars: { [key]: { lastSeen: t, journal: [{ t, e: 'kill', name: 'Browser Test Mob' }] } } }, { 'cc.test.fromMac': 'yes' });
  await page.evaluate(() => window.CC.syncNow());
  await page.waitForFunction(() => (window.CC.api.CH.journal || []).some((e) => e && e.name === 'Browser Test Mob'), null, { timeout: 15000 });
  const seen = await page.evaluate(() => ({ grind: (window.CC.api.CH.grinds || []).some((g) => g.name === 'browser test grind'),
    setting: localStorage.getItem('cc.test.fromMac'), from: window.CC.api.DB.syncedFrom, raw: window.CC.api.RAW.chars[Object.keys(window.CC.api.RAW.chars)[0]].journal.some((e) => e && e.name === 'Browser Test Mob') }));
  check(seen.grind, 'the other computer\'s grind shows in the app');
  check(seen.setting === 'yes', 'its settings reached this browser');
  check(!seen.raw, 'the save as read is untouched (the merge is only in the view)');
  // its loot shows with its icon, though this computer's item cache has never seen that item key
  await page.click('button[data-tab="grinds"]');
  const lootIcon = await page.evaluate(() => { const el = document.querySelector('.grind [data-item^="item:14047::::::::7:999"] img'); return el ? el.getAttribute('src') : null; });
  check(lootIcon && /inv_fabric_purplefire_01/.test(lootIcon), `another computer's loot shows its icon (${lootIcon})`);
  const side = await page.textContent('aside .sync');
  check(/^Saved in game .+ago$|^Saved in game just now$/.test(side.trim()), `the sidebar says when the game last saved ("${side.trim()}")`);
  await page.click('button[data-tab="system"]');
  const sys = await page.textContent('main');
  check(/Sync between computers/.test(sys) && /MacBook/.test(sys), 'the System tab shows sync and both computers');
  await page.click('[data-sync="code"]');
  await page.waitForFunction(() => /enter [A-Z0-9]{4} [A-Z0-9]{4}/.test(document.querySelector('main').textContent), null, { timeout: 5000 });
  check(true, 'Link another computer shows a code');
  // the page writes snapshot.json once its advice is computed: wait for it (up to 15 s on a slow runner)
  const snapFile = path.join(dataDir, 'snapshot.json');
  for (let i = 0; i < 30 && !fs.existsSync(snapFile); i++) await page.waitForTimeout(500);
  const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
  check(snap.sync && snap.sync.account === st.account && !JSON.stringify(snap).includes(st.key), 'snapshot.json has the account for Claude, never the key');
  const inst = fs.existsSync(path.join(dataDir, 'installed.json')) ? JSON.parse(fs.readFileSync(path.join(dataDir, 'installed.json'), 'utf8')) : null;
  check(inst ? snap.app && snap.app.build === inst.tag : snap.app === null, `the snapshot names the app build (${JSON.stringify(snap.app)})`);
  // the page sends it on its next sync after writing snapshot.json: wait for it (up to 15 s on a slow runner)
  let online = '';
  for (let i = 0; i < 30 && !online; i++) { online = B.query(`select data->'character'->>'name' from public.records where kind = 'snapshot'`); if (!online) await page.waitForTimeout(500); }
  check(online && online === (snap.character || {}).name, `the snapshot is online for Claude too (${online})`);
  check(Array.isArray(snap.quests) && snap.quests.every((q) => Array.isArray(q.rewards) && 'next' in q), 'every quest in the snapshot carries its scored rewards and the chain\'s next quest');
  // Claude writes a card online; the app shows it, and what the player does goes back online
  const cards = JSON.stringify({ schema: 1, cards: [{ id: 'browser-card', kind: 'quest', title: 'Card from Claude online', step: 'quest:1' },
    { id: 'browser-farm', kind: 'farm', title: 'Farm card online', risk: 'Elite patrol at the camp: pull one at a time.' }] });
  B.query(`select private.claude_put_setting('${st.account}', 'cc.claude.cards', '${cards.replace(/'/g, "''")}')`);
  // (a sync already running when this asks for one doesn't fetch again: ask until it has come)
  await page.waitForFunction(() => { window.CC.syncNow(); return window.CC.cards.open().some((c) => c.id === 'browser-card'); }, null, { timeout: 20000, polling: 1000 });
  await page.click('button[data-tab="claude"]');
  check(/Card from Claude online/.test(await page.textContent('main')), 'a card Claude wrote online shows in From Claude');
  check(/Risk\s*Elite patrol at the camp/.test(await page.textContent('.ccard.k-farm .crisk').catch(() => '')), 'a farm card shows its risk line');
  await page.click('[data-card="browser-card"][data-cact="done"]');
  for (let i = 0; i < 20 && !/browser-card/.test(B.query(`select coalesce(data->>'v', '') from public.records where id = 'setting|cc.claude.cardsState'`) || ''); i++) {
    await page.evaluate(() => window.CC.syncNow()); await page.waitForTimeout(1000);
  }
  const back = B.query(`select data->>'v' from public.records where id = 'setting|cc.claude.cardsState'`);
  check(back && JSON.parse(back).cards['browser-card'].state === 'done', 'marking it done reaches the account, where Claude reads it');
  // #150: a ticked step stays on its step when Claude rewrites the card and moves the steps around
  const put = (list) => B.query(`select private.claude_put_setting('${st.account}', 'cc.claude.cards', '${JSON.stringify({ schema: 1, cards: list }).replace(/'/g, "''")}')`);
  const base = JSON.parse(cards).cards, iso = (ms) => new Date(Date.now() + ms).toISOString().replace(/\.\d+Z$/, 'Z');
  put(base.concat([{ id: 'browser-steps', kind: 'note', title: 'Card with steps', updated: iso(-60000), steps: ['Step A', 'Step B', 'Step C'] }]));
  await page.waitForFunction(() => { window.CC.syncNow(); return !!document.querySelector('[data-cstep="browser-steps"][data-i="1"]'); }, null, { timeout: 20000, polling: 1000 });
  await page.check('[data-cstep="browser-steps"][data-i="1"]');
  await page.waitForTimeout(500);
  put(base.concat([{ id: 'browser-steps', kind: 'note', title: 'Card with steps, rewritten', updated: iso(0), steps: ['New first step', 'Step A', 'Step B', 'Step C'] }]));
  await page.waitForFunction(() => { window.CC.syncNow(); return /rewritten/.test(document.querySelector('main').textContent); }, null, { timeout: 20000, polling: 1000 });
  const ticked = await page.$$eval('[data-cstep="browser-steps"]', (xs) => xs.filter((x) => x.checked).map((x) => x.closest('label').textContent.trim()));
  check(JSON.stringify(ticked) === '["Step B"]', `a ticked step stays ticked on its own text after Claude moves it (${JSON.stringify(ticked)})`);
  const mine = await page.evaluate(() => JSON.parse(localStorage.getItem('cc.claude.cardsState')).cards['browser-steps']);
  check(mine && JSON.stringify(mine.steps) === '[1]' && Array.isArray(mine.ticked) && mine.ticked.length === 1 && mine.v, `the saved tick has its position, its step's key and the card's version, for Claude (${JSON.stringify(mine)})`);
  // an older record with positions only: kept while the card is unchanged, dropped once Claude rewrote it
  const ticked0 = mine.ticked;
  const legacy = async (dt, extra) => {
    const shown = await page.evaluate(async ([dt, extra]) => {
      const c = window.CC.cards.open().find((x) => x.id === 'browser-steps');
      const s = JSON.parse(localStorage.getItem('cc.claude.cardsState'));
      s.cards['browser-steps'] = Object.assign({ steps: [0, 1], at: new Date(Date.parse(c.updated) + dt).toISOString() }, extra || {});
      localStorage.setItem('cc.claude.cardsState', JSON.stringify(s));
      await fetch('api/cards-state', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body: JSON.stringify(s) });
      return true;
    }, [dt, extra]);
    await page.waitForTimeout(6000);   // the cards page reads both copies every 5 s
    return shown && page.$$eval('[data-cstep="browser-steps"]', (xs) => xs.filter((x) => x.checked).map((x) => x.closest('label').textContent.trim()));
  };
  const older = await legacy(-1000);
  check(JSON.stringify(older) === '[]', `ticks saved by position on an older version of the card don't mark the new steps (${JSON.stringify(older)})`);
  const same = await legacy(1000);
  check(JSON.stringify(same) === '["New first step","Step A"]', `ticks saved by position on this version still show (${JSON.stringify(same)})`);
  // an older build (positions only) unticked Step B after this build ticked it: its positions count, not the stale keys
  const oldBuild = await legacy(1000, { steps: [], ticked: ticked0 });
  check(JSON.stringify(oldBuild) === '[]', `a change an older build made to the ticks shows (${JSON.stringify(oldBuild)})`);
  // #83: a friend's Claude writes from-claude/cards.json on this computer: the app sends it to the account
  // (the card gate, merged in), so the other computers get it, and says so
  const fc = path.join(dataDir, 'from-claude');
  fs.mkdirSync(fc, { recursive: true });
  fs.writeFileSync(path.join(fc, 'cards.tmp'), JSON.stringify({ schema: 1, cards: [{ id: 'browser-local', kind: 'note', title: 'Card from a Claude on this computer', updated: new Date().toISOString() }] }));
  fs.renameSync(path.join(fc, 'cards.tmp'), path.join(fc, 'cards.json'));
  let online2 = null;
  for (let i = 0; i < 30 && !/browser-local/.test(online2 || ''); i++) { await page.waitForTimeout(1000); online2 = B.query(`select data->>'v' from public.records where id = 'setting|cc.claude.cards'`); }
  const oc = online2 ? JSON.parse(online2).cards.map((c) => c.id) : [];
  check(oc.includes('browser-local') && oc.includes('browser-card'), `a cards.json on this computer reaches the account, next to Claude's online cards (${oc.join(', ')})`);
  await page.click('button[data-tab="overview"]').catch(() => {}); await page.click('button[data-tab="claude"]');
  check(/were sent to your other computers/.test(await page.textContent('main')), 'From Claude says the cards written here were sent');
  const stj = JSON.parse(fs.readFileSync(path.join(fc, 'state.json'), 'utf8'));
  check(stj.upload && stj.upload.ok === true && stj.cards['browser-card'], `state.json says how the send went, for Claude, and keeps the player's choices (${JSON.stringify(stj.upload)})`);
  fs.rmSync(path.join(fc, 'cards.json'));
  await page.click('button[data-tab="system"]');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: false });
  // the server's hidden browser (?background=1, what runs after a save with the app closed) syncs too
  const bg = await browser.newPage();
  bg.on('pageerror', (e) => errors.push('background: ' + e));
  await bg.route(S.CONFIG.url + '/**', async (route) => {
    const r = await B.fetch(route.request().url(), { body: route.request().postData() });
    route.fulfill({ status: r.status, contentType: 'application/json', body: await r.text(), headers: { 'access-control-allow-origin': '*' } });
  });
  await bg.goto(`http://localhost:${port}/?background=1`);
  await bg.waitForFunction(() => window.CC && window.CC.sync && window.CC.sync.status.ok === true && !window.CC.sync.status.busy, null, { timeout: 30000 });
  check(true, 'the hidden browser\'s page syncs');
  await bg.close();
  // sync turned off in System: kept in sync.json, the view goes back to this computer's save; back on, it returns
  await page.click('[data-sync="off"]');
  await page.waitForFunction(() => /Sync is off on this computer/.test(document.querySelector('main').textContent), null, { timeout: 5000 });
  const offState = JSON.parse(fs.readFileSync(path.join(dataDir, 'sync.json'), 'utf8'));
  const offView = await page.evaluate(() => (window.CC.api.CH.journal || []).some((e) => e && e.name === 'Browser Test Mob'));
  const pushedBefore = B.query('select count(*) from public.records');
  await page.evaluate(() => window.CC.syncNow());
  check(offState.off === true && !offView && B.query('select count(*) from public.records') === pushedBefore,
    'Turn sync off: kept in sync.json, the app shows only this computer\'s save, and nothing is sent');
  await page.click('[data-sync="on"]');
  await page.waitForFunction(() => window.CC.sync.status.ok === true && !window.CC.sync.status.busy && (window.CC.api.CH.journal || []).some((e) => e && e.name === 'Browser Test Mob'), null, { timeout: 15000 });
  check(!JSON.parse(fs.readFileSync(path.join(dataDir, 'sync.json'), 'utf8')).off, 'Turn sync on: the other computer\'s history is back');
  // offline: the backend is down, the app still works and says so
  B.down = true;
  await page.evaluate(() => window.CC.syncNow());
  const off = await page.evaluate(() => ({ ok: window.CC.sync.status.ok, err: window.CC.sync.status.error, ch: !!window.CC.api.CH }));
  check(off.ok === false && off.ch, `offline: the app keeps working and shows "${off.err}"`);
  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  B.drop();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
