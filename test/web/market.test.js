// node test/web/market.test.js
// The AH buy list (js/market.js, #115): each rule fires where it should and nowhere else, and the speculative rules
// are offered only when their backtest over the scan history made money.
const M = require('../../ClaudeCompanion/web/js/market.js');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };

const DAY = 86400, T0 = 1795000000;
// an item's price record from a list of scan lowest prices (null = none listed); the newest is the last full scan
const rec = (id, mins, o = {}) => ({ id, name: o.name || 'Item ' + id, obs: mins.map((m, i) => (m == null ? { src: 'scan', t: T0 + i * DAY, qty: 0 }
  : { src: 'scan', t: T0 + i * DAY, min: m, med: (o.med && o.med[i]) || m, qty: (o.qty && o.qty[i]) || 10 })) });
const N = 6, lastScan = { t: T0 + (N - 1) * DAY, auctions: 5000 };
const ctxOf = (prices, o = {}) => Object.assign({
  prices, lastScan, cut: 0.05, now: lastScan.t + 60,
  vendorBuy: (id) => (o.vbuy || {})[id] || null, vendorSell: (id) => (o.vsell || {})[id] || null,
  item: (id) => (o.items || {})[id] || null, deValue: (it) => (o.de || {})[it.name] || null,
  hasEnchanting: !!o.ench, sellShare: () => null,
}, o.ctx || {});
const rowsOf = (B, rule) => B.rows.filter((r) => r.rule === rule);

// nothing scanned: no rows, no rules
check(M.buyList(ctxOf({}, {}, )).rows.length === 0 && M.buyList({ prices: {}, lastScan: null }).rules.length === 0, 'no full scan: no buy list');

// history: one entry per scan; two readings within 10 min of each other are the same scan (the newer counts); none listed keeps qty 0
{
  const h = M.history({ obs: [{ src: 'scan', t: 100, min: 5, qty: 2 }, { src: 'scan', t: 300, min: 9, qty: 1 }, { src: 'browse', t: 400, min: 1, qty: 1 }, { src: 'scan', t: 5000, qty: 0 }] });
  check(h.length === 2 && h[0].min === 9 && h[0].t === 100 && h[1].min === null && h[1].qty === 0, 'history: one entry per full scan (the newer reading of it), browsing ignored, none listed kept');
}

// vendor: listed under what a vendor pays
{
  const B = M.buyList(ctxOf({ 1: rec(1, [200, 210, 190, 205, 200, 80]), 2: rec(2, [200, 210, 190, 205, 200, 150]) }, { vsell: { 1: 100, 2: 100 } }));
  const v = rowsOf(B, 'vendor');
  check(v.length === 1 && v[0].id === 1 && v[0].net === 20 && v[0].buyUnder === 99 && v[0].offered, 'vendor: under the vendor price fires (net 20), above it does not');
}

// not listed in the newest full scan: no row, whatever its old prices were
{
  const p = rec(3, [200, 200, 200, 200, 50]);   // newest entry is a scan before the last one
  const B = M.buyList(ctxOf({ 3: p }, { vsell: { 3: 100 } }));
  check(B.rows.length === 0, 'an item the newest full scan did not list gets no row');
  const B2 = M.buyList(ctxOf({ 4: rec(4, [200, 200, 200, 200, 200, null]) }, { vsell: { 4: 300 } }));
  check(B2.rows.length === 0, 'none listed at the newest scan: no row');
}

// a second scan pass stamped after the scan started still counts as the newest scan
{
  const p = rec(6, [200, 200, 200, 200, 200, 50]); p.obs[p.obs.length - 1].t = lastScan.t + 1500;
  check(rowsOf(M.buyList(ctxOf({ 6: p }, { vsell: { 6: 100 } })), 'vendor').length === 1, 'a reading from the scan\'s second pass, 25 min after it started, is in the newest scan');
}

