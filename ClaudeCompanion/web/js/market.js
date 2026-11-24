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
//   thin        3 or fewer listed, the lowest under 70% of this scan's median and of the earlier floor: buy out and
//               relist. Backtested the same way.
(function (root) {
  const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
  const median = (xs) => { if (!xs.length) return null; const v = xs.slice().sort((a, b) => a - b), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  const MIN_HISTORY = 4;          // earlier scans an item needs before dip / thin can judge it
  const MIN_BACKTEST = 30;        // fired cases a speculative rule needs before it can be offered
  const SCAN_SLACK = 600;         // seconds: an observation this close to the full scan's time belongs to it

  // an item's full-scan history, oldest first: one entry per scan, {t, min, med, qty} (qty 0 = none listed)
  function history(p) {
    const out = [];
    arr(p && p.obs).filter((o) => o && o.src === 'scan' && o.t).sort((a, b) => a.t - b.t).forEach((o) => {
      const last = out[out.length - 1];
      if (last && o.t - last.t < SCAN_SLACK) return;
      out.push({ t: o.t, min: o.qty ? o.min || null : null, med: o.qty ? o.med || o.min || null : null, qty: o.qty || 0 });
    });
    return out;
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
      return { usual, falling: older != null && recent <= older * 0.9 };
    },
    thin: (h, i) => {
      const cur = h[i], prev = h.slice(0, i).filter((x) => x.min);
      if (!cur.min || !cur.med || cur.qty > 3 || prev.length < MIN_HISTORY) return null;
      const floor = median(prev.map((x) => x.min));
      if (!(cur.min < cur.med * 0.7 && cur.min < floor * 0.8)) return null;
      return { usual: floor, falling: false };
    },
  };

  // the backtest of a speculative rule over every item's history: bought at the scan's lowest price, relisted at
  // the next scan's lowest price after the AH cut; a next scan with none listed counts as sold at the old median
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

  // ctx: { prices, lastScan, cut, now, vendorBuy(id) (what a vendor sells it for), vendorSell(id) (what a vendor pays),
  //        item(id) -> {name, q, ilvl, bind, cls} | null, deValue(item) -> {value, missing[]} | null,
  //        hasEnchanting, sellShare(name) -> share | null }
  function buyList(ctx) {
    const cut = ctx.cut == null ? 0.05 : ctx.cut, ls = ctx.lastScan;
    const out = { scan: ls ? ls.t : null, rules: [], rows: [] };
    if (!ls || !ls.t) return out;
    const entries = Object.entries(ctx.prices || {}).filter(([k, p]) => p && p.id && !String(k).includes(':'));   // one key per item; random rolls apart
    const hists = entries.map(([, p]) => history(p));
    const bt = { dip: backtest('dip', hists, cut), thin: backtest('thin', hists, cut) };
    const offered = (r) => bt[r].n >= MIN_BACKTEST && bt[r].medianReturn > 0;
    out.rules = [
      { id: 'vendor', name: 'Under the vendor price', evidence: 'certain: a vendor pays a fixed price', offered: true },
      { id: 'disenchant', name: 'Under its disenchant value', evidence: 'expected value, Classic disenchant table (not measured on Forever)', offered: !!ctx.hasEnchanting },
      { id: 'resell', name: 'A vendor sells it for less', evidence: "the item's own scans: how often the lowest price stayed above the vendor's", offered: true },
      { id: 'dip', name: "25% under the item's usual lowest price", backtest: bt.dip, offered: offered('dip') },
      { id: 'thin', name: 'Few listed, far under the rest', backtest: bt.thin, offered: offered('thin') },
    ];
    entries.forEach(([key, p], ix) => {
      const h = hists[ix], cur = h[h.length - 1];
      if (!cur || !cur.min || Math.abs(cur.t - ls.t) > SCAN_SLACK) return;   // not listed in the newest full scan
      const it = ctx.item(p.id) || {}, name = p.name || it.name || '#' + p.id;
      const row = (rule, buyUnder, relist, net, extra) => out.rows.push(Object.assign({ rule, id: p.id, name, listed: cur.qty, lowest: cur.min, buyUnder: Math.round(buyUnder),
        relist: relist == null ? null : Math.round(relist), net: Math.round(net), scans: h.length, sellShare: ctx.sellShare ? ctx.sellShare(name) : null }, extra || {}));
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
        const listedScans = h.filter((x) => x.min), held = listedScans.filter((x) => x.min * (1 - cut) > vb).length;
        row('resell', vb, cur.min - 1, (cur.min - 1) * (1 - cut) - vb, { vendorPrice: vb, held, of: listedScans.length });
      }
      ['dip', 'thin'].forEach((r) => {
        const f = SPEC[r](h, h.length - 1);
        if (f) row(r, cur.min, f.usual, f.usual * (1 - cut) - cur.min, { usual: Math.round(f.usual), falling: f.falling });
      });
    });
    out.rows.forEach((r) => { r.offered = (out.rules.find((x) => x.id === r.rule) || {}).offered; });
    const ORDER = { vendor: 0, disenchant: 1, resell: 2, dip: 3, thin: 4 };
    out.rows.sort((a, b) => (b.offered - a.offered) || ORDER[a.rule] - ORDER[b.rule] || b.net - a.net);
    return out;
  }

  const api = { buyList, history, backtest, MIN_BACKTEST, MIN_HISTORY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CCMarket = api;
})(typeof window !== 'undefined' ? window : globalThis);
