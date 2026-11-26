// node test/web/cards-browser.js [screenshot dir]
// The From Claude tab in Chromium (#163) on the made-up level 59 Priest (test/web/gear-fixture.js): cards in
// Claude's order (Start here, Next, After that, the rest, Older folded away), a plan's place, steps ticked by
// Claude and done in game (doneWhen), an untick that sticks, a card that closes itself when every step is done
// and stays open once restored, what the app saves for Claude (state.json) and the snapshot's cards[].
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
  const iso = (s) => new Date((now - s) * 1000).toISOString();
  // General Drakkisath's Command done; Theka's Last Breath in the bags (gear-fixture.js); Argent Dawn Neutral
  const save = saveLua(now, { snap: { completedQuests: [5089, 100] } });
  const cards = { schema: 1, cards: [
    { id: 'new-note', title: 'A new note', updated: iso(60) },
    { id: 'old-note', title: 'An old note', updated: iso(10 * 86400) },
    { id: 'v2', kind: 'quest', title: 'Virtuous: step two', order: 20, group: 'Virtuous plan', updated: iso(3600),
      steps: ['Hand in the Command', 'Ask Claude', 'Get Honored with the Argent Dawn'], stepsDone: [1],
      doneWhen: ['quest:5089', null, 'rep:Argent Dawn>=Honored'] },
    { id: 'v1', kind: 'quest', title: 'Virtuous: step one', order: 10, group: 'Virtuous plan', updated: iso(3600),
      steps: ["Have Theka's Last Breath", 'Finish the Command'], doneWhen: ['item:274641', 'quest:5089'] },
    { id: 'ah', kind: 'flip', title: 'Sell the staff', order: 30, updated: iso(7200) },
  ] };
  let state = null;
  const posts = [];
  let snapshot = null;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url()), post = route.request().method() === 'POST';
    if (u.hostname !== 'cc.test') return shots && route.request().resourceType() === 'image' ? route.continue() : route.abort();
    if (u.pathname === '/api/stamp') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ stamp: 1, game: false }) });
    if (u.pathname === '/api/data') return route.fulfill({ contentType: 'text/plain', body: save });
    if (u.pathname === '/api/cards') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(cards) });
    if (u.pathname === '/api/cards-state' && post) { state = route.request().postData(); posts.push(JSON.parse(state)); return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
    if (u.pathname === '/api/cards-state') return state ? route.fulfill({ contentType: 'application/json', body: state }) : route.fulfill({ status: 204, body: '' });
    if (u.pathname === '/api/snapshot' && post) { snapshot = JSON.parse(route.request().postData()); return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
    if (u.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
    const f = path.join(WEB, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    if (!f.startsWith(WEB) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.goto('http://cc.test/#claude');
  await page.waitForSelector('[data-tab="claude"]', { timeout: 60000 });
  await page.click('[data-tab="claude"]');
  await page.waitForSelector('main .ccard', { timeout: 30000 });
  const rec = (id) => ((posts.length ? posts[posts.length - 1] : { cards: {} }).cards || {})[id] || {};

  // ---- v1: both steps done in game -> the app closes it as finished
  await page.waitForFunction(() => !document.querySelector('main [data-card="v1"]'), null, { timeout: 15000 }).catch(() => {});
  check(rec('v1').state === 'done' && rec('v1').by === 'app' && (rec('v1').auto || []).length === 2, `every step done in game: the app closes the card as finished (${JSON.stringify(rec('v1'))})`);
  check((rec('v2').auto || []).length === 1, `a step whose check passes is saved as done in game (${JSON.stringify(rec('v2'))})`);

  // ---- the order
  const heads = await page.$$eval('main h3.csec', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  check(heads[0] === 'Start here' && heads[1] === 'Next' && heads[2] === 'Other suggestions' && /^Older 1/.test(heads[3] || ''), `sections in Claude's order (${heads})`);
  const titles = await page.$$eval('main .ccard .ttl', (els) => els.map((e) => e.innerText));
  check(titles[0] === 'Virtuous: step two' && titles[1] === 'Sell the staff' && titles[2] === 'A new note', `cards in order (${titles.slice(0, 3)})`);
  check(await page.$eval('main details.cold', (d) => !d.open && /An old note/.test(d.textContent)), "a card Claude hasn't touched for a week folds away under Older");
  const meta = await page.$eval('main .ccard', (e) => e.querySelector('header .sub').innerText);
  check(/Virtuous plan 2 of 2/.test(meta) && /2\/3 steps/.test(meta), `a plan card says its place in the plan and steps done (${meta})`);

  // ---- who ticked each step
  const steps = async (id) => page.$$eval(`main [data-cstep="${id}"]`, (els) => els.map((e) => ({ on: e.checked, t: e.closest('li').innerText.replace(/\s+/g, ' ').trim() })));
  let s = await steps('v2');
  check(s[0].on && /done in game/.test(s[0].t), `a quest step done in game (${s[0].t})`);
  check(s[1].on && /ticked by Claude/.test(s[1].t), `a step Claude ticked (${s[1].t})`);
  check(!s[2].on && /Ticks itself when you are Honored with Argent Dawn/.test(s[2].t), `a step still to do says what ticks it (${s[2].t})`);

  // ---- an untick sticks; a tick of your own
  await page.click('main [data-cstep="v2"][data-i="0"]');
  await page.waitForTimeout(300);
  s = await steps('v2');
  check(!s[0].on && (rec('v2').unticked || []).length === 1, 'unticking a step the game ticked: it stays unticked, saved for Claude to read');
  await page.waitForTimeout(5500);   // a poll and the game's checks again
  s = await steps('v2');
  check(!s[0].on, 'still unticked after the next check');
  await page.click('main [data-cstep="v2"][data-i="2"]');
  await page.waitForTimeout(300);
  s = await steps('v2');
  check(s[2].on && !/done in game|ticked by Claude/.test(s[2].t) && JSON.stringify(rec('v2').steps) === '[2]', 'your own tick, no tag');

  // ---- the finished card, restored, stays open
  await page.click('main [data-cview="closed"]');
  const closed = await page.$eval('main', (e) => e.innerText);
  check(/Virtuous: step one[\s\S]*Finished: every step done/.test(closed), 'the finished card is under Done, saying so');
  await page.click('main [data-card="v1"][data-cact="open"]');
  await page.waitForTimeout(5500);
  check(rec('v1').state == null && rec('v1').by == null && rec('v1').reopened === cards.cards[3].updated, `Restore keeps it open until Claude changes the card (${JSON.stringify(rec('v1'))})`);
  await page.click('main [data-cview="open"]');
  check(!!(await page.$('main [data-card="v1"][data-cact="done"]')), 'and it is open again');

  // ---- the snapshot's cards[] for Claude
  await page.waitForFunction(() => true);
  await page.waitForTimeout(1500);
  const sc = ((snapshot || {}).cards || []).find((c) => c.id === 'v2');
  check(sc && sc.group === 'Virtuous plan' && sc.order === 20 && sc.place === 'next' && sc.standing === 'open', `snapshot cards[]: place, plan, order (${JSON.stringify(sc)})`);
  check(sc && JSON.stringify(sc.steps.map((x) => [x.done, x.by])) === '[[false,null],[true,"claude"],[true,"you"]]' && sc.steps[0].check === 'quest:5089' && sc.steps[0].met === true,
    'snapshot cards[]: each step, who ticked it, its check and whether it passes');

  if (shots) { await page.click('main [data-cview="open"]'); await page.screenshot({ path: path.join(shots, 'cards.png'), fullPage: true }); }
  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
