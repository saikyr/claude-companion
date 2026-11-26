// node test/web/gear-browser.js [screenshot dir]
// The real app page in Chromium on a made-up level 59 Priest (test/web/gear-fixture.js), the local
// server's API answered by the test: the Gear page's views (the slot list, one slot in full with every
// upgrade incl. random greens and items you own, its pre-BiS with picks; Auction House; class sets), the Stat weights page (defaults by talent tree, the
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
  await page.waitForSelector('.slotrow', { timeout: 30000 });
  const text = async (sel) => page.$$eval(sel, (els) => els.map((e) => e.innerText).join('\n'));

  // ---- the page frame
  const tools = await text('.ph-tools');
  check(/Holy 17\/33\/0 · active/.test(tools) && /Shadow 17\/0\/33/.test(tools), 'the spec switcher names each spec by its biggest tree');
  const cards = await text('.cards.c4');
  check(/Stat weights\s*Holy/i.test(cards) && /default for Holy/i.test(cards), 'Holy uses the Holy weights by default (most points in Holy)');
  check(await page.$eval('.ph-tools .seg button.on', (b) => /^Holy/.test(b.innerText)), 'the spec being shown is marked in the switcher');

  // ---- the slot list: every slot, what it has, the best gain now
  const rows = await page.$$eval('.slotrow', (els) => els.map((e) => ({ slot: e.querySelector('.sn').innerText, t: e.innerText })));
  check(rows.length === 15, `the slot list has every slot (${rows.length})`);
  check(rows.filter((r) => /\+[\d.]+\s*$/.test(r.t)).length >= 5, 'several slots show a gain');
  check(/compare with/i.test(await text('.slotlist .sl-h')), '"Compare with" sits on the slot list');

  // ---- one slot in full: every option, any source, best first
  await page.click('.slotrow[data-gearslot="Shoulder"]');
  const opts = await page.$$eval('.slotdet .gopt .tr', (els) => els.map((e) => e.innerText));
  check(opts.some((r) => /Elegant Mantle of Healing/.test(r) && /On the AH/.test(r)), 'Shoulder: an AH random-suffix green is an option, with its source');
  check(opts.some((r) => /Devout Mantle/.test(r) && /in your bank/.test(r)), 'Shoulder: an item in your bank is an option');
  check(opts.some((r) => /Random green/.test(r) && / of /.test(r)), 'Shoulder: random greens not on the AH are options too');
  const allChip = Number((/All\s*(\d+)/.exec(await text('.slotdet .chips')) || [0, 0])[1]);
  await page.click('.slotdet [data-gearupall]');
  const optsAll = await page.$$eval('.slotdet .gopt .tr', (els) => els.length);
  check(opts.length === 15 && optsAll === allChip && allChip > 15, `Shoulder: the best 15, then "Show all" shows every option (${optsAll} of ${allChip})`);
  const gains = (list) => list.map((r) => Number((/([+−][\d.]+)\s*$/.exec(r) || [0, '0'])[1].replace('−', '-')));
  check(gains(opts).every((g, i, a) => g > 0 && (i === 0 || a[i - 1] >= g)), 'every option is a gain, best first');
  await page.click('.slotdet [data-gearsrc="ah"]');
  const ahOnly = await page.$$eval('.slotdet .gopt .tr', (els) => els.map((e) => e.innerText));
  check(ahOnly.length > 0 && ahOnly.every((r) => /On the AH/.test(r)), 'the AH filter shows only AH listings');
  await page.click('.slotdet [data-gearsrc="all"]');

  // ---- pre-BiS in the same slot: a target, other options to pick
  const pre = await page.$$eval('.slotdet .prelist .tr', (els) => els.map((e) => ({ t: e.innerText, target: e.classList.contains('target') })));
  check(pre.length > 3 && pre[0].target && /target/.test(pre[0].t), 'pre-BiS: the target is on top');
  const pickBtn = await page.$('.slotdet .prelist .tr:not(.target) button[data-gearpick]');
  const pickName = await pickBtn.evaluate((b) => b.closest('.tr').querySelector('.nm span').innerText);
  await pickBtn.click();
  const pre2 = await page.$$eval('.slotdet .prelist .tr', (els) => els.map((e) => e.innerText));
  check(pre2[0].includes(pickName) && /your pick/.test(pre2[0]), `pre-BiS: "Make target" makes ${pickName} the target`);
  await page.click('.slotdet .prelist .linkbtn[data-gearpick]');
  check(!(await text('.slotdet .prelist')).includes('your pick'), 'pre-BiS: "use the best" undoes it');

  // ---- random greens in the main hand are ranked by gain (a two-hander also replaces the off hand)
  await page.click('.slotrow[data-gearslot="Main hand"]');
  await page.click('.slotdet [data-gearsrc="roll"]');
  const mhRolls = await page.$$eval('.slotdet .gopt .tr', (els) => els.map((e) => e.innerText));
  check(mhRolls.some((r) => /Dagger of Healing/.test(r)), 'Main hand: the best "of Healing" roll is the one-hander that gains most, not the biggest staff');
  // ---- rings: two picks; undoing one keeps the other
  await page.click('.slotrow[data-gearslot="Ring"]');
  for (let k = 0; k < 2; k++) await page.click('.slotdet .prelist .tr:not(.target) button[data-gearpick]');
  const picks = () => text('.slotdet .prelist').then((t) => (t.match(/your pick/g) || []).length);
  check((await picks()) === 2, 'Ring: two picks');
  await page.click('.slotdet .prelist .tr.target button[data-unpick]');
  check((await picks()) === 1, 'Ring: "use the best" on one pick keeps the other');
  await page.click('.slotdet .prelist .tr.target button[data-unpick]');
  check((await picks()) === 0, 'Ring: and the other undoes too');

  // ---- Auction House
  await page.click('[data-gearview="ah"]');
  const ah = await text('main');
  check(/Upgrades listed now/.test(ah) && /Elegant Mantle of Healing/.test(ah), 'the AH view lists the upgrades on the AH');
  check(!/Lunar Coronet of Healing/.test(ah.split('Rolls to search for')[0]), 'an item the newest scan no longer found is left out');
  check(/Rolls to search for/.test(ah) && /of Healing/.test(ah.split('Rolls to search for')[1] || ''), 'rolls worth searching for are listed');

  // ---- enchants (#147): each enchantable slot's enchant, scored; empty ones flagged; the best you can get
  await page.click('[data-gearview="ench"]');
  const en = await page.$$eval('.ench .tr', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  check(en.some((r) => /^Chest/.test(r) && /\+65 Mana/.test(r) && /the game/.test(r)), "Enchants: the chest's enchant, named by the game's own line (" + (en.find((r) => /^Chest/.test(r)) || 'none') + ')');
  check(en.some((r) => /^Wrist/.test(r) && /no enchant/.test(r)), "Enchants: the heals set's bracers have none: flagged");
  check(en.some((r) => /^Head/.test(r) && /no enchant/.test(r) && /\+\d/.test(r)), 'Enchants: an empty slot shows the best you can get, with its gain');
  check(!en.some((r) => /^(Neck|Ring|Trinket|Waist)/.test(r)), 'Enchants: slots nothing enchants are left out');
  check(/slots? ha(s|ve) no enchant/.test(await text('main')), 'Enchants: the empty slots are counted on top');
  await page.click('[data-gearspec="2"]');
  const en2 = await page.$$eval('.ench .tr', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  check(en2.some((r) => /^Wrist/.test(r) && /Superior Spirit/.test(r) && /Classic data/.test(r)), 'Enchants (Shadow set): an enchant known only by id is named from Classic data, and says so');
  await page.click('[data-gearspec="1"]');
  const ens = await page.evaluate(() => window.CC.gear.summary()[0].enchants);
  const chest = ens.find((r) => r.slot === 'Chest'), head = ens.find((r) => r.slot === 'Head');
  check(chest && chest.enchant && chest.enchant.id === 913 && chest.enchant.statsFrom === 'game' && chest.enchant.score > 0, 'snapshot: gear[].enchants names and scores the enchant on each slot');
  check(head && head.empty === true && head.best && head.best.gain > 0 && head.best.where, 'snapshot: an empty slot with the best enchant you can get and how');
  check(ens.every((r) => !r.best || (r.best.how && Array.isArray(r.best.reagents))), 'snapshot: each best enchant says how you get it, with its reagents');

  // ---- class sets
  await page.click('[data-gearview="sets"]');
  check((await page.$$('.setcard')).length > 0, 'class sets show');

  // ---- Shadow spec: its own weights, Shadow numbers
  await page.click('[data-gearview="up"]');
  await page.click('[data-gearspec="2"]');
  const cards2 = await text('.cards.c4');
  check(/Stat weights\s*Shadow/i.test(cards2), 'the Shadow spec uses the Shadow weights');
  check(await page.$eval('.ph-tools .seg button.on', (b) => /^Shadow/.test(b.innerText)), 'switching marks Shadow in the switcher');

  // ---- Stat weights page
  await page.click('[data-gearspec="1"]');
  await page.evaluate(() => { location.hash = 'weights'; window.CC.api.STATE.tab = 'weights'; window.CC.api.render(); });
  await page.waitForSelector('.wspec');
  const wp = await text('main');
  check(/Holy \(default\)/.test(wp) && /Default: most of your talent points are in Holy/.test(wp), 'Stat weights: each spec says why it uses its weights');
  check(/Why these numbers/i.test(wp) && /Intellect 1\.6/.test(wp), 'Stat weights: the reasons for each number show');
  check(!/guide order|mana model|project weights/i.test(wp.split(/Why these numbers/i)[0]), 'Stat weights: plain names (no "guide order", "mana model")');

  // ---- the snapshot for Claude
  const snapQ = await page.evaluate(() => (window.CC.snapshot().quests || []).find((q) => q.id === 7488));
  // (the pack's rewards for it: 18491, and since the 25 Nov pack two Forever-only choices as well)
  check(snapQ && snapQ.rewards.some((r) => r.id === 18491) && snapQ.rewards.every((r) => Array.isArray(r.specs)), 'a complete quest the game read with no rewards: the pack\'s rewards, scored for every spec');
  const sum = await page.evaluate(() => window.CC.gear.summary());
  const holy = sum.find((s) => s.tree === 'Holy');
  // #99: a healer's crit weight comes from their own heals: Greater Heal R5 and Flash Heal R7 at 500 +healing
  const crit = await page.evaluate((holyIdx) => {
    const A = window.CC.api, SP = A.DB.spells, s = A.CH.snap, keep = { book: s.spellbook, healing: (s.stats || {}).healing, taken: s.taken };
    SP[25314] = { name: 'Greater Heal', tip: [{ l: 'Greater Heal' }, { l: '710 Mana', r: '40 yd range' }, { l: '2.5 sec cast' }, { l: 'A slow casting spell that heals a single target for 1966 to 2194.' }] };
    SP[10917] = { name: 'Flash Heal', tip: [{ l: 'Flash Heal' }, { l: '380 Mana', r: '40 yd range' }, { l: '1.5 sec cast' }, { l: 'Heals a friendly target for 812 to 958.' }] };
    s.spellbook = [{ name: 'Holy', spells: [{ name: 'Greater Heal', rank: 'Rank 5', id: 25314 }, { name: 'Greater Heal', rank: 'Rank 1', id: 2060 }, { name: 'Flash Heal', rank: 'Rank 7', id: 10917 }] }];
    s.stats = Object.assign({}, s.stats, { healing: 500 }); s.taken = (s.taken || 0) + 1;
    const out = window.CC.gear.summary()[holyIdx];
    A.STATE.tab = 'gear'; A.render(); const h = document.querySelector('main').innerHTML;
    delete SP[25314]; delete SP[10917]; Object.assign(s, { spellbook: keep.book, taken: keep.taken }); s.stats.healing = keep.healing;
    const after = window.CC.gear.summary()[holyIdx];
    return { c: out.crit, w32: out.weightValues[32], h: /Crit: 1% is worth/.test(h), after: after.crit || null, a32: after.weightValues[32] };
  }, sum.indexOf(holy));
  // the tooltip's 2.5 sec (Divine Fury) is ignored: the share uses the base 3 sec. Greater Heal: 2080 + 0.857 × 500 = 2509, / 0.857 × 0.5 × 2/3 × 1% = 9.76 a 1%; Flash Heal: 885 + 214 = 1099 / 0.4286 × … = 8.55; average 9.15 / 14 = 0.65
  check(crit.c && crit.c.heals.length === 2 && crit.c.heals[0].name === 'Greater Heal' && crit.c.heals[0].rank === 5 && Math.abs(crit.c.perPct - 9.15) < 0.05 && crit.w32 === 0.65 && crit.c.profileWeight === 0.3,
    `a healer's crit weight from their heals: 1% = ${crit.c && crit.c.perPct} healing, 0.65 a rating (the profile's 0.3 until read) ${JSON.stringify(crit.c)}`);
  check(crit.h && crit.after === null && crit.a32 === 0.3, 'the Gear page says how crit was worked out; heals not read: the profile\'s 0.3');
  // #13: a set bonus with stats counts in a gain when an item makes or breaks it
  const setT = await page.evaluate((holyIdx) => {
    const A = window.CC.api, G = window.CC.gear, keep = A.GD.sets;
    const w = { 5: 1 };
    A.GD.sets = Object.assign({}, keep, { t1: ['Test Set', [900001, 900002], [[2, '+10 Intellect.', [[5, 10]]], [3, 'a proc', []]], 16] });
    const make = G.setDelta(w, { 1: { id: 900001 }, 5: { id: 777 } }, 900002, [777]);
    const brk = G.setDelta(w, { 1: { id: 900001 }, 5: { id: 900002 } }, 777, [900002]);
    const dup = G.setDelta(w, { 11: { id: 900001 }, 12: { id: 900002 } }, 900002, [123]);
    const none = G.setDelta(w, { 1: { id: 5 } }, 6, [5]);
    // in the plan: the best Holy upgrade and an item worn in another slot become one set
    const before = G.summary()[holyIdx], up = before.upgrades[0];
    const other = before.worn.find((x) => x.slot !== up.slot && x.items[0]);
    A.GD.sets = Object.assign({}, keep, { t2: ['Test Pair', [up.id, other.items[0].id], [[2, '+20 Intellect.', [[5, 20]]]], 16] });
    const after = G.summary()[holyIdx].upgrades.find((u) => u.id === up.id && u.slot === up.slot);
    const wInt = (before.weightValues || {})[5] || 0;
    // a ring row: the weaker ring is a set piece whose bonus is big, so a new ring replaces the stronger one
    const rings = before.worn.find((x) => x.slot === 'Ring'), rUp = before.upgrades.find((u) => u.slot === 'Ring');
    let ring = null;
    if (rings && rings.items.length === 2 && rUp) {
      const [r1, r2] = rings.items.slice().sort((a, b) => a.score - b.score), other2 = before.worn.find((x) => x.slot !== 'Ring' && x.items[0]);
      A.GD.sets = Object.assign({}, keep, { t3: ['Test Ring Set', [r1.id, other2.items[0].id], [[2, '+500 Intellect.', [[5, 500]]]], 16] });
      const a2 = G.summary()[holyIdx].upgrades.find((u) => u.id === rUp.id && u.slot === 'Ring');
      ring = { weak: r1.score, strong: r2.score, up: rUp, after: a2 || null };
    }
    // two copies of a set ring: taking one off keeps the piece
    A.GD.sets = Object.assign({}, keep, { t4: ['Copies', [900001, 900003], [[2, '+10 Intellect.', [[5, 10]]]], 16] });
    const copy = G.setDelta(w, { 11: { id: 900001 }, 12: { id: 900001 }, 1: { id: 900003 } }, 777, [900001]);
    A.GD.sets = keep;
    return { make, brk, dup, none, up, after, wInt, ring, copy };
  }, sum.indexOf(holy));
  check(setT.make.d === 10 && setT.make.sets[0].from === 1 && setT.make.sets[0].to === 2, 'set bonus: the second piece makes the 2-piece bonus (+10)');
  check(setT.brk.d === -10 && setT.dup.d === 0 && setT.none.d === 0 && setT.none.sets.length === 0, 'set bonus: taking a piece off breaks it; a second copy adds nothing; no set, nothing');
  check(setT.after && setT.after.setBonus && Math.abs(setT.after.setBonus.gain - +(20 * setT.wInt).toFixed(1)) < 0.11 && Math.abs(setT.after.gain - (setT.up.gain + setT.after.setBonus.gain)) < 0.11,
    `the Gear plan: an upgrade that completes a set gains its bonus (${setT.up.gain} → ${setT.after && setT.after.gain}, set ${JSON.stringify(setT.after && setT.after.setBonus)})`);
  check(setT.copy.d === 0, 'set bonus: two copies of a piece, one taken off: the bonus stays');
  check(!setT.ring || (setT.ring.after && Math.abs(setT.ring.after.gain - +(setT.ring.up.score - setT.ring.strong).toFixed(1)) < 0.11 && !setT.ring.after.setBonus),
    `a ring row: a new ring replaces the stronger ring when the weaker one keeps a set bonus (${JSON.stringify(setT.ring)})`);
  const worldSeen = await page.evaluate(() => {
    const ah = window.CC.api.CH.ah = window.CC.api.CH.ah || {}; ah.prices = ah.prices || {};
    const before = window.CC.gear.availability(2243);
    ah.prices['2243'] = { id: 2243, obs: [{ t: 1, min: 500000, qty: 1, src: 'scan' }] };
    const after = window.CC.gear.availability(2243);
    delete ah.prices['2243'];
    return { before, after };
  });
  check(worldSeen.before === 'worldAh' && worldSeen.after === null, `a world drop your AH once listed is a target again (Hand of Edward the Odd: ${JSON.stringify(worldSeen)})`);
  // hit up to the cap (spell weights): Shadow Focus 5/5 read from its text, 10 rating per 1% from the client's numbers
  const sh = sum.find((s) => s.tree === 'Shadow');
  check(sh && sh.hit && sh.hit.talents.some((t) => t.name === 'Shadow Focus' && t.pct === 5) && sh.hit.ratingPer1Pct === 10 && sh.hit.ratingMeasured && sh.hit.capPct === 17 && !sh.hit.overCap,
    `Shadow: hit from Shadow Focus and gear against the raid cap (${JSON.stringify(sh && sh.hit)})`);
  check(holy && !holy.hit, 'Holy: no hit model (healing weights)');
  check(holy && holy.weightsName === 'Holy' && holy.weightsChosen === 'default for the biggest tree', 'snapshot: Holy weights, chosen by the biggest tree');
  check(holy && holy.ahUpgrades.some((u) => u.roll === 'of Healing' && u.ah && u.ah.price > 0), 'snapshot: AH upgrades with roll and price');
  check(holy && holy.preBis.length >= 15 && holy.preBis.every((p) => Array.isArray(p.alternatives)), 'snapshot: pre-BiS with alternatives');
  const raidIds = new Set([22631, 21275, 21273, 21523]);
  check(holy && !holy.preBis.some((p) => raidIds.has(p.id) || p.alternatives.some((a) => raidIds.has(a.id))), 'snapshot: no raid weapon (Atiesh, Qiraji staves, Fang of Korialstrasz) in pre-BiS');
  check(holy && holy.notInPreBis.some((x) => x.availability === 'raid') && holy.notInPreBis.every((x) => ['raid', 'pvp', 'unseen', 'worldAh'].includes(x.availability)), 'snapshot: raid and not-yet-seen items kept with why (notInPreBis)');
  // a world drop is a target only once the player's own AH has listed one (the fixture's AH has none of them)
  const arr0 = (x) => x || [];
  const worldIn = (sp) => sp.preBis.flatMap((p) => [p, ...p.alternatives]).filter((x) => x.source === 'world');
  check(sum.every((sp) => !sp.preBis || worldIn(sp).length === 0) && sum.some((sp) => arr0(sp.notInPreBis).some((x) => x.availability === 'worldAh')), `pre-BiS: no world drop your AH hasn't listed; they are kept with why (${sum.map((sp) => sp.preBis ? worldIn(sp).map((x) => x.name) : []).flat().join(', ')})`);
  // #110: raid, world-boss, battleground and raid-material sources are raid / PvP; dungeon and world drops aren't
  const kinds = await page.evaluate(() => Object.fromEntries([23025, 20632, 20682, 20580, 19140, 21210, 19165, 19682, 17193, 22669, 19309, 19315, 22747, 22752, 2243, 13001, 13133, 13075, 18510]
    .map((id) => [id, window.CC.gear.kindOf(id)])));
  check([23025, 20632, 20682, 20580, 19140, 21210, 19165, 19682, 17193, 22669].every((id) => kinds[id] === 'raid'), `raid: Naxx chest, Taerar, the Abyssal Council, the green dragons, Cache of the Firelord, the AQ rep chain, MC, ZG and Naxx crafts (${JSON.stringify(kinds)})`);
  check([19309, 19315, 22747, 22752].every((id) => kinds[id] === 'pvp'), 'PvP: Alterac Valley and Warsong Gulch quartermasters');
  check([2243, 13001, 13133, 13075].every((id) => kinds[id] === 'world') && kinds[18510] === 'crafted', 'world drops (also world-drop epics that raid bosses list too) and a Dire Maul craft stay what they are');
  await page.evaluate(() => { window.CC.api.STATE.tab = 'gear'; window.CC.api.STATE.gearSlot = 'Main hand'; window.CC.api.render(); });
  const later = await page.$$eval('.slotdet details.later', (els) => els.map((e) => e.textContent).join('\n'));
  check(/Raid, PvP and not in game yet/.test(later) && /Raid/.test(later), 'Main hand: raid items listed under "Raid, PvP and not in game yet", not in Pre-BiS');
  const ms = await page.evaluate(() => { const t = performance.now(); window.CC.api.STATE.tab = 'gear'; window.CC.api.render(); window.CC.gear.summary(); return performance.now() - t; });
  console.log(`     (Gear page + snapshot: ${Math.round(ms)} ms)`);
  check(ms < 3000, 'the Gear page and its snapshot take under 3 s');
  // ---- spell ranks: Talents & Bars and Claude's snapshot (js/spells.js)
  await page.evaluate(() => { window.CC.api.STATE.tab = 'talents'; window.CC.api.STATE.spec = 1; window.CC.api.render(); });
  const tb = await text('main');
  check(/Flash Heal: rank 6 on the bar, you know rank 7/.test(tb), 'Talents & Bars: a bar spell below your best rank is named');
  check(/To train now/.test(tb) && /Greater Heal 5/.test(tb) && /Next at level 60: Holy Fire 8/.test(tb), "Talents & Bars: the trainer's ranks to train now and next");
  check((await page.$$('.abars .ic.oldrank')).length === 1, 'Talents & Bars: the outdated bar slot is marked');
  const sp = await page.evaluate(() => window.CC.snapshot().spells);
  const s1 = sp && sp.specs.find((x) => x.spec === 1);
  check(s1 && s1.outdated.length === 1 && s1.outdated[0].rank === 6 && s1.outdated[0].best === 7 && s1.bars.find((b) => b.slot === 2).rank === 9,
    'snapshot: spells.specs[].outdated and each bar spell with its rank');
  check(sp && sp.train.length === 1 && sp.train[0].name === 'Greater Heal' && sp.later[0].level === 60 && sp.trainer.npc === 'High Priestess Laurena'
    && sp.known.some((k) => k.name === 'Flash Heal' && k.rank === 7), 'snapshot: spells.train, later, trainer and known ranks');
  // ---- one source model for every item: a crafted item says its recipe, where that comes from, and what it needs
  const craft = await page.evaluate(() => window.CC.api.gdSourceLines(17015).map((l) => l.l));   // Dark Iron Reaver
  check(craft.some((l) => /^Crafted \(Blacksmithing\) · Recipe: Plans: Dark Iron Reaver \(skill 300\), sold by Lokhtos Darkbargainer, Blackrock Depths$/.test(l)),
    'crafted item: its recipe and where the recipe is sold (' + craft.join(' | ') + ')');
  check(craft.includes('Needs Honored with Thorium Brotherhood for Plans: Dark Iron Reaver (you: none)'), "crafted item: the recipe's reputation, with yours");
  check(craft.includes('Needs Blacksmithing 320 to craft it (you: none)'), 'crafted item: the skill to craft it');
  // its tools and place, learned or not (#145; pack recipes, Classic data): on the item, on its recipe, on the tool
  check(craft.includes('To craft it: needs Blacksmith Hammer at The Black Anvil (Classic data)'), 'crafted item: the tools and place its recipe needs');
  const plans = await page.evaluate(() => window.CC.api.gdSourceLines(17059).map((l) => l.l));
  check(plans.includes('Teaches Dark Iron Reaver: needs Blacksmith Hammer at The Black Anvil (Classic data)'), 'recipe item: what it teaches and its tools (' + plans.join(' | ') + ')');
  const rodL = await page.evaluate(() => window.CC.api.gdSourceLines(16207).map((l) => l.l));
  check(rodL.some((l) => /^Tool for \d{2,} Enchanting recipes \(Classic data\)$/.test(l)), 'a tool: how many recipes need it (' + rodL.join(' | ') + ')');
  const moon = await page.evaluate(() => window.CC.api.gdSourceLines(14342).map((l) => l.l));
  check(moon.includes('To craft it: needs a Moonwell (Classic data)') || moon.some((l) => /^To craft it: needs .*Moonwell$/.test(l)), 'a place alone: a Moonwell (' + moon.join(' | ') + ')');
  const gates = await page.evaluate(() => window.CC.api.itemGates(19447).map((g) => g.short));   // Formula: Enchant Bracer - Healing (Revered: Forever's tooltip, #129)
  check(gates.includes('Revered with Argent Dawn (you: Neutral)'), "an item's own reputation need, against yours (" + gates.join(' | ') + ')');
  // a vendor's own price and reputation (#151): Forever's Formula: Enchant 2H Weapon - Mighty Healing Power from Alynsia (the Alliance one)
  const fav = await page.evaluate(() => ({ gates: window.CC.api.itemGates(249526).map((g) => g.text), lines: window.CC.api.gdSourceLines(249526).map((l) => l.l) }));
  check(fav.gates.includes('Needs Honored with Azeroth Commerce Authority for buying it from Alynsia (you: none)') && !fav.gates.some((g) => /Durotar/.test(g)),
    "a vendor's reputation, your side's vendor only (" + fav.gates.join(' | ') + ')');
  check(fav.lines.some((l) => /^Vendor: .*Alynsia \(Redridge Mountains\) for 240 Merchant's Favor/.test(l)), "a vendor's price in Merchant's Favor (" + fav.lines.join(' | ') + ')');

  // a vendor on your side sells it (#157): Deliana in Dun Morogh sells the Virtuous pieces a set container also gives;
  // the item is a vendor item, with where to buy it (the price once the pack has it)
  const vir = await page.evaluate(() => ({ line: window.CC.api.buyLine(226955),
    ups: window.CC.snapshot().gear.flatMap((g) => (g.upgrades || []).filter((u) => u.id === 226955).map((u) => [u.source, u.where])
      .concat((g.preBis || []).filter((u) => u.id === 226955).map((u) => ['vendor', u.where]))) }));   // preBis entries carry no source
  check(/^Buy: Deliana, Dun Morogh, /.test(vir.line || '') && vir.ups.length && vir.ups.every(([src, w]) => src === 'vendor' && w === vir.line),
    'an item a vendor on your side sells: Buy, the vendor, where, the price (' + JSON.stringify(vir) + ')');
  // best from what you own (#149): never worse than the set it is compared with (the set's items count even when the
  // saved bags and bank don't list them); an item the game hadn't loaded when it saved is scored from the pack for
  // every spec: Glowing Brightwood Staff put in the bags with no saved item data
  const owned = await page.evaluate(() => window.CC.advice.bestOwnedSnapshot().map((b) => ({ spec: b.spec, neg: b.slots.filter((x) => x.gain < -0.05).map((x) => x.slot + ' ' + x.gain) })));
  check(owned.length === 2 && owned.every((b) => !b.neg.length), 'best from what you own is never worse than the compared set (' + JSON.stringify(owned) + ')');
  const staff = await page.evaluate(() => {
    const sn = window.CC.api.CH.snap;
    sn.bags[0].items.push({ slot: 2, item: 'item:812::::::::59:::::', count: 1 });
    sn.taken = (sn.taken || 0) + 1;
    const v = window.CC.advice.snapshot().find((x) => x.id === 812);
    const w = window.CC.advice.bestOwnedSnapshot().map((b) => ({ spec: b.spec, best: (b.slots.find((x) => x.slot === 'Weapons') || { best: [] }).best.map((x) => x.id) }));
    return { v, w };
  });
  check(staff.v && staff.v.flag === 'ask' && ['Holy', 'Shadow'].every((n) => staff.v.specs.some((x) => x.spec === n && x.score > 0)),
    'an item the game hadn\'t loaded: Keep, ask, with a score for every spec (' + JSON.stringify(staff.v) + ')');
  check(staff.w.some((b) => b.spec === 'Holy' && b.best.includes(812)), 'and it counts in best from what you own (' + JSON.stringify(staff.w) + ')');

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));

  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    await page.evaluate(() => { location.hash = 'gear'; window.CC.api.STATE.tab = 'gear'; window.CC.api.STATE.gearView = 'up'; window.CC.api.STATE.gearSlot = 'Shoulder'; window.CC.api.STATE.gearUpAll = null; window.CC.api.render(); });
    for (const [wd, view] of [[1600, 'up'], [1280, 'up'], [1280, 'ah'], [1280, 'ench'], [900, 'up'], [900, 'ench']]) {
      await page.setViewportSize({ width: wd, height: 1100 });
      await page.evaluate((v) => { window.CC.api.STATE.gearView = v; window.CC.api.render(); }, view);
      await page.screenshot({ path: path.join(shots, `gear-${view}-${wd}.png`), fullPage: wd === 1280 && view === 'up' });
    }
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.evaluate(() => { window.CC.api.STATE.tab = 'weights'; window.CC.api.render(); });
    await page.screenshot({ path: path.join(shots, 'weights-1280.png'), fullPage: true });
  }
  await browser.close();
  if (failed) { console.log(`${failed} failed`); process.exit(1); }
  console.log('DONE');
})().catch((e) => { console.error(e); process.exit(1); });
