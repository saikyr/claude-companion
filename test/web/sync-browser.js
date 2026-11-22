// node test/web/sync-browser.js <port> <companion-data folder>
// The real app page in Chromium, its backend calls answered by the in-memory backend: the page
// registers, pushes its save, gets another computer's history after linking, shows it, and writes
// sync.account into snapshot.json. Needs a running server.py on <port> with a save (see the CI step).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium } = require('playwright');
const S = require('../../ClaudeCompanion/web/js/sync.js');
const { memoryBackend } = require('./sync-backend.js');
const [port, dataDir] = process.argv.slice(2);
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
(async () => {
  const B = memoryBackend();
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
  check(B.records.size > 0, `the page sent its save (${B.records.size} records)`);
  const key = await page.evaluate(() => Object.keys(window.CC.api.RAW.chars)[0]);
  // another computer, linked to this one, with history this save doesn't have
  const files = {};
  const mac = S.client({ fetch: B.fetch, now: () => Date.now(), crypto: crypto.webcrypto, device: { name: 'MacBook', os: 'mac' },
    loadState: async () => files.s || null, saveState: async (s) => { files.s = s; }, loadCache: async () => null, saveCache: async () => {} });
  const t = 1795400000;
  await mac.push({ chars: { [key]: { lastSeen: t, journal: [{ t, e: 'kill', name: 'Browser Test Mob' }], grinds: [{ name: 'browser test grind', start: t - 600, finish: t, kills: 1 }] } } }, { 'cc.test.fromMac': 'yes' });
  const { code } = B.fns.cc_link_code({ p_key: st.key });
  await mac.link(code);
  await mac.push({ chars: { [key]: { lastSeen: t, journal: [{ t, e: 'kill', name: 'Browser Test Mob' }] } } }, {});
  await page.evaluate(() => window.CC.syncNow());
  await page.waitForFunction(() => (window.CC.api.CH.journal || []).some((e) => e && e.name === 'Browser Test Mob'), null, { timeout: 15000 });
  const seen = await page.evaluate(() => ({ grind: (window.CC.api.CH.grinds || []).some((g) => g.name === 'browser test grind'),
    setting: localStorage.getItem('cc.test.fromMac'), from: window.CC.api.DB.syncedFrom, raw: window.CC.api.RAW.chars[Object.keys(window.CC.api.RAW.chars)[0]].journal.some((e) => e && e.name === 'Browser Test Mob') }));
  check(seen.grind, 'the other computer\'s grind shows in the app');
  check(seen.setting === 'yes', 'its settings reached this browser');
  check(!seen.raw, 'the save as read is untouched (the merge is only in the view)');
  await page.click('button[data-tab="system"]');
  const sys = await page.textContent('main');
  check(/Sync between computers/.test(sys) && /MacBook/.test(sys), 'the System tab shows sync and both computers');
  await page.click('[data-sync="code"]');
  await page.waitForFunction(() => /enter [A-Z0-9]{8}/.test(document.querySelector('main').textContent), null, { timeout: 5000 });
  check(true, 'Link another computer shows a code');
  await page.waitForTimeout(1500);
  const snap = JSON.parse(fs.readFileSync(path.join(dataDir, 'snapshot.json'), 'utf8'));
  check(snap.sync && snap.sync.account === st.account && !JSON.stringify(snap).includes(st.key), 'snapshot.json has the account for Claude, never the key');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: false });
  // offline: the backend is down, the app still works and says so
  B.down = true;
  await page.evaluate(() => window.CC.syncNow());
  const off = await page.evaluate(() => ({ ok: window.CC.sync.status.ok, err: window.CC.sync.status.error, ch: !!window.CC.api.CH }));
  check(off.ok === false && off.ch, `offline: the app keeps working and shows "${off.err}"`);
  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
