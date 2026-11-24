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
