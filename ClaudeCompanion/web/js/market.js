// Claude Companion: the AH buy list (#115). The one place that scores what is worth buying on your AH after a
// full scan, each rule with its own evidence. Used by the Auction House tab (Buy list) and by the snapshot
// Claude reads (js/claude.js, `ah.buyList`). Pure: everything it reads is passed in.
//
// Rules, from certain to speculative:
//   vendor      listed under what a vendor pays for it: buy, sell to a vendor. Certain (the vendor price is fixed).
//   disenchant  a green, blue or purple BoE weapon or armor listed under what disenchanting it gives, at your AH's
//               prices for the materials after the AH cut. An expected value from the Classic table (labelled).
//   resell      a vendor sells it for less than your AH's lowest price after the cut: buy from the vendor, list it.
//               Evidence: in how many of the item's scans the lowest price stayed above that.
//   dip         the lowest price is 25% or more under the item's own median lowest price of its earlier scans,
//               relisted at the next scan's lowest price. Backtested on every item's scan history; offered only
//               when the backtest made money.
//   thin        3 or fewer listed, the lowest under 70% of this scan's median and under 80% of the earlier floor: buy
//               the cheapest and relist. Backtested the same way.
// For dip and thin, "you make" is what the backtest supports: the lowest times the backtest's median return, never
// the gap to the usual price. An item whose rolls (random suffixes) share its base key is left out of both.
(function (root) {
  const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
  const median = (xs) => { if (!xs.length) return null; const v = xs.slice().sort((a, b) => a - b), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  const MIN_HISTORY = 4;          // earlier scans an item needs before dip / thin can judge it
  const MIN_BACKTEST = 30;        // fired cases a speculative rule needs before it can be offered
  const SCAN_SLACK = 600;         // seconds: an observation this close to the full scan's time belongs to it
  const SCAN_GAP = 1800;          // a scan's second pass ends within this; a reading later than that is a later scan

  // an item's full-scan history, oldest first: one entry per scan, {t, min, med, qty} (qty 0 = none listed); readings
  // within 10 min of the one before belong to the same scan, and the newest of them counts
  function history(p) {
    const out = [];
    arr(p && p.obs).filter((o) => o && o.src === 'scan' && o.t).sort((a, b) => a.t - b.t).forEach((o) => {
      const last = out[out.length - 1], e = { t: o.t, min: o.qty ? o.min || null : null, med: o.qty ? o.med || o.min || null : null, qty: o.qty || 0 };
      // probable sales since the scan before (the addon compares the two scans' listings, #116)
      if (o.gap > 0 && o.sold != null) { e.sold = o.sold; e.gap = o.gap; e.soldAt = o.soldAt || null; }
      if (last && o.t - last.t < SCAN_SLACK) { e.t = last.t; out[out.length - 1] = e; return; }
      out.push(e);
    });
    return out;
  }

  // Market volume (#116): probable units sold per day, from the scans the addon compared with the scan before. A
  // listing counts as sold when it was gone before its time could run out and its seller didn't relist; pairs of
  // scans more than 12 h apart count nothing (a very long auction can run out in that time), so they are left out.
  const VOLUME_GAP = 12 * 3600;
  function volume(h) {
    const pairs = h.filter((x) => x.gap > 0 && x.gap < VOLUME_GAP && x.sold != null);
    if (!pairs.length) return null;
    const sold = pairs.reduce((a, x) => a + x.sold, 0), secs = pairs.reduce((a, x) => a + x.gap, 0);
    const at = []; pairs.forEach((x) => { if (x.sold && x.soldAt) for (let k = 0; k < Math.min(x.sold, 20); k++) at.push(x.soldAt); });
    return { sold, hours: +(secs / 3600).toFixed(1), perDay: +(sold / (secs / 86400)).toFixed(1), soldAt: median(at), pairs: pairs.length };
  }

  // the speculative rules: does it fire at scan i of a history h?
  const SPEC = {
    dip: (h, i) => {
      const cur = h[i], prev = h.slice(0, i).filter((x) => x.min);
      if (!cur.min || prev.length < MIN_HISTORY) return null;
      const usual = median(prev.map((x) => x.min));
      if (!(cur.min <= usual * 0.75)) return null;
      // falling: the last 3 earlier scans' median is 10% or more under the ones before
      const recent = median(prev.slice(-3).map((x) => x.min)), older = median(prev.slice(0, -3).map((x) => x.min));
      return { usual, earlier: prev.length, falling: older != null && recent <= older * 0.9 };
    },
    thin: (h, i) => {
      const cur = h[i], prev = h.slice(0, i).filter((x) => x.min);
      if (!cur.min || !cur.med || cur.qty > 3 || prev.length < MIN_HISTORY) return null;
      const floor = median(prev.map((x) => x.min));
      if (!(cur.min < cur.med * 0.7 && cur.min < floor * 0.8)) return null;
      return { usual: floor, earlier: prev.length, falling: false };
    },
  };

  // the backtest of a speculative rule over every item's history: bought at the scan's lowest price, relisted at
  // the next scan's lowest price after the AH cut; a next scan with none listed (all bought) counts as sold at the
  // buying scan's median. The deposit is left out: it comes back when an auction sells, which the backtest assumes
  function backtest(rule, hists, cut) {
    const ret = [];
    hists.forEach((h) => {
      for (let i = 0; i < h.length - 1; i++) {
        const f = SPEC[rule](h, i);
        if (!f) continue;
        const next = h[i + 1], sell = next.min || h[i].med;
        if (!sell) continue;
        ret.push((sell * (1 - cut)) / h[i].min - 1);
      }
    });
    const n = ret.length, med = median(ret);
    return { n, medianReturn: med == null ? null : +med.toFixed(3), winShare: n ? +(ret.filter((r) => r > 0).length / n).toFixed(2) : null };
  }

  // The market index (#117): per price band, how the lowest price of every item listed at both moved from the
  // full scan before to the newest. Banded by the item's lowest at the scan before. A band is falling when at least
  // 10 items moved, the median change is below 0 and 60% or more got cheaper.
  const BANDS = [['<1g', 0, 10000], ['1-5g', 10000, 50000], ['5-20g', 50000, 200000], ['20g+', 200000, Infinity]];
  const bandOf = (c) => (BANDS.find(([, lo, hi]) => c >= lo && c < hi) || BANDS[0])[0];
  function index(hists, lastScan, skip) {
    if (!lastScan || !lastScan.t) return null;
    const ls = lastScan.t;
    // the full scans: every reading's time, split where 30 minutes pass with none (a scan and its second pass are one)
    const ts = [...new Set([].concat(...hists.map((h) => h.map((x) => x.t))))].filter((t) => t < ls - SCAN_SLACK).sort((a, b) => a - b);
    if (!ts.length) return { scan: ls, prev: null, bands: [], byItem: new Map() };
    let start = ts[ts.length - 1];
    for (let k = ts.length - 2; k >= 0 && start - ts[k] <= SCAN_GAP; k--) start = ts[k];
    const prevT = start, prevEnd = ts[ts.length - 1];
    const by = {}, byItem = new Map();
    hists.forEach((h, ix) => {
      if (skip && skip(ix)) return;
      const cur = h[h.length - 1], prev = h.slice(0, -1).reverse().find((x) => x.t >= prevT && x.t <= prevEnd);
      if (!cur || cur.t < ls - SCAN_SLACK || !cur.min || !prev || !prev.min) return;
      const b = bandOf(prev.min);
      (by[b] || (by[b] = [])).push(cur.min / prev.min - 1);
      byItem.set(ix, b);
    });
    const bands = BANDS.map(([b]) => {
      const ch = by[b] || [], n = ch.length, med = median(ch), cheaper = ch.filter((x) => x < 0).length;
      return { band: b, n, medianChange: med == null ? null : +med.toFixed(3), cheaper, dearer: ch.filter((x) => x > 0).length,
        falling: n >= 10 && med < 0 && cheaper / n >= 0.6 };
    });
    return { scan: ls, prev: prevT, prevEnd, bands, byItem };
  }

  // ctx: { prices, lastScan, cut, now, vendorBuy(id) (what a vendor sells it for), vendorSell(id) (what a vendor pays),
  //        item(id) -> {name, q, ilvl, bind, cls} | null, deValue(item) -> {value, missing[]} | null,
  //        hasEnchanting, sellShare(name) -> share | null }
  function buyList(ctx) {
    const cut = ctx.cut == null ? 0.05 : ctx.cut, ls = ctx.lastScan;
    const out = { scan: ls ? ls.t : null, rules: [], rows: [], index: null };
    if (!ls || !ls.t) return out;
    const all = Object.entries(ctx.prices || {}).filter(([, p]) => p && p.id);
    // one key per item; random rolls have their own keys, and their base key mixes every roll's prices
    const rolled = new Set(all.filter(([k]) => String(k).includes(':')).map(([, p]) => p.id));
    const entries = all.filter(([k]) => !String(k).includes(':'));
    const hists = entries.map(([, p]) => history(p));
    const plain = hists.filter((h, ix) => !rolled.has(entries[ix][1].id));
    const bt = { dip: backtest('dip', plain, cut), thin: backtest('thin', plain, cut) };
    const ix = index(hists, ls, (i) => rolled.has(entries[i][1].id)), falling = new Set(ix ? ix.bands.filter((b) => b.falling).map((b) => b.band) : []);
    out.index = ix && { scan: ix.scan, prev: ix.prev, prevEnd: ix.prevEnd, bands: ix.bands };
    const offered = (r) => bt[r].n >= MIN_BACKTEST && bt[r].medianReturn > 0;
    out.rules = [
      { id: 'vendor', name: 'Under the vendor price', evidence: 'certain: a vendor pays a fixed price', offered: true },
      { id: 'disenchant', name: 'Under its disenchant value', evidence: 'expected value, Classic disenchant table (not measured on Forever)', offered: !!ctx.hasEnchanting },
      { id: 'resell', name: 'A vendor sells it for less', evidence: "the item's own scans: how often the lowest price stayed above the vendor's", offered: true },
      { id: 'dip', name: "25% under the item's usual lowest price", backtest: bt.dip, offered: offered('dip') },
      { id: 'thin', name: 'Few listed, far under the rest', backtest: bt.thin, offered: offered('thin') },
    ];
    entries.forEach(([key, p], i) => {
      const h = hists[i], cur = h[h.length - 1];
      if (!cur || !cur.min || cur.t < ls.t - SCAN_SLACK) return;   // not listed in the newest full scan (its second pass ends later)
      const it = ctx.item(p.id) || {}, name = p.name || it.name || '#' + p.id;
      const band = ix && ix.byItem.has(i) ? ix.byItem.get(i) : bandOf(cur.min), vol = volume(h);
      const row = (rule, buyUnder, relist, net, extra) => out.rows.push(Object.assign({ rule, id: p.id, name, listed: cur.qty, lowest: cur.min, buyUnder: Math.round(buyUnder),
        relist: relist == null ? null : Math.round(relist), net: Math.round(net), scans: h.length, sellShare: ctx.sellShare ? ctx.sellShare(name) : null, volume: vol,
        // a rule that holds the item to resell it, in a falling band: sell at the next scan, don't hold
        band, dontHold: rule !== 'vendor' && rule !== 'disenchant' && falling.has(band) }, extra || {}));
      const vs = ctx.vendorSell(p.id);
      if (vs && cur.min < vs) row('vendor', vs - 1, null, vs - cur.min, { sellTo: 'vendor' });
      if (it.bind === 2 && (it.cls === 2 || it.cls === 4) && it.q >= 2 && it.q <= 4 && ctx.deValue) {
        const de = ctx.deValue(it);
        if (de && !de.missing.length && de.value) {
          const worth = de.value * (1 - cut);
          if (cur.min < worth) row('disenchant', worth, null, worth - cur.min, { deValue: de.value, label: 'Classic disenchant table' });
        }
      }
      const vb = ctx.vendorBuy(p.id);
      if (vb && vb < cur.min * (1 - cut)) {
        // evidence from the earlier scans only: the newest passes by definition
        const listedScans = h.slice(0, -1).filter((x) => x.min), held = listedScans.filter((x) => x.min * (1 - cut) > vb).length;
        row('resell', vb, cur.min - 1, (cur.min - 1) * (1 - cut) - vb, { vendorPrice: vb, held, of: listedScans.length });
      }
      if (!rolled.has(p.id)) ['dip', 'thin'].forEach((r) => {
        const f = SPEC[r](h, h.length - 1);
        // buy under: break-even if it sells at its usual lowest; you make: the backtest's median return on this price
        if (f) row(r, f.usual * (1 - cut), f.usual, bt[r].medianReturn == null ? 0 : cur.min * bt[r].medianReturn, { usual: Math.round(f.usual), earlier: f.earlier, falling: f.falling, unitOnly: true });
      });
    });
    // how far apart the scans are: probable sales need two scans less than 12 h apart
    out.cadence = { compared: ls.compared || null, gapHours: ls.compared ? +((ls.t - ls.compared) / 3600).toFixed(1) : null, measures: !!(ls.compared && ls.t - ls.compared < VOLUME_GAP) };
    out.volume = entries.map(([, p], i) => { const v = volume(hists[i]); return v && Object.assign({ id: p.id, name: p.name || '#' + p.id }, v); })
      .filter((v) => v && v.sold > 0).sort((a, b) => b.perDay - a.perDay);
    out.rows.forEach((r) => { r.offered = (out.rules.find((x) => x.id === r.rule) || {}).offered; });
    const ORDER = { vendor: 0, disenchant: 1, resell: 2, dip: 3, thin: 4 };
    out.rows.sort((a, b) => (b.offered - a.offered) || ORDER[a.rule] - ORDER[b.rule] || b.net - a.net);
    return out;
  }

  // Open positions (#117): each open flip against your AH now and your own rules. ctx: { open[] (flipsOf().open:
  // id, item, t, units, paid), now, cut, lowestOf(name) -> {min, t} | {none, t} | null, plans {flipId: planned sell
  // price per unit}, rules {holdDays, stopPct, capItem, capTotal}, gold (copper on hand, or null) }.
  // sell now: held longer than holdDays, or the lowest fell stopPct% or more under what you paid per unit.
  // at target: the lowest reached your planned sell price. Unrealised = the lowest after the cut, times units, minus paid.
  const RULES = { holdDays: 3, stopPct: 15, capItem: 10, capTotal: 50 };
  function positions(ctx) {
    const R = Object.assign({}, RULES, ctx.rules || {}), cut = ctx.cut == null ? 0.05 : ctx.cut, now = ctx.now;
    const rows = arr(ctx.open).map((o) => {
      const unit = o.paid / (o.units || 1), age = (now - o.t) / 86400, lo = ctx.lowestOf ? ctx.lowestOf(o.item) : null;
      const target = (ctx.plans || {})[o.id] || null, stopAt = Math.round(unit * (1 - R.stopPct / 100));
      // the AH's lowest may be your own listing of this flip: then it says nothing about the market
      const mine = o.listedAt != null ? Math.round(o.listedAt / (o.units || 1)) : null;
      const own = lo && !lo.none && mine != null && Math.abs(lo.min - mine) <= 1;
      const lowest = lo && !lo.none && !own ? lo.min : null;
      const unrealised = lowest == null ? null : Math.round(lowest * (1 - cut) * o.units - o.paid);
      let flag = 'hold', why = `held ${age.toFixed(1)} of ${R.holdDays} days`;
      if (age > R.holdDays) { flag = 'sell'; why = `held ${age.toFixed(1)} days, past your ${R.holdDays}`; }
      else if (lowest != null && lowest <= stopAt) { flag = 'sell'; why = `lowest is ${Math.round((1 - lowest / unit) * 100)}% under what you paid (your stop: ${R.stopPct}%)`; }
      else if (lowest != null && target && lowest >= target) { flag = 'target'; why = 'the lowest reached your planned price'; }
      else if (lowest == null) why += own ? '; the lowest is your own listing' : lo && lo.none ? '; none listed at the last scan' : '; no AH price';
      return { id: o.id, item: o.item, t: o.t, units: o.units, paid: o.paid, unit: Math.round(unit), ageDays: +age.toFixed(1), lowest, priceAt: lo ? lo.t : null, ownListing: own,
        unrealised, target, stopAt, flag, why };
    });
    const capital = rows.reduce((a, r) => a + r.paid, 0);
    // limits are per item: every open purchase of the same item together
    const perItem = {};
    rows.forEach((r) => { perItem[r.item] = (perItem[r.item] || 0) + r.paid; });
    const big = Object.entries(perItem).reduce((a, [item, paid]) => (!a || paid > a.paid ? { item, paid } : a), null);
    const gold = ctx.gold == null ? null : ctx.gold, share = (x) => (gold ? +(x / gold).toFixed(3) : null);
    const totals = { capital, unrealised: rows.some((r) => r.unrealised != null) ? rows.reduce((a, r) => a + (r.unrealised || 0), 0) : null,
      priced: rows.filter((r) => r.unrealised != null).length,
      gold, totalShare: share(capital), largest: big ? { item: big.item, paid: big.paid, share: share(big.paid) } : null };
    totals.overItem = Object.entries(perItem).filter(([, paid]) => gold && paid / gold > R.capItem / 100).map(([item]) => item);
    totals.overTotal = !!(gold && capital / gold > R.capTotal / 100);
    return { rules: R, rows: rows.sort((a, b) => ({ sell: 0, target: 1, hold: 2 }[a.flag] - { sell: 0, target: 1, hold: 2 }[b.flag]) || b.paid - a.paid), totals };
  }

  // Paper trades (#117): dip and thin rows you marked (the rules that resell on the AH, before they are shown), scored the way the backtest scores a case: bought at that scan's
  // lowest, sold at the next full scan's lowest after the cut (none listed then: that scan's median). Until a later
  // scan exists a trade is open. trades[] {t (the scan), id, rule, price}; prices = the AH price records.
  function paper(trades, prices, cut) {
    cut = cut == null ? 0.05 : cut;
    const hist = {};
    Object.entries(prices || {}).forEach(([k, p]) => { if (p && p.id && !String(k).includes(':')) hist[p.id] = history(p); });
    const list = arr(trades).map((tr) => {
      const h = hist[tr.id] || [], at = h.find((x) => Math.abs(x.t - tr.t) <= SCAN_SLACK), next = h.find((x) => x.t > tr.t + SCAN_GAP);
      const sell = next ? next.min || (at && at.med) || null : null;
      return Object.assign({}, tr, { sold: sell, soldAt: next ? next.t : null, ret: sell ? +((sell * (1 - cut)) / tr.price - 1).toFixed(3) : null,
        net: sell ? Math.round(sell * (1 - cut) - tr.price) : null });
    });
    const rules = {};
    list.forEach((x) => {
      const r = rules[x.rule] || (rules[x.rule] = { rule: x.rule, n: 0, open: 0, rets: [], net: 0 });
      if (x.ret == null) { r.open++; return; }
      r.n++; r.rets.push(x.ret); r.net += x.net;
    });
    return { trades: list.sort((a, b) => b.t - a.t), rules: Object.values(rules).map((r) => ({ rule: r.rule, n: r.n, open: r.open, net: r.net,
      medianReturn: r.n ? +median(r.rets).toFixed(3) : null, winShare: r.n ? +(r.rets.filter((x) => x > 0).length / r.n).toFixed(2) : null })) };
  }

  // Flip profit per week (Monday 00:00 UTC), newest first: flipsOf().done
  function weekly(done) {
    const by = {};
    arr(done).forEach((f) => {
      if (!f || !f.sold) return;
      const d = new Date(f.sold * 1000), back = (d.getUTCDay() + 6) % 7;
      const wk = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back) / 1000;
      const w = by[wk] || (by[wk] = { week: wk, flips: 0, profit: 0, paid: 0 });
      w.flips++; w.profit += f.profit || 0; w.paid += f.paid || 0;
    });
    return Object.values(by).sort((a, b) => b.week - a.week);
  }

  const api = { buyList, history, backtest, index, volume, VOLUME_GAP, positions, paper, weekly, BANDS, RULES, MIN_BACKTEST, MIN_HISTORY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CCMarket = api;
})(typeof window !== 'undefined' ? window : globalThis);
