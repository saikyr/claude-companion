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
        { id: 4184, title: 'The True Masters', level: 54, complete: true, ready: true },
        { id: 5803, title: "Araj's Scarab", level: 60, complete: false }],
      group: [{ name: 'Friend', level: 56, class: 'MAGE', online: true }],
      // Hearthstone used 13 minutes ago (1-hour cooldown)
      itemCooldowns: [{ id: 6948, icon: 134414, link: '|cffffffff|Hitem:6948::::::::59:::::::::|h[Hearthstone]|h|r', readyAt: now + 2820, duration: 3600 }],
    },
    // a finished 1-hour grind: 10g looted, one Glowing Brightwood Staff (AH median 95g in the fixture's scan)
    grinds: [{ name: 'test grind', start: now - 7200, last: now - 3600, finish: now - 3600, secs: 3600, kills: 60, deaths: 0,
      coin: 100000, bySource: { loot: 100000 }, zones: { 'Burning Steppes': 60 }, loot: { 812: { id: 812, name: 'Glowing Brightwood Staff', count: 1, q: 4 } } }],
    caps: { api: { GetLootSourceInfo: 'function' }, secret: {}, checked: now, loot: { t: now, slots: 2, sources: 2, value: 'readable' } },
    professions: { Tailoring: { name: 'Tailoring', rank: 268, taken: now - 3600, recipes: [
      { name: 'Runecloth Bag', difficulty: 1, reagents: [{ id: 14048, need: 5 }] },
      { name: 'Runecloth Belt', difficulty: 0, reagents: [{ id: 14048, need: 3 }] },
      { name: 'Bolt of Runecloth', difficulty: 3, reagents: [{ id: 14047, need: 4 }] },
      { name: 'Mooncloth', difficulty: 1, cooldownEnds: now + 2 * 86400 + 3 * 3600 + 30, reagents: [{ id: 14256, need: 2 }] },
      // #118: a made-up recipe whose reagent only a vendor prices (Rune Thread) and whose product the AH prices
      { name: 'Test Staff', difficulty: 3, output: 812, makesMin: 1, makesMax: 1, reagents: [{ id: 14341, need: 2 }] }] } },
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

  // ---- cooldowns: one plain list under its own heading, time left (not a clock time already past)
  const cdRows = await page.$$eval('main .list.cds > .li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  check(cdRows.length === 2 && /^Hearthstone Item cooldown Ready in 47m /.test(cdRows[0]), `Overview: Hearthstone with the time left (${cdRows[0]})`);
  check(/^Mooncloth Tailoring cooldown Ready in 2d 3h /.test(cdRows[1] || ''), `Overview: Mooncloth, days and hours left (${cdRows[1]})`);
  check(await page.$eval('main .list.cds', (e) => e.previousElementSibling && e.previousElementSibling.tagName === 'H2' && e.previousElementSibling.innerText === 'Cooldowns'), 'Overview: cooldowns sit under a Cooldowns heading');
  check(!(await page.$('main .cd')), 'no nested boxed cooldown rows');
  await page.evaluate(() => { location.hash = '#professions'; });
  await page.click('[data-tab="professions"]');
  await page.waitForSelector('main .list.cds');
  const profCd = await page.$$eval('main .list.cds > .li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  check(profCd.length === 1 && /^Mooncloth Cooldown Ready in 2d 3h /.test(profCd[0]), `Professions: the same rows, that profession only (${profCd})`);
  await page.click('[data-tab="overview"]');
  await page.waitForSelector('.nextsteps .tr');

  // ---- the ranked list
  let all = await rows();
  check(all.length >= 5, `next steps listed (${all.length})`);
  const vals = all.map((r) => r.t);
  check(all.some((r) => r.id.startsWith('dungeon:')), 'dungeons are steps');
  check(all.some((r) => r.id.startsWith('quest:') || r.id.startsWith('zone:')), 'quests are steps');
  check(all.some((r) => r.id === 'dungeon:Upper Blackrock Spire'), 'Upper Blackrock Spire is its own step');
  check(!all.some((r) => r.id === 'unlock:brd'), 'a done key (Shadowforge, quest done) is not in the main list');
  check(!all.some((r) => r.id === 'quest:3802'), 'a done quest is never a step');
  const ubrs = all.find((r) => r.id === 'dungeon:Upper Blackrock Spire');
  check(ubrs && /Needs Seal of Ascension/.test(ubrs.t), 'UBRS says it needs the Seal of Ascension');
  check(all.some((r) => /Holy \+[\d.]+/.test(r.t)) && all.some((r) => /Shadow \+[\d.]+/.test(r.t)), 'gains show per spec (Holy and Shadow)');
  check(all.some((r) => /% of a level/.test(r.t)), 'under 60, XP shows as a share of the level');
  const order = await page.evaluate(() => window.CC.next.ranked('all').map((x) => x.v));
  check(order.every((v, i) => !i || v <= order[i - 1] + 1e-9 || false) || order.filter((v, i) => i && v > order[i - 1] + 1e-9).length === 0, 'ranked best first');

  // ---- what must never be a step (review of the first version)
  const never = await page.evaluate(() => {
    const ids = new Set(window.CC.next.steps().map((x) => x.id));
    const all = window.CC.next.steps();
    const inside = (id) => all.some((x) => (x.quests || []).some((q) => q.quest === id));
    const D = window.CC.next._dungeonIndex();
    const ups = all.flatMap((x) => (x.ups || []).map((u) => u.id)).concat(all.flatMap((x) => (x.items || []).map((u) => u.id)));
    return { zf: D["Zul'Farrak"] && D["Zul'Farrak"].raid, mc: D['Molten Core'] && D['Molten Core'].raid, aq: ids.has('quest:8802') || inside(8802),
      naxx: [...ids].some((i) => /^zone:Naxxramas/.test(i)) || all.some((x) => (x.quests || []).some((q) => q.quest === 9120)),
      hakkar: all.some((x) => x.quest === 8183 || (x.quests || []).some((q) => q.quest === 8183)), owned: ups.includes(274641) || ups.includes(16695),
      solakar: (all.find((x) => x.id === 'dungeon:Upper Blackrock Spire') || { ups: [] }).ups.some((u) => /Solakar|Gyth/.test(u.boss)) };
  });
  check(never.zf === false && never.mc === true, "Zul'Farrak is a dungeon, Molten Core a raid (rules.js instances)");
  check(!never.aq && !never.naxx && !never.hakkar, 'raid quests (AQ40, Naxxramas, Zul\'Gurub by its starting item) are never steps');
  check(!never.owned, 'items you already have are not counted as upgrades to chase');
  check(never.solakar, 'UBRS counts boss drops that carry no instance id (Solakar, Gyth)');

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
  // every item in an opened step is the shared item row: icon and quality-coloured name, both with the tooltip
  const itemRows = await page.$$eval('.nx-det .tr', (els) => els.map((e) => ({ ic: !!e.querySelector('.c-main > .ic'),
    tipIc: !!e.querySelector('.c-main > .ic[data-tip], .c-main > .ic[data-item]'), tipNm: !!e.querySelector('.nm [data-tip], .nm [data-item]'), q: !!e.querySelector('.nm [class^="q"]') })));
  check(itemRows.length > 0 && itemRows.every((r) => r.ic), `${d1.id}: every row has an icon (${itemRows.length})`);
  const ups = itemRows.filter((r) => r.q);
  check(ups.length > 0 && ups.every((r) => r.tipIc && r.tipNm), `${d1.id}: item rows have the tooltip on icon and name (${ups.length})`);
  // Dire Maul: the pack's twin quests (1318/7703 Unfinished Gordok Business) count once
  const dm = await page.evaluate(() => { const x = window.CC.next.steps().find((s) => s.id === 'dungeon:Dire Maul'); return x && x.quests.map((q) => q.name); });
  check(dm && dm.length > 0 && new Set(dm).size === dm.length, `Dire Maul: each quest once (${dm && dm.length})`);
  // ...but different quests that only look alike stay: other quest giver (a chain's later step, one per race), other earlier step
  const tw = await page.evaluate(() => { const t = window.CC.next._twins(); return [1318, 1250, 1248, 625, 624, 1463, 1462, 1780, 1788].map((id) => [id, t.has(id)]); });
  check(tw[0][1] && tw.slice(1).every(([, x]) => !x), 'twins: 1318 hidden; The Missing Diplomat, Cortello\'s Riddle, Earth Sapta, Tome of Divinity steps kept (' + tw.filter(([, x]) => x).map(([i]) => i).join(',') + ')');
  // the step icons come from the app's icon map: the Dungeons one is the skull, not a key
  const dIc = await page.$eval(`[data-nextopen="${d1.id}"] .ic img`, (i) => i.src);
  check(/inv_misc_bone_humanskull_01/.test(dIc), 'a dungeon step shows the dungeon icon');

  // ---- Claude's snapshot carries the same list
  await page.waitForTimeout(500);
  if (!posted) await page.evaluate(() => window.CC.reload && window.CC.reload());
  await page.waitForTimeout(1500);
  const snapNext = await page.evaluate(() => window.CC.next.snapshot());
  check(snapNext.length > 3 && snapNext.every((x) => x.id && x.kind && typeof x.value === 'number'), 'snapshot nextSteps: id, kind, value');
  // #116: your own sell-through, posts matched to the sales that followed (unit by unit, oldest post first, within 48 h)
  const st = await page.evaluate(() => {
    const T = 1795000000, H = 3600;
    return window.CC.api.sellThrough({
      posts: [{ t: T, id: 14047, qty: 4, unit: 2000 }, { t: T + H, id: 14047, qty: 2, unit: 1900 },   // Runecloth: 6 posted
        { t: T, id: 812, qty: 1, unit: 950000 },                                                         // a staff at 95g: never sold
        { t: T + 100 * H, id: 14047, qty: 3, unit: 2100 }],                                               // posted 1 h ago: pending
      sales: [{ t: T + 2 * H, item: 'Runecloth', price: 6000, count: 3 }, { t: T + 5 * H, item: 'Runecloth', price: 3800, count: 2 },
        { t: T + 60 * H, item: 'Runecloth', price: 2000, count: 1 }] }, T + 101 * H,
      [{ t: T + 48 * H, e: 'ahExpired', name: 'Glowing Brightwood Staff' }, { t: T + 3 * H, e: 'ahRemoved', name: 'Runecloth' }, { t: T - H, e: 'ahExpired', name: 'Runecloth' }]);
  });
  const rc = st.items.find((x) => x.item === 'Runecloth'), staffSt = st.items.find((x) => x.item === 'Glowing Brightwood Staff');
  check(rc && rc.posted === 6 && rc.sold === 5 && rc.pending === 3 && rc.share === 0.83 && rc.medianHours === 2,
    'sell-through: 5 of 6 Runecloth sold within 48 h (a sale 60 h later is not counted), the newest post pending (' + JSON.stringify(rc) + ')');
  check(staffSt && staffSt.sold === 0 && st.totals.worth10g.posted === 1 && st.totals.worth10g.sold === 0 && st.totals.posted === 7 && st.totals.sold === 5,
    'sell-through totals, and posts at 10g or more apart (' + JSON.stringify(st.totals) + ')');
  check(staffSt.expired === 1 && rc.cancelled === 1 && rc.expired === 0 && st.totals.expired === 1 && st.totals.cancelled === 1,
    'sell-through: expired and cancelled auctions from the game\'s messages, since the first post');
  check(await page.evaluate(() => 'sellThrough' in window.CC.snapshot().ah), 'snapshot ah.sellThrough');
  // the Flips view draws the sell-through table under the flips
  const flipsHtml = await page.evaluate(() => { const ch = window.CC.api.CH; ch.ah.posts = [{ t: 1795000000, id: 14047, qty: 2, unit: 2000 }];
    ch.ah.sales = [{ t: 1795003600, item: 'Runecloth', price: 4000, count: 2 }]; window.CC.api.STATE.tab = 'auction'; window.CC.api.STATE.ahSec = 'flips'; window.CC.api.render();
    const h = document.querySelector('main').innerHTML; window.CC.api.STATE.tab = 'overview'; window.CC.api.render(); return h; });
  check(/Sell-through/.test(flipsHtml) && /sellthru/.test(flipsHtml), 'the Flips view shows the sell-through table');
  // #115: the buy list: an item listed under what a vendor pays shows as a certain buy; the speculative rules carry
  // their backtest and are shown only when it made money; the Buy list section draws both tables
  const buy = await page.evaluate(() => { const A = window.CC.api, ch = A.CH, ls = ch.ah.lastScan, g = A.GD.items[14047];
    const keep = ch.ah.prices['14047'], keepAll = ch.ah.prices;
    ch.ah.prices = Object.assign({}, keepAll);
    ch.ah.prices['14047'] = { id: 14047, name: 'Runecloth', obs: [{ t: ls.t, min: 1, med: 1500, qty: 4, src: 'scan' }] };
    const b = A.buyListOf(ch.ah); A.STATE.tab = 'auction'; A.STATE.ahSec = 'buy'; A.render();
    const h = document.querySelector('main').innerHTML, snap = window.CC.snapshot().ah.buyList;
    ch.ah.prices = keepAll;
    A.STATE.tab = 'overview'; A.render();
    return { sell: g && g[6], row: b.rows.find((r) => r.id === 14047 && r.rule === 'vendor'), rules: b.rules, html: h, snap: !!(snap && snap.rules && snap.rows), snapRows: (snap && snap.rows) || [] }; });
  check(buy.sell > 1 && buy.row && buy.row.net === buy.sell - 1 && buy.row.offered, 'buy list: Runecloth listed at 1c is a vendor buy worth the vendor price − 1c (' + JSON.stringify(buy.row) + ')');
  check(['dip', 'thin'].every((id) => { const r = buy.rules.find((x) => x.id === id); return r && r.backtest && typeof r.backtest.n === 'number' && !r.offered; }),
    'buy list: the fixture has one scan, so neither price rule has a backtest to offer it (' + JSON.stringify(buy.rules.map((r) => [r.id, r.offered])) + ')');
  check(buy.snapRows.every((r) => r.offered), 'snapshot ah.buyList lists only the rows the app shows');
  check(/buyrules/.test(buy.html) && /buylist/.test(buy.html) && /Runecloth/.test(buy.html), 'the Buy list section shows the rules and the rows');
  check(buy.snap, 'snapshot ah.buyList');
  // #117: positions: an open flip, its plan typed in the Positions section (synced cc.trade.* key), a paper buy
  // from the buy list, and the snapshot's parts
  const pos = await page.evaluate(() => { const A = window.CC.api, ch = A.CH, ls = ch.ah.lastScan;
    const keep = { buys: ch.ah.buys, sales: ch.ah.sales, rc: ch.ah.prices['14047'], prices: ch.ah.prices };
    ch.ah.buys = [{ t: ls.t - 5 * 86400, item: 'Runecloth', price: 2000, count: 2 }]; ch.ah.sales = [];
    ch.ah.prices['14047'] = { id: 14047, name: 'Runecloth', obs: [{ t: ls.t, min: 1, med: 1500, qty: 4, src: 'scan' }] };
    A.STATE.tab = 'auction'; A.STATE.ahSec = 'positions'; A.render();
    const inp = document.querySelector('[data-flipplan]'); inp.value = '0.5'; inp.dispatchEvent(new Event('change', { bubbles: true }));
    const html = document.querySelector('main').innerHTML, P = A.positionsOf(ch.ah);
    const planKey = Object.keys(localStorage).find((k) => k.startsWith('cc.trade.plans.'));
    // a dip on Runecloth that the backtest doesn't show yet: paper trade it
    ch.ah.prices = Object.assign({}, ch.ah.prices);   // new data comes as new objects (the buy list is kept per prices object)
    ch.ah.prices['14047'] = { id: 14047, name: 'Runecloth', obs: [0, 1, 2, 3, 4].map((k) => ({ t: ls.t - (5 - k) * 86400, min: 1000, med: 1000, qty: 40, src: 'scan' })).concat([{ t: ls.t, min: 600, med: 1000, qty: 40, src: 'scan' }]) };
    A.STATE.ahSec = 'buy'; A.render();
    const vendorPaper = [...document.querySelectorAll('[data-paper]')].some((b) => /\|(vendor|resell|disenchant)\|/.test(b.dataset.paper));
    const btn = [...document.querySelectorAll('[data-paper]')].find((b) => b.dataset.paper.includes('|14047|dip|'));
    btn.click();
    const paper = A.paperOf(ch.ah), marked = /Paper buy marked/.test(document.querySelector('main').innerHTML), snap = window.CC.snapshot().ah;
    Object.keys(localStorage).filter((k) => k.startsWith('cc.trade.')).forEach((k) => localStorage.removeItem(k));
    ch.ah.buys = keep.buys; ch.ah.sales = keep.sales; ch.ah.prices = keep.prices; if (keep.rc) ch.ah.prices['14047'] = keep.rc; else delete ch.ah.prices['14047'];
    A.STATE.tab = 'overview'; A.render();
    return { row: P.rows[0], html, planKey, paper: paper.trades, marked, vendorPaper, snap: { positions: !!snap.positions, paper: !!snap.paper, weekly: Array.isArray(snap.weekly), index: 'index' in (snap.buyList || {}) } }; });
  check(pos.row && pos.row.flag === 'sell' && pos.row.target === 5000 && pos.row.units === 2 && pos.row.unit === 1000 && /positions/.test(pos.html),
    'positions: a 5-day-old flip says sell at market; the plan typed in (0.5g) is kept (' + JSON.stringify(pos.row) + ')');
  check(pos.planKey && /^cc\.trade\.plans\./.test(pos.planKey), 'positions: plans are a cc. setting, synced between computers');
  check(pos.paper.length === 1 && pos.paper[0].id === 14047 && pos.paper[0].rule === 'dip' && pos.paper[0].price === 600 && pos.marked && !pos.vendorPaper,
    'buy list: a dip the backtest doesn\'t show yet can be paper traded, at the scan\'s lowest; vendor, resell and disenchant rows have no paper buy');
  check(pos.snap.positions && pos.snap.paper && pos.snap.weekly && pos.snap.index, 'snapshot ah.positions, ah.paper, ah.weekly, ah.buyList.index');
  // #118: each known recipe's margin, the Professions tab's numbers: a reagent only a vendor sells is priced at the
  // vendor's price (Rune Thread, 50s on Forever), never guessed from its sell price; a reagent with no price is missing
  const crafts = await page.evaluate(() => window.CC.snapshot().crafts);
  const staff = crafts.find((c) => c.name === 'Test Staff'), moon = crafts.find((c) => c.name === 'Mooncloth');
  check(staff && staff.reagents[0].from === 'vendor' && staff.reagents[0].each === 5000 && staff.cost === 10000 && staff.value === Math.round(950000 * 0.95) && staff.profit === staff.value - 10000 && crafts[0] === staff,
    'snapshot crafts: a vendor-priced reagent, the product after the AH cut, the margin, best first (' + JSON.stringify(staff) + ')');
  check(moon && moon.missing === 1 && moon.profit === null && moon.cooldownEnds, 'snapshot crafts: an unpriced reagent leaves the margin unknown, with the cooldown');
  // #105: each dungeon row lists every upgrade it drops, with its source, wing and rate; Upper Blackrock Spire's trash
  // and Lord Valthalak are in the Upper row, not in Blackrock Spire's
  const dRows = snapNext.filter((x) => x.kind === 'dungeon');
  check(dRows.length && dRows.every((x) => Array.isArray(x.ups)) && dRows.some((x) => x.ups.length)
    && dRows.every((x) => x.ups.every((u) => u.id && u.boss && typeof u.npc === 'number' && u.gains && typeof u.rate === 'string' && 'wing' in u)),
    'snapshot nextSteps: a dungeon row lists its upgrades (id, boss, npc, wing, rate, gains per spec)');
  const allRows = await page.evaluate(() => window.CC.next.ranked('all').filter((x) => x.kind === 'dungeon').map((x) => ({ name: x.name, ups: x.ups.map((u) => ({ npc: u.npc, wing: u.wing })) })));
  const brsRow = allRows.find((x) => x.name === 'Blackrock Spire'), ubrsRow = allRows.find((x) => x.name === 'Upper Blackrock Spire');
  check(brsRow && ubrsRow && brsRow.ups.every((u) => u.wing !== 'Upper') && ubrsRow.ups.length && ubrsRow.ups.every((u) => u.wing === 'Upper'),
    `Blackrock Spire's row has no Upper creature and the Upper row only Upper ones (${brsRow && brsRow.ups.length} / ${ubrsRow && ubrsRow.ups.length})`);
  if (posted) { const j = JSON.parse(posted); check(Array.isArray(j.nextSteps) && j.nextSteps.length > 3, 'the snapshot sent to the server has nextSteps'); }

  // ---- gold per hour comes from the app, with a range and completeness (the brief copies these)
  const snapMs = await page.evaluate(() => { const t = performance.now(); window.CC.snapshot(); return Math.round(performance.now() - t); });
  console.log(`     (snapshot built in ${snapMs} ms)`);
  const snap = await page.evaluate(() => window.CC.snapshot());
  // #91: consumables you carry and bank, what each does (the game's tooltip), and what it doesn't stack with now
  const cons = await page.evaluate(() => {
    const A = window.CC.api, ch = A.CH, s = ch.snap, D = A.DB.items;
    const keep = { bags: s.bags, buffs: s.buffs, equipped: s.equipped, bank: ch.bank };
    D['t:flask'] = { id: 13512, name: 'Flask of Supreme Power', class: 0, tip: [{ l: 'Flask of Supreme Power' }, { l: 'Requires Level 50' }, { l: 'Use: Increases damage done by magical spells and effects by up to 150 for 2 hrs.' }] };
    D['t:oil'] = { id: 20749, name: 'Brilliant Wizard Oil', class: 7, tip: [{ l: 'Brilliant Wizard Oil' }, { l: 'Use: While applied to target weapon it increases spell damage by up to 36 for 30 minutes.' }] };
    D['t:cloth'] = { id: 14047, name: 'Runecloth', class: 7 };
    D['t:port'] = { id: 2593, name: 'Flask of Port', class: 0 };
    D['t:fish'] = { id: 3825, name: 'Fishliver Oil', class: 0 };
    s.bags = [{ id: 0, items: [{ item: 't:flask', count: 2 }, { item: 't:oil', count: 1 }, { item: 't:cloth', count: 20 }, { item: 't:port', count: 1 }, { item: 't:fish', count: 1 }] }];
    ch.bank = Object.assign({}, ch.bank, { bags: [{ id: -1, items: [{ item: 't:flask', count: 3 }] }] });
    s.buffs = [{ name: 'Distilled Wisdom', spell: 17627, left: 3000 }];
    s.equipped = [{ slot: 16, slotName: 'MainHand', item: 't:staff', enchant: { id: 2504, text: 'Spell Power +30', temp: { name: 'Brilliant Wizard Oil', left: 900 } } }];
    const out = window.CC.snapshot();
    // at logout the game read no buffs: the snapshot kept the read before's, which may have run out since
    s.kept = ['buffs', 'equipped']; s.keptFrom = s.taken - 7200;
    const old = window.CC.snapshot();
    delete s.kept; delete s.keptFrom;
    Object.assign(s, { bags: keep.bags, buffs: keep.buffs, equipped: keep.equipped }); ch.bank = keep.bank;
    ['t:flask', 't:oil', 't:cloth', 't:port', 't:fish'].forEach((k) => delete D[k]);
    return { c: out.consumables, b: out.buffs, e: out.equipped, old, taken: s.taken };
  });
  // #95: macros with their text, and the addons installed (with the Talents & Bars list)
  const mac = await page.evaluate(() => {
    const A = window.CC.api, s = A.CH.snap, keep = { macros: s.macros, addons: s.addons };
    s.macros = [{ index: 1, scope: 'account', name: 'Tag', body: '/cast [@mouseover] Renew' }];
    s.addons = [{ name: 'Clique', title: 'Clique', version: 'v1.2', enabled: false, loaded: false }, { name: 'ClaudeCompanion', title: 'Claude Companion', version: '1.5.0', enabled: true, loaded: true }];
    const out = window.CC.snapshot();
    const tab = A.STATE.tab; A.STATE.tab = 'talents'; A.render(); const h = document.querySelector('main').innerHTML; A.STATE.tab = tab;
    s.addons = undefined; const none = window.CC.snapshot().addons;
    Object.assign(s, keep); A.render();
    return { m: out.macros, a: out.addons, h, none };
  });
  check(mac.m[0] && mac.m[0].body === '/cast [@mouseover] Renew' && mac.m[0].scope === 'account', 'snapshot macros: name, scope and text');
  check(mac.a && mac.a.length === 2 && mac.a[0].name === 'Clique' && mac.a[0].enabled === false && mac.none === null, 'snapshot addons: enabled or not, null when the build doesn\'t read them');
  check(/Addons/.test(mac.h) && /Clique/.test(mac.h) && /turned off/.test(mac.h), 'Talents & Bars lists the addons, a turned-off one says so');
  // #108: where things are inside an instance, from the addon's place entries, boss kills and quest items looted
  const pl = await page.evaluate(() => {
    const A = window.CC.api, c = Object.values(A.DB.chars)[0], keep = c.journal, s = A.CH.snap, keepQ = s.quests;
    const at = (sub, e) => Object.assign({ t: 1795400000, zone: 'Blackrock Spire', sub }, e);
    c.journal = arr0(keep).concat([
      at('Hordemar City', { e: 'place', kind: 'npc', id: 10299, name: 'Scarshield Infiltrator' }),
      at('Hordemar City', { e: 'place', kind: 'npc', id: 10299, name: 'Scarshield Infiltrator', t: 1795500000 }),
      at('Hordemar City', { e: 'place', kind: 'object', id: 175334 }),
      at('Chamber of Battle', { e: 'boss', name: 'Overlord Wyrmthalak' }),
      at('Chamber of Battle', { e: 'loot', item: 'item:12780::::::::60', count: 1 }),
      at('Chamber of Battle', { e: 'loot', item: 'item:14047::::::::60', count: 2 }),
      at('Chamber of Battle', { e: 'loot', item: 'item:12780::::::::60', count: 1, t: 1795400100 }),
      at('Hordemar City', { e: 'place', kind: 'object', id: 999999 }),
      { t: 1795400002, zone: 'Elwynn Forest', sub: 'Fargodeep Mine', e: 'loot', item: 'item:12780::::::::60', count: 1 },
      { t: 1795400001, zone: 'Dire Maul', sub: '', e: 'place', kind: 'npc', id: 1, name: 'x' }]);
    s.quests = [{ id: 4742, title: 'Seal of Ascension', objectives: [{ text: "Bijou's Belongings: 0/1" }, { text: 'General Drakkisath\'s Command: 0/1' }] }];
    const all = A.placesSeen(), out = window.CC.snapshot();
    c.journal = keep; s.quests = keepQ;
    return { all, places: out.places, where: out.quests[0].where };
    function arr0(x) { return Array.isArray(x) ? x : []; }
  });
  const hc = (pl.all['Blackrock Spire'] || []).find((x) => x.sub === 'Hordemar City'), cb = (pl.all['Blackrock Spire'] || []).find((x) => x.sub === 'Chamber of Battle');
  check(hc && hc.npcs[0].id === 10299 && hc.npcs[0].n === 2 && hc.npcs[0].last === 1795500000 && hc.objects[0].name === "Bijou's Belongings"
    && hc.objects.some((o) => o.id === 999999 && o.name === null),
    'places: a creature seen twice in Hordemar City, an object named from the pack, one the pack doesn\'t name kept by id ' + JSON.stringify(hc));
  check(cb && cb.bosses[0] === 'Overlord Wyrmthalak' && cb.items.length === 1 && cb.items[0].id === 12780 && cb.items[0].n === 2 && !pl.all['Dire Maul'] && !pl.all['Elwynn Forest'],
    'places: a boss and a quest item looted twice (not Runecloth) in Chamber of Battle; no sub-area, no place; quest items outside instances left out');
  check(pl.places.some((p) => p.instance === 'Blackrock Spire') && pl.where.some((w) => w.name === "Bijou's Belongings" && w.sub === 'Hordemar City' && w.kind === 'object')
    && pl.where.some((w) => w.kind === 'item' && w.sub === 'Chamber of Battle'), 'snapshot places, and a quest\'s objectives found by name: ' + JSON.stringify(pl.where));
  // #21: 10 of your own disenchants of green armor at item level 46-50 replace the table; 9 don't
  const deT = await page.evaluate(() => {
    const A = window.CC.api, D = A.DB, c = Object.values(D.chars)[0], keep = c.deResults, prices = A.CH.ah.prices;
    A.CH.ah.prices = Object.assign({}, prices, { 11176: { id: 11176, name: 'Dream Dust', obs: [{ t: 1795000000, min: 1000, med: 1000, qty: 50, src: 'scan' }] },
      11175: { id: 11175, name: 'Greater Nether Essence', obs: [{ t: 1795000000, min: 5000, med: 5000, qty: 5, src: 'scan' }] } });
    const mk = (n) => Array.from({ length: n }, (_, i) => ({ t: 1795000000 + i, item: 'item:9' + i, ilvl: 48, q: 2, class: 4, out: [{ id: 11176, count: 2 }] }));
    c.deResults = mk(9);
    const table = A.deOutcome({ q: 2, class: 4, ilvl: 48 });
    c.deResults = mk(10);
    const own = A.deOutcome({ q: 2, class: 4, ilvl: 48 });
    c.deResults = keep; A.CH.ah.prices = prices;
    return { table, own };
  });
  check(deT.table.from === 'table' && deT.table.n === 9 && /9 of your own so far/.test(deT.table.label) && deT.table.mats.find((m) => m.name === 'Dream Dust').id === 11176,
    'disenchant: 9 of your own: still the Classic table, saying so; materials by id');
  check(deT.own.from === 'measured' && deT.own.n === 10 && deT.own.value === 2000 && deT.own.mats.length === 1 && deT.own.mats[0].ch === 1 && /your 10 disenchants/.test(deT.own.label),
    'disenchant: 10 of your own (2 Dream Dust each at 10s): 20s, from your disenchants ' + JSON.stringify(deT.own));
  // #90: what killed you, from this computer's combat log: the Grinds tab and the snapshot's combat.deaths
  const dz = await page.evaluate(() => {
    const A = window.CC.api, C = window.CC.combat, keep = C.state, st = C.api.fresh();
    st.npcs['Gordok Hyena'] = { npc: 11360, kills: 0, deaths: 0, schools: {}, taken: { dmg: 2100, hits: 5 } };
    st.deaths = [{ at: '11/23/2026 07:37:04.0000', by: [{ name: 'Gordok Hyena', npc: 11360, kind: 'creature', count: 3, dmg: 2100, hits: 5 }], dmg: 2100, seconds: 10 }];
    st.lines = 10; C.state = st;
    const tab = A.STATE.tab; A.STATE.tab = 'grinds'; A.render(); const h = document.querySelector('main').innerHTML; A.STATE.tab = tab;
    const snap = window.CC.snapshot().combat;
    C.state = keep; A.render();
    return { h, d: snap && snap.deaths, n: snap && snap.npcs[0] };
  });
  check(/What killed you/.test(dz.h) && /3× Gordok Hyena 2,100 in 5 hits/.test(dz.h) && /420 a hit/.test(dz.h), 'Grinds tab: what killed you (3 hyenas) and who hits hardest');
  check(dz.d && dz.d[0].by[0].count === 3 && dz.n && dz.n.taken.dmg === 2100, 'snapshot combat: deaths and damage taken per creature');
  const fl = cons.c.find((x) => x.id === 13512), oil = cons.c.find((x) => x.id === 20749);
  check(fl && fl.bags === 2 && fl.bank === 3 && fl.from === 'game' && fl.use.some((l) => /^Use: Increases damage/.test(l)) && !cons.c.some((x) => x.id === 14047),
    'consumables: a flask in bags and bank, what it does from the game, cloth left out (' + JSON.stringify(fl) + ')');
  check(fl && fl.groups.some((g) => g.id === 'flask') && fl.notWith.some((n) => n.buff === 'Distilled Wisdom' && /not checked on Forever/.test(n.label)),
    'consumables: a flask doesn\'t stack with the flask on you now, labelled as a Classic rule');
  check(oil && oil.notWith.some((n) => n.weapon === 'MainHand' && n.on === 'Brilliant Wizard Oil'), 'consumables: an oil replaces the one on the main hand');
  const port = cons.c.find((x) => x.id === 2593), fish = cons.c.find((x) => x.id === 3825);
  check(port && !port.groups.length && !port.notWith.length && fish && !fish.groups.length && !fish.notWith.length,
    'consumables: Flask of Port is no flask and Fishliver Oil no weapon oil');
  const oFl = cons.old.consumables.find((x) => x.id === 13512), oOil = cons.old.consumables.find((x) => x.id === 20749);
  check(oFl && !oFl.notWith.length && oOil && !oOil.notWith.length && cons.old.buffs[0].at === new Date((cons.taken - 7200) * 1000).toISOString(),
    'buffs and weapon oils kept at logout from an older read: dated by that read, and no clash from them');
  check(cons.b[0] && cons.b[0].name === 'Distilled Wisdom' && cons.b[0].left === 3000 && cons.b[0].at === new Date(cons.taken * 1000).toISOString(), 'snapshot buffs: name, seconds left and when read');
  check(cons.e[0] && cons.e[0].enchant && cons.e[0].enchant.id === 2504 && cons.e[0].enchant.temp.name === 'Brilliant Wizard Oil' && cons.e[0].enchant.temp.at,
    'snapshot equipped: the enchant and the oil on the weapon');
  const g = (snap.grind.recent || [])[0] || {};
  check(g.name === 'test grind' && g.hours === 1 && g.coin === 100000, 'snapshot grind: hours and coin');
  check(g.gph === 100000 + 950000 && g.gph_low < g.gph && g.gph_high >= g.gph, `snapshot grind: gph at the AH median, gph_low at vendor price, gph_high >= gph (${g.gph_low} / ${g.gph} / ${g.gph_high})`);
  check(g.complete === true && Array.isArray(g.incomplete) && g.incomplete.length === 0 && /copper per hour/.test(g.basis), 'a finished hour-long grind is complete');
  const app = await page.evaluate(() => window.CC.api.trackerStats(window.CC.api.CH.grinds[0]).perHour);
  check(Math.round(app) === g.gph, 'the Grinds tab and the snapshot show the same gold per hour');
  // ---- dungeon quests are marked keep (CLAUDE.md, the dungeon-quest rule)
  const dq = (snap.quests || []).find((q) => q.id === 5089);
  check(dq && dq.keep === true && dq.dungeon === 'Blackrock Spire', "a dungeon quest is keep, with its dungeon (General Drakkisath's Command: Blackrock Spire)");
  const aq = (snap.quests || []).find((q) => q.id === 5803);
  check(aq && aq.keep === true && aq.dungeon === 'Scholomance' && /key or attunement/.test(aq.keepWhy) && /Key to Scholomance/.test(aq.keepWhy), `a step of a key chain is keep (Araj's Scarab: ${aq && aq.keepWhy})`);
  // ---- what the client allows addons
  check(snap.caps && snap.caps.loot && snap.caps.loot.sources === 2, 'snapshot caps: the loot-source probe');
  // ---- skills read: the gear advice is there for every spec
  check(Array.isArray(snap.gear) && snap.gear.length >= 2 && snap.gear.every((x) => x.label), 'snapshot gear: one entry per spec');

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
