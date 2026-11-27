// node test/web/runner-browser.js [screenshot dir]
// Claude updates the cards after a save (#169), the page's side, in Chromium on the made-up level 59 Priest
// (test/web/gear-fixture.js): the System tab's Connect, on / off, Update now and last run; after a save, the change
// since the save before goes to the local server (with every card first, when it is worth a run); the From Claude
// tab says when Claude is updating the cards. The local server's side: test/web/server-api.test.js.
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { saveLua } = require('./gear-fixture.js');
const WEB = path.join(__dirname, '../../ClaudeCompanion/web');
const shots = process.argv[2] || null;
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

(async () => {
  const now = Math.floor(Date.now() / 1000);
  // General Drakkisath's Command done since the save before (the server's digest has only quest 100)
  const save = saveLua(now, { snap: { completedQuests: [5089, 100] } });
  const cards = { schema: 1, cards: [
    { id: 'v1', kind: 'quest', title: 'Virtuous: step one', order: 10, group: 'Virtuous plan', character: 'Testpriest', updated: new Date((now - 3600) * 1000).toISOString(),
      steps: ['Finish the Command', 'Ask Claude'], doneWhen: ['quest:5089', null] },
  ] };
  // the local server's api/claude, as a small state machine
  const S = { on: false, claude: false, signedIn: null, running: false, queued: false, checking: false, last: null, runs: 0, cap: 24,
    digests: { Testpriest: { t: 1, name: 'Testpriest', level: 59, quests: [100], items: {}, rep: {}, cards: {} } } };
  const posts = [], order = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url()), post = route.request().method() === 'POST';
    if (u.hostname !== 'cc.test') return route.abort();
    const json = (o) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/stamp') return json({ stamp: 1, game: false });
    if (u.pathname === '/api/data') return route.fulfill({ contentType: 'text/plain', body: save });
    if (u.pathname === '/api/cards') return json(cards);
    if (u.pathname === '/api/claude-cards' && post) { order.push('cards'); posts.push({ cards: JSON.parse(route.request().postData()) }); return json({ ok: true }); }
    if (u.pathname === '/api/claude' && post) {
      const b = JSON.parse(route.request().postData()); posts.push(b); order.push(b.action);
      if (b.action === 'connect') { Object.assign(S, { claude: true, signedIn: true }); return json({ ok: true }); }
      if (b.action === 'on' || b.action === 'off') S.on = b.action === 'on';
      if (b.action === 'save') { S.digests[b.name] = b.digest; if (b.worth) Object.assign(S, { running: true, runs: S.runs + 1 }); }
      if (b.action === 'run') Object.assign(S, { running: true, runs: S.runs + 1 });
      return json(S);
    }
    if (u.pathname === '/api/claude') return json(S);
    if (u.pathname.startsWith('/api/') && post) return json({ ok: true });
    if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 204, body: '' });
    const f = path.join(WEB, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    if (!f.startsWith(WEB) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.goto('http://cc.test/');
  await page.waitForSelector('[data-tab="system"]', { timeout: 60000 });
  await page.waitForTimeout(1500);
  check(!posts.some((p) => p.action === 'save'), 'off: the page tells the server nothing after a save');

  // ---- System tab: not installed -> Connect
  await page.click('[data-tab="system"]');
  await page.waitForSelector('main [data-crun="connect"]', { timeout: 20000 });
  let text = await page.$eval('main', (e) => e.innerText);
  check(/Claude updates your cards/.test(text) && /Needs Claude Code on this computer/.test(text) && /Pro or above/.test(text), 'System tab: what it does, and that it needs Claude Code');
  await page.click('main [data-crun="connect"]');
  await page.waitForFunction(() => /A window opened/.test(document.querySelector('main').innerText), null, { timeout: 10000 });
  check(posts.some((p) => p.action === 'connect'), 'Connect asks the server to install and open the sign-in');
  await page.waitForSelector('main [data-crun="on"]', { timeout: 30000 });
  check(true, 'signed in: a Turn on button');

  // ---- on: the next save goes to the server, the cards first because it is worth a run
  await page.click('main [data-crun="on"]');
  await page.waitForFunction(() => /On · /.test(document.querySelector('main').innerText), null, { timeout: 10000 });
  check(S.on, 'Turn on');
  await page.evaluate(() => document.dispatchEvent(new Event('cc:loaded')));
  await page.waitForFunction(() => true);
  for (let i = 0; i < 30 && !posts.some((p) => p.action === 'save'); i++) await page.waitForTimeout(200);
  const sv = posts.find((p) => p.action === 'save');
  check(sv && sv.name === 'Testpriest' && sv.digest.t > 1 && sv.wake && (sv.wake.questsDone || []).some((q) => q.id === 5089) && sv.worth === true,
    `after a save: the change since the save before, worth a run (${JSON.stringify(sv && { name: sv.name, worth: sv.worth, quests: sv.wake && sv.wake.questsDone })})`);
  const cp = posts.find((p) => p.cards);
  check(cp && cp.cards.cards.length === 1 && cp.cards.cards[0].id === 'v1' && cp.cards.cards[0].steps.length === 2 && order.indexOf('cards') < order.indexOf('save'),
    'every card, as written, reaches the server before the save that starts the run');
  // ---- From Claude tab while it runs
  await page.click('[data-tab="claude"]');
  await page.waitForFunction(() => /Claude is updating these cards/.test(document.querySelector('main').innerText), null, { timeout: 10000 }).catch(() => {});
  check(/Claude is updating these cards/.test(await page.$eval('main', (e) => e.innerText)), 'From Claude tab: says Claude is updating the cards');
  Object.assign(S, { running: false, last: { at: new Date().toISOString(), ok: true, why: 'save', wrote: true, cards: 1, gate: 'ok' } });
  await page.waitForFunction(() => /checked and sent to your account/.test(document.querySelector('main').innerText), null, { timeout: 15000 }).catch(() => {});
  check(/Last run .*1 card, checked and sent to your account/.test(await page.$eval('main', (e) => e.innerText)), 'and then how the run went');
  // ---- the same save again (a combat-log or card event): nothing more
  const saves = posts.filter((p) => p.action === 'save').length;
  await page.evaluate(() => document.dispatchEvent(new Event('cc:cards')));
  await page.waitForTimeout(1500);
  check(posts.filter((p) => p.action === 'save').length === saves, 'the same save again: not sent twice');
  // ---- System tab: Update now, errors, off
  await page.click('[data-tab="system"]');
  await page.waitForSelector('main [data-crun="run"]', { timeout: 10000 });
  text = await page.$eval('main', (e) => e.innerText);
  check(/On · Last run .* · 1 of 24 runs today/.test(text), `System tab: on, the last run and runs today (${(/On ·[^\n]*/.exec(text) || [''])[0]})`);
  const before = posts.length;
  await page.click('main [data-crun="run"]');
  await page.waitForTimeout(800);
  check(posts.slice(before).some((p) => p.cards) && posts.slice(before).some((p) => p.action === 'run'), 'Update now: the cards, then a run');
  Object.assign(S, { running: false, last: { at: new Date().toISOString(), ok: false, why: 'asked', error: 'signed out of Claude on this computer: System tab, Reconnect' } });
  await page.click('[data-tab="claude"]'); await page.click('[data-tab="system"]');
  await page.waitForFunction(() => /signed out of Claude/.test(document.querySelector('main').innerText), null, { timeout: 10000 }).catch(() => {});
  check(/Last run .*signed out of Claude/.test(await page.$eval('main', (e) => e.innerText)), 'a run that failed says why');
  // ---- the sign-in expired (a run said so): Reconnect, not the raw error
  Object.assign(S, { signedIn: false, signin: { needed: true, at: new Date().toISOString(), why: 'Failed to authenticate. API Error: 401 OAuth access token has expired.' } });
  for (let i = 0; i < 20 && !/sign-in on this computer has expired/.test(await page.$eval('main', (e) => e.innerText)); i++) {
    await page.click('[data-tab="claude"]'); await page.click('[data-tab="system"]'); await page.waitForTimeout(1000);
  }
  text = await page.$eval('main', (e) => e.innerText);
  check(/Your Claude sign-in on this computer has expired/.test(text) && /Reconnect/.test(text) && !/OAuth access token/.test(text), 'an expired sign-in: a Reconnect button, not the raw error');
  const snapRun = await page.evaluate(() => (window.CC.snapshot() || {}).claudeRun);
  check(snapRun && snapRun.signedIn === false && snapRun.signin && snapRun.signin.needed && /access token has expired/.test(snapRun.signin.why || ''),
    `and the snapshot says so (claudeRun), so Claude can see it online (${JSON.stringify(snapRun)})`);
  const nRe = posts.filter((p) => p.action === 'connect').length;
  await page.click('main [data-crun="connect"]');
  await page.waitForTimeout(800);
  check(posts.filter((p) => p.action === 'connect').length === nRe + 1, 'Reconnect opens the sign-in');
  Object.assign(S, { signedIn: true, signin: null });
  for (let i = 0; i < 20 && !(await page.$('main [data-crun="run"]')); i++) {
    await page.click('[data-tab="claude"]'); await page.click('[data-tab="system"]'); await page.waitForTimeout(1000);
  }
  // ---- a Claude Code too old for the run's flags: says which, and Update Claude Code (Connect, which updates it)
  Object.assign(S, { tooOld: { version: '2.1.200', missing: ['--setting-sources'] } });
  for (let i = 0; i < 20 && !/too old/.test(await page.$eval('main', (e) => e.innerText)); i++) {
    await page.click('[data-tab="claude"]'); await page.click('[data-tab="system"]'); await page.waitForTimeout(1000);
  }
  text = await page.$eval('main', (e) => e.innerText);
  check(/Claude Code 2\.1\.200 on this computer is too old .*--setting-sources/.test(text) && /Update Claude Code/.test(text), 'a Claude Code too old for the run: says which flag it lacks');
  const nConnect = posts.filter((p) => p.action === 'connect').length;
  await page.click('main [data-crun="connect"]');
  await page.waitForFunction(() => /it updates Claude Code/.test(document.querySelector('main').innerText), null, { timeout: 10000 }).catch(() => {});
  check(posts.filter((p) => p.action === 'connect').length === nConnect + 1 && /it updates Claude Code/.test(await page.$eval('main', (e) => e.innerText)), 'Update Claude Code asks the server to update it');
  delete S.tooOld;
  if (shots) await page.screenshot({ path: path.join(shots, 'runner.png'), fullPage: true });
  await page.click('main [data-crun="off"]');
  await page.waitForSelector('main [data-crun="on"]', { timeout: 10000 });
  check(!S.on, 'Turn off');

  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