// random-roll keys (item:suffix) are left out: one key per item
check(M.buyList(ctxOf({ '5:1': rec(5, [50, 50, 50, 50, 50, 50]) }, { vsell: { 5: 100 } })).rows.length === 0, 'random-roll keys are left out');

// disenchant: a BoE green weapon or armor under its disenchant value after the cut; BoP, a white, or a value with
// a missing material price never fire; not offered without Enchanting
{
  const items = { 10: { name: 'Green', q: 2, ilvl: 30, bind: 2, cls: 4 }, 11: { name: 'Bop', q: 2, ilvl: 30, bind: 1, cls: 4 },
    12: { name: 'White', q: 1, ilvl: 30, bind: 2, cls: 4 }, 13: { name: 'Gap', q: 2, ilvl: 30, bind: 2, cls: 2 } };
  const de = { Green: { value: 1000, missing: [] }, Bop: { value: 1000, missing: [] }, White: { value: 1000, missing: [] }, Gap: { value: 1000, missing: ['Strange Dust'] } };
  const prices = {}; [10, 11, 12, 13].forEach((id) => (prices[id] = rec(id, [900, 900, 900, 900, 900, 900])));
  const B = M.buyList(ctxOf(prices, { items, de, ench: true }));
  const d = rowsOf(B, 'disenchant');
  check(d.length === 1 && d[0].id === 10 && d[0].net === 50 && d[0].deValue === 1000 && /Classic/.test(d[0].label), 'disenchant: only the BoE green with every material priced (950 after the cut − 900)');
  const B2 = M.buyList(ctxOf(prices, { items, de, ench: false }));
  check(!B2.rules.find((r) => r.id === 'disenchant').offered && rowsOf(B2, 'disenchant').every((r) => !r.offered), 'disenchant: not offered without Enchanting');
}

// resell: a vendor sells it for less than the AH's lowest after the cut; held = scans whose lowest stayed above
{
  const B = M.buyList(ctxOf({ 20: rec(20, [120, 80, 150, 160, 140, 200]) }, { vbuy: { 20: 100 } }));
  const r = rowsOf(B, 'resell')[0];
  check(r && r.vendorPrice === 100 && r.relist === 199 && r.net === Math.round(199 * 0.95 - 100) && r.held === 4 && r.of === 5, 'resell: list 1c under the lowest; evidence from the 5 earlier scans: 4 stayed above the vendor after the cut');
  check(rowsOf(M.buyList(ctxOf({ 21: rec(21, [100, 100, 100, 100, 100, 104]) }, { vbuy: { 21: 100 } })), 'resell').length === 0, 'resell: not when the cut eats the margin');
}

// dip: 25% under the item's own median lowest of its earlier scans; needs 4 earlier scans
{
  const B = M.buyList(ctxOf({ 30: rec(30, [100, 100, 100, 100, 100, 70]), 31: rec(31, [100, 100, 100, 100, 100, 80]), 32: rec(32, [100, 100, 100, 70]) }));
  const d = rowsOf(B, 'dip');
  check(d.length === 1 && d[0].id === 30 && d[0].usual === 100 && d[0].relist === 100 && d[0].falling === false, 'dip: 30% under fires, 20% under does not');
  const B2 = M.buyList(ctxOf({ 33: rec(33, [100, 100, 100, 70]) }, { ctx: { lastScan: { t: T0 + 3 * DAY } } }));
  check(rowsOf(B2, 'dip').length === 0, 'dip: needs 4 earlier scans with the item listed');
  const B3 = M.buyList(ctxOf({ 34: rec(34, [200, 200, 200, 120, 120, 100]) }));
  const f = rowsOf(B3, 'dip')[0];
  check(f && f.falling === true, 'dip: marked falling when the last 3 scans are 10% or more under the ones before');
  check(d[0].offered === false && B.rules.find((r) => r.id === 'dip').backtest.n === 0, 'dip: not offered without a backtest');
}

