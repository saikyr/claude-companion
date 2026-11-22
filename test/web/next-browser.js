// node test/web/next-browser.js [screenshot dir]
// The Now page (js/next.js) in Chromium on the made-up level 59 Priest (test/web/gear-fixture.js) with a quest
// log, completed quests, a group and Tailoring recipes: Ready now, the ranked next steps and their filters,
// Hybrid vs one spec, a step opened in place, attunements, and the nextSteps list in Claude's snapshot.
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
  const save = saveLua(now, {
    snap: {
      // BRD's Shadowforge Key done, the first Seal of Ascension done; Onyxia chain started
      completedQuests: [3801, 3802, 4742, 4182, 4183],
      quests: [{ id: 5089, title: "General Drakkisath's Command", level: 60, complete: false },
        { id: 4184, title: 'The True Masters', level: 54, complete: true, ready: true }],
      group: [{ name: 'Friend', level: 56, class: 'MAGE', online: true }],
    },
    professions: { Tailoring: { name: 'Tailoring', rank: 268, taken: now - 3600, recipes: [
      { name: 'Runecloth Bag', difficulty: 1, reagents: [{ id: 14048, need: 5 }] },
      { name: 'Runecloth Belt', difficulty: 0, reagents: [{ id: 14048, need: 3 }] },
      { name: 'Bolt of Runecloth', difficulty: 3, reagents: [{ id: 14047, need: 4 }] }] } },
  });
  let posted = null;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'cc.test') return shots && route.request().resourceType() === 'image' ? route.continue() : route.abort();
    if (u.pathname === '/api/stamp') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ stamp: 1, game: false }) });
    if (u.pathname === '/api/data') return route.fulfill({ contentType: 'text/plain', body: save });
    if (u.pathname === '/api/snapshot' && route.request().method() === 'POST') { posted = route.request().postData(); return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
    if (u.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
    const f = path.join(WEB, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    if (!f.startsWith(WEB) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  const t0 = Date.now();
  await page.goto('http://cc.test/#overview');
  await page.waitForSelector('.nextsteps .tr', { timeout: 60000 });
  console.log(`     (Now page drawn in ${Date.now() - t0} ms)`);
  const text = async (sel) => page.$$eval(sel, (els) => els.map((e) => e.innerText).join('\n'));
  const rows = async () => page.$$eval('.nextsteps > .tr[data-nextopen]', (els) => els.map((e) => ({ id: e.dataset.nextopen, t: e.innerText })));

  // ---- Ready now
  const ready = await text('main');
  check(/Ready now/.test(ready) && /The True Masters/.test(ready) && /ready to turn in/.test(ready), 'Ready now: a quest ready to turn in');
  check(/Theka's Last Breath[\s\S]*in your bags/.test(ready), 'Ready now: an upgrade already in your bags');

  // ---- the ranked list
  let all = await rows();
  check(all.length >= 5, `next steps listed (${all.length})`);
  const vals = all.map((r) => r.t);
  check(all.some((r) => r.id.startsWith('dungeon:')), 'dungeons are steps');
  check(all.some((r) => r.id.startsWith('quest:') || r.id.startsWith('zone:')), 'quests are steps');
  check(all.some((r) => r.id === 'unlock:ubrs'), 'Upper Blackrock Spire (Seal of Ascension) is a step');
  check(!all.some((r) => r.id === 'unlock:brd'), 'a done key (Shadowforge, quest done) is not in the main list');
  check(!all.some((r) => r.id === 'quest:3802'), 'a done quest is never a step');
  const ubrs = all.find((r) => r.id === 'unlock:ubrs');
  check(ubrs && /Seal of Ascension/.test(ubrs.t), 'UBRS says what opens it');
  check(all.some((r) => /Holy \+[\d.]+/.test(r.t)) && all.some((r) => /Shadow \+[\d.]+/.test(r.t)), 'gains show per spec (Holy and Shadow)');
  check(all.some((r) => /% of a level/.test(r.t)), 'under 60, XP shows as a share of the level');
  const order = await page.evaluate(() => window.CC.next.ranked('all').map((x) => x.v));
  check(order.every((v, i) => !i || v <= order[i - 1] + 1e-9 || false) || order.filter((v, i) => i && v > order[i - 1] + 1e-9).length === 0, 'ranked best first');

  // ---- one spec
  await page.click('[data-nextspec="Shadow"]');
  const shadowOrder = await page.evaluate(() => window.CC.next.ranked('all').slice(0, 5).map((x) => x.id + ' ' + (x.gains.Shadow || 0).toFixed(1)));
  check(await page.$eval('[data-nextspec="Shadow"]', (b) => b.classList.contains('on')), 'Shadow only: the switch is marked');
  check(shadowOrder.length > 0, 'Shadow only: still ranked (' + shadowOrder.slice(0, 2).join(', ') + ')');
  await page.click('[data-nextspec="hybrid"]');

  // ---- filters
  for (const [f, re] of [['dungeons', /^dungeon:/], ['unlocks', /^unlock:/], ['quests', /^(quest|zone):/]]) {
    await page.click(`[data-nextf="${f}"]`);
    const r = await rows();
    check(r.length > 0 && r.every((x) => re.test(x.id)), `filter ${f}: only those (${r.length})`);
  }
  await page.click('[data-nextf="unlocks"]');
  const ul = await rows();
  check(ul.some((x) => x.id === 'unlock:brd' && /done/.test(x.t)), 'Unlocks: a done one shows as done');
  check(ul.some((x) => x.id === 'unlock:ony' && /Raid · opens/.test(x.t)), 'Unlocks: Onyxia says when the raid opens');
  // the Onyxia chain picks up where you are
  await page.click('[data-nextopen="unlock:ony"]');
  const ony = await text('.nx-det');
  check(/The True Masters/.test(ony) && /Drakefire Amulet/.test(ony) && !/Dragonkin Menace/.test(ony), 'Onyxia: the chain from your step to the amulet, done steps left out');

  // ---- a dungeon opened in place
  await page.click('[data-nextf="dungeons"]');
  const d1 = (await rows())[0];
  await page.click(`[data-nextopen="${d1.id}"]`);
  const det = await text('.nx-det');
  check(/%|no drop rate/.test(det), `${d1.id}: its upgrades with boss and drop chance`);
  check(/Classic rate|Forever/.test(det), 'drop chances say whether they are Forever or Classic');

  // ---- Claude's snapshot carries the same list
  await page.waitForTimeout(500);
  if (!posted) await page.evaluate(() => window.CC.reload && window.CC.reload());
  await page.waitForTimeout(1500);
  const snapNext = await page.evaluate(() => window.CC.next.snapshot());
  check(snapNext.length > 3 && snapNext.every((x) => x.id && x.kind && typeof x.value === 'number'), 'snapshot nextSteps: id, kind, value');
  if (posted) { const j = JSON.parse(posted); check(Array.isArray(j.nextSteps) && j.nextSteps.length > 3, 'the snapshot sent to the server has nextSteps'); }

  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    await page.click('[data-nextf="all"]');
    for (const w of [860, 1280, 1920]) {
      await page.setViewportSize({ width: w, height: 1100 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(shots, `now-${w}.png`), fullPage: false });
    }
  }
  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
