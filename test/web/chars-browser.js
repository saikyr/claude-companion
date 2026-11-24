// node test/web/chars-browser.js
// More than one character in a save (#4, #12), the real app page in Chromium: the picker lists them with the one
// played last first, shows that one by default, remembers a pick across reloads until a character saves again,
// never writes Claude's snapshot for a character you only look at, and shares AH prices between characters of
// the same realm and faction (not across factions).
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { saveLua } = require('./gear-fixture.js');
const WEB = path.join(__dirname, '../../ClaudeCompanion/web');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };

(async () => {
  const now = Math.floor(Date.now() / 1000);
  const alt = (key, name, cls, classFile, faction, taken, ah) => ({ key, snap: { taken, version: 1, character: { name, class: cls, classFile, faction, level: 30, race: 'Human' } }, ah });
  const save = saveLua(now, { alts: [
    alt('Altmage-Realm', 'Altmage', 'Mage', 'MAGE', 'Alliance', now - 7200, { prices: { '2589': { id: 2589, name: 'Linen Cloth', last: now - 7200, obs: [{ t: now - 7200, min: 40, med: 50, qty: 20, src: 'scan' }] } } }),
    alt('Hordie-Realm', 'Hordie', 'Warrior', 'WARRIOR', 'Horde', now - 9000, { prices: { '2592': { id: 2592, name: 'Wool Cloth', last: now - 9000, obs: [{ t: now - 9000, min: 90, med: 99, qty: 20, src: 'scan' }] } } }),
  ] });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [], snaps = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'cc.test') return route.abort();
    if (u.pathname === '/api/stamp') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ stamp: 1, game: false }) });
    if (u.pathname === '/api/data') return route.fulfill({ contentType: 'text/plain', body: save });
    if (u.pathname === '/api/snapshot' && route.request().method() === 'POST') {
      try { snaps.push(((JSON.parse(route.request().postData() || '{}').character) || {}).name); } catch (e) { snaps.push('?'); }
      return route.fulfill({ contentType: 'application/json', body: '{}' });
    }
    if (u.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
    const f = path.join(WEB, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    if (!f.startsWith(WEB) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  const name = () => page.$eval('aside .me .nm', (e) => e.innerText);
  const ch = (f) => page.evaluate(f);
  await page.goto('http://cc.test/#overview');
  await page.waitForSelector('aside .me .charpick', { timeout: 30000 });

  const opts = await page.$$eval('aside .me .charpick option', (os) => os.map((o) => o.textContent));
  check(opts.length === 3 && /^Testpriest/.test(opts[0]) && /played last/.test(opts[0]) && /^Altmage/.test(opts[1]) && /^Hordie/.test(opts[2]),
    'the picker lists every character, the one played last first: ' + opts.join(' | '));
  check(await name() === 'Testpriest', 'the character played last is shown by default');
  check(!(await page.$('aside .me .sub.need')), 'no "not the character you played last" note when showing it');
  await page.waitForTimeout(1200);
  check(snaps.includes('Testpriest'), "Claude's snapshot is of the character played last");
  check(await ch(() => !!CC.api.CH.ah.prices['2589']), "Testpriest sees Altmage's Linen Cloth price (same realm and faction)");
  check(await ch(() => !CC.api.CH.ah.prices['2592']), "Testpriest doesn't see Hordie's Wool Cloth price (the other faction's AH)");

  snaps.length = 0;
  await page.selectOption('aside .me .charpick', 'Altmage-Realm');
  await page.waitForFunction(() => document.querySelector('aside .me .nm').innerText === 'Altmage');
  check(true, 'picking Altmage shows Altmage');
  check(/Not the character you played last/.test(await page.$eval('aside .me .sub.need', (e) => e.innerText)), 'a note says it is not the character played last');
  check(await ch(() => !!CC.api.CH.ah.prices['812'] && !!CC.api.CH.ah.prices['2589'] && !CC.api.CH.ah.prices['2592']),
    "Altmage prices with Testpriest's scan and its own, not Hordie's");
  check(await ch(() => (CC.api.CH.ah.lastScan || {}).auctions === 31000), "Altmage's newest full scan is Testpriest's (the same AH)");
  await page.waitForTimeout(1200);
  check(!snaps.includes('Altmage'), "looking at Altmage doesn't write Claude's snapshot for it (" + snaps.join(',') + ')');

  await page.reload();
  await page.waitForSelector('aside .me .charpick', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('aside .me .nm').innerText !== '');
  check(await name() === 'Altmage', 'the pick is remembered after a reload');

  await page.selectOption('aside .me .charpick', 'Hordie-Realm');
  await page.waitForFunction(() => document.querySelector('aside .me .nm').innerText === 'Hordie');
  check(await ch(() => !CC.api.CH.ah.prices['812'] && !!CC.api.CH.ah.prices['2592']), 'Hordie sees only the Horde AH prices');

  // the character played last saves again (logged in, /reload): the app follows it
  await ch(() => { const raw = CC.api.RAW; raw.chars['Testpriest-Realm'].snap.taken += 60; CC.load(raw); });
  check(await name() === 'Testpriest', 'a new save of a character: the app follows it again');
  check(await ch(() => localStorage.getItem('cc.char.pick.v1') === null), 'and the old pick is forgotten');
  // a different character logs in (its save is now the newest): followed too
  await ch(() => { const raw = CC.api.RAW; raw.chars['Altmage-Realm'].snap.taken = raw.chars['Testpriest-Realm'].snap.taken + 60; CC.load(raw); });
  check(await name() === 'Altmage' && /played last/.test(await page.$eval('aside .me .charpick option', (o) => o.textContent)) && !(await page.$('aside .me .sub.need')),
    'logging in on another character switches to it, with no note');

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