// thin: 3 or fewer listed, the lowest under 70% of this scan's median and under 80% of the earlier floor
{
  const B = M.buyList(ctxOf({ 40: rec(40, [100, 100, 100, 100, 100, 50], { med: [0, 0, 0, 0, 0, 100], qty: [9, 9, 9, 9, 9, 2] }),
    41: rec(41, [100, 100, 100, 100, 100, 50], { med: [0, 0, 0, 0, 0, 100], qty: [9, 9, 9, 9, 9, 8] }) }));
  const t = rowsOf(B, 'thin');
  check(t.length === 1 && t[0].id === 40 && t[0].usual === 100, 'thin: 2 listed far under the rest fires; 8 listed does not');
}

// the backtest: offered only with 30 or more cases and a median return above 0
{
  // 40 items that dip at scan 4 and come back at scan 5 (return 100*0.95/70 − 1 ≈ +36%), newest scan steady
  const up = {}; for (let i = 0; i < 40; i++) up[100 + i] = rec(100 + i, [100, 100, 100, 100, 70, 100]);
  up[200] = rec(200, [100, 100, 100, 100, 100, 70]);
  const B = M.buyList(ctxOf(up));
  const r = B.rules.find((x) => x.id === 'dip');
  check(r.backtest.n === 40 && r.backtest.medianReturn === +(0.95 / 0.7 - 1).toFixed(3) && r.backtest.winShare === 1 && r.offered, 'backtest: 40 dips that came back: offered, median +36%');
  const nd = rowsOf(B, 'dip')[0];
  check(nd && nd.offered && B.rows[0].rule === 'dip', 'backtest: the newest dip is offered');
  check(nd.net === Math.round(70 * r.backtest.medianReturn) && nd.buyUnder === 95 && nd.relist === 100 && nd.earlier === 5 && nd.unitOnly,
    'dip: you make = the lowest × the backtest median return; buy under = break-even at the usual lowest after the cut (' + JSON.stringify(nd) + ')');
  // an item with random rolls: its base key mixes every roll, so it is in neither the backtest nor the dip rows
  const rolled = Object.assign({}, up, { '200:of the Owl': rec(200, [100, 100, 100, 100, 100, 100]) });
  const R = M.buyList(ctxOf(rolled));
  check(rowsOf(R, 'dip').length === 0 && R.rules.find((x) => x.id === 'dip').backtest.n === 40, 'dip: an item with random rolls is left out of the rows and the backtest');
  // 40 that kept falling (sold at 60): not offered, and the row is kept but marked not offered
  const down = {}; for (let i = 0; i < 40; i++) down[100 + i] = rec(100 + i, [100, 100, 100, 100, 70, 60]);
  down[200] = rec(200, [100, 100, 100, 100, 100, 70]);
  const D = M.buyList(ctxOf(down));
  const rd = D.rules.find((x) => x.id === 'dip');
  check(rd.backtest.n >= 40 && rd.backtest.medianReturn < 0 && !rd.offered && rowsOf(D, 'dip').every((x) => !x.offered), 'backtest: dips that kept falling are not offered');
  // 29 cases: not enough
  const few = {}; for (let i = 0; i < 29; i++) few[100 + i] = rec(100 + i, [100, 100, 100, 100, 70, 100]);
  check(!M.buyList(ctxOf(few)).rules.find((x) => x.id === 'dip').offered, 'backtest: 29 cases are not enough');
  // a next scan with none listed counts as sold at the old median
  const gone = {}; for (let i = 0; i < 30; i++) gone[100 + i] = rec(100 + i, [100, 100, 100, 100, 70, null], { med: [0, 0, 0, 0, 90, 0] });
  const G = M.backtest('dip', Object.values(gone).map(M.history), 0.05);
  check(G.n === 30 && G.medianReturn === +(90 * 0.95 / 70 - 1).toFixed(3), 'backtest: none listed next scan sells at the old median');
}

