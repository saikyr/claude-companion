// Claude Companion: Gear page. For each spec, slot by slot: what you wear, every upgrade you can get now
// (dungeons, quests, crafting, vendors, your bags and bank, and what's listed on your Auction House,
// random-suffix greens included), a pre-BiS plan with alternatives you can pick from, and your class sets.
// Scores come from one engine (js/weights.js), shared with Bags (js/advice.js) and the Claude snapshot.
// Item data: the game-data pack (endgametools tooltips, sources from QuestieDB / ForeverDB), the
// random-suffix rolls (data/suffixes.js, foreverchanges.pro) and the game's own numbers for what you own.
(function () {
  const CC = window.CC;
  if (!CC || !CC.api || !CC.V) return;
  const A = CC.api, V = CC.V, esc = A.esc, arr = A.arr;
  const W = window.CCWeights;
  if (!W) return;
  const SFX = window.GAMEDATA_SUFFIX || null;

  // ---------------------------------------------------------------- who can wear what
  // What you can wear comes from the game: the Weapon Skills (category 6) and Armor Proficiencies (8)
  // in your skill list, mapped to item subclasses (warcraft.wiki.gg ItemType). A few labels have
  // both the Classic and the modern spelling. Relics have no skill line: they follow the class.
  const WEAPON_SKILL = { 0: ['Axes', 'One-Handed Axes'], 1: ['Two-Handed Axes'], 2: ['Bows', 'Bow'], 3: ['Guns', 'Gun'],
    4: ['Maces', 'One-Handed Maces'], 5: ['Two-Handed Maces'], 6: ['Polearms'], 7: ['Swords', 'One-Handed Swords'],
    8: ['Two-Handed Swords'], 10: ['Staves'], 13: ['Fist Weapons'], 15: ['Daggers'], 16: ['Thrown'], 18: ['Crossbows', 'Crossbow'], 19: ['Wands', 'Wand'] };
  const ARMOR_SKILL = { 1: ['Cloth'], 2: ['Leather'], 3: ['Mail'], 4: ['Plate Mail', 'Plate'], 6: ['Shield', 'Shields'] };
  const RELIC = { PALADIN: 7, DRUID: 8, SHAMAN: 9 };
  // An item's armor subclass as the Forever client's tooltip names it ("Shield", "Plate", ...): where the
  // pack's subclass (ForeverDB) disagrees, the client wins. Thrash's Trash is a shield the pack files as
  // Miscellaneous, which anyone may wear: read that way, a Mage would be offered a shield.
  const ARMOR_WORD = { Cloth: 1, Leather: 2, Mail: 3, Plate: 4, Shield: 6, Libram: 7, Idol: 8, Totem: 9 };
  function packSub(g) {
    if (!g) return null;
    if (g[9] !== 4) return g[12];
    if (g[4] === 14) return 6;                                   // the Off Hand "Shield" slot
    if (g[11] === 'e') for (const l of arr(g[10]).slice(0, 5)) if (ARMOR_WORD[l] != null) return ARMOR_WORD[l];
    return g[12];
  }
  function canUse() {
    const skills = arr((A.CH.snap || {}).skills);
    const have = new Set(skills.filter((k) => k && (k.skillLineCategoryID === 6 || k.skillLineCategoryID === 8)).map((k) => k.name));
    if (!have.size) return null;
    const pick = (map) => Object.entries(map).filter(([, names]) => names.some((n) => have.has(n))).map(([id]) => Number(id));
    const armor = [0, null, ...pick(ARMOR_SKILL)];            // rings, necks, trinkets, cloaks: no subclass or Miscellaneous
    if (RELIC[char().classFile] != null) armor.push(RELIC[char().classFile]);
    // Dual Wield is a skill line too (Rogues from level 1; Warriors and Hunters train it at 20)
    const dual = skills.some((k) => k && k.name === 'Dual Wield') || char().classFile === 'ROGUE';
    return { 2: pick(WEAPON_SKILL), 4: armor, dual };
  }
  // gear slots: game slot numbers you wear in, and the item inventory types that fit
  const SLOTS = [
    ['Head', [1], [1]], ['Neck', [2], [2]], ['Shoulder', [3], [3]], ['Back', [15], [16]], ['Chest', [5], [5, 20]],
    ['Wrist', [9], [9]], ['Hands', [10], [10]], ['Waist', [6], [6]], ['Legs', [7], [7]], ['Feet', [8], [8]],
    ['Ring', [11, 12], [11]], ['Trinket', [13, 14], [12]], ['Main hand', [16], [13, 21, 17]],
    ['Off hand', [17], [23, 14, 22, 13]], ['Ranged', [18], [15, 25, 26, 28]],
  ];
  const TWO_HAND = 17;
  // The off hand takes shields and held-in-off-hand items from anyone; off-hand weapons, and one-hand
  // weapons in the off hand, only with Dual Wield.
  const OFF_WEAPON = [22, 13];
  const handFits = (name, inv, use) => name !== 'Off hand' || !OFF_WEAPON.includes(inv) || !!(use && use.dual);
  // what kind of item is worn: the game's own slot for an item you have, else the pack's
  const wornInv = (x) => { const it = x && x.key && A.item(x.key); return (it && CC.advice && CC.advice.invOf ? CC.advice.invOf(it) : 0) || (A.gdItem(x && x.id) || [])[4] || 0; };
  const unique = (c) => arr(c && c.g && c.g[10]).some((l) => /^Unique/.test(l));

  // ---------------------------------------------------------------- set bonuses (#13)
  // pack sets[sid] = [name, ids, [[pieces, text, [[stat, value], ...]], ...], class mask]. A bonus with stats
  // (+8 All Resistances, spell power) counts in a gain when an item makes or breaks it; an effect (a proc) has
  // no stats and isn't counted, like an item's own use and proc effects.
  let SET_OF = null, SETS_SEEN = null;
  const setOf = (id) => {
    if (!SET_OF || SETS_SEEN !== (A.GD && A.GD.sets)) { SET_OF = {}; SETS_SEEN = A.GD && A.GD.sets; Object.entries((A.GD && A.GD.sets) || {}).forEach(([sid, s]) => arr(s && s[1]).forEach((i) => { SET_OF[i] = sid; })); }
    return id != null ? SET_OF[id] || null : null;
  };
  // what a set's bonuses are worth with n pieces on
  const setValue = (sid, n, w) => arr(((A.GD.sets || {})[sid] || [])[2]).filter((b) => b[0] <= n && arr(b[2]).length)
    .reduce((a, b) => { const st = {}; b[2].forEach(([k, v]) => { st[k] = (st[k] || 0) + v; }); return a + score(st, w, null, {}); }, 0);
  // the change in set bonuses when item inId goes on in place of outIds (what it replaces), against the gear
  // worn[] (the set compared with): {d, sets: [{name, from, to, d}]}. A piece counts once however many copies
  // are worn; taking one copy off keeps it while another is still on.
  function setDelta(w, worn, inId, outIds) {
    const outs = arr(outIds).filter((i) => i != null);
    if (!setOf(inId) && !outs.some((i) => setOf(i))) return { d: 0, sets: [] };
    const copies = {};
    Object.values(worn || {}).forEach((x) => { if (x && x.id != null) copies[x.id] = (copies[x.id] || 0) + 1; });
    const pieces = (cp) => { const c = {}; Object.keys(cp).forEach((i) => { const s = cp[i] > 0 && setOf(Number(i)); if (s) c[s] = (c[s] || 0) + 1; }); return c; };
    const cnt = pieces(copies);
    const next = Object.assign({}, copies);
    outs.forEach((i) => { if (next[i] > 0) next[i]--; });
    if (inId != null) next[inId] = (next[inId] || 0) + 1;
    const after = pieces(next);
    const sets = [];
    new Set(Object.keys(after).concat(Object.keys(cnt))).forEach((sid) => {
      const from = cnt[sid] || 0, to = after[sid] || 0;
      if (from === to) return;
      const d = setValue(sid, to, w) - setValue(sid, from, w);
      if (Math.abs(d) > 1e-9) sets.push({ name: (A.GD.sets[sid] || [])[0] || 'a set', from, to, d });
    });
    return { d: sets.reduce((a, s) => a + s.d, 0), sets };
  }

  const char = () => ((A.CH && A.CH.snap) || {}).character || {};
  const idOf = (key) => { const m = /item:(\d+)/.exec(key || ''); return m ? Number(m[1]) : null; };
  const score = W.score;
  const packStats = (id) => W.fromPack(A.gdItem(id));
  // the game's own numbers for an item you have (random suffixes count), else the pack's
  const ownStats = (mine, id) => (mine && mine.stats ? W.fromGame(mine.stats, mine.tip) : packStats(id));
  const fmt1 = (v) => v.toFixed(1);
  // a gain that includes a set bonus says so: "set +4.2" (made) or "set −3.0" (broken)
  const setNote = (y) => (y && y.sb ? `<div class="sub" title="${esc(y.sb.sets.map((s) => `${s.name}: ${s.from} → ${s.to} pieces`).join('; '))}">set ${gainTxt(y.sb.d)}</div>` : '');
  const gainTxt = (d) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;

  // ---------------------------------------------------------------- specs and weights
  // A spec is named by its biggest talent tree (Forever answers the spec-name call with the class); the
  // rule, with no points and ties, is the weights engine's (W.pickTree). Points come from the talent trees
  // the page draws (modern trait API), else from the classic talent tabs, matched to trees by their names.
  function treePoints(sp, cf) {
    const names = W.TREES[cf] || [];
    const t = A.specTrees(sp);
    if (t && t.length === names.length) return t.map((x) => x.points || 0);
    // the layout found more or fewer trees (a tree with an empty column, say): split the nodes where the
    // gaps across are widest, one split fewer than the class has trees
    // (only for one trait tree holding every talent tree: separate trees don't share x positions)
    const one = arr(sp && sp.traits && sp.traits.trees).filter((x) => arr(x && x.nodes).length).length <= 1;
    const nodes = one ? (t || []).flatMap((g) => arr(g.nodes)).filter((n) => n.x != null) : [];
    const xs = [...new Set(nodes.map((n) => n.x))].sort((a, b) => a - b);
    if (names.length && xs.length >= names.length) {
      const cuts = xs.slice(1).map((x, i) => ({ at: x, gap: x - xs[i] })).sort((a, b) => b.gap - a.gap).slice(0, names.length - 1).map((c) => c.at).sort((a, b) => a - b);
      const pts = names.map(() => 0);
      nodes.forEach((n) => { pts[cuts.filter((c) => n.x >= c).length] += n.rank || 0; });
      return pts;
    }
    const tabs = arr(sp && sp.talents && sp.talents.tabs);
    if (tabs.length === names.length) {
      const key = (x) => String(x || '').toLowerCase().replace(/[^a-z]/g, '');
      const byName = names.map((n) => tabs.findIndex((tb) => key(tb && tb.name).startsWith(key(n))));
      const order = byName.every((i) => i >= 0) && new Set(byName).size === names.length ? byName : names.map((n, i) => i);
      return order.map((i) => Number((tabs[i] || {}).points) || 0);
    }
    return null;
  }
  function specs() {
    const raw = (A.CH && A.CH.specs) || {};
    const cf = char().classFile;
    return Object.entries(raw).map(([k, sp]) => {
      const pts = treePoints(sp, cf);
      const pick = W.pickTree(cf, pts);
      return { i: Number(k), sp, label: A.specLabel(sp) || 'Spec ' + k, tree: pick.tree, treeWhy: pick.why, points: pts };
    }).sort((a, b) => a.i - b.i);
  }
  // choices are kept per character (Name-Realm, so same-named characters on two realms don't share) and
  // spec (the game's talent group, spec1 / spec2); the page mirrors them to companion-data/settings.json
  // and they sync between computers. Choices saved before the realm was in the key (name only, or older still
  // by index) are read from there until something new is saved.
  const who = () => { const c = char(); return (c.name || '') + (c.realm ? '-' + c.realm : ''); };
  const store = (spec, what) => `cc.gear.${what}.${who()}.spec${spec.i}`;
  const byName = (spec, what) => `cc.gear.${what}.${char().name || ''}.spec${spec.i}`;
  // the oldest picks: under the reader's array index (0 = group 1, 1 = group 2; a lone group 2 under 2)
  const legacy = (spec, what) => (spec.i === 1 ? [0] : [1, 2]).map((n) => `cc.gear.${what}.${char().name || ''}.${n}`);
  const readChoice = (spec, what) => {
    for (const k of [store(spec, what), byName(spec, what), ...legacy(spec, what)]) { const v = localStorage.getItem(k); if (v != null) return v; }
    return null;
  };
  // the profile you picked for a spec (null: the default for its biggest tree)
  function pickedProfile(spec) {
    const cls = char().classFile;
    W.migrate(char().name, spec.i - 1, cls, store(spec, 'profile'));
    const pick = readChoice(spec, 'profile');
    const p = pick && W.get(pick);
    return p && p.cls === cls ? pick : null;
  }
  const profileKey = (spec) => pickedProfile(spec) || W.defaultFor(char().classFile, spec.tree, char().level);
  // clearing a pick stores '' so an older pick under the legacy key doesn't come back
  const setProfile = (spec, id) => localStorage.setItem(store(spec, 'profile'), id || '');
  // A spell profile's weights carry the hit model (non-enumerable `hit`, read by W.score): the cap, the hit the
  // compared gear and your talents give, and the rating per 1% the client reports. Without it hit counts flat.
  const HIT_RULE = (window.GAMERULES || {}).spellHit || null;
  const SCHOOL_NAME = { 110: 'fire', 111: 'shadow', 112: 'frost', 113: 'arcane', 114: 'nature', 115: 'holy' };
  const TREE_SCHOOL = { shadow: ['affliction'], fire: ['destruction'] };   // talent trees whose spells are that school
  // talents you have that add spell hit, read from their text at your rank: "chance to hit with spells by 3%",
  // or "...chance to resist your Shadow spells by 8%" (counted when it names a school these weights use)
  function talentHit(spec, schools) {
    const out = [];
    arr(spec && spec.sp && spec.sp.traits && spec.sp.traits.trees).forEach((t) => arr(t.nodes).forEach((n) => {
      const d = String((n && n.rank > 0 && n.desc) || '');
      let m = /chance to hit with (?:all )?(?:your )?(?:melee attacks and |attacks and )?spells(?: and attacks)? by (\d+(?:\.\d+)?)%/i.exec(d);
      if (!m) {
        const r = /chance (?:that )?(?:targets?|enemies|your target)?[^.]*?resist (?:your )?([A-Za-z, ]+?) spells by (\d+(?:\.\d+)?)%/i.exec(d);
        // a talent may name a tree instead of a school (Suppression: "your Affliction spells")
        const words = (sc) => [sc].concat(TREE_SCHOOL[sc] || []);
        if (r && schools.some((sc) => words(sc).some((x) => new RegExp('\\b' + x + '\\b', 'i').test(r[1])))) m = [r[0], r[2]];
      }
      if (m) out.push({ name: n.name || 'talent', pct: Number(m[1]) });
    }));
    return out;
  }
  const HIT_CACHE = new Map();
  function hitModel(spec, pk, w) {
    const prof = W.get(pk) || {};
    if (!HIT_RULE || prof.role !== 'spell' || !(w[W.S.hit] > 0)) return null;
    const schools = Object.keys(w).map((k) => SCHOOL_NAME[k]).filter(Boolean);
    const st = (A.CH.snap || {}).stats || {};
    // rating per 1%: measured from the client when it says both, else the Forever client's 10 (weights.js PCT)
    const per1 = st.spellHitRating > 0 && st.spellHitBonus > 0 ? st.spellHitRating / st.spellHitBonus : W.PCT[18][1];
    const tal = talentHit(spec, schools.length ? schools : ['shadow', 'fire', 'frost', 'arcane', 'nature', 'holy']);
    const talPct = tal.reduce((a, t) => a + t.pct, 0);
    const base = baseline(spec, pk);
    const gearR = Object.values(base.worn).reduce((a, x) => a + W.hitRating(x.st, { per1 }), 0);
    return { cap: HIT_RULE.cap, against: HIT_RULE.against, src: HIT_RULE.src, per1, capR: HIT_RULE.cap * per1, haveR: gearR + talPct * per1,
      gearPct: gearR / per1, talents: tal, measured: st.spellHitRating > 0 && st.spellHitBonus > 0 };
  }
  // ---------------------------------------------------------------- what crit is worth to a healer (#99)
  // From your own heals: each heal's average (the game's tooltip at your best rank) plus your +healing times its
  // share (cast time / 3.5). 1% crit adds critBonus × (1 − overheal) of 1% of a heal; in points of +healing that is
  // that amount over the share. Averaged over your heals, per crit rating (14 = 1%). null: your heals weren't read.
  const CRIT_RULE = (window.GAMERULES || {}).critHeals || null;
  function critModel(pk) {
    const prof = W.get(pk) || {};
    if (!CRIT_RULE || prof.role !== 'heal' || prof.own) return null;
    const groups = CRIT_RULE[char().classFile];
    const snap = A.CH.snap || {}, SP = A.SPELLS || {};
    if (!groups) return null;
    const known = {};
    arr(snap.spellbook).forEach((t) => arr(t && t.spells).forEach((x) => {
      if (!x || !x.name || x.id == null) return;
      const r = Number((/(\d+)/.exec(String(x.rank || '')) || [])[1]) || 0;
      if (!known[x.name] || r > known[x.name].rank) known[x.name] = { id: x.id, rank: r };
    }));
    const healing = Number((snap.stats || {}).healing) || 0;
    const heals = [];
    groups.forEach((names) => {
      const name = names.find((n) => known[n]);
      if (!name) return;
      const k = known[name], tip = arr((SP[k.id] || {}).tip);
      let lo = null, hi = null;
      tip.forEach((ln) => {
        [ln && ln.l, ln && ln.r].forEach((t) => {
          if (typeof t !== 'string') return;
          const m = /\b(?:[Hh]eals?|healing)\b[^.]*?\bfor (\d+) to (\d+)/.exec(t); if (m && lo == null) { lo = Number(m[1]); hi = Number(m[2]); }
        });
      });
      const rule = (CRIT_RULE.spells || {})[name] || {};
      const c0 = rule.cast, cast = typeof c0 === 'number' ? c0 : c0 ? (c0[k.rank] || c0.other) : null;
      if (lo == null || !(cast > 0)) return;
      const lv = (rule.learn || {})[k.rank], low = lv && lv < 20 ? 1 - (20 - lv) * 0.0375 : 1;
      const coef = Math.min(cast, 3.5) / 3.5 * low, avg = (lo + hi) / 2, size = avg + coef * healing;
      heals.push({ name, rank: k.rank || null, id: k.id, avg, cast, coef: +coef.toFixed(3), size: Math.round(size),
        perPct: +(0.01 * CRIT_RULE.critBonus * (1 - CRIT_RULE.overheal) * size / coef).toFixed(2) });
    });
    if (!heals.length) return null;
    const per1 = W.PCT[21][1];
    const perPct = heals.reduce((a, h) => a + h.perPct, 0) / heals.length;
    // in the profile's own units: points of +healing times what the profile gives a point of +healing
    const unit = prof.w[W.S.heal] != null ? prof.w[W.S.heal] : 1;
    return { weight: +(perPct / per1 * unit).toFixed(2), unit, perPct: +perPct.toFixed(2), per1, healing, heals, base: prof.w[W.S.crit],
      critBonus: CRIT_RULE.critBonus, overheal: CRIT_RULE.overheal, label: CRIT_RULE.label };
  }
  function critLine(cm) {
    return `<div class="meta">Crit: 1% is worth ${cm.perPct.toFixed(1)} healing on your heals (${cm.heals.map((h) => `${esc(h.name)}${h.rank ? ' R' + h.rank : ''} ${h.size}`).join(', ')}, with your ${cm.healing} +healing), so a point of crit rating counts ${cm.weight} (${cm.per1} = 1%${cm.unit !== 1 ? `, at this profile's ${cm.unit} for a point of +healing` : ''}). ${esc(cm.label)}: a crit heals 150%, a third of the extra overheals.</div>`;
  }
  const hitSummary = (hm) => ({ havePct: +(hm.haveR / hm.per1).toFixed(2), capPct: hm.cap, gearPct: +hm.gearPct.toFixed(2),
    talents: hm.talents, ratingPer1Pct: +hm.per1.toFixed(2), ratingMeasured: hm.measured, against: hm.against, capSource: hm.src,
    overCap: hm.haveR >= hm.capR });
  // one line for the Gear page: your hit against the cap, and what that means for hit on items
  function hitLine(hm) {
    const h = hitSummary(hm), parts = [`${h.gearPct.toFixed(1)}% from gear`].concat(h.talents.map((t) => `${t.pct}% ${esc(t.name)}`));
    const tail = h.overCap ? 'hit on items counts for nothing until you lose some' : `items count hit up to ${(h.capPct - h.havePct).toFixed(1)}% more`;
    return `<div class="meta">Hit: ${h.havePct.toFixed(1)}% (${parts.join(' + ')}) of the ${h.capPct}% that counts against ${esc(h.against)}: ${tail}.${h.ratingMeasured ? '' : ' Rating per 1% not read from the game yet: using 10.'}</div>`;
  }
  // the same weights with the hit model measured against other gear (the character sheet compares with what
  // you wear, not the spec's set)
  const weightsAgainst = (w, worn) => {
    const hm = w && w.hit;
    if (!hm) return w;
    const gearR = Object.values(worn || {}).reduce((a, x) => a + W.hitRating(x && x.st, hm), 0);
    const talR = hm.talents.reduce((a, t) => a + t.pct, 0) * hm.per1;
    return Object.defineProperty(Object.assign({}, w), 'hit', { value: Object.assign({}, hm, { haveR: gearR + talR, gearPct: gearR / hm.per1 }), enumerable: false });
  };
  const weightsFor = (spec, pk) => {
    const w = (W.get(pk) || {}).w || null;
    if (!w || !spec || !spec.sp) return w;
    const key = [pk, spec.i, (A.CH.snap || {}).taken || 0, JSON.stringify(w), readChoice(spec, 'set')].join('|');
    if (!HIT_CACHE.has(key)) {
      if (HIT_CACHE.size > 64) HIT_CACHE.clear();      // one entry per edit of the weights or sync: keep it small
      const hm = hitModel(spec, pk, w), cm = critModel(pk);
      let out = w;
      if (hm || cm) {
        out = Object.assign({}, w);
        if (cm) { out[W.S.crit] = cm.weight; Object.defineProperty(out, 'crit', { value: cm, enumerable: false }); }
        if (hm) Object.defineProperty(out, 'hit', { value: hm, enumerable: false });
      }
      HIT_CACHE.set(key, out);
    }
    return HIT_CACHE.get(key);
  };

  // What a spec's upgrades are measured against: the gear set for that spec, else what you wear now.
  // A set is linked by your pick, else the game's own spec link, else a name that matches the spec or its
  // weights ("heals" ~ Healing, "shadow" ~ Shadow).
  const SETS = () => arr((A.CH.snap || {}).gearSets).filter((g) => g && g.name && arr(g.items).length);
  function baseline(spec, pk) {
    const sets = SETS(), pick = readChoice(spec, 'set');
    const stem = (x) => (x || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 4);
    const role = (W.get(W.defaultFor(char().classFile, spec.tree, char().level)) || W.get(pk) || {}).role;
    const words = [spec.tree, pk && W.get(pk) && W.get(pk).name, role === 'heal' ? 'heal' : ''].map(stem).filter((x) => x.length === 4);
    const byName = (g) => g.name.toLowerCase().split(/[^a-z]+/).some((t) => words.includes(stem(t)));
    let set = null, why = '';
    if (pick === 'worn') set = null;
    else if (pick && (set = sets.find((g) => String(g.id) === pick))) why = 'your pick';
    else if ((set = sets.find((g) => g.spec === spec.i))) why = 'linked to this spec in game';
    else if ((set = sets.filter(byName).length === 1 ? sets.find(byName) : null)) why = 'matched by name';
    if (!set) {
      const worn = {};
      Object.values((A.CH.snap || {}).equipped || {}).forEach((e) => { if (e && e.item) worn[e.slot] = { id: idOf(e.item), key: e.item, st: ownStats(A.item(e.item), idOf(e.item)) }; });
      return { key: 'worn', label: 'what you wear now', short: 'what you wear', worn };
    }
    const worn = {};
    // the copy the set uses when the game said (its link: its enchant, #147), else the copy you wear, else one you have
    // (the copy you wear only when you wear one copy of it and the set has one: a bank copy, or two of one weapon, aren't
    // that copy; another copy's key is only a guess at its enchant, guess: true)
    const wearing = {}, inSet = {};
    Object.values((A.CH.snap || {}).equipped || {}).forEach((e) => { if (e && e.item) { const i = idOf(e.item); wearing[i] = wearing[i] === undefined ? e.item : null; } });
    arr(set.items).forEach((x) => { if (x && x.id > 0) inSet[x.id] = (inSet[x.id] || 0) + 1; });
    arr(set.items).forEach((x) => {
      if (!x || !(x.id > 0)) return;
      const key = x.item || (inSet[x.id] === 1 && !x.bank ? wearing[x.id] : null), own = key && A.item(key), mine = own ? Object.assign({ key }, own) : A.byId(x.id);
      worn[x.slot] = { id: x.id, key: key || (mine && mine.key), guess: !key || undefined, bank: x.bank || undefined, st: ownStats(mine, x.id) };
    });
    const lost = set.numLost ? `; the game listed ${set.numLost} of its items as missing when it saved` : '';
    return { key: String(set.id), label: `your “${set.name}” set (${why}${lost})`, short: `your ${set.name} set`, worn };
  }

  // ---------------------------------------------------------------- where an item comes from
  // PvP gear: sold in the two PvP halls; bought with Honor, the epics also need a rank. Left out of PvE lists.
  const PVP_HALLS = ["Champions' Hall", 'Hall of Legends'];
  const PVP_RANK = /^(Premier )?(Private|Corporal|Sergeant|Master Sergeant|Sergeant Major|Knight|Knight-Lieutenant|Knight-Captain|Knight-Champion|Lieutenant Commander|Commander|Marshal|Field Marshal|Grand Marshal|Scout|Grunt|Senior Sergeant|First Sergeant|Stone Guard|Blood Guard|Legionnaire|Centurion|Champion|Lieutenant General|General|Warlord|High Warlord)'s /;
  let VENDORS = null;
  const vendorInfo = (name) => {
    if (!VENDORS) { VENDORS = {}; Object.values(A.GD.vend || {}).forEach((rows) => arr(rows).forEach((v) => { if (!VENDORS[v[0]]) VENDORS[v[0]] = { hall: PVP_HALLS.includes(v[1]), side: v[7] || '' }; })); }
    return VENDORS[name] || null;
  };
  const howVendor = (id) => { const m = /^Vendor · ([^·]+)/.exec((A.GD.how || {})[id] || ''); return m ? vendorInfo(m[1].trim()) : null; };
  const isPvp = (id) => arr((A.GD.vend || {})[id]).some((v) => PVP_HALLS.includes(v[1])) || PVP_RANK.test((A.gdItem(id) || [''])[0]) || !!(howVendor(id) || {}).hall;
  // One word for the kind of source, used for the source column and the filters.
  const KINDS = [['owned', 'Yours'], ['ah', 'On the AH'], ['dungeon', 'Dungeon'], ['quest', 'Quest'], ['crafted', 'Crafted'], ['vendor', 'Vendor'], ['roll', 'Random green'], ['world', 'World drop'], ['raid', 'Raid'], ['pvp', 'PvP']];
  const KIND_WORD = Object.fromEntries(KINDS);
  // Why an item is not in Upgrades or Pre-BiS (candidates' `avail`); the snapshot writes the key
  const AVAIL = { raid: 'Raid', pvp: 'PvP (Honor)', unseen: 'Not seen on Forever yet', worldAh: 'World drop, not seen on your AH yet' };
  // battleground quartermasters sell for gold and their reputation, not Honor
  const availWord = (c) => (c.avail === 'pvp' && !isPvp(c.id) ? 'PvP (battleground reputation)' : AVAIL[c.avail]) + (c.avail !== 'unseen' && c.seen === false ? ' · not seen on Forever yet' : '');
  // a quest reward is raid gear when the quest or an earlier step of its chain is raid content (quests.js)
  const raidQuest = (qid) => (CC.quests && CC.quests.raid ? CC.quests.raid(qid) : ((A.GD.quests || {})[qid] || {}).type === 'Raid');
  // Raid and PvP by source (#110), the one place both the source word and `avail` read. Raid: a group size
  // of 20+, a quest from raid content, crafts whose reagents only raids drop, or loot whose every placed
  // source is a raid zone or a world boss (a zone-less drop or a container keeps it open-world). PvP: the PvP halls, rank titles, battleground zones and their
  // quartermasters. Lists: data/rules.js instances.
  const INST = (window.GAMERULES || {}).instances || {};
  const RAID_Z = new Set(arr(INST.raids)), RAID_MAP = new Set(arr(INST.raidMaps)), BG_Z = new Set(arr(INST.battlegrounds)), WB = new Set(arr(INST.worldBosses));
  const RAID_MATS = new Set(arr(INST.raidMatCrafts)), PVP_WORDS = arr(INST.pvpVendorWords);
  const pvpVendor = (v) => BG_Z.has(v[1]) || PVP_WORDS.some((w) => String(v[6] || '').includes(w));
  // one source row is in a raid: a raid zone or map, or a world boss
  const raidRow = (r) => (r[0] === 'drop' && WB.has(r[2])) || RAID_Z.has(r[7]) || RAID_MAP.has(Number(r[5]));
  function raidSource(id) {
    // a vendor row with no zone is a test NPC (Jimmy McWeaksauce), not a place to buy it
    const size = (A.GD.size || {})[id] || 0, rows = arr((A.GD.src || {})[id]).filter((r) => r && (r[0] !== 'vendor' || r[7]));
    if (size >= 20 || RAID_MATS.has(Number(id)) || rows.some((r) => r[0] === 'quest' && raidQuest(r[2]))) return true;
    if (rows.some((r) => r[0] === 'world' || r[0] === 'quest' || r[0] === 'craft' || r[0] === 'vendor')) return false;
    if (arr((A.GD.vend || {})[id]).length) return false;
    // a drop with no zone from a creature that isn't a world boss (a world-drop epic's list names a few
    // droppers, Mushgog among them), or a lockbox or sack: open-world, so not raid gear
    if (rows.some((r) => !r[7] && !RAID_MAP.has(Number(r[5])) && ((r[0] === 'drop' && !WB.has(r[2])) || r[0] === 'container'))) return false;
    const placed = rows.filter((r) => raidRow(r) || (typeof r[7] === 'string' && r[7]));
    return placed.length > 0 && placed.every(raidRow);
  }
  function pvpSource(id) {
    if (isPvp(id)) return true;
    const vend = arr((A.GD.vend || {})[id]), rows = arr((A.GD.src || {})[id]);
    if (vend.length && vend.every(pvpVendor)) return true;
    return rows.length > 0 && rows.every((r) => BG_Z.has(r[7]));
  }
  function kindOf(id) {
    const size = (A.GD.size || {})[id] || 0, rows = arr((A.GD.src || {})[id]);
    const how = (A.GD.how || {})[id] || '';
    if (raidSource(id)) return 'raid';
    if (pvpSource(id)) return 'pvp';
    if (/^World Drop/.test(how)) return 'world';
    if (size || /^(Boss Drop|Dungeon)/.test(how)) return 'dungeon';
    // a vendor on your side that Forever players saw selling it: buyable now, whatever else gives it (#157: Deliana sells
    // the Virtuous pieces a set container also gives)
    if (A.buyLine && A.buyLine(id)) return 'vendor';
    if (/^Quest/.test(how) || rows.some((r) => r[0] === 'quest' || r[0] === 'container')) return 'quest';
    if (/^Profession/.test(how) || rows.some((r) => r[0] === 'craft')) return 'crafted';
    if (/^Vendor/.test(how) || (A.GD.vend || {})[id]) return 'vendor';
    if (rows.some((r) => r[0] === 'drop' && r[5])) return 'dungeon';
    return 'world';
  }
  // a random-suffix roll drops from any creature of its level: its base's drop list says nothing about the roll
  const whereOf = (c) => (c.kind === 'vendor' && A.buyLine && A.buyLine(c.id)) || (c.kind === 'quest' && A.questLine && A.questLine(c.id)) || (c.roll ? `Random-suffix ${c.g[1] === 3 ? 'blue' : 'green'} · drops from creatures of its level, or the AH` : (c.kind === 'crafted' && A.recipeLine(c.id) && `${c.how ? c.how.split(' · Learnt from')[0] + ' · ' : ''}${A.recipeLine(c.id)}`) || c.how || ((A.gdSourceLines(c.id, 1, false)[0] || {}).l) || (c.boe ? 'BoE: not seen on your AH yet' : ''));

  // ---------------------------------------------------------------- candidates
  // The fixed-stat items Forever is known to have, and every roll of the random-suffix ones. Cached per
  // class and skills.
  const rollsOf = (id) => (SFX && SFX.items[id]) || null;
  const rollStats = (rows) => { const st = {}; rows.forEach(([k, v]) => { st[k] = (st[k] || 0) + v; }); return st; };
  let cache = null;
  // item id -> the class mask of the class sets it belongs to (pack sets: [name, pieces, bonuses, class mask])
  let MASKS = null;
  const setMasks = () => {
    if (!MASKS) { MASKS = {}; Object.values(A.GD.sets || {}).forEach((s) => { if (s && s[3]) arr(s[1]).forEach((id) => { MASKS[id] = (MASKS[id] || 0) | s[3]; }); }); }
    return MASKS;
  };
  // the level cap from the client (character.maxLevel), else Classic's 60
  const capLevel = () => { const m = Number(char().maxLevel); return m > 0 ? m : 60; };
  function candidates(use, cls) {
    const Q = CC.quests;
    const ah = (A.CH && A.CH.ah) || {};
    const ck = JSON.stringify(use) + cls + (SFX ? SFX.built : '') + '|' + (((A.CH && A.CH.snap) || {}).taken || 0) + '|' + arr(((A.CH && A.CH.snap) || {}).completedQuests).length + '|' + ((ah.lastScan || {}).t || 0) + '|' + Object.keys(ah.prices || {}).length;
    // A world drop (any creature of its level, no named source) is got from the AH in practice, so it's a
    // target only once your own AH has listed one (any scan or browse, ever); until then it's kept with why.
    // Items you own come in separately (ownedCands), so one you looted still counts.
    const onMyAh = new Set();
    Object.entries(ah.prices || {}).forEach(([key, p]) => { if (arr(p.obs).some((o) => o && o.qty > 0)) onMyAh.add(Number(p.id || key.split(':')[0])); });
    if (cache && cache.ck === ck) return cache;
    const fixed = [], rolls = [], byId = {}, later = [];
    const skipped = { 'quest reward you already took (or not for you)': 0, 'raid only': 0, 'PvP honor gear': 0, 'battleground reputation gear': 0, 'other faction only': 0, 'only Classic data says where it comes from': 0, 'no endgametools tooltip': 0, 'stats from ForeverDB only, and Forever not seen to have it': 0, 'not for your class': 0, 'no known source': 0, 'world drop not seen on your AH yet': 0 };
    const side = (char().faction || '')[0];            // 'A' or 'H'; vendors that only serve the other side don't count
    const bit = CLASS_BIT[char().classFile] || 0;
    for (const [k, g] of Object.entries((A.GD && A.GD.items) || {})) {
      const c = g[9], sub = packSub(g);
      if (c !== 2 && c !== 4) continue;
      if (!use || !(use[c] || []).includes(sub)) continue;
      // stats from the Forever client (endgametools), else ForeverDB's: those items aren't known in game yet
      if (g[11] !== 'e' && g[11] !== 'f') { skipped['no endgametools tooltip']++; continue; }
      const clientTip = g[11] === 'e';
      const only = arr(g[10]).find((l) => /^Classes: /.test(l));
      if (only && !only.includes(cls)) { skipped['not for your class']++; continue; }
      // a class set's piece is for that class, whatever its tooltip says (ForeverDB-only items have none)
      const mask = setMasks()[k];
      if (mask && bit && !(mask & bit)) { skipped['not for your class']++; continue; }
      const id = Number(k), src = (A.GD.src || {})[k], vend = (A.GD.vend || {})[k];
      const boe = g[7] === 2;
      // only what Forever is known to have: the client's own source (endgametools), a Forever sighting or
      // Forever quest data (ForeverDB / QuestieDB), or a vendor seen selling it on Forever. Random-suffix
      // items count when foreverchanges lists their rolls as confirmed in game.
      const how = (A.GD.how || {})[k];
      const myVend = arr(vend).filter((v) => !v[7] || !side || v[7].includes(side));
      const rr = rollsOf(k);
      if (vend && !myVend.length && !src && !how) { skipped['other faction only']++; continue; }
      const onForever = how || rr || arr(src).some((r) => r[10] === 'f') || myVend.some((v) => v[5]);
      const size = (A.GD.size || {})[k] || 0;
      const fromRaid = raidSource(k);
      // Not for now or pre-BiS, but kept and shown with why (AVAIL): raid content, PvP honor gear, and items
      // Forever isn't known to have yet (only Classic data names a source, or none does)
      // ForeverDB's stats count when Forever itself was seen giving the item (a drop, container or quest sighting:
      // Forever's own items, its Tier 0.5 spec sets, have no endgametools page yet). A vendor row alone doesn't:
      // ForeverDB lists Season of Discovery raid-token vendors the Forever client carries.
      const foreverSeen = arr(src).some((r) => r[10] === 'f' && r[0] !== 'vendor');
      // ForeverDB often has no required level for them: offered at the level cap only, not guessed lower
      const req = g[3] || (clientTip ? 0 : capLevel());
      const seen = !!onForever && (clientTip || foreverSeen);
      const avail = fromRaid ? 'raid' : pvpSource(id) ? 'pvp' : !seen ? 'unseen' : !rr && kindOf(id) === 'world' && !onMyAh.has(id) ? 'worldAh' : null;
      // only a quest gives it, and every such quest is done (or for the other faction or another class)
      if (Q && !vend && (!how || /^Quest/.test(how) && !/ · (Vendor|World Drop|Drop|Boss Drop|Profession|PvP reward) · /.test(' · ' + how + ' · ')) && arr(src).every((r) => r[0] === 'quest') && Q.rewardGone(id)) { skipped['quest reward you already took (or not for you)']++; continue; }
      if (avail === 'pvp' && vend && !myVend.length) { skipped['other faction only']++; continue; }
      if (avail) {
        skipped[avail === 'raid' ? 'raid only' : avail === 'pvp' ? (isPvp(id) ? 'PvP honor gear' : 'battleground reputation gear') : avail === 'worldAh' ? 'world drop not seen on your AH yet' : !clientTip ? 'stats from ForeverDB only, and Forever not seen to have it' : src || vend ? 'only Classic data says where it comes from' : 'no known source']++;
        later.push({ id, key: k, g, name: g[0], inv: g[4], req, boe, size, how, kind: kindOf(id), avail, seen, st: W.fromPack(g) });
        continue;
      }
      const base = { id, g, inv: g[4], req, boe, size, how, kind: kindOf(id) };
      if (rr) {
        // each roll is its own item: "Elegant Mantle of Healing"; the base's armor still counts
        const armor = W.fromPack(g);
        rr.forEach(([ni, rows]) => {
          const roll = SFX.names[ni], st = Object.assign({}, armor);
          Object.entries(rollStats(rows)).forEach(([s, v]) => { st[s] = (st[s] || 0) + v; });
          const c = Object.assign({}, base, { roll, key: k + ':' + roll, name: g[0] + ' ' + roll, st, kind: 'roll' });
          rolls.push(c); byId[c.key] = c;
        });
      } else {
        const c = Object.assign(base, { key: k, name: g[0], st: W.fromPack(g) });
        fixed.push(c); byId[k] = c;
      }
    }
    cache = { ck, fixed, rolls, byId, later, skipped };
    return cache;
  }

  // What's listed on your Auction House now: the newest scan (or browsing in the last day) that found it.
  // A random-suffix roll is told apart by its key ("3192:of Healing") or, for older records keyed by the
  // suffix number, by the name the listing had.
  const LISTED_FOR = 3 * 86400;
  function listings(cand) {
    const ah = (A.CH && A.CH.ah) || {}, ls = ah.lastScan || {}, now = Date.now() / 1000;
    const out = [];
    for (const [key, p] of Object.entries(ah.prices || {})) {
      const id = Number(p.id || key.split(':')[0]);
      const obs = arr(p.obs), o = obs[obs.length - 1];
      if (!o || !o.min || !o.qty) continue;                              // the newest reading found none
      // a browse sighting counts for a day, and not once a newer scan has run without finding it
      if (o.src === 'scan' ? ls.t && o.t < ls.t - 600 : now - o.t > 86400 || (ls.t && o.t < ls.t - 600)) continue;
      if (now - o.t > LISTED_FOR) continue;
      let c = null;
      const sfx = key.includes(':') ? key.slice(key.indexOf(':') + 1) : null;
      if (sfx && /^of /.test(sfx)) c = cand.byId[id + ':' + sfx];
      else if (sfx) {
        const g = A.gdItem(id), nm = p.name || '';
        if (g && nm.startsWith(g[0] + ' of ')) c = cand.byId[id + ':' + nm.slice(g[0].length + 1)];
      } else if (!rollsOf(id)) c = cand.byId[String(id)];                 // a fixed item; a random one's own key mixes every roll
      if (c) out.push({ c, price: o.med || o.min, min: o.min, qty: o.qty, t: o.t });
    }
    return out;
  }

  // Items you have that you could wear (worn ones too: a gear set you compare with may not use them), scored from the game's own numbers.
  function ownedCands(use) {
    const adv = CC.advice;
    if (!adv || !adv.owned) return [];
    const seen = new Set(), out = [];
    adv.owned().forEach((o) => {
      const it = A.item(o.key);
      if (!it || seen.has(o.key) || !adv.wearable(it, use)) return;
      seen.add(o.key);
      const g = A.gdItem(it.id) || [it.name, it.q, it.ilvl, it.req, adv.invOf(it)];
      out.push({ id: it.id, key: o.key, g, name: it.name || g[0], inv: adv.invOf(it), req: it.req || g[3] || 0, st: adv.statsOf(o.key), kind: 'owned', where: o.where, boe: it.bind === 2, how: (A.GD.how || {})[it.id] });
    });
    return out;
  }

  // ---------------------------------------------------------------- what you still need for an item (only unmet gates show)
  const NEEDS = new Map();
  // what you still need for it: the shared gates (app.js itemGates: the item's reputation, a reward quest's,
  // the recipe's, and the profession skill to craft it; a BoE crafted item can be bought, so no skill gate)
  function needs(c) {
    const ck = c.id + '|' + (A.CH.snap || {}).taken;
    if (NEEDS.has(ck)) return NEEDS.get(ck);
    const res = A.itemGates(c.id).filter((x) => !x.met && !(x.craft && c.boe)).map((x) => x.short);
    NEEDS.set(ck, res);
    return res;
  }

  // where each of your items is: worn, in your bags or in your bank (as of the last Sync / bank visit)
  function ownedAt() {
    const at = {};
    const put = (key, where) => { const m = /item:(\d+)/.exec(key || ''); if (m && !at[m[1]]) at[m[1]] = where; };
    Object.values((A.CH.snap || {}).equipped || {}).forEach((e) => e && put(e.item, 'worn'));
    arr((A.CH.snap || {}).bags).forEach((b) => arr(b.items).forEach((x) => put(x.item, 'bags')));
    arr((A.CH.bank || {}).bags).forEach((b) => arr(b.items).forEach((x) => put(x.item, 'bank')));
    return at;
  }
  const AT_WORD = { worn: 'worn', bags: 'in your bags', bank: 'in your bank' };

  // ---------------------------------------------------------------- the plan, slot by slot
  // For one spec's weights and baseline: per slot what it has, the upgrades usable now (several, from every
  // kind of source), the AH listings that are upgrades, the rolls worth searching for, and pre-BiS targets
  // with alternatives (best items up to the level cap, raids left out).
  const NOW_MAX = 6, PRE_ALTS = 4, LATER_MAX = 8;
  function plan(w, lvl, base, picks, reach) {
    const use = canUse(), ch = char(), cap = capLevel();
    const cand = candidates(use, ch.class);
    const worn = base.worn;
    const wornIds = new Set(Object.values(worn).map((x) => x.id));
    const twoHand = !!worn[16] && wornInv(worn[16]) === TWO_HAND;
    const listed = listings(cand);
    const listedBy = {}; listed.forEach((l) => { const k = l.c.key; if (!listedBy[k] || l.price < listedBy[k].price) listedBy[k] = l; });
    const mine = ownedCands(use);
    const at = ownedAt();
    const offScore = worn[17] ? score(worn[17].st, w, 17, worn[17].st) : 0;
    const slots = SLOTS.map(([name, nums, invs]) => {
      const cur = nums.map((n) => worn[n] ? { n, id: worn[n].id, key: worn[n].key, st: worn[n].st, s: score(worn[n].st, w, n, worn[n].st) } : { n, id: null, s: 0 });
      const weakest = cur.reduce((a, c) => (c.s < a.s ? c : a), cur[0]);
      const blocked = name === 'Off hand' && twoHand;
      const fitsPre = (c) => invs.includes(c.inv) && handFits(name, c.inv, use);
      const fits = (c) => fitsPre(c) && !blocked;          // usable now (a worn two-hander blocks the off hand)
      // a two-hander replaces the main hand and the off hand; a set bonus it makes or breaks counts too. In a
      // ring or trinket row it replaces whichever of the two gives the bigger gain with the set change counted
      // (the weaker one, unless that one keeps a set bonus)
      const swap = (c, s) => {
        const own = cur.find((y) => y.id && y.id === c.id);
        const two = name === 'Main hand' && c.inv === TWO_HAND && worn[17];
        const opts = (own ? [own] : cur).map((y) => {
          const sd = setDelta(w, worn, c.id, [y.id].concat(two ? [worn[17].id] : []));
          return { y, sd, d: s - y.s - (two ? offScore : 0) + sd.d };
        });
        return opts.reduce((a, o) => (o.d > a.d ? o : a), opts[0]);
      };
      const gain = (c, s) => swap(c, s).d;
      // what it would replace, for the hit cap: itself when worn here, else the weaker item (and a two-hander
      // also frees the off hand's hit)
      const replOf = (c) => {
        const own = cur.find((y) => y.id && y.id === c.id && W.sameSt(y.st, c.st));
        const r = own ? own.st : weakest.st;
        return name === 'Main hand' && c.inv === TWO_HAND && worn[17] ? W.addSt(r, worn[17].st) : r;
      };
      const x = (c, extra) => { const s = score(c.st, w, name, replOf(c)), o = swap(c, s); return Object.assign({ c, s, d: o.d, sb: o.sd.sets.length ? o.sd : null }, extra || {}); };
      const distinct = (list) => { const seen = new Set(); return list.filter((y) => !seen.has(y.c.name) && seen.add(y.c.name)); };
      const byGain = (a, b) => b.d - a.d;
      // ---- usable now: fixed items, your own, AH listings
      // what you own comes first, so an item you have shows as yours rather than as a drop
      // ---- random greens: the best base for each suffix at your level (any creature of its level drops it)
      const bestRoll = {};
      cand.rolls.forEach((c) => {
        if (!fits(c) || c.req > lvl) return;
        // ranked by gain: in the main hand a two-hander also replaces the off hand
        const s = score(c.st, w, name, replOf(c)), d = gain(c, s);
        if (!bestRoll[c.roll] || d > bestRoll[c.roll].d) bestRoll[c.roll] = { c, s, d, n: 0 };
      });
      cand.rolls.forEach((c) => { if (bestRoll[c.roll] && fits(c) && c.req <= lvl) bestRoll[c.roll].n++; });
      const pool = mine.filter((c) => fits(c) && c.req <= lvl && !wornIds.has(c.id)).map((c) => x(c))
        .concat(cand.fixed.filter((c) => fits(c) && c.req <= lvl && !wornIds.has(c.id)).map((c) => x(c, listedBy[c.key] ? { ah: listedBy[c.key] } : null)))
        .concat(listed.filter((l) => l.c.roll && fits(l.c) && l.c.req <= lvl).map((l) => x(l.c, { ah: listedBy[l.c.key] })))
        .concat(Object.values(bestRoll).map((r) => x(r.c, listedBy[r.c.key] ? { ah: listedBy[r.c.key] } : { bases: r.n })));
      const ups = distinct(pool.filter((y) => y.d > 0.5).sort(byGain));
      // the best few, plus the best of each other kind (yours, the AH, crafted, ...) so you see real choices
      const now = ups.slice(0, NOW_MAX - 2);
      const kind = (y) => (y.ah ? 'ah' : y.c.kind);
      KINDS.forEach(([k]) => { if (now.length < NOW_MAX + 2 && !now.some((y) => kind(y) === k)) { const b = ups.find((y) => kind(y) === k); if (b) now.push(b); } });
      now.sort(byGain);
      const ahUps = distinct(pool.filter((y) => y.ah && y.d > 0.5).sort(byGain));
      const search = Object.values(bestRoll).map((r) => Object.assign(r, { d: gain(r.c, r.s) })).filter((r) => r.d > 0.5).sort(byGain).slice(0, 3);
      // ---- pre-BiS: the best up to the level cap, counting what you own; one random roll at most (its best base)
      const preRolls = {};
      cand.rolls.forEach((c) => { if (fitsPre(c) && c.req <= cap) { const s = score(c.st, w, name, replOf(c)); if (!preRolls[c.roll] || s > preRolls[c.roll].s) preRolls[c.roll] = { c, s }; } });
      const prePool = mine.filter(fitsPre).map((c) => x(c))
        .concat(cand.fixed.filter((c) => fitsPre(c) && c.req <= cap).map((c) => x(c)))
        .concat(cur.filter((y) => y.id && !cand.byId[String(y.id)] && !mine.some((m) => m.id === y.id))
          .map((y) => x({ id: y.id, key: y.key || String(y.id), g: A.gdItem(y.id) || [A.anyItemName(y.id), 1], name: A.anyItemName(y.id), inv: wornInv(y) || invs[0], req: 0, st: y.st, kind: 'owned' })));
      const topRoll = Object.values(preRolls).sort((a, b) => b.s - a.s)[0];
      if (topRoll) prePool.push(x(topRoll.c));
      // "only what you can get": no unmet reputation or profession gates (your own items always count)
      const pre = distinct(prePool.filter((y) => !reach || y.c.kind === 'owned' || !needs(y.c).length).sort((a, b) => b.s - a.s));
      // your picks come first; then the best that's left
      const n = nums.length;
      const want = arr(picks[name]).map((k) => pre.find((y) => y.c.key === k)).filter(Boolean);
      const targets = want.concat(pre.filter((y) => !want.includes(y))).slice(0, n).map((y) => Object.assign({ picked: want.includes(y) }, y));
      const alts = pre.filter((y) => !targets.some((t) => t.c.name === y.c.name)).slice(0, PRE_ALTS);
      // ---- not in game yet, raid or PvP: the best few, scored the same way, never a target
      const later = distinct(cand.later.filter((c) => fitsPre(c) && !wornIds.has(c.id) && !mine.some((m) => m.id === c.id)).map((c) => x(c)).sort((a, b) => b.s - a.s)).slice(0, LATER_MAX);
      return { name, nums, cur, weakest, blocked, ups, now, ahUps, search, targets, alts, pre, later };
    });
    // Main hand: a two-hander target makes the off hand target moot (and the other way round)
    const mh = slots.find((s) => s.name === 'Main hand'), oh = slots.find((s) => s.name === 'Off hand');
    if (mh && oh && mh.targets[0]) {
      const t = mh.targets[0];
      const best1h = (t.c.inv === TWO_HAND ? mh.pre.find((y) => y.c.inv !== TWO_HAND) : t);
      const ohBest = oh.targets[0] ? oh.targets[0].s : 0;
      if (t.c.inv === TWO_HAND && !t.picked && best1h && best1h.s + ohBest > t.s) {
        // a one-hander and an off hand together beat the two-hander
        mh.alts = [t].concat(mh.alts.filter((y) => y !== best1h)).slice(0, PRE_ALTS);
        mh.targets = [Object.assign({ picked: false }, best1h)];
      }
      if (mh.targets[0].c.inv === TWO_HAND) oh.twoHander = true;
      // dual wield: a unique one-hander can't be the target for both hands
      const m0 = mh.targets[0].c, o0 = oh.targets[0] && oh.targets[0].c;
      if (!oh.twoHander && o0 && o0.id === m0.id && unique(m0)) {
        const next = oh.pre.find((y) => y.c.id !== m0.id);
        oh.alts = oh.alts.filter((y) => y !== next);
        oh.targets = next ? [Object.assign({ picked: false }, next)] : [];
      }
    }
    return { slots, listed, skipped: cand.skipped, at };
  }

  // ---------------------------------------------------------------- pre-BiS picks (per character, spec and slot)
  const pickKey = (spec) => store(spec, 'prebis');
  const getPicks = (spec) => { try { return JSON.parse(readChoice(spec, 'prebis') || '{}') || {}; } catch (e) { return {}; } };
  function setPick(spec, slot, key, unpick) {
    const p = getPicks(spec);
    if (key) {
      const isPair = slot === 'Ring' || slot === 'Trinket';
      const cur = arr(p[slot]).filter((k) => k !== key);
      p[slot] = isPair ? [key].concat(cur).slice(0, 2) : [key];
    } else if (unpick && arr(p[slot]).length > 1) p[slot] = arr(p[slot]).filter((k) => k !== unpick);   // one of two ring / trinket picks
    else delete p[slot];
    localStorage.setItem(pickKey(spec), JSON.stringify(p));
  }

  // ---------------------------------------------------------------- class sets
  // Every item set for your class, from the pack (pieces: ForeverDB; names and bonuses: endgametools).
  const INV_NAME = { 1: 'Head', 2: 'Neck', 3: 'Shoulder', 5: 'Chest', 20: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrist', 10: 'Hands',
    11: 'Finger', 12: 'Trinket', 16: 'Back', 13: 'One-hand', 17: 'Two-hand', 21: 'Main hand', 22: 'Off hand', 23: 'Held in off hand',
    14: 'Shield', 15: 'Ranged', 25: 'Thrown', 26: 'Ranged', 28: 'Relic' };
  const CLASS_BIT = { WARRIOR: 1, PALADIN: 2, HUNTER: 4, ROGUE: 8, PRIEST: 16, SHAMAN: 64, MAGE: 128, WARLOCK: 256, DRUID: 1024 };
  const SET_KIND = { dungeon: 'Dungeon', quest: 'Dungeon set upgrade (quests)', crafted: 'Crafted', vendor: 'Vendor', world: 'World drop', pvp: 'PvP (Honor)', raid: 'Raid' };
  const KIND_ORDER = ['Dungeon', 'Dungeon set upgrade (quests)', 'Crafted', 'Vendor', 'World drop', 'PvP (Honor)', 'Raid', 'Unknown source'];
  function classSets() {
    const bit = CLASS_BIT[char().classFile] || 0, at = ownedAt(), side = (char().faction || '')[0];
    return Object.entries(A.GD.sets || {}).filter(([, s]) => s[3] & bit && s[0]).map(([sid, [name, ids, bonus]]) => {
      const pieces = ids.map((id) => {
        const g = A.gdItem(id) || [];
        const how = (A.GD.how || {})[id], src = (A.GD.src || {})[id], vend = arr((A.GD.vend || {})[id]);
        const hv = howVendor(id);
        if (hv && hv.side && side && !hv.side.includes(side)) return null;            // only the other faction's vendor sells it
        const onForever = !!how || arr(src).some((r) => r[10] === 'f') || vend.some((v) => v[5] && (!v[7] || !side || v[7].includes(side)));
        return { id, g, slot: INV_NAME[g[4]] || '', on: onForever, kind: SET_KIND[kindOf(id)], at: at[id] || null };
      }).filter((p) => p && p.on);
      if (!pieces.length) return null;
      const kinds = {}; pieces.forEach((p) => p.kind && (kinds[p.kind] = (kinds[p.kind] || 0) + 1));
      const kind = Object.keys(kinds).sort((a, b) => kinds[b] - kinds[a])[0] || 'Unknown source';
      const slots = [...new Set(pieces.map((p) => p.slot))];
      const have = new Set(pieces.filter((p) => p.at).map((p) => p.slot)).size;
      const worn = new Set(pieces.filter((p) => p.at === 'worn').map((p) => p.slot)).size;
      const il = Math.round(pieces.reduce((a, p) => a + (p.g[2] || 0), 0) / pieces.length);
      return { sid, name: name || (pieces[0].g[0] || 'Set') + ' set', bonus: arr(bonus), pieces, kind, slots: slots.length, have, worn, il };
    }).filter(Boolean).sort((a, b) => (b.have > 0) - (a.have > 0) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.il - b.il);
  }

  // ---------------------------------------------------------------- view parts
  // an item: icon (with its tooltip), name in its quality colour, badges, and where it comes from
  const tagsOf = (c) => {
    const t = [];
    if (c.req > (char().level || 0)) t.push(`level ${c.req}`);
    if (c.size === 10) t.push('10-player');
    return t.map((x) => ` <span class="badge">${esc(x)}</span>`).join('');
  };
  // what you still need for it (reputation, profession skill) gets its own line, so it is never cut off
  function itemCell(c, sub) {
    const q = c.roll ? (c.g[1] || 2) : (c.kind === 'owned' && A.item(c.key) ? A.item(c.key).q : c.g[1]);
    const nd = c.kind === 'owned' ? [] : needs(c);
    // the shared item cell (app.js itemCell): icon and name both carry the item's tooltip
    return A.itemCell(c.id, { key: c.kind === 'owned' ? c.key : null, name: c.name || c.g[0], q, tags: tagsOf(c), sub: sub != null ? sub : whereOf(c), need: nd.length ? 'Needs ' + nd.join(' and ') : '' });
  }
  const srcCell = (y) => {
    const k = y.ah ? 'ah' : y.c.kind;
    const word = y.c.kind === 'owned' ? (AT_WORD[y.c.where] || 'Yours') : KIND_WORD[k];
    return `<div><span class="src src-${k}">${esc(word)}</span></div>`;
  };
  const priceCell = (y) => (y.ah ? `<div class="c-num">${A.money(y.ah.price, { short: true })}<div class="sub">${y.ah.qty} listed · ${esc(A.ago(y.ah.t))}</div></div>` : '<div class="c-num dim">—</div>');
  const kindKey = (y) => (y.ah ? 'ah' : y.c.kind);
  const statusOf = (P, baseIds, c) => {
    if (baseIds.has(c.id) && !c.roll) return ['done', 'in use'];
    const at = c.kind === 'owned' ? c.where : (!c.roll && P.at[c.id]);
    return at ? ['have', AT_WORD[at] || 'yours'] : ['get', 'to get'];
  };

  // The slot list: every slot, what the compared gear has there, its score and the biggest gain you can get now.
  function slotList(P, sel, setSel) {
    let h = `<div class="slotlist"><div class="sl-h">${setSel}</div><div class="sl-cols"><span>Slot</span><span>Has</span><span class="c-num">Score</span><span class="c-num">Best</span></div>`;
    P.slots.forEach((sl) => {
      const best = sl.blocked ? null : sl.ups[0];
      const cur = sl.cur.map((x) => (x.id ? `<span class="have">${A.itemIconOf(x.id, { size: 'xs' })}${A.itemLink(x.id)}</span>` : '<span class="have dim">empty</span>')).join('');
      h += `<button class="slotrow${sl.name === sel ? ' on' : ''}" data-gearslot="${esc(sl.name)}"><span class="sn">${esc(sl.name)}</span><span class="cur">${cur}</span><span class="c-num">${fmt1(sl.weakest.s)}</span><span class="c-num ${best ? 'pos' : 'dim'}">${best ? gainTxt(best.d) : sl.blocked ? '2H' : '—'}</span></button>`;
    });
    return h + '</div>';
  }

  // One slot in full: every upgrade you can use now (filter by source), then the pre-BiS list with your target.
  const UP_SHOW = 15, PRE_SHOW = 10;
  function slotDetail(P, sl, lvl, base, filter) {
    const baseIds = new Set(Object.values(base.worn).map((x) => x.id));
    let h = `<section class="slotdet"><div class="det-h"><h2>${esc(sl.name)}</h2>${sl.cur.length > 1 ? '<span class="dim small">gains are measured against the weaker one</span>' : ''}</div>`;
    // ---- upgrades now
    h += `<h3>Upgrades at level ${lvl} <span>· better than ${esc(base.short)}</span></h3>`;
    if (sl.blocked) h += `<div class="empty">You wear a two-hander: an off hand only counts with a one-hand weapon (see Main hand).</div>`;
    else if (!sl.ups.length) h += `<div class="empty">Nothing you can use at level ${lvl} is better than ${esc(base.short)} here.</div>`;
    else {
      const counts = {};
      sl.ups.forEach((y) => { const k = kindKey(y); counts[k] = (counts[k] || 0) + 1; });
      const f = filter !== 'all' && counts[filter] ? filter : 'all';
      h += `<div class="chips"><button data-gearsrc="all" class="${f === 'all' ? 'on' : ''}">All<span>${sl.ups.length}</span></button>${KINDS.filter(([k]) => counts[k]).map(([k, l]) => `<button data-gearsrc="${k}" class="${f === k ? 'on' : ''}">${esc(l)}<span>${counts[k]}</span></button>`).join('')}</div>`;
      const full = f === 'all' ? sl.ups : sl.ups.filter((y) => kindKey(y) === f);
      const open = A.STATE.gearUpAll === sl.name, list = open ? full : full.slice(0, UP_SHOW);
      h += `<div class="table gopt"><div class="thead"><div>Item</div><div>Source</div><div class="c-num">AH price</div><div class="c-num">Score</div><div class="c-num">Gain</div></div>`;
      list.forEach((y) => { h += `<div class="tr">${itemCell(y.c)}${srcCell(y)}${priceCell(y)}<div class="c-num">${fmt1(y.s)}</div><div class="c-num pos">${gainTxt(y.d)}${setNote(y)}</div></div>`; });
      h += '</div>';
      if (full.length > UP_SHOW) h += `<button class="linkbtn more" data-gearupall="${open ? '' : esc(sl.name)}">${open ? 'Show the best ' + UP_SHOW : `Show all ${full.length}`}</button>`;
    }
    // ---- pre-BiS
    h += `<h3>Pre-BiS <span>· the best up to level ${capLevel()}, raids left out</span></h3>`;
    if (sl.twoHander) return h + `<div class="empty">Not needed: your main-hand target is a two-hander.</div>` + laterList(sl) + '</section>';
    const n = sl.targets.length;
    h += `<div class="toolbar"><div class="chips"><button data-gearreach="" class="${A.STATE.gearReach ? '' : 'on'}">Everything</button><button data-gearreach="1" class="${A.STATE.gearReach ? 'on' : ''}">Only what I can get now</button></div><span class="dim small">${n > 1 ? 'Your two targets are on top.' : 'Your target is on top.'} Make any other item ${n > 1 ? 'one of them' : 'your target'}.</span></div>`;
    const rest = sl.pre.filter((y) => !sl.targets.some((t) => t.c.name === y.c.name));
    const all = A.STATE.gearPreAll === sl.name;
    const shown = sl.targets.concat(all ? rest : rest.slice(0, PRE_SHOW));
    h += `<div class="table prelist"><div class="thead"><div>Item</div><div>Status</div><div class="c-num">Score</div><div></div></div>`;
    shown.forEach((y, i) => {
      const isT = i < n, [st, word] = statusOf(P, baseIds, y.c);
      const act = isT ? (y.picked ? `<span class="badge on">your pick</span> <button class="linkbtn" data-gearpick="${esc(sl.name)}" data-key="" data-unpick="${esc(y.c.key)}">use the best</button>` : '<span class="badge on">target</span>')
        : `<button class="btn ghost" data-gearpick="${esc(sl.name)}" data-key="${esc(y.c.key)}">Make target</button>`;
      h += `<div class="tr${isT ? ' target' : ''}">${itemCell(y.c)}<div><span class="st st-${st}">${esc(word)}</span></div><div class="c-num">${fmt1(y.s)}</div><div class="act">${act}</div></div>`;
    });
    h += '</div>';
    if (rest.length > PRE_SHOW) h += `<button class="linkbtn more" data-gearpreall="${all ? '' : esc(sl.name)}">${all ? 'Show fewer' : `Show all ${rest.length + n}`}</button>`;
    return h + laterList(sl) + '</section>';
  }

  // Raid, PvP and not-yet-seen items: shown with why they aren't in Upgrades or Pre-BiS
  function laterList(sl) {
    if (!sl.later.length) return '';
    let h = `<details class="later"><summary><h3>Raid, PvP and not in game yet <span>· ${sl.later.length} left out of Pre-BiS</span></h3></summary>`;
    h += `<div class="table laterlist"><div class="thead"><div>Item</div><div>Why not now</div><div class="c-num">Score</div><div class="c-num">Gain</div></div>`;
    sl.later.forEach((y) => { h += `<div class="tr">${itemCell(y.c)}<div><span class="src src-${esc(y.c.avail)}">${esc(availWord(y.c))}</span></div><div class="c-num">${fmt1(y.s)}</div><div class="c-num ${y.d > 0 ? 'pos' : 'dim'}">${gainTxt(y.d)}</div></div>`; });
    return h + '</div></details>';
  }

  // Auction House: upgrades listed now, then the random-suffix rolls worth searching for
  function ahView(P, lvl) {
    const ls = ((A.CH.ah || {}).lastScan) || null;
    let h = `<p class="meta">${ls ? `From your last full scan, ${esc(A.ago(ls.t))}` : 'No full scan yet: open the Auction House in game and press Claude scan'}. Listings older than 3 days are left out. Random-suffix greens are scored from their roll's exact stats (foreverchanges.pro, confirmed in game).</p>`;
    const rows = P.slots.flatMap((sl) => sl.ahUps.map((y) => ({ sl, y }))).sort((a, b) => b.y.d - a.y.d);
    h += '<h2>Upgrades listed now</h2>';
    if (!rows.length) h += `<div class="empty">Nothing on your Auction House beats what you have at level ${lvl}${ls ? '' : ' (no scan yet)'}.</div>`;
    else {
      h += `<div class="table ahup"><div class="thead"><div>Item</div><div>Slot</div><div class="c-num">Price</div><div class="c-num">Gain</div><div class="c-num">Gain per gold</div></div>`;
      rows.forEach(({ sl, y }) => { h += `<div class="tr">${itemCell(y.c)}<div class="dim">${esc(sl.name)}</div>${priceCell(y)}<div class="c-num pos">${gainTxt(y.d)}</div><div class="c-num dim">${(y.d / Math.max(y.ah.price / 10000, 0.01)).toFixed(1)}</div></div>`; });
      h += '</div>';
    }
    h += `<h2>Rolls to search for</h2><p class="meta">Random-suffix greens and blues that would be upgrades at level ${lvl}: search the AH for the suffix (for example “of Healing”). The best base for each roll is shown; others with the same suffix score a little lower.</p>`;
    const srows = P.slots.flatMap((sl) => sl.search.map((r) => ({ sl, r })));
    if (!srows.length) h += '<div class="empty">No random-suffix roll beats what you have.</div>';
    else {
      h += `<div class="table rollsrch"><div class="thead"><div>Slot</div><div>Search for</div><div>Best base</div><div class="c-num">Gain</div></div>`;
      srows.forEach(({ sl, r }) => {
        const st = Object.entries(r.c.st).filter(([k]) => Number(k) < 100 || Number(k) >= 110).map(([k, v]) => `+${v} ${W.statName(k, A.GD.stat)}`).join(', ');
        h += `<div class="tr"><div class="dim">${esc(sl.name)}</div><div><b>${esc(r.c.roll)}</b><div class="sub">${esc(st)}</div></div>${itemCell(r.c, `requires level ${r.c.req} · ${r.n} bases roll it`)}<div class="c-num pos">${gainTxt(r.d)}</div></div>`;
      });
      h += '</div>';
    }
    return h;
  }

  function setsView(list) {
    if (!list.length) return '<div class="empty">No item sets for your class in the game data yet.</div>';
    let h = '<p class="meta">Every item set for your class that Forever is known to have. Bonuses you have active (pieces worn) are highlighted.</p><div class="setlist">';
    list.forEach((s) => {
      const open = s.have > 0 ? ' open' : '';
      h += `<details class="setcard"${open}><summary><span class="nm">${esc(s.name)}</span><span class="dim small">${esc(s.kind)} · item level ${s.il}</span><span class="badge${s.have ? ' on' : ''}">${s.have}/${s.slots} owned</span></summary>`;
      h += '<div class="setbody"><div class="table setp"><div class="thead"><div>Piece</div><div>Where</div><div>Status</div></div>';
      s.pieces.sort((a, b) => a.slot.localeCompare(b.slot)).forEach((p) => {
        const c = { id: p.id, g: p.g, name: p.g[0], how: (A.GD.how || {})[p.id], boe: p.g[7] === 2 };
        h += `<div class="tr">${itemCell(c, p.slot)}<div class="sub">${esc(whereOf(c))}</div><div>${p.at ? `<span class="badge on">${AT_WORD[p.at]}</span>` : '<span class="badge">missing</span>'}</div></div>`;
      });
      h += '</div>';
      if (s.bonus.length) h += `<ul class="bonus">${s.bonus.map(([n, t]) => `<li class="${s.worn >= n ? 'pos' : ''}"><b>(${n})</b> ${esc(t)}</li>`).join('')}</ul>`;
      h += '</div></details>';
    });
    return h + '</div>';
  }

  // ---------------------------------------------------------------- the page
  const VIEWS = [['up', 'By slot'], ['ench', 'Enchants'], ['ah', 'Auction House'], ['sets', 'Class sets']];
  const curSpec = () => { const l = specs(); return l.find((s) => s.i === A.STATE.gearSpec) || l.find((s) => s.i === (A.CH.snap || {}).activeSpec) || l[0]; };

  V.gear = function () {
    const ch = char();
    if (!A.GD || !A.GD.items) return '<div class="empty">The game-data pack (data/gamedata.js) is missing.</div>';
    if (!canUse()) return '<div class="empty">Your weapon and armor skills aren\'t saved yet: Sync in game.</div>';
    const list = specs();
    if (!list.length) return '<div class="empty">Talents not saved yet: Sync in game.</div>';
    const active = (A.CH.snap || {}).activeSpec;
    const cur = curSpec();
    let h = `<div class="seg">${list.map((s) => `<button data-gearspec="${s.i}" class="${s.i === cur.i ? 'on' : ''}">${esc(s.label)}${s.i === active ? ' · active' : ''}</button>`).join('')}</div>`;
    const pk = profileKey(cur), prof = W.get(pk);
    const w = pk && weightsFor(cur, pk);
    const view = VIEWS.some(([k]) => k === A.STATE.gearView) ? A.STATE.gearView : 'up';
    const base = baseline(cur, pk);
    const sets = SETS();
    const setSel = `<label class="sel"><span class="k">Compare with</span>${sets.length ? `<select data-gearset>${[['worn', 'What you wear'], ...sets.map((g) => [String(g.id), `“${g.name}” set`])].map(([k, l]) => `<option value="${esc(k)}"${base.key === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>` : '<span>What you wear</span>'}</label>`;
    h += `<div class="toolbar"><div class="seg">${VIEWS.map(([k, l]) => `<button data-gearview="${k}" class="${view === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
    if (!w || !Object.keys(w).length) return h + `<div class="empty">No stat weights for ${esc(cur.tree || cur.label)} yet. Pick or make some on the <button class="linkbtn" data-tab="weights">Stat weights</button> page.</div>`;
    if (w.hit) h += hitLine(w.hit);
    if (w.crit) h += critLine(w.crit);
    const lvl = ch.level || capLevel();
    const P = plan(w, lvl, base, getPicks(cur), !!A.STATE.gearReach);
    const upSlots = P.slots.filter((s) => s.ups.length && !s.blocked);
    const bigUp = upSlots.slice().sort((a, b) => b.ups[0].d - a.ups[0].d)[0];
    const ahN = P.slots.reduce((a, s) => a + s.ahUps.length, 0);
    const cheapest = P.slots.flatMap((s) => s.ahUps).sort((a, b) => a.ah.price - b.ah.price)[0];
    const preT = P.slots.filter((s) => !s.twoHander).flatMap((s) => s.targets);
    const baseIds = new Set(Object.values(base.worn).map((x) => x.id));
    const preDone = preT.filter((t) => baseIds.has(t.c.id) && !t.c.roll).length;
    const top = Object.entries(w).filter(([k]) => !W.PCT[k]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${W.statName(k, A.GD.stat)} ${+v.toFixed(2)}`).join(', ');
    const sel = P.slots.some((s) => s.name === A.STATE.gearSlot) ? A.STATE.gearSlot : (bigUp || P.slots[0]).name;
    const why = pickedProfile(cur) ? 'your pick' : cur.treeWhy === 'none' ? `no talents yet: ${cur.tree}` : `default for ${cur.tree}`;
    h += `<div class="cards c4">
      <button class="card link" data-gearview="up" data-gearslot="${esc(bigUp ? bigUp.name : sel)}"><span class="k">Slots with an upgrade</span><span class="v">${upSlots.length} of ${P.slots.length}</span><span class="sub">${upSlots.length ? `biggest: ${esc(bigUp.name)} ${gainTxt(bigUp.ups[0].d)}` : `nothing beats ${esc(base.short)}`}</span></button>
      <button class="card link" data-gearview="ah"><span class="k">Upgrades on your AH</span><span class="v">${ahN}</span><span class="sub"${cheapest ? ` title="${esc(cheapest.c.name)}"` : ''}>${cheapest ? `cheapest from ${A.money(cheapest.ah.price, { short: true })}` : 'none listed now'}</span></button>
      <div class="card"><span class="k">Pre-BiS targets</span><span class="v">${preDone} of ${preT.length}</span><span class="sub">already in ${esc(base.short)}</span></div>
      <button class="card link" data-tab="weights"><span class="k">Stat weights</span><span class="v">${esc(prof.name)}</span><span class="sub" title="${esc(top)}">${esc(why)} · ${esc(top)}</span></button></div>`;
    if (view === 'up') h += `<div class="gearlay">${slotList(P, sel, setSel)}${slotDetail(P, P.slots.find((s) => s.name === sel), lvl, base, KIND_WORD[A.STATE.gearSrc] ? A.STATE.gearSrc : 'all')}</div>`;
    else if (view === 'ah') h += `<div class="toolbar">${setSel}</div>` + ahView(P, lvl);
    else if (view === 'ench') h += `<div class="toolbar">${setSel}</div>` + (CC.enchants ? CC.enchants.view(w, base) : '');
    else h += setsView(classSets());
    if (view !== 'sets' && view !== 'ench') h += `<details class="how"><summary>How this works, and what's left out</summary><p>Score = each stat × its weight, added up. Gain = score minus the score of ${esc(base.short)} in that slot (rings and trinkets: the weaker one). Random greens ("of Healing") are scored from their roll's exact stats (foreverchanges.pro, confirmed in game); for each roll, the best base you can wear at your level is shown. Left out: ${Object.entries(P.skipped).map(([k, v]) => `${v.toLocaleString()} ${esc(k)}`).join(' · ')}. A set bonus with stats (resistances, spell power, mana per 5) counts in the gain when an item completes or breaks it (shown as "set +N"); pre-BiS ranks each item on its own. Use and proc effects, and set bonuses that are effects, aren't in the score. Sources follow the item tooltip: Forever data is marked, Classic-only rates say so.</p></details>`;
    return h;
  };

  // ---------------------------------------------------------------- the same advice as data, for the Claude snapshot (js/claude.js)
  CC.gear = {
    raidSource, raidRow, setDelta,
    kindOf,
    // why an item is kept out of upgrades and pre-BiS for this character ('raid', 'pvp', 'unseen', 'worldAh'), or null
    weightsAgainst,
    availability(id) { const c = canUse() && candidates(canUse(), char().class); const l = c && c.later.find((x) => x.id === Number(id)); return l ? l.avail : null; },
    summary() {
      const ch = char();
      if (!A.GD || !A.GD.items || !canUse()) return [];
      const active = (A.CH.snap || {}).activeSpec;
      const opt = (sl) => (y) => ({ slot: sl.name, id: y.c.id, name: y.c.name, roll: y.c.roll || null, score: +y.s.toFixed(1), gain: +y.d.toFixed(1),
        setBonus: y.sb ? { gain: +y.sb.d.toFixed(1), sets: y.sb.sets.map((s) => ({ name: s.name, from: s.from, to: s.to, gain: +s.d.toFixed(1) })) } : null,
        reqLevel: y.c.req, boe: !!y.c.boe, source: y.ah ? 'ah' : y.c.kind, where: y.c.kind === 'owned' ? y.c.where : whereOf(y.c), needs: needs(y.c),
        ah: y.ah ? { price: y.ah.price, listed: y.ah.qty, seen: y.ah.t } : null });
      const sets = classSets().map((s) => ({ name: s.name, kind: s.kind, owned: s.have, pieces: s.slots, worn: s.worn,
        missing: s.pieces.filter((p) => !p.at).map((p) => ({ id: p.id, name: p.g[0], slot: p.slot, where: whereOf({ id: p.id, g: p.g, how: (A.GD.how || {})[p.id] }) })),
        bonuses: s.bonus.map(([n, t, st]) => ({ pieces: n, text: t, active: s.worn >= n, counted: arr(st).length > 0 })) }));
      return specs().map((sp) => {
        const pk = profileKey(sp);
        const w = pk && weightsFor(sp, pk);
        const prof = W.get(pk);
        const out = { spec: sp.i, label: sp.label, tree: sp.tree, active: sp.i === active, weights: w && Object.keys(w).length ? pk : null, classSets: sets };
        if (!out.weights) return out;
        out.weightsName = prof.name;
        out.weightsChosen = pickedProfile(sp) ? 'picked' : ({ none: 'default: no talent points yet, the class levelling tree', unknown: 'default: talents unreadable, the class levelling tree', tie: 'default: tied trees, levelling tree first' })[sp.treeWhy] || 'default for the biggest tree';
        out.talentPoints = sp.points;
        out.weightsSource = prof.own ? 'yours' : (prof.src || {}).url || (prof.src || {}).label || null;
        out.weightValues = w;
        // the hit cap model (spell weights): how much hit you have, from where, and the cap it counts up to
        if (w.hit) out.hit = hitSummary(w.hit);
        // a healer's crit weight, measured from their own heals (weightValues has it in place of the profile's)
        if (w.crit) out.crit = { weight: w.crit.weight, profileWeight: w.crit.base, perPct: w.crit.perPct, ratingPer1Pct: w.crit.per1, healing: w.crit.healing,
          heals: w.crit.heals.map((h) => ({ name: h.name, rank: h.rank, avg: h.avg, cast: h.cast, coefficient: h.coef, size: h.size, perPct: h.perPct })),
          critBonus: w.crit.critBonus, overheal: +w.crit.overheal.toFixed(3), label: w.crit.label };
        const base = baseline(sp, pk);
        out.comparedWith = base.label;
        // each slot's enchant, scored, empty ones flagged, and the best you can get (js/enchants.js, #147)
        out.enchants = CC.enchants ? CC.enchants.summary(w, base) : [];
        const P = plan(w, ch.level || capLevel(), base, getPicks(sp));
        const baseIds = new Set(Object.values(base.worn).map((x) => x.id));
        out.worn = P.slots.map((sl) => ({ slot: sl.name, score: +sl.weakest.s.toFixed(1), items: sl.cur.filter((x) => x.id).map((x) => ({ id: x.id, name: A.anyItemName(x.id), score: +x.s.toFixed(1) })) }));
        out.upgrades = P.slots.flatMap((sl) => sl.now.map(opt(sl)));
        out.ahUpgrades = P.slots.flatMap((sl) => sl.ahUps.map(opt(sl)));
        out.watch = out.ahUpgrades;                 // the older name for AH upgrades
        out.rollsToSearch = P.slots.flatMap((sl) => sl.search.map((r) => ({ slot: sl.name, roll: r.c.roll, bestBase: r.c.g[0], id: r.c.id, reqLevel: r.c.req, gain: +r.d.toFixed(1), bases: r.n })));
        out.preBis = P.slots.filter((sl) => !sl.twoHander).flatMap((sl) => sl.targets.map((t) => ({ slot: sl.name, id: t.c.id, name: t.c.name, roll: t.c.roll || null, score: +t.s.toFixed(1),
          picked: t.picked, status: baseIds.has(t.c.id) && !t.c.roll ? 'done' : t.c.kind === 'owned' ? t.c.where : (!t.c.roll && P.at[t.c.id]) || 'missing', where: whereOf(t.c), needs: needs(t.c),
          alternatives: sl.alts.map((y) => ({ id: y.c.id, name: y.c.name, score: +y.s.toFixed(1), where: whereOf(y.c) })) })));
        // raid, PvP and not-yet-seen items, the best 3 per slot: never targets; `availability` says why
        out.notInPreBis = P.slots.flatMap((sl) => sl.later.slice(0, 3).map((y) => ({ slot: sl.name, id: y.c.id, name: y.c.name, score: +y.s.toFixed(1), gain: +y.d.toFixed(1),
          availability: y.c.avail, seenOnForever: y.c.seen, where: whereOf(y.c) })));
        return out;
      });
    },
    // shared with the Stat weights page and the item advice (js/weights.js, js/advice.js)
    specs, profileKey, pickedProfile, setProfile, baseline, canUse, weightsFor, SLOTS, handFits, wornInv, packSub,
    // for tests
    _plan: plan, _candidates: candidates, _listings: listings,
  };

  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-gearspec]');
    if (s) { A.STATE.gearSpec = Number(s.dataset.gearspec); A.render(); return; }
    const v = e.target.closest('[data-gearview]'), sl = e.target.closest('[data-gearslot]');
    if (sl) { A.STATE.gearSlot = sl.dataset.gearslot; A.STATE.gearSrc = 'all'; A.STATE.gearPreAll = null; A.STATE.gearUpAll = null; }
    if (v) A.STATE.gearView = v.dataset.gearview;
    if (v || sl) { A.render(); return; }
    const f = e.target.closest('[data-gearsrc]');
    if (f) { A.STATE.gearSrc = f.dataset.gearsrc; A.render(); return; }
    const ua = e.target.closest('[data-gearupall]');
    if (ua) { A.STATE.gearUpAll = ua.dataset.gearupall || null; A.render(); return; }
    const pa = e.target.closest('[data-gearpreall]');
    if (pa) { A.STATE.gearPreAll = pa.dataset.gearpreall || null; A.render(); return; }
    const r = e.target.closest('[data-gearreach]');
    if (r) { A.STATE.gearReach = !!r.dataset.gearreach; A.render(); return; }
    const p = e.target.closest('[data-gearpick]');
    if (p) { const sp = curSpec(); if (sp) setPick(sp, p.dataset.gearpick, p.dataset.key || null, p.dataset.unpick || null); A.render(); }
  });
  document.addEventListener('change', (e) => {
    const gs = e.target.closest('select[data-gearset]');
    if (gs) { const sp = curSpec(); if (sp) localStorage.setItem(store(sp, 'set'), gs.value); A.render(); }
  });
})();
