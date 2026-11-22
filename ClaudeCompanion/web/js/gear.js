// Claude Companion: Gear tab. Next upgrades, pre-BiS and a BoE watch list for each spec,
// scored from the game-data pack (endgametools tooltips, sources from QuestieDB / ForeverDB)
// and what you wear now (the game's own stats, so random suffixes count).
(function () {
  const CC = window.CC;
  if (!CC || !CC.api || !CC.V) return;
  const A = CC.api, V = CC.V, esc = A.esc, arr = A.arr;

  // ---------------------------------------------------------------- stat weights
  // Points per stat, +1 healing (or +1 spell damage) = 1. From stat-weights/weights-18nov-draft.md
  // (Healing) and the Shadow weights in project memory. 14 crit rating = 1% crit (foreverdb.net/stats),
  // so a "+1% spell crit" line counts as 14 rating.
  const PROFILES = {
    healing: { name: 'Healing', w: { 41: 1, 45: 1, 5: 1.6, 43: 2.3, 6: 0.7, 32: 0.3, 21: 0.3 * 14 } },
    shadow: { name: 'Shadow', w: { 45: 1, 42: 1, 111: 1, 6: 0.55, 43: 0.66, 5: 0.35, 32: 0.3, 21: 0.3 * 14, 31: 0.2 } },
  };
  // which profile a talent tree uses; a tree not listed here has no weights yet
  const TREE_PROFILE = { PRIEST: { Discipline: 'healing', Holy: 'healing', Shadow: 'shadow' } };
  // What you can wear comes from the game: the Weapon Skills (category 6) and Armor Proficiencies (8)
  // in your skill list, mapped to item subclasses (warcraft.wiki.gg ItemType). A few labels have
  // both the Classic and the modern spelling. Relics have no skill line: they follow the class.
  const WEAPON_SKILL = { 0: ['Axes', 'One-Handed Axes'], 1: ['Two-Handed Axes'], 2: ['Bows', 'Bow'], 3: ['Guns', 'Gun'],
    4: ['Maces', 'One-Handed Maces'], 5: ['Two-Handed Maces'], 6: ['Polearms'], 7: ['Swords', 'One-Handed Swords'],
    8: ['Two-Handed Swords'], 10: ['Staves'], 13: ['Fist Weapons'], 15: ['Daggers'], 16: ['Thrown'], 18: ['Crossbows', 'Crossbow'], 19: ['Wands', 'Wand'] };
  const ARMOR_SKILL = { 1: ['Cloth'], 2: ['Leather'], 3: ['Mail'], 4: ['Plate Mail', 'Plate'], 6: ['Shield', 'Shields'] };
  const RELIC = { PALADIN: 7, DRUID: 8, SHAMAN: 9 };
  function canUse() {
    const have = new Set(arr((A.CH.snap || {}).skills).filter((k) => k && (k.skillLineCategoryID === 6 || k.skillLineCategoryID === 8)).map((k) => k.name));
    if (!have.size) return null;
    const pick = (map) => Object.entries(map).filter(([, names]) => names.some((n) => have.has(n))).map(([id]) => Number(id));
    const armor = [0, null, ...pick(ARMOR_SKILL)];            // rings, necks, trinkets, cloaks: no subclass or Miscellaneous
    if (RELIC[char().classFile] != null) armor.push(RELIC[char().classFile]);
    return { 2: pick(WEAPON_SKILL), 4: armor };
  }
  // the game's GetItemStats names, for the stats of what you wear
  const GAME = { ITEM_MOD_AGILITY_SHORT: 3, ITEM_MOD_STRENGTH_SHORT: 4, ITEM_MOD_INTELLECT_SHORT: 5, ITEM_MOD_SPIRIT_SHORT: 6,
    ITEM_MOD_STAMINA_SHORT: 7, ITEM_MOD_SPELL_HEALING_DONE_SHORT: 41, ITEM_MOD_SPELL_DAMAGE_DONE_SHORT: 42,
    ITEM_MOD_MANA_REGENERATION_SHORT: 43, ITEM_MOD_SPELL_POWER_SHORT: 45, ITEM_MOD_SHADOW_DAMAGE_DONE_SHORT: 111,
    ITEM_MOD_HIT_RATING_SHORT: 31, ITEM_MOD_CRIT_RATING_SHORT: 32, ITEM_MOD_SPELL_CRIT_RATING_SHORT: 32,
    ITEM_MOD_ATTACK_POWER_SHORT: 38, ITEM_MOD_DEFENSE_SKILL_RATING_SHORT: 12, ITEM_MOD_DODGE_RATING_SHORT: 13, ITEM_MOD_PARRY_RATING_SHORT: 14,
    ITEM_MOD_BLOCK_RATING_SHORT: 15, ITEM_MOD_BLOCK_VALUE_SHORT: 48, ITEM_MOD_HEALTH_REGEN_SHORT: 46, ITEM_MOD_SPELL_PENETRATION_SHORT: 47,
    RESISTANCE0_NAME: 100, ITEM_MOD_FIRE_RESISTANCE_SHORT: 101, ITEM_MOD_FROST_RESISTANCE_SHORT: 102, ITEM_MOD_NATURE_RESISTANCE_SHORT: 103,
    ITEM_MOD_SHADOW_RESISTANCE_SHORT: 104, ITEM_MOD_ARCANE_RESISTANCE_SHORT: 105, ITEM_MOD_FIRE_DAMAGE_DONE_SHORT: 110,
    ITEM_MOD_FROST_DAMAGE_DONE_SHORT: 112, ITEM_MOD_ARCANE_DAMAGE_DONE_SHORT: 113, ITEM_MOD_NATURE_DAMAGE_DONE_SHORT: 114, ITEM_MOD_HOLY_DAMAGE_DONE_SHORT: 115 };

  // gear slots: game slot numbers you wear in, and the item inventory types that fit
  const SLOTS = [
    ['Head', [1], [1]], ['Neck', [2], [2]], ['Shoulder', [3], [3]], ['Back', [15], [16]], ['Chest', [5], [5, 20]],
    ['Wrist', [9], [9]], ['Hands', [10], [10]], ['Waist', [6], [6]], ['Legs', [7], [7]], ['Feet', [8], [8]],
    ['Ring', [11, 12], [11]], ['Trinket', [13, 14], [12]], ['Main hand', [16], [13, 21, 17]],
    ['Off hand', [17], [23, 14, 22]], ['Ranged', [18], [15, 25, 26, 28]],
  ];

  const char = () => ((A.CH && A.CH.snap) || {}).character || {};
  const idOf = (key) => { const m = /item:(\d+)/.exec(key || ''); return m ? Number(m[1]) : null; };
  const score = (st, w) => Object.entries(st).reduce((a, [k, v]) => a + (w[k] || 0) * v, 0);
  const packStats = (id) => { const g = A.gdItem(id); return g ? Object.fromEntries(arr(g[8])) : {}; };
  // the game's own numbers for an item you have (random suffixes count), else the pack's
  function ownStats(mine, id) {
    if (!(mine && mine.stats)) return packStats(id);
    const st = {};
    Object.entries(mine.stats).forEach(([k, v]) => { if (GAME[k]) st[GAME[k]] = (st[GAME[k]] || 0) + v; });
    return st;
  }

  // the spec a gear list is for: chosen in the tab, else the active one
  function specs() {
    const raw = (A.CH && A.CH.specs) || {};
    const cf = char().classFile;
    return Object.entries(raw).map(([k, sp]) => {
      const t = A.specTrees(sp);
      let tree = null;
      if (t && t.length) { let b = 0; t.forEach((x, i) => { if (x.points > t[b].points) b = i; }); tree = (A.TREE_NAMES[cf] || [])[b]; }
      return { i: Number(k), sp, label: A.specLabel(sp) || 'Spec ' + k, tree };
    }).sort((a, b) => a.i - b.i);
  }
  // choices are kept per character and spec, in this browser
  const store = (spec, what) => `cc.gear.${what}.${char().name || ''}.${spec.i}`;
  const ownWeights = (spec) => { try { return JSON.parse(localStorage.getItem(store(spec, 'own')) || 'null'); } catch (e) { return null; } };
  const profileKey = (spec) => localStorage.getItem(store(spec, 'profile')) || localStorage.getItem('cc.gear.profile.' + spec.i) || ((TREE_PROFILE[char().classFile] || {})[spec.tree]);
  // What a spec's upgrades are measured against: the gear set for that spec, else what you wear now.
  // A set is linked by your pick in the tab, else the game's own spec link, else a name that matches the
  // spec or its weights ("heals" ~ Healing, "shadow" ~ Shadow).
  const SETS = () => arr((A.CH.snap || {}).gearSets).filter((g) => g && g.name && arr(g.items).length);
  function baseline(spec, pk) {
    const sets = SETS(), pick = localStorage.getItem(store(spec, 'set'));
    const stem = (x) => (x || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 4);
    const words = [spec.tree, pk && PROFILES[pk] && PROFILES[pk].name].map(stem).filter((x) => x.length === 4);
    const byName = (g) => g.name.toLowerCase().split(/[^a-z]+/).some((t) => words.includes(stem(t)));
    let set = null, why = '';
    if (pick === 'worn') set = null;
    else if (pick && (set = sets.find((g) => String(g.id) === pick))) why = 'your pick';
    else if ((set = sets.find((g) => g.spec === spec.i))) why = 'linked to this spec in game';
    else if ((set = sets.filter(byName).length === 1 ? sets.find(byName) : null)) why = 'matched by name';
    if (!set) {
      const worn = {};
      Object.values((A.CH.snap || {}).equipped || {}).forEach((e) => { if (e && e.item) worn[e.slot] = { id: idOf(e.item), st: ownStats(A.item(e.item), idOf(e.item)) }; });
      return { key: 'worn', label: 'what you wear now', worn };
    }
    const worn = {};
    arr(set.items).forEach((x) => { if (x && x.id > 0) worn[x.slot] = { id: x.id, st: ownStats(A.byId(x.id), x.id) }; });
    const lost = set.numLost ? `; the game listed ${set.numLost} of its items as missing when it saved` : '';
    return { key: String(set.id), label: `your “${set.name}” set (${why}${lost})`, worn };
  }
  const weightsFor = (spec, pk) => (pk === 'own' ? ownWeights(spec) : PROFILES[pk] && PROFILES[pk].w);
  // stats you can weigh in "Your own weights"
  const EDITABLE = [4, 3, 7, 5, 6, 38, 31, 117, 32, 116, 21, 18, 45, 42, 41, 43, 12, 100];

  // ---------------------------------------------------------------- candidates
  let cache = null;
  function candidates(use, cls) {
    const ck = JSON.stringify(use);
    if (cache && cache.ck === ck) return cache;
    const out = [], skipped = { 'raid only': 0, 'other faction only': 0, 'only Classic data says where it comes from': 0, 'no endgametools tooltip': 0, 'not for your class': 0, 'no known source': 0 };
    for (const [k, g] of Object.entries((A.GD && A.GD.items) || {})) {
      const c = g[9], sub = g[12];
      if (c !== 2 && c !== 4) continue;
      if (!use || !(use[c] || []).includes(sub)) continue;
      if (g[11] !== 'e') { skipped['no endgametools tooltip']++; continue; }
      const only = arr(g[10]).find((l) => /^Classes: /.test(l));
      if (only && !only.includes(cls)) { skipped['not for your class']++; continue; }
      const id = Number(k), src = (A.GD.src || {})[k], vend = (A.GD.vend || {})[k];
      const boe = g[7] === 2;
      // only what Forever is known to have: the client's own source (endgametools), a Forever sighting or
      // Forever quest data (ForeverDB / QuestieDB), or a vendor seen selling it on Forever
      const how = (A.GD.how || {})[k];
      const side = (char().faction || '')[0];            // 'A' or 'H'; vendors that only serve the other side don't count
      const myVend = arr(vend).filter((v) => !v[7] || !side || v[7].includes(side));
      if (vend && !myVend.length && !src && !how) { skipped['other faction only']++; continue; }
      const onForever = how || arr(src).some((r) => r[10] === 'f') || myVend.some((v) => v[5]);
      if (!onForever) { skipped[src || vend ? 'only Classic data says where it comes from' : 'no known source']++; continue; }
      // raids are left out (a raid drop, or a quest ForeverDB lists as a raid quest); 10-player UBRS stays, marked
      const size = (A.GD.size || {})[k] || 0;
      const raidQuest = arr(src).some((r) => r[0] === 'quest' && ((A.GD.quests || {})[r[2]] || {}).type === 'Raid');
      if (size >= 20 || raidQuest) { skipped['raid only']++; continue; }
      out.push({ id, g, inv: g[4], req: g[3] || 0, st: Object.fromEntries(arr(g[8])), boe, size, how });
    }
    cache = { ck, out, skipped };
    return cache;
  }

  function plan(w, lvl, worn) {
    const ch = char();
    const { out, skipped } = candidates(canUse(), ch.class);
    const wornIds = new Set(Object.values(worn).map((x) => x.id));
    const twoHand = worn[16] && A.gdItem(worn[16].id) && A.gdItem(worn[16].id)[4] === 17;
    return SLOTS.map(([name, slots, invs]) => {
      const cur = slots.map((s) => worn[s]).filter(Boolean);
      // compare against the weaker of two rings / trinkets; a two-hander also fills the off hand
      let base = cur.length ? Math.min(...cur.map((x) => score(x.st, w))) : 0;
      if (cur.length < slots.length) base = 0;
      const offScore = worn[17] ? score(worn[17].st, w) : 0;
      const fits = out.filter((c) => invs.includes(c.inv) && !wornIds.has(c.id) && !(name === 'Off hand' && twoHand));
      const gain = (c) => (name === 'Main hand' && c.inv === 17 ? score(c.st, w) - base - offScore : score(c.st, w) - base);
      // the client can carry two items with one name (an old and a Forever copy): keep the better one
      const rank = (list) => { const seen = new Set(); return list.map((c) => ({ c, s: score(c.st, w), d: gain(c) })).filter((x) => x.d > 0.5).sort((a, b) => b.d - a.d).filter((x) => !seen.has(x.c.g[0]) && seen.add(x.c.g[0])); };
      return {
        name, cur, base,
        now: rank(fits.filter((c) => c.req <= lvl)).slice(0, 3),
        pre: rank(fits.filter((c) => c.req <= 60)).slice(0, 1),
        watch: rank(fits.filter((c) => c.boe && c.req <= lvl + 2)).slice(0, 2),
      };
    }).concat([{ skipped }]);
  }

  // ---------------------------------------------------------------- what you still need for an item
  // Reputation and profession gates from the tooltip, the recipe line and the reward quest; only unmet ones show.
  const STANDING = ['', 'Hated', 'Hostile', 'Unfriendly', 'Neutral', 'Friendly', 'Honored', 'Revered', 'Exalted'];
  const REP_AT = [[42000, 8], [21000, 7], [9000, 6], [3000, 5], [0, 4]];
  function needs(c) {
    const snap = A.CH.snap || {};
    const rep = (name) => { const r = arr(snap.reputation).find((x) => x.name === name); return r ? r.reaction : 0; };
    const skill = (name) => { const r = arr(snap.skills).find((x) => x.name === name); return r ? r.rank : 0; };
    const out = [];
    const wantRep = (f, lvl) => { const have = rep(f); if (have < lvl) out.push(`${f} ${STANDING[lvl]} (you: ${STANDING[have] || 'none'})`); };
    arr(c.g[10]).forEach((l) => { const m = /^Requires (.+) - (Friendly|Honored|Revered|Exalted)$/.exec(l); if (m) wantRep(m[1], STANDING.indexOf(m[2])); });
    const m = /Requires ([A-Z][a-z]+(?: [A-Z][a-z]+)?) \((\d+)\)/.exec(c.how || '');
    if (m && !c.boe && skill(m[1]) < Number(m[2])) out.push(`${m[1]} ${m[2]} (you: ${skill(m[1]) || 'none'})`);
    arr((A.GD.src || {})[c.id]).filter((r) => r[0] === 'quest').map((r) => (A.GD.quests || {})[r[2]]).filter((q) => q && q.repReq)
      .forEach((q) => { const [f, v] = q.repReq[0] || []; if (f) wantRep(f, (REP_AT.find(([n]) => v >= n) || [0, 4])[1]); });
    return [...new Set(out)];
  }

  // ---------------------------------------------------------------- view
  function row(x, slot) {
    const id = x.c.id, g = x.c.g;
    const src = A.gdSourceLines(id, 1, false)[0];
    const price = x.c.boe ? A.planPrice(id) : null;
    const where = x.c.how || (src && src.l) || (x.c.boe ? 'BoE: not seen on your AH yet' : '');
    const how = (price ? `AH ${A.money(price, { short: true })} · ` : '') + esc(where);
    const need = needs(x.c).map((r) => ` <span class="badge">needs ${esc(r)}</span>`).join('');
    return `<div class="tr"><div class="c-main">${A.anyItemIcon(id, { size: 'sm' })}<div class="grow"><div class="nm"><span class="q${g[1]}">${esc(g[0])}</span>${x.c.req > (char().level || 0) ? ` <span class="badge">level ${x.c.req}</span>` : ''}${x.c.boe ? ' <span class="badge">BoE</span>' : ''}${x.c.size === 10 ? ' <span class="badge">10-player</span>' : ''}${need}</div><div class="sub">${esc(slot)} · ${how}</div></div></div><div class="c-num">${x.s.toFixed(1)}</div><div class="c-num pos">+${x.d.toFixed(1)}</div></div>`;
  }
  function table(title, plans, key, empty) {
    let h = `<h3>${esc(title)}</h3><div class="table geart"><div class="thead"><div>Item</div><div class="c-num">Score</div><div class="c-num">Gain</div></div>`;
    let n = 0;
    plans.forEach((p) => p[key] && p[key].forEach((x) => { h += row(x, p.name); n++; }));
    if (!n) h += `<div class="tr"><div class="dim">${esc(empty)}</div></div>`;
    return h + '</div>';
  }

  V.gear = function () {
    const ch = char();
    if (!A.GD || !A.GD.items) return '<div class="empty">The game-data pack (data/gamedata.js) is missing.</div>';
    if (!canUse()) return '<div class="empty">Your weapon and armor skills aren\'t saved yet: Sync in game.</div>';
    const list = specs();
    if (!list.length) return '<div class="empty">Talents not saved yet: Sync in game.</div>';
    const active = (A.CH.snap || {}).activeSpec;
    const cur = list.find((s) => s.i === A.STATE.gearSpec) || list.find((s) => s.i === active) || list[0];
    let h = `<div class="seg">${list.map((s) => `<button data-gearspec="${s.i}" class="${s === cur ? 'on' : ''}">${esc(s.label)}${s.i === active ? ' · active' : ''}</button>`).join('')}</div>`;
    const pk = profileKey(cur);
    const own = ownWeights(cur) || {};
    h += `<div class="toolbar"><div class="chips">${Object.entries(PROFILES).map(([k, p]) => `<button data-gearprof="${k}" class="${pk === k ? 'on' : ''}">${p.name} weights</button>`).join('')}<button data-gearprof="own" class="${pk === 'own' ? 'on' : ''}">Your own weights</button></div></div>`;
    if (pk === 'own') {
      h += `<div class="wedit">${EDITABLE.map((k) => `<label><span>${esc((A.GD.stat || {})[k] || k)}</span><input type="number" step="0.05" min="0" data-gearw="${k}" value="${own[k] != null ? own[k] : ''}" placeholder="0"></label>`).join('')}</div>`;
    }
    const w = pk && weightsFor(cur, pk);
    if (!w || !Object.keys(w).length) return h + `<div class="empty">No stat weights for ${esc(cur.tree || cur.label)} yet. Pick a set above or type your own (points per 1 of each stat), or ask Claude to work out weights for this spec.</div>`;
    const lvl = ch.level || 60;
    const base = baseline(cur, pk);
    const sets = SETS();
    if (sets.length) h += `<div class="toolbar"><span class="dim small">Compare with</span><div class="chips">${[['worn', 'What you wear'], ...sets.map((g) => [String(g.id), g.name])].map(([k, l]) => `<button data-gearset="${esc(k)}" class="${base.key === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div></div>`;
    const plans = plan(w, lvl, base.worn);
    const skipped = plans.pop().skipped;
    h += `<p class="meta">${esc(pk === 'own' ? 'Your own' : PROFILES[pk].name)} weights: ${Object.entries(w).map(([k, v]) => `${esc((A.GD.stat || {})[k] || k)} ${+v.toFixed(2)}`).join(' · ')}. Score = sum of stat × weight. Gains are measured against ${esc(base.label)}.</p>`;
    h += table(`Next upgrades you can use at level ${lvl}`, plans, 'now', 'Nothing beats what you wear at your level.');
    h += '<div class="grid2"><section>' + table('Pre-BiS: best per slot up to level 60 (no raids)', plans, 'pre', 'What you wear is already the best per slot.');
    h += '</section><section>' + table('Watch the AH: BoE upgrades', plans, 'watch', 'No BoE upgrades for your slots.') + '</section></div>';
    h += `<details class="how"><summary>What's left out</summary><p>${Object.entries(skipped).map(([k, v]) => `${v.toLocaleString()} ${esc(k)}`).join(' · ')}. Items with no endgametools page are mostly ones Forever's client carries but doesn't drop. Gear you wear is never suggested. Sources and drop chances follow the item tooltip: Forever data is marked, Classic-only rates say so.</p></details>`;
    return h;
  };

  // the same advice as data, for the Claude snapshot (js/claude.js)
  CC.gear = {
    summary() {
      const ch = char();
      if (!A.GD || !A.GD.items || !canUse()) return [];
      const active = (A.CH.snap || {}).activeSpec;
      const row = (p) => (x) => ({ slot: p.name, id: x.c.id, name: x.c.g[0], score: +x.s.toFixed(1), gain: +x.d.toFixed(1),
        reqLevel: x.c.req, boe: x.c.boe, where: x.c.how || ((A.gdSourceLines(x.c.id, 1, false)[0] || {}).l || ''), needs: needs(x.c) });
      return specs().map((sp) => {
        const pk = profileKey(sp);
        const w = pk && weightsFor(sp, pk);
        const out = { spec: sp.i, label: sp.label, tree: sp.tree, active: sp.i === active, weights: w && Object.keys(w).length ? pk : null };
        if (!out.weights) return out;
        if (pk === 'own') out.ownWeights = w;
        const base = baseline(sp, pk);
        out.comparedWith = base.label;
        const plans = plan(w, ch.level || 60, base.worn);
        plans.pop();
        out.worn = plans.map((p) => ({ slot: p.name, score: +p.base.toFixed(1) }));
        out.upgrades = plans.flatMap((p) => p.now.map(row(p)));
        out.preBis = plans.flatMap((p) => p.pre.map(row(p)));
        out.watch = plans.flatMap((p) => p.watch.map(row(p)));
        return out;
      });
    },
    PROFILES,
  };

  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-gearspec]');
    if (s) { A.STATE.gearSpec = Number(s.dataset.gearspec); A.render(); return; }
    const gs = e.target.closest('[data-gearset]');
    if (gs) {
      const sp = specs().find((x) => x.i === A.STATE.gearSpec) || specs().find((x) => x.i === (A.CH.snap || {}).activeSpec) || specs()[0];
      if (sp) localStorage.setItem(store(sp, 'set'), gs.dataset.gearset);
      A.render(); return;
    }
    const p = e.target.closest('[data-gearprof]');
    if (p) {
      const sp = specs().find((x) => x.i === A.STATE.gearSpec) || specs().find((x) => x.i === (A.CH.snap || {}).activeSpec) || specs()[0];
      if (sp) localStorage.setItem(store(sp, 'profile'), p.dataset.gearprof);
      A.render();
    }
  });
  // typing a weight saves it; the lists redraw when you leave the box
  document.addEventListener('change', (e) => {
    const t = e.target.closest('[data-gearw]');
    if (!t) return;
    const sp = specs().find((x) => x.i === A.STATE.gearSpec) || specs().find((x) => x.i === (A.CH.snap || {}).activeSpec) || specs()[0];
    if (!sp) return;
    const w = ownWeights(sp) || {}, v = parseFloat(t.value);
    if (v > 0) w[t.dataset.gearw] = v; else delete w[t.dataset.gearw];
    localStorage.setItem(store(sp, 'own'), JSON.stringify(w));
    A.render();
  });
})();