// order: offered first, then certain to speculative, then by what you make
{
  const B = M.buyList(ctxOf({ 1: rec(1, [200, 200, 200, 200, 200, 50]), 2: rec(2, [200, 200, 200, 200, 200, 90]) }, { vsell: { 1: 100, 2: 100 }, vbuy: {} }));
  check(B.rows[0].rule === 'vendor' && B.rows[0].id === 1 && B.rows[1].id === 2 && B.rows.slice(2).every((r) => !r.offered), 'order: offered rows first, the biggest margin first');
}

// the market index: per band, the median change of the lowest from the scan before to the newest, for items at both
{
  const prices = {};
  for (let i = 0; i < 12; i++) prices[300 + i] = rec(300 + i, [300000, 300000, 300000, 300000, 300000, i < 9 ? 240000 : 330000]);   // 20g+: 9 of 12 cheaper
  for (let i = 0; i < 12; i++) prices[400 + i] = rec(400 + i, [5000, 5000, 5000, 5000, 5000, i < 6 ? 4500 : 5500]);              // <1g: half and half
  prices[500] = rec(500, [300000, 300000, 300000, 300000, 300000, 200000]);
  prices[501] = rec(501, [300000, 300000, 300000, 300000, null, 200000]);   // not listed at the scan before: not in the index
  const vb = {}; vb[500] = 1;   // a resell row in the falling band
  const B = M.buyList(ctxOf(prices, { vbuy: vb }));
  const hi = B.index.bands.find((b) => b.band === '20g+'), lo = B.index.bands.find((b) => b.band === '<1g');
  check(hi.n === 13 && hi.cheaper === 10 && hi.falling && hi.medianChange === -0.2, 'index: 20g+ falling, 10 of 13 cheaper, median −20% (' + JSON.stringify(hi) + ')');
  check(lo.n === 12 && !lo.falling && lo.medianChange === 0, 'index: <1g even, not falling');
  check(B.index.prev === T0 + 4 * DAY && B.index.scan === lastScan.t, 'index: compares the newest scan with the one before');
  const rs = rowsOf(B, 'resell').find((r) => r.id === 500);
  check(rs && rs.dontHold && rs.band === '20g+', 'index: a resell row in a falling band says don\'t hold');
  const v = M.buyList(ctxOf(prices, { vsell: { 500: 250000 } }));
  check(rowsOf(v, 'vendor')[0] && !rowsOf(v, 'vendor')[0].dontHold, 'index: a vendor row is never "don\'t hold" (it sells to a vendor)');
}

