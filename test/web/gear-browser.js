// node test/web/gear-browser.js [screenshot dir]
// The real app page in Chromium on a made-up level 59 Priest (test/web/gear-fixture.js), the local
// server's API answered by the test: the Gear page's views (upgrades per slot with AH greens and items you
// own, pre-BiS with picks, Auction House, class sets), the Stat weights page (defaults by talent tree, the
// reasons), and the gear part of Claude's snapshot. With a folder, also saves screenshots at four widths.
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { saveLua } = require('./gear-fixture.js');
const WEB = path.join(__dirname, '../../ClaudeCompanion/web');
const shots = process.argv[2] || null;
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };

(async () => {
  const now = Math.floor(Date.now() / 1000);
  const save = saveLua(now);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    // nothing leaves the test (no sync backend); icons only when taking screenshots
    if (u.hostname !== 'cc.test') return shots && route.request().resourceType() === 'image' ? route.continue() : route.abort();
    if (u.pathname === '/api/stamp') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ stamp: 1, game: false }) });
    if (u.pathname === '/api/data') return route.fulfill({ contentType: 'text/plain', body: save });
    if (u.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
    const f = path.join(WEB, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    if (!f.startsWith(WEB) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.goto('http://cc.test/#gear');
  await page.waitForSelector('.slotblk', { timeout: 30000 });
  const text = async (sel) => page.$$eval(sel, (els) => els.map((e) => e.innerText).join('\n'));

  // ---- the page frame
  const tools = await text('.ph-tools');
  check(/Holy 17\/33\/0 · active/.test(tools) && /Shadow 17\/0\/33/.test(tools), 'the spec switcher names each spec by its biggest tree');
  const cards = await text('.cards.c4');
  check(/Weights: Holy/i.test(cards) && /default for Holy/i.test(cards), 'Holy uses the Holy weights by default (most points in Holy)');

  // ---- upgrades, slot by slot
  const blocks = await page.$$eval('.slotblk', (els) => els.map((e) => ({ slot: e.querySelector('.sn').innerText, rows: [...e.querySelectorAll('.tr')].map((r) => r.innerText) })));
  check(blocks.length >= 5, `several slots have upgrades (${blocks.length})`);
  const sh = blocks.find((b) => b.slot === 'Shoulder');
  check(sh && sh.rows.some((r) => /Elegant Mantle of Healing/.test(r) && /On the AH/.test(r)), 'Shoulder: an AH random-suffix green is an option, with its source');
  check(sh && sh.rows.some((r) => /Devout Mantle/.test(r) && /in your bank/.test(r)), 'Shoulder: an item in your bank is an option');
  check(sh && sh.rows.length >= 3, `Shoulder: several options (${sh && sh.rows.length})`);
  const gains = (b) => b.rows.map((r) => Number((/([+−][\d.]+)\s*$/.exec(r) || [0, '0'])[1].replace('−', '-')));
  check(blocks.every((b) => gains(b).every((g, i, a) => g > 0 && (i === 0 || a[i - 1] >= g))), 'every option is a gain, best first');
  // a source filter
  await page.click('[data-gearsrc="ah"]');
  const ahOnly = await page.$$eval('.slotblk .tr', (els) => els.map((e) => e.innerText));
  check(ahOnly.length > 0 && ahOnly.every((r) => /On the AH/.test(r)), 'the AH filter shows only AH listings');
  if (shots) { await page.click('[data-gearsrc="all"]'); }

  // ---- pre-BiS: targets, alternatives, a pick
  await page.click('[data-gearview="pre"]');
  await page.waitForSelector('.prebis');
  const firstAlt = await page.$('.prebis .tr button.alt');
  check(!!firstAlt, 'pre-BiS rows offer alternatives');
  const altName = await firstAlt.$eval('span:not(.dim)', (e) => e.innerText);
  const slotOf = await firstAlt.getAttribute('data-gearpick');
  await firstAlt.click();
  const picked = await page.$$eval('.prebis .tr', (els, s) => els.filter((e) => e.querySelector('.sn') && e.querySelector('.sn').innerText === s).map((e) => e.innerText).join('\n'), slotOf);
  check(picked.includes(altName) && /your pick/.test(picked), `picking an alternative makes it the ${slotOf} target`);
  await page.click(`.prebis button.linkbtn[data-gearpick="${slotOf}"]`);
  check(!(await text('.prebis')).includes('your pick'), 'and "use the best instead" undoes it');

  // ---- Auction House
  await page.click('[data-gearview="ah"]');
  const ah = await text('main');
  check(/Upgrades listed now/.test(ah) && /Elegant Mantle of Healing/.test(ah), 'the AH view lists the upgrades on the AH');
  check(!/Lunar Coronet of Healing/.test(ah.split('Rolls to search for')[0]), 'an item the newest scan no longer found is left out');
  check(/Rolls to search for/.test(ah) && /of Healing/.test(ah.split('Rolls to search for')[1] || ''), 'rolls worth searching for are listed');

  // ---- class sets
  await page.click('[data-gearview="sets"]');
  check((await page.$$('.setcard')).length > 0, 'class sets show');

  // ---- Shadow spec: its own weights, Shadow numbers
  await page.click('[data-gearview="up"]');
  await page.click('[data-gearspec="2"]');
  const cards2 = await text('.cards.c4');
  check(/Weights: Shadow/i.test(cards2), 'the Shadow spec uses the Shadow weights');

  // ---- Stat weights page
  await page.click('[data-gearspec="1"]');
  await page.evaluate(() => { location.hash = 'weights'; window.CC.api.STATE.tab = 'weights'; window.CC.api.render(); });
  await page.waitForSelector('.wspec');
  const wp = await text('main');
  check(/Holy \(default\)/.test(wp) && /Default: most of your talent points are in Holy/.test(wp), 'Stat weights: each spec says why it uses its weights');
  check(/Why these numbers/i.test(wp) && /Intellect 1\.6/.test(wp), 'Stat weights: the reasons for each number show');
  check(!/guide order|mana model|project weights/i.test(wp.split(/Why these numbers/i)[0]), 'Stat weights: plain names (no "guide order", "mana model")');

  // ---- the snapshot for Claude
  const sum = await page.evaluate(() => window.CC.gear.summary());
  const holy = sum.find((s) => s.tree === 'Holy');
  check(holy && holy.weightsName === 'Holy' && holy.weightsChosen === 'default for the biggest tree', 'snapshot: Holy weights, chosen by the biggest tree');
  check(holy && holy.ahUpgrades.some((u) => u.roll === 'of Healing' && u.ah && u.ah.price > 0), 'snapshot: AH upgrades with roll and price');
  check(holy && holy.preBis.length >= 15 && holy.preBis.every((p) => Array.isArray(p.alternatives)), 'snapshot: pre-BiS with alternatives');
  const ms = await page.evaluate(() => { const t = performance.now(); window.CC.api.STATE.tab = 'gear'; window.CC.api.render(); window.CC.gear.summary(); return performance.now() - t; });
  console.log(`     (Gear page + snapshot: ${Math.round(ms)} ms)`);
  check(ms < 3000, 'the Gear page and its snapshot take under 3 s');
  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));

  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    await page.evaluate(() => { location.hash = 'gear'; window.CC.api.STATE.tab = 'gear'; window.CC.api.STATE.gearView = 'up'; window.CC.api.render(); });
    for (const [wd, view] of [[1600, 'up'], [1280, 'pre'], [1280, 'ah'], [900, 'up']]) {
      await page.setViewportSize({ width: wd, height: 1100 });
      await page.evaluate((v) => { window.CC.api.STATE.gearView = v; window.CC.api.render(); }, view);
      await page.screenshot({ path: path.join(shots, `gear-${view}-${wd}.png`), fullPage: false });
    }
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.evaluate(() => { window.CC.api.STATE.tab = 'weights'; window.CC.api.render(); });
    await page.screenshot({ path: path.join(shots, 'weights-1280.png'), fullPage: true });
  }
  await browser.close();
  if (failed) { console.log(`${failed} failed`); process.exit(1); }
  console.log('DONE');
})().catch((e) => { console.error(e); process.exit(1); });
