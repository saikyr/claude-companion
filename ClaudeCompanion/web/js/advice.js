// Claude Companion: item advice. One engine looks at every item you own (worn, bags, bank) once
// for each of your specs, with that spec's weights (js/weights.js) and the gear it is compared
// with (js/gear.js baseline). Everything that says something about an item reads from here:
//   - Bags & Bank: a quiet mark on the item and the verdict in its tooltip
//   - Character: a soft ring on the slot an item in your bags would upgrade
//   - Gear: "Best from what you own" per spec, which two rings and which two trinkets included
//   - Claude snapshot: the same verdicts as data
// The words, colours and marks are the app's shared vocabulary: docs/ui-language.md.
(function () {
  'use strict';
  const CC = window.CC, W = window.CCWeights;
  if (!CC || !CC.api || !W) return;
  const A = CC.api, esc = A.esc, arr = A.arr;

  // ---------------------------------------------------------------- vocabulary
  // flag -> [mark class, short word, tooltip colour]. Keep has no mark: keeping is the default.
  const FLAG = {
    up: ['up', 'Upgrade', '4fc38a'],
    keep: [null, 'Keep', 'a3a4ad'],
    ask: ['ask', 'Keep, ask', 'e9a23b'],
    de: ['de', 'Disenchant', 'c99bff'],
    ah: ['ah', 'Auction House', 'e2c15a'],
    sell: ['sell', 'Vendor', 'c0c4cc'],
  };
  const ORDER = ['up', 'de', 'ah', 'sell', 'ask'];
  // the equip location string the game saves -> inventory type number (warcraft.wiki.gg ItemEquipLoc)
  const INV = { INVTYPE_HEAD: 1, INVTYPE_NECK: 2, INVTYPE_SHOULDER: 3, INVTYPE_BODY: 4, INVTYPE_CHEST: 5, INVTYPE_ROBE: 20, INVTYPE_WAIST: 6,
    INVTYPE_LEGS: 7, INVTYPE_FEET: 8, INVTYPE_WRIST: 9, INVTYPE_HAND: 10, INVTYPE_FINGER: 11, INVTYPE_TRINKET: 12, INVTYPE_WEAPON: 13,
    INVTYPE_SHIELD: 14, INVTYPE_RANGED: 15, INVTYPE_CLOAK: 16, INVTYPE_2HWEAPON: 17, INVTYPE_TABARD: 19, INVTYPE_WEAPONMAINHAND: 21,
    INVTYPE_WEAPONOFFHAND: 22, INVTYPE_HOLDABLE: 23, INVTYPE_THROWN: 25, INVTYPE_RANGEDRIGHT: 26, INVTYPE_RELIC: 28 };
  // Disenchanting skill needed by item level: data/rules.js (Classic numbers, not checked on Forever)
  const DE_RULES = (window.GAMERULES || {}).disenchant || {};
  const deSkill = (it) => (it.q === 4 ? DE_RULES.epicSkill : ((arr(DE_RULES.skill).find(([lv]) => it.ilvl <= lv) || [0, 300])[1]));
  // a sidegrade this close to what a spec uses is never sold off without asking
  const CLOSE = 0.95;

  const snap = () => (A.CH && A.CH.snap) || {};
  const char = () => snap().character || {};
  const tipText = (it) => arr(it && it.tip).map((l) => (l && l.l) || '').join('\n');
  const invOf = (it) => INV[it.loc] || ((A.gdItem(it.id) || [])[4]) || 0;
  // Use / proc / non-stat Equip effects (trinkets, Chance on hit) aren't in the score
  const EFFECT = /(?:^|\n)(Use: |Chance on hit: |Equip: [^\n]*(\bchance\b|When struck|Has a \d))/i;
  const effectOf = (id) => { const mine = A.byId(id); const t = mine ? tipText(mine) : arr((A.gdItem(id) || [])[10]).join('\n'); return EFFECT.test(t); };
  const skill = (name) => { const r = arr(snap().skills).find((x) => x && x.name === name); return r ? r.rank : 0; };

  // ---------------------------------------------------------------- what you own
  function owned() {
    const out = [];
    arr(snap().equipped).forEach((e) => e && e.item && out.push({ key: e.item, where: 'worn', slot: e.slot, count: 1 }));
    arr(snap().bags).forEach((b) => arr(b.items).forEach((x) => x && x.item && out.push({ key: x.item, where: 'bags', bag: b.id, slot: x.slot, count: x.count || 1, bound: x.bound, noValue: x.noValue })));
    arr((A.CH.bank || {}).bags).forEach((b) => arr(b.items).forEach((x) => x && x.item && out.push({ key: x.item, where: 'bank', bag: b.id, slot: x.slot, count: x.count || 1, bound: x.bound, noValue: x.noValue })));
    return out;
  }
  const statsOf = (key) => { const it = A.item(key); return it && it.stats ? W.fromGame(it.stats, it.tip) : W.fromPack(A.gdItem(it ? it.id : null)); };

  // ---------------------------------------------------------------- per spec
  // can this character wear it (armor / weapon skill, class line), and from which level
  function wearable(it, use) {
    if (!(it.class === 2 || it.class === 4) || !use) return false;
    const inv = invOf(it);
    if (!inv || inv === 4 || inv === 19) return false;                       // shirts and tabards carry no stats
    if (!(use[it.class] || []).includes(it.subclass)) return false;
    if (inv === 22 && !use.dual) return false;                               // an off-hand weapon needs Dual Wield
    const cls = /(?:^|\n)Classes: ([^\n]+)/.exec(tipText(it));
    if (cls && !cls[1].includes(char().class || '')) return false;
    return true;
  }
  function specContexts() {
    const G = CC.gear;
    if (!G || !G.specs) return [];
    return G.specs().map((sp) => {
      const pk = G.profileKey(sp), w = pk && G.weightsFor(sp, pk);
      if (!w || !Object.keys(w).length) return null;
      const base = G.baseline(sp, pk);
      return { sp, pk, w, base, name: sp.tree || sp.label };
    }).filter(Boolean);
  }
  // the slot row an item goes in, and what it is measured against there
  // A one-hander with Dual Wield goes in either hand: measured in both, the bigger gain counts.
  function measure(ctx, it, st, use) {
    const inv = invOf(it);
    const rows = CC.gear.SLOTS.filter(([name, , invs]) => invs.includes(inv) && CC.gear.handFits(name, inv, use));
    const worn = ctx.base.worn;
    const wornIn = rows.find(([, slots]) => slots.some((n) => worn[n] && worn[n].id === it.id));
    if (wornIn) return measureIn(ctx, it, st, wornIn);
    const all = rows.map((row) => measureIn(ctx, it, st, row));
    return all.filter((m) => m.gain != null).sort((a, b) => b.gain - a.gain)[0] || all[0] || null;
  }
  function measureIn(ctx, it, st, row) {
    const inv = invOf(it);
    const [name, slots] = row, worn = ctx.base.worn;
    const cur = slots.map((n) => worn[n] ? { n, id: worn[n].id, st: worn[n].st, s: W.score(worn[n].st, ctx.w, n, worn[n].st) } : { n, id: null, s: 0 });
    // what it would replace, for the hit cap: itself when worn here, else the weaker of the slot's items;
    // a two-hander also frees the off hand
    const weak = cur.reduce((a, c) => (c.s < a.s ? c : a), cur[0]);
    const mh = worn[16], oh = worn[17];
    const own = cur.find((c) => c.id && c.id === it.id && W.sameSt(c.st, st));
    const repl = own ? own.st : name === 'Main hand' && inv === 17 && oh ? W.addSt(weak && weak.st, oh.st) : weak && weak.st;
    const s = W.score(st, ctx.w, name, repl);
    if (own) return { row: name, s, gain: 0, same: true };
    const twoHandWorn = !!mh && CC.gear.wornInv(mh) === 17;
    if (name === 'Off hand' && twoHandWorn) return { row: name, s, gain: null, blocked: 'you use a two-hander' };
    // a two-hander replaces the main hand and the off hand; a set bonus it makes or breaks counts (the Gear tab's
    // own rule, gear.js setDelta), and in a ring or trinket row it replaces whichever gives the bigger gain
    const withOh = name === 'Main hand' && inv === 17 && oh;
    const ohS = withOh ? W.score(oh.st, ctx.w, 17, oh.st) : 0;
    const opt = cur.map((c) => {
      const sd = CC.gear.setDelta ? CC.gear.setDelta(ctx.w, worn, it.id, [c.id].concat(withOh ? [oh.id] : [])) : { d: 0 };
      return { vs: c, sd, g: s - c.s - ohS + sd.d };
    }).reduce((a, o) => (o.g > a.g ? o : a));
    const vs = opt.vs, sd = opt.sd;
    const base = vs.s + ohS;
    return { row: name, s, base, gain: s - base + sd.d, setBonus: sd.d ? +sd.d.toFixed(1) : undefined, vs, also: withOh ? oh.id : null, target: vs.n, effect: effectOf(it.id) || (vs.id ? effectOf(vs.id) : false) };
  }

  // ---------------------------------------------------------------- values
  function values(o, it) {
    const v = { vendor: 0, ah: null, de: null, deMats: null, deNeeds: null };
    if (!o.noValue && it.sell) v.vendor = it.sell * o.count;
    if (!o.bound && it.bind !== 1 && it.bind !== 4) { const p = A.planPrice(it.id); if (p) v.ah = Math.round(p * 0.95) * o.count; }
    const ench = skill('Enchanting');
    if (ench && (it.class === 2 || it.class === 4) && it.q >= 2 && it.q <= 4 && A.deOutcome) {
      const need = deSkill(it);
      const de = A.deOutcome(it);
      if (de && ench >= need) { v.de = de.missing.length < de.mats.length ? de.value : null; v.deMats = de.mats; }
      else if (de) v.deNeeds = need;
    }
    return v;
  }

  // ---------------------------------------------------------------- verdicts
  let CACHE = null;
  // the Gear tab's "Compare with" picks change what each spec is measured against
  function setPicks() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^cc\.gear\.set\./.test(k)) out.push(k + '=' + localStorage.getItem(k)); }
    return out.sort().join(',');
  }
  function cacheKey() {
    const picks = (CC.gear && CC.gear.specs ? CC.gear.specs().map((sp) => CC.gear.profileKey(sp)) : []).join(',');
    return [snap().taken, (A.CH.bank || {}).taken, ((A.CH.ah || {}).lastScan || {}).t, picks, localStorage.getItem('cc.weights.v1') || '', setPicks()].join('|');
  }
  function compute() {
    const ck = cacheKey();
    if (CACHE && CACHE.ck === ck && CACHE.CH === A.CH) return CACHE;
    const use = CC.gear && CC.gear.canUse ? CC.gear.canUse() : null;
    const ctxs = specContexts();
    const lvl = char().level || 0;
    const inSet = {};
    arr(snap().gearSets).forEach((g) => arr(g.items).forEach((x) => { if (x && x.id > 0) (inSet[x.id] = inSet[x.id] || []).push(g.name); }));
    const byKey = {};
    const list = owned();
    list.forEach((o) => {
      if (byKey[o.key] && o.where !== 'worn') { byKey[o.key].where.push(o.where); return; }
      const it = A.item(o.key);
      const v = { key: o.key, where: [o.where], flag: null, words: '', why: '', specs: [], value: null };
      byKey[o.key] = v;
      if (!it || !it.name) { v.flag = 'ask'; v.words = 'Keep, ask'; v.why = 'The game hadn\'t loaded this item when it saved: Sync again.'; return; }
      v.id = it.id; v.name = it.name;
      const tip = tipText(it);
      const gear = wearable(it, use);
      const st = gear || it.class === 2 || it.class === 4 ? statsOf(o.key) : null;
      if (st) {
        ctxs.forEach((c) => {
          const m = measure(c, it, st, use);
          if (m) v.specs.push(Object.assign({ spec: c.sp.i, name: c.name, set: c.base.label, can: gear, later: gear && it.req > lvl ? it.req : null }, m));
        });
      }
      v.value = values(o, it);
      if (o.where === 'worn') { v.flag = null; v.words = 'Worn'; return; }
      // things that are never sold off
      if (it.class === 12 || it.bind === 4 || /(?:^|\n)(Quest Item|This Item Begins a Quest)/.test(tip)) { v.flag = 'keep'; v.words = /\bKey\b/.test(it.name) ? 'Keep: key' : 'Keep: quest item'; v.why = 'Quest items, rep turn-ins and dungeon shortcuts are never flagged to sell.'; return; }
      if (it.class === 13) { v.flag = 'keep'; v.words = 'Keep: key'; return; }
      if (it.q >= 5) { v.flag = 'keep'; v.words = 'Keep: legendary'; return; }
      if (inSet[it.id]) { v.flag = 'keep'; v.words = `Keep: in your ${inSet[it.id].join(', ')} set`; return; }
      if (it.class === 2 && (it.subclass === 20 || it.subclass === 14)) { v.flag = 'keep'; v.words = 'Keep: profession tool'; return; }
      if ((it.class === 2 || it.class === 4) && [4, 19].includes(invOf(it))) { v.flag = 'keep'; v.words = 'Keep: shirt or tabard'; return; }
      const ups = v.specs.filter((s) => s.can && s.gain > 0.5);
      const now = ups.filter((s) => !s.later), later = ups.filter((s) => s.later);
      // an effect the score can't count (a trinket's Use, a proc) on either side: say so, don't decide
      const unsure = now.filter((s) => s.effect);
      if (now.length && unsure.length === now.length) { v.flag = 'ask'; v.words = 'Keep, ask'; v.why = `Scores higher for ${unsure.map((s) => s.name).join(' and ')}, but a Use or proc effect isn't counted (this item's or ${A.anyItemName(unsure[0].vs.id)}'s).`; return; }
      if (now.length) { v.flag = 'up'; v.words = 'Upgrade for ' + now.map((s) => s.name).join(' and '); return; }
      if (later.length) { v.flag = 'up'; v.later = later[0].later; v.words = `Upgrade at level ${later[0].later} for ` + later.map((s) => s.name).join(' and '); return; }
      const close = v.specs.filter((s) => s.can && s.gain != null && s.base > 0 && s.s >= s.base * CLOSE);
      if (close.length) { v.flag = 'ask'; v.words = 'Keep, ask'; v.why = `Almost as good as what ${close[0].name} uses: ${close[0].s.toFixed(1)} vs ${close[0].base.toFixed(1)}.`; return; }
      // the rest: what it is worth, best way first
      const isGear = it.class === 2 || it.class === 4;
      if (!isGear && it.q !== 0) return;                                     // trade goods, consumables, recipes: no advice
      const val = v.value;
      const opts = [['de', val.de], ['ah', val.ah], ['sell', val.vendor]].filter(([, x]) => x > 0).sort((a, b) => b[1] - a[1]);
      if (!opts.length) {
        if (isGear) { v.flag = 'ask'; v.words = 'Keep, ask'; v.why = val.deNeeds ? `Needs Enchanting ${val.deNeeds} to disenchant, and no price is known.` : 'No vendor, AH or disenchant value known.'; }
        return;
      }
      const [best, amt] = opts[0];
      v.flag = best;
      v.words = best === 'de' ? 'Disenchant' : best === 'ah' ? 'Sell on the Auction House' : 'Sell to a vendor';
      v.amount = amt;
      if (!isGear) v.why = 'Grey item.';
      else if (!gear) v.why = 'You can\'t use this.';
      else v.why = 'Not an upgrade for any of your specs.';
    });
    CACHE = { ck, CH: A.CH, byKey, ctxs, list, use };
    return CACHE;
  }

  // ---------------------------------------------------------------- best from what you own
  // Per spec: the best items you have for each slot (two for rings and trinkets, a two-hander or
  // a main hand plus off hand), next to what that spec's set uses.
  function bestOwned(spec) {
    const C = compute();
    const ctx = C.ctxs.find((c) => c.sp.i === spec.i);
    if (!ctx) return null;
    const lvl = char().level || 0;
    // every instance you own that this spec can wear now, with its score
    const seen = new Set();
    const pool = [];
    C.list.forEach((o) => {
      const it = A.item(o.key);
      if (!it || !wearable(it, C.use) || it.req > lvl) return;
      const tag = o.key + '@' + o.where + (o.bag != null ? o.bag + ':' + o.slot : o.slot);
      if (seen.has(tag)) return; seen.add(tag);
      const st = statsOf(o.key);
      // scored where it would be worn: weapon DPS counts per hand (W.dpsWeight)
      pool.push({ o, it, inv: invOf(it), st, s: W.score(st, ctx.w), unique: /(?:^|\n)Unique/.test(tipText(it)) });
    });
    const worn = ctx.base.worn;
    const baseScore = (n) => (worn[n] ? W.score(worn[n].st, ctx.w, n, worn[n].st) : 0);
    // scored in place of what the compared gear has there (the first of a pair), so hit counts up to the cap
    const slotNums = Object.fromEntries(CC.gear.SLOTS.map(([name, nums]) => [name, nums]));
    // in place of: itself when it's worn in that slot, else the weaker worn item there (a two-hander: both hands)
    const replIn = (p, slot) => {
      const nums = slotNums[slot] || [];
      const own = nums.find((n) => worn[n] && worn[n].id === p.it.id && W.sameSt(worn[n].st, p.st));
      if (own != null) return worn[own].st;
      const there = nums.map((n) => worn[n]);
      const weak = there.some((x) => !x) ? null : there.reduce((a, x) => (baseScore0(x, slot) < baseScore0(a, slot) ? x : a));
      const st = weak ? weak.st : null;
      return slot === 'Main hand' && p.inv === 17 && worn[17] ? W.addSt(st, worn[17].st) : st;
    };
    const baseScore0 = (x, slot) => W.score(x.st, ctx.w, slot, x.st);
    const inSlot = (p, slot) => Object.assign({}, p, { s: W.score(p.st, ctx.w, slot, replIn(p, slot)) });
    const pick = (invs, n, slot) => {
      const out = [], ids = new Set();
      pool.filter((p) => invs.includes(p.inv)).map((p) => inSlot(p, slot)).sort((a, b) => b.s - a.s).forEach((p) => {
        if (out.length >= n || (p.unique && ids.has(p.it.id))) return;
        out.push(p); ids.add(p.it.id);
      });
      return out;
    };
    const rows = [];
    CC.gear.SLOTS.forEach(([name, slots, invs]) => {
      if (name === 'Main hand' || name === 'Off hand') return;
      const best = pick(invs, slots.length, name);
      const now = slots.map((n) => worn[n] ? { id: worn[n].id, s: baseScore(n) } : null);
      rows.push({ name, best, now, gain: best.reduce((a, p) => a + p.s, 0) - now.reduce((a, x) => a + (x ? x.s : 0), 0) });
    });
    // weapons: the better of a two-hander or a main hand + off hand
    // with Dual Wield the off hand can be a second one-hander (another copy, or a unique item only once)
    const two = pick([17], 1, 'Main hand')[0], mh = pick([13, 21], 1, 'Main hand')[0];
    const ohInvs = C.use && C.use.dual ? [23, 14, 22, 13] : [23, 14];
    const oh = pool.filter((p) => ohInvs.includes(p.inv) && !(mh && p.o === mh.o) && !(mh && p.unique && p.it.id === mh.it.id)).map((p) => inSlot(p, 'Off hand')).sort((a, b) => b.s - a.s)[0];
    const pair = (mh ? mh.s : 0) + (oh ? oh.s : 0);
    const best = two && two.s >= pair ? [two] : [mh, oh].filter(Boolean);
    const now = [16, 17].map((n) => worn[n] ? { id: worn[n].id, s: baseScore(n) } : null);
    rows.push({ name: 'Weapons', best, now, gain: best.reduce((a, p) => a + p.s, 0) - now.reduce((a, x) => a + (x ? x.s : 0), 0) });
    return { spec, ctx, rows };
  }

  // ---------------------------------------------------------------- any item, owned or not
  // The same per-spec score for an item you don't own: quest rewards, chain rewards, drops. An owned
  // item (its key, "item:..."), or an item id read from the game-data pack. Rewards, the Quest log and
  // the Claude snapshot all rate items here, so nothing scores gear a second way.
  function asItem(x) {
    if (typeof x === 'string' && A.item(x)) { const it = A.item(x); return { it, st: statsOf(x) }; }
    const id = Number(String(x).replace(/^item:/, '').split(':')[0]);
    const g = A.gdItem(id);
    if (!g) return null;
    return { it: { id, name: g[0], q: g[1], class: g[9], subclass: CC.gear && CC.gear.packSub ? CC.gear.packSub(g) : g[12], req: g[3] || 0, tip: arr(g[10]).map((l) => ({ l })) }, st: W.fromPack(g) };
  }
  function rate(x) {
    const r = asItem(x);
    if (!r || !(r.it.class === 2 || r.it.class === 4)) return null;
    const C = compute(), can = wearable(r.it, C.use), lvl = char().level || 0;
    const out = C.ctxs.map((c) => {
      const m = measure(c, r.it, r.st, C.use);
      return m && { spec: c.name, comparedWith: c.base.label, slot: m.row, score: +m.s.toFixed(1), gain: m.gain == null ? null : +m.gain.toFixed(1),
        vs: m.vs && m.vs.id ? { id: m.vs.id, name: A.anyItemName(m.vs.id) } : null, same: !!m.same, blocked: m.blocked || null,
        canWear: can, level: can && r.it.req > lvl ? r.it.req : null, effect: !!m.effect, setBonus: m.setBonus || null };
    }).filter(Boolean);
    return { id: r.it.id, name: r.it.name, specs: out };
  }
  // one line for a reward: which specs it upgrades, by how much ("Holy +3.2 · Shadow +0.8")
  function rewardLine(x) {
    const r = rate(x);
    if (!r) return '';
    const ups = r.specs.filter((s) => s.canWear && s.gain > 0.5);
    if (!ups.length) return '';
    return `<span class="pos small" title="Score gain over the gear each spec is compared with (Gear tab). Use and proc effects aren't counted.">${esc(r.name)}: ${ups.map((s) => `${esc(s.spec)} +${s.gain.toFixed(1)}${s.level ? ' at ' + s.level : ''}${s.effect ? '*' : ''}`).join(' · ')}</span>`;
  }

  // ---------------------------------------------------------------- views
  const whereWord = { worn: 'worn', bags: 'in your bags', bank: 'in your bank' };
  function bestOwnedHTML(spec) {
    const b = bestOwned(spec);
    if (!b) return '';
    const changes = b.rows.filter((r) => r.gain > 0.5);
    let h = `<h2>Best from what you own</h2><p class="meta">For ${esc(b.ctx.name)} with ${esc((W.get(b.ctx.pk) || {}).name || '')} weights, compared with ${esc(b.ctx.base.label)}. Use and proc effects (“+ effect”) aren't in the score. ${changes.length ? `${changes.length} slot${changes.length === 1 ? '' : 's'} can do better with items you already have.` : 'Nothing you own does better.'}</p>`;
    h += '<div class="table ownbest"><div class="thead"><div>Slot</div><div>Best you own</div><div>In this set now</div><div class="c-num">Gain</div></div>';
    b.rows.forEach((r) => {
      const fx = (id) => (effectOf(id) ? ' <span class="dim" title="Its Use or proc effect isn\'t in the score">+ effect</span>' : '');
      const cell = (p) => `<div class="pick">${A.itemIcon(p.o.key, { size: 'xs' })}<span class="q${p.it.q}" data-item="${esc(p.o.key)}">${esc(p.it.name)}</span> <span class="dim">${p.s.toFixed(1)} · ${whereWord[p.o.where]}</span>${fx(p.it.id)}</div>`;
      const nowCell = (x) => (x ? `<div class="pick">${A.anyItemIcon(x.id, { size: 'xs' })}${A.itemLink(x.id)} <span class="dim">${x.s.toFixed(1)}</span>${fx(x.id)}</div>` : '<div class="pick dim">empty</div>');
      const up = r.gain > 0.5;
      h += `<div class="tr${up ? ' adv-row' : ''}"><div class="dim">${esc(r.name)}</div><div>${r.best.map(cell).join('') || '<span class="dim">nothing you can wear</span>'}</div><div>${r.now.map(nowCell).join('')}</div><div class="c-num${up ? ' pos' : ' dim'}">${up ? '+' + r.gain.toFixed(1) : '✓'}</div></div>`;
    });
    return h + '</div>';
  }

  // the verdict block at the bottom of an item's tooltip
  function tipHTML(key) {
    const C = compute(), v = C.byKey[key];
    if (!v) return '';
    const f = FLAG[v.flag] || null;
    let h = '<div class="tipsep"></div>';
    if (v.words) h += `<div class="l tipv" style="color:#${f ? f[2] : 'a3a4ad'}">${esc(v.words)}${v.amount ? ' · ≈ ' + A.money(v.amount, { short: true }) : ''}</div>`;
    if (v.why) h += `<div class="l tipx dim">${esc(v.why)}</div>`;
    v.specs.forEach((s) => {
      if (s.same) { h += `<div class="l tipx">${esc(s.name)}: ${s.s.toFixed(1)} <span class="dim">(in this spec's gear)</span></div>`; return; }
      if (s.gain == null) { h += `<div class="l tipx">${esc(s.name)}: <span class="dim">${esc(s.blocked || '')}</span></div>`; return; }
      const vsName = (s.vs && s.vs.id ? A.anyItemName(s.vs.id) : 'an empty slot') + (s.also ? ' + ' + A.anyItemName(s.also) : '');
      const g = s.gain, cls = g > 0.5 ? 'pos' : g < -0.5 ? 'neg' : 'dim';
      h += `<div class="l tipx">${esc(s.name)}: ${s.s.toFixed(1)} <span class="${cls}">${g >= 0 ? '+' : '−'}${Math.abs(g).toFixed(1)}</span> <span class="dim">vs ${esc(vsName)}${!s.can ? ' · you can\'t wear it' : s.later ? ' · level ' + s.later : ''}</span></div>`;
    });
    const val = v.value || {};
    if (val.de != null) h += `<div class="l tipx">Disenchant: ≈ ${A.money(val.de, { short: true })} <span class="dim">${esc((val.deMats || []).slice().sort((a, b) => b.ch - a.ch).map((m) => `${m.lo === m.hi ? m.lo : m.lo + '–' + m.hi} ${m.name} ${Math.round(m.ch * 100)}%`).join(', '))}</span></div>`;
    else if (val.deNeeds) h += `<div class="l tipx dim">Disenchant: needs Enchanting ${val.deNeeds}</div>`;
    return h;
  }

  // the mark on an item square: { cls, title } or null
  function markOf(key) {
    const v = compute().byKey[key];
    if (!v || !v.flag || !FLAG[v.flag][0]) return null;
    return { cls: 'adv adv-' + FLAG[v.flag][0], flag: v.flag };
  }

  // Character sheet: the slot an item you own would upgrade. The sheet shows what you wear, so it is
  // measured against what you wear, for the spec you're dressed for (the one whose gear matches most).
  let HINT = null;
  function slotHints() {
    const C = compute();
    if (HINT && HINT.C === C) return HINT.map;
    const worn = {};
    arr(snap().equipped).forEach((e) => { if (e && e.item) { const it = A.item(e.item); worn[e.slot] = { id: it ? it.id : null, st: statsOf(e.item) }; } });
    const ids = new Set(Object.values(worn).map((x) => x.id));
    const active = snap().activeSpec;
    const overlap = (c) => Object.values(c.base.worn).filter((x) => ids.has(x.id)).length;
    const ctx = C.ctxs.slice().sort((a, b) => overlap(b) - overlap(a) || (b.sp.i === active) - (a.sp.i === active))[0];
    const map = {};
    if (ctx) {
      const lvl = char().level || 0, here = Object.assign({}, ctx, { base: { worn }, w: CC.gear.weightsAgainst(ctx.w, worn) });
      C.list.forEach((o) => {
        if (o.where === 'worn') return;
        const it = A.item(o.key);
        if (!it || !wearable(it, C.use) || it.req > lvl) return;
        const m = measure(here, it, statsOf(o.key), C.use);
        if (m && m.gain > 0.5 && !m.effect && m.target && (!map[m.target] || m.gain > map[m.target].gain)) map[m.target] = { gain: m.gain, key: o.key, name: it.name, spec: ctx.name, where: o.where };
      });
    }
    HINT = { C, map };
    return map;
  }
  const slotHint = (slotNum) => slotHints()[slotNum] || null;

  // the chips above your bags: how many of each, and what they're worth
  function summary(keys) {
    const C = compute(), out = {};
    ORDER.forEach((f) => (out[f] = { n: 0, value: 0 }));
    Object.values(C.byKey).forEach((v) => { if (keys && !keys.has(v.key)) return; if (out[v.flag]) { out[v.flag].n++; out[v.flag].value += v.amount || 0; } });
    return out;
  }
  function chipsHTML(active) {
    const s = summary();
    return `<div class="chips advchips">${ORDER.map((f) => s[f].n ? `<button data-bagflag="${f}" class="${active === f ? 'on' : ''}"><i class="mk mk-${FLAG[f][0]}"></i>${FLAG[f][1]}<span>${s[f].n}${s[f].value ? ' · ' + A.money(s[f].value, { short: true }) : ''}</span></button>` : '').join('')}</div>`;
  }

  CC.advice = {
    FLAG, ORDER, compute, bestOwned, bestOwnedHTML, tipHTML, markOf, slotHint, summary, chipsHTML,
    // shared with the Gear page (js/gear.js)
    owned, wearable, statsOf, effectOf, invOf,
    // any item, owned or from the pack: quest rewards (Quest log, Claude snapshot)
    rate, rewardLine,
    // the disenchanting skill an item needs, and your rank in a skill (the AH buy list, js/market.js)
    deSkill, skill,
    of: (key) => compute().byKey[key] || null,
    // for the Claude snapshot
    snapshot() {
      const C = compute();
      return Object.values(C.byKey).filter((v) => v.flag && v.flag !== 'keep').map((v) => ({ id: v.id || null, name: v.name || null, where: [...new Set(v.where)], flag: v.flag, words: v.words, why: v.why || null,
        value: v.amount || null, specs: v.specs.filter((s) => s.gain != null && !s.same).map((s) => ({ spec: s.name, score: +s.s.toFixed(1), gain: +s.gain.toFixed(1), canWear: s.can, level: s.later || null, setBonus: s.setBonus || undefined })) }));
    },
    bestOwnedSnapshot() {
      return C_specs().map((sp) => {
        const b = bestOwned(sp);
        return b && { spec: b.ctx.name, comparedWith: b.ctx.base.label, slots: b.rows.map((r) => ({ slot: r.name, gain: +r.gain.toFixed(1),
          best: r.best.map((p) => ({ id: p.it.id, name: p.it.name, score: +p.s.toFixed(1), where: p.o.where })), now: r.now.filter(Boolean).map((x) => ({ id: x.id, name: A.anyItemName(x.id), score: +x.s.toFixed(1) })) })) };
      }).filter(Boolean);
    },
  };
  const C_specs = () => (CC.gear && CC.gear.specs ? CC.gear.specs() : []);

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-bagflag]');
    if (!b) return;
    A.STATE.bagFlag = A.STATE.bagFlag === b.dataset.bagflag ? null : b.dataset.bagflag;
    A.render();
  });
})();