// open positions: sell after the hold time or past the stop; at target; unrealised at the lowest after the cut; limits
{
  const now = T0 + 10 * DAY;
  const open = [{ id: 'a', item: 'Old', t: now - 4 * DAY, units: 2, paid: 2000 }, { id: 'b', item: 'Stop', t: now - DAY, units: 1, paid: 1000 },
    { id: 'c', item: 'Goal', t: now - DAY, units: 1, paid: 1000 }, { id: 'd', item: 'Wait', t: now - DAY, units: 1, paid: 6000 }, { id: 'e', item: 'Gone', t: now - DAY, units: 1, paid: 100 }];
  const low = { Old: { min: 1200, t: now }, Stop: { min: 840, t: now }, Goal: { min: 1500, t: now }, Wait: { min: 6100, t: now }, Gone: { none: true, t: now } };
  const P = M.positions({ open, now, cut: 0.05, lowestOf: (n) => low[n] || null, plans: { c: 1400 }, rules: { capItem: 10, capTotal: 50 }, gold: 20000 });
  const by = (id) => P.rows.find((r) => r.id === id);
  check(by('a').flag === 'sell' && /past your 3/.test(by('a').why) && by('a').unrealised === Math.round(1200 * 0.95 * 2 - 2000), 'positions: held past 3 days: sell at market; unrealised after the cut');
  check(by('b').flag === 'sell' && /16% under/.test(by('b').why), 'positions: the lowest 16% under what you paid: sell (stop 15%)');
  check(by('c').flag === 'target' && by('d').flag === 'hold' && by('e').flag === 'hold' && by('e').unrealised === null && /none listed/.test(by('e').why), 'positions: at the planned price; holding; none listed has no unrealised');
  check(P.totals.capital === 10100 && P.totals.largest.item === 'Wait' && P.totals.largest.share === 0.3 && P.totals.overItem.join() === 'Wait' && P.totals.overTotal,
    'positions: capital 10,100 of 20,000 gold: over 50% in all and over 10% in Wait (' + JSON.stringify(P.totals) + ')');
  check(P.rows[0].flag === 'sell' && P.rows[P.rows.length - 1].flag === 'hold', 'positions: sell first');
  const ng = M.positions({ open, now, lowestOf: () => null, gold: null }).totals;
  check(ng.totalShare === null && ng.overItem.length === 0 && ng.overTotal === false, 'positions: no gold on hand known: no shares, no warnings');
  // limits are per item: three buys of one item at 8% each are 24% in that item
  const three = [1, 2, 3].map((k) => ({ id: 'x' + k, item: 'Same', t: now - DAY, units: 1, paid: 800 }));
  const T3 = M.positions({ open: three, now, lowestOf: () => null, rules: { capItem: 10 }, gold: 10000 }).totals;
  check(T3.overItem.join() === 'Same' && T3.largest.paid === 2400 && T3.largest.share === 0.24, 'positions: open buys of the same item add up for the limit');
  // your own listing is the lowest: it says nothing about the market
  const mine = M.positions({ open: [{ id: 'm', item: 'Mine', t: now - DAY, units: 2, paid: 2000, listedAt: 3000 }], now, lowestOf: () => ({ min: 1500, t: now }), plans: { m: 1400 } }).rows[0];
  check(mine.ownListing && mine.lowest === null && mine.flag === 'hold' && /your own listing/.test(mine.why), 'positions: the lowest is your own listing: no target or stop from it');
}

// paper trades: scored at the next full scan's lowest after the cut; open until one exists
{
  const prices = { 600: rec(600, [100, 100, 100, 100, 70, 120]), 601: rec(601, [100, 100, 100, 100, 100, 70]) };
  const P = M.paper([{ t: T0 + 4 * DAY, id: 600, rule: 'dip', price: 70 }, { t: T0 + 5 * DAY, id: 601, rule: 'dip', price: 70 }], prices, 0.05);
  const done = P.trades.find((x) => x.id === 600), open = P.trades.find((x) => x.id === 601), r = P.rules.find((x) => x.rule === 'dip');
  check(done.sold === 120 && done.net === Math.round(120 * 0.95 - 70) && done.ret === +(120 * 0.95 / 70 - 1).toFixed(3) && open.ret === null, 'paper: scored at the next scan; the newest is still open');
  check(r.n === 1 && r.open === 1 && r.net === done.net && r.winShare === 1, 'paper: per rule, scored and waiting apart');
  // a second pass of the same scan, 20 min later, is not the next scan
  const sp = rec(602, [100, 100, 100, 100, 70]); sp.obs.push({ src: 'scan', t: T0 + 4 * DAY + 1200, min: 70, med: 70, qty: 3 });
  check(M.paper([{ t: T0 + 4 * DAY, id: 602, rule: 'dip', price: 70 }], { 602: sp }, 0.05).trades[0].ret === null, 'paper: a reading 20 min after the scan (its second pass) does not score it');
}

// flip profit per week, Monday 00:00 UTC
{
  const mon = Date.UTC(2026, 10, 23) / 1000;   // Monday 23 Nov 2026
  const W = M.weekly([{ sold: mon + 3600, profit: 100, paid: 10 }, { sold: mon + 6 * DAY, profit: -20, paid: 5 }, { sold: mon - 3600, profit: 7, paid: 1 }]);
  check(W.length === 2 && W[0].week === mon && W[0].flips === 2 && W[0].profit === 80 && W[1].week === mon - 7 * DAY && W[1].profit === 7, 'weekly: flips grouped by the week they sold');
}

console.log(failed ? `\n${failed} failed` : '\nall ok');
process.exit(failed ? 1 : 0);
