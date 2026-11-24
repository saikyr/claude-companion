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

// history: one entry per scan; two readings within 10 min of each other are the same scan; none listed keeps qty 0
{
  const h = M.history({ obs: [{ src: 'scan', t: 100, min: 5, qty: 2 }, { src: 'scan', t: 300, min: 9, qty: 1 }, { src: 'browse', t: 400, min: 1, qty: 1 }, { src: 'scan', t: 5000, qty: 0 }] });
  check(h.length === 2 && h[0].min === 5 && h[1].min === null && h[1].qty === 0, 'history: one entry per full scan, browsing ignored, none listed kept');
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
  check(r && r.vendorPrice === 100 && r.relist === 199 && r.net === Math.round(199 * 0.95 - 100) && r.held === 5 && r.of === 6, 'resell: list 1c under the lowest; lowest after the cut stayed above the vendor in 5 of 6 scans');
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
  check(rowsOf(B, 'dip').length === 1 && rowsOf(B, 'dip')[0].offered && B.rows[0].rule === 'dip', 'backtest: the newest dip is offered');
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

console.log(failed ? `\n${failed} failed` : '\nall ok');
process.exit(failed ? 1 : 0);
