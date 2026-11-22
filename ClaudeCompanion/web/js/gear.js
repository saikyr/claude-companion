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
  function canUse() {
    const have = new Set(arr((A.CH.snap || {}).skills).filter((k) => k && (k.skillLineCategoryID === 6 || k.skillLineCategoryID === 8)).map((k) => k.name));
    if (!have.size) return null;
    const pick = (map) => Object.entries(map).filter(([, names]) => names.some((n) => have.has(n))).map(([id]) => Number(id));
    const armor = [0, null, ...pick(ARMOR_SKILL)];            // rings, necks, trinkets, cloaks: no subclass or Miscellaneous
    if (RELIC[char().classFile] != null) armor.push(RELIC[char().classFile]);
    return { 2: pick(WEAPON_SKILL), 4: armor };
  }
  // gear slots: game slot numbers you wear in, and the item inventory types that fit
  const SLOTS = [
    ['Head', [1], [1]], ['Neck', [2], [2]], ['Shoulder', [3], [3]], ['Back', [15], [16]], ['Chest', [5], [5, 20]],
    ['Wrist', [9], [9]], ['Hands', [10], [10]], ['Waist', [6], [6]], ['Legs', [7], [7]], ['Feet', [8], [8]],
    ['Ring', [11, 12], [11]], ['Trinket', [13, 14], [12]], ['Main hand', [16], [13, 21, 17]],
    ['Off hand', [17], [23, 14, 22]], ['Ranged', [18], [15, 25, 26, 28]],
  ];
  const TWO_HAND = 17;

  const char = () => ((A.CH && A.CH.snap) || {}).character || {};
  const idOf = (key) => { const m = /item:(\d+)/.exec(key || ''); return m ? Number(m[1]) : null; };
  const score = W.score;
  const packStats = (id) => W.fromPack(A.gdItem(id));
  // the game's own numbers for an item you have (random suffixes count), else the pack's
  const ownStats = (mine, id) => (mine && mine.stats ? W.fromGame(mine.stats, mine.tip) : packStats(id));
  const fmt1 = (v) => v.toFixed(1);
  const gainTxt = (d) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;

  // ---------------------------------------------------------------- specs and weights
  // a spec is named by its biggest talent tree (Forever answers the spec-name call with the class)
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
  // Keys use the game's talent group (spec1 / spec2). Choices made before that were saved under the
  // reader's array index (0 = group 1, 1 = group 2; a lone group 2 under 2) and are read from there
  // until something new is saved.
  const store = (spec, what) => `cc.gear.${what}.${char().name || ''}.spec${spec.i}`;
  const legacy = (spec, what) => (spec.i === 1 ? [0] : [1, 2]).map((n) => `cc.gear.${what}.${char().name || ''}.${n}`);
  const readChoice = (spec, what) => {
    const v = localStorage.getItem(store(spec, what));
    if (v != null) return v;
    for (const k of legacy(spec, what)) { const o = localStorage.getItem(k); if (o != null) return o; }
    return null;
  };
  // the profile you picked for a spec (null: the default for its biggest tree)
  function pickedProfile(spec) {
    const cls = char().classFile;
    W.migrate(char().name, spec.i - 1, cls);
    const pick = readChoice(spec, 'profile');
    const p = pick && W.get(pick);
    return p && p.cls === cls ? pick : null;
  }
  const profileKey = (spec) => pickedProfile(spec) || W.defaultFor(char().classFile, spec.tree);
  // clearing a pick stores '' so an older pick under the legacy key doesn't come back
  const setProfile = (spec, id) => localStorage.setItem(store(spec, 'profile'), id || '');
  const weightsFor = (spec, pk) => (W.get(pk) || {}).w || null;

  // What a spec's upgrades are measured against: the gear set for that spec, else what you wear now.
  // A set is linked by your pick, else the game's own spec link, else a name that matches the spec or its
  // weights ("heals" ~ Healing, "shadow" ~ Shadow).
  const SETS = () => arr((A.CH.snap || {}).gearSets).filter((g) => g && g.name && arr(g.items).length);
  function baseline(spec, pk) {
    const sets = SETS(), pick = readChoice(spec, 'set');
    const stem = (x) => (x || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 4);
    const role = (W.get(W.defaultFor(char().classFile, spec.tree)) || W.get(pk) || {}).role;
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
      return { key: 'worn', label: 'what you wear now', short: 'What you wear', worn };
    }
    const worn = {};
    arr(set.items).forEach((x) => { if (x && x.id > 0) { const mine = A.byId(x.id); worn[x.slot] = { id: x.id, key: mine && mine.key, st: ownStats(mine, x.id) }; } });
    const lost = set.numLost ? `; the game listed ${set.numLost} of its items as missing when it saved` : '';
    return { key: String(set.id), label: `your “${set.name}” set (${why}${lost})`, short: `“${set.name}” set`, worn };
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
  function kindOf(id) {
    const size = (A.GD.size || {})[id] || 0, rows = arr((A.GD.src || {})[id]);
    const how = (A.GD.how || {})[id] || '';
    if (size >= 20 || rows.some((r) => r[0] === 'quest' && ((A.GD.quests || {})[r[2]] || {}).type === 'Raid')) return 'raid';
    if (isPvp(id)) return 'pvp';
    if (size || /^(Boss Drop|Dungeon)/.test(how)) return 'dungeon';
    if (/^Quest/.test(how) || rows.some((r) => r[0] === 'quest' || r[0] === 'container')) return 'quest';
    if (/^Profession/.test(how) || rows.some((r) => r[0] === 'craft')) return 'crafted';
    if (/^Vendor/.test(how) || (A.GD.vend || {})[id]) return 'vendor';
    if (rows.some((r) => r[0] === 'drop' && r[5])) return 'dungeon';
    return 'world';
  }
  // a random-suffix roll drops from any creature of its level: its base's drop list says nothing about the roll
  const whereOf = (c) => (c.roll ? `Random-suffix ${c.g[1] === 3 ? 'blue' : 'green'} · drops from creatures of its level, or the AH` : c.how || ((A.gdSourceLines(c.id, 1, false)[0] || {}).l) || (c.boe ? 'BoE: not seen on your AH yet' : ''));

  // ---------------------------------------------------------------- candidates
  // The fixed-stat items Forever is known to have, and every roll of the random-suffix ones. Cached per
  // class and skills.
  const rollsOf = (id) => (SFX && SFX.items[id]) || null;
  const rollStats = (rows) => { const st = {}; rows.forEach(([k, v]) => { st[k] = (st[k] || 0) + v; }); return st; };
  let cache = null;
  function candidates(use, cls) {
    const ck = JSON.stringify(use) + cls + (SFX ? SFX.built : '');
    if (cache && cache.ck === ck) return cache;
    const fixed = [], rolls = [], byId = {};
    const skipped = { 'raid only': 0, 'PvP honor gear': 0, 'other faction only': 0, 'only Classic data says where it comes from': 0, 'no endgametools tooltip': 0, 'not for your class': 0, 'no known source': 0 };
    const side = (char().faction || '')[0];            // 'A' or 'H'; vendors that only serve the other side don't count
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
      // Forever quest data (ForeverDB / QuestieDB), or a vendor seen selling it on Forever. Random-suffix
      // items count when foreverchanges lists their rolls as confirmed in game.
      const how = (A.GD.how || {})[k];
      const myVend = arr(vend).filter((v) => !v[7] || !side || v[7].includes(side));
      const rr = rollsOf(k);
      if (vend && !myVend.length && !src && !how) { skipped['other faction only']++; continue; }
      const onForever = how || rr || arr(src).some((r) => r[10] === 'f') || myVend.some((v) => v[5]);
      if (!onForever) { skipped[src || vend ? 'only Classic data says where it comes from' : 'no known source']++; continue; }
      const size = (A.GD.size || {})[k] || 0;
      const raidQuest = arr(src).some((r) => r[0] === 'quest' && ((A.GD.quests || {})[r[2]] || {}).type === 'Raid');
      if (size >= 20 || raidQuest) { skipped['raid only']++; continue; }
      if (isPvp(id)) { skipped['PvP honor gear']++; continue; }
      const base = { id, g, inv: g[4], req: g[3] || 0, boe, size, how, kind: kindOf(id) };
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
    cache = { ck, fixed, rolls, byId, skipped };
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

  // ---------------------------------------------------------------- what you still need for an item
  // Reputation and profession gates from the tooltip, the recipe line and the reward quest; only unmet ones show.
  const STANDING = ['', 'Hated', 'Hostile', 'Unfriendly', 'Neutral', 'Friendly', 'Honored', 'Revered', 'Exalted'];
  const REP_AT = [[42000, 8], [21000, 7], [9000, 6], [3000, 5], [0, 4]];
  const NEEDS = new Map();
  function needs(c) {
    const ck = c.id + '|' + (A.CH.snap || {}).taken;
    if (NEEDS.has(ck)) return NEEDS.get(ck);
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
    const res = [...new Set(out)];
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
  // with alternatives (best items up to level 60, raids left out).
  const NOW_MAX = 6, PRE_ALTS = 4;
  function plan(w, lvl, base, picks, reach) {
    const use = canUse(), ch = char();
    const cand = candidates(use, ch.class);
    const worn = base.worn;
    const wornIds = new Set(Object.values(worn).map((x) => x.id));
    const twoHand = worn[16] && (A.gdItem(worn[16].id) || [])[4] === TWO_HAND;
    const listed = listings(cand);
    const listedBy = {}; listed.forEach((l) => { const k = l.c.key; if (!listedBy[k] || l.price < listedBy[k].price) listedBy[k] = l; });
    const mine = ownedCands(use);
    const at = ownedAt();
    const offScore = worn[17] ? score(worn[17].st, w) : 0;
    const slots = SLOTS.map(([name, nums, invs]) => {
      const cur = nums.map((n) => worn[n] ? { n, id: worn[n].id, key: worn[n].key, st: worn[n].st, s: score(worn[n].st, w) } : { n, id: null, s: 0 });
      const weakest = cur.reduce((a, c) => (c.s < a.s ? c : a), cur[0]);
      const blocked = name === 'Off hand' && twoHand;
      const fitsPre = (c) => invs.includes(c.inv);
      const fits = (c) => fitsPre(c) && !blocked;          // usable now (a worn two-hander blocks the off hand)
      // a two-hander replaces the main hand and the off hand
      const gain = (c, s) => s - weakest.s - (name === 'Main hand' && c.inv === TWO_HAND ? offScore : 0);
      const x = (c, extra) => { const s = score(c.st, w); return Object.assign({ c, s, d: gain(c, s) }, extra || {}); };
      const distinct = (list) => { const seen = new Set(); return list.filter((y) => !seen.has(y.c.name) && seen.add(y.c.name)); };
      const byGain = (a, b) => b.d - a.d;
      // ---- usable now: fixed items, your own, AH listings
      // what you own comes first, so an item you have shows as yours rather than as a drop
      // ---- random greens: the best base for each suffix at your level (any creature of its level drops it)
      const bestRoll = {};
      cand.rolls.forEach((c) => {
        if (!fits(c) || c.req > lvl) return;
        // ranked by gain: in the main hand a two-hander also replaces the off hand
        const s = score(c.st, w), d = gain(c, s);
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
      // ---- pre-BiS: the best up to level 60, counting what you own; one random roll at most (its best base)
      const preRolls = {};
      cand.rolls.forEach((c) => { if (fitsPre(c) && c.req <= 60) { const s = score(c.st, w); if (!preRolls[c.roll] || s > preRolls[c.roll].s) preRolls[c.roll] = { c, s }; } });
      const prePool = mine.filter(fitsPre).map((c) => x(c))
        .concat(cand.fixed.filter((c) => fitsPre(c) && c.req <= 60).map((c) => x(c)))
        .concat(cur.filter((y) => y.id && !cand.byId[String(y.id)] && !mine.some((m) => m.id === y.id))
          .map((y) => x({ id: y.id, key: y.key || String(y.id), g: A.gdItem(y.id) || [A.anyItemName(y.id), 1], name: A.anyItemName(y.id), inv: (A.gdItem(y.id) || [])[4] || invs[0], req: 0, st: y.st, kind: 'owned' })));
      const topRoll = Object.values(preRolls).sort((a, b) => b.s - a.s)[0];
      if (topRoll) prePool.push(x(topRoll.c));
      // "only what you can get": no unmet reputation or profession gates (your own items always count)
      const pre = distinct(prePool.filter((y) => !reach || y.c.kind === 'owned' || !needs(y.c).length).sort((a, b) => b.s - a.s));
      // your picks come first; then the best that's left
      const n = nums.length;
      const want = arr(picks[name]).map((k) => pre.find((y) => y.c.key === k)).filter(Boolean);
      const targets = want.concat(pre.filter((y) => !want.includes(y))).slice(0, n).map((y) => Object.assign({ picked: want.includes(y) }, y));
      const alts = pre.filter((y) => !targets.some((t) => t.c.name === y.c.name)).slice(0, PRE_ALTS);
      return { name, nums, cur, weakest, blocked, ups, now, ahUps, search, targets, alts, pre };
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
  function icon(c) {
    if (c.kind === 'owned' && c.key && A.item(c.key)) return A.itemIcon(c.key, { size: 'sm' });
    return A.anyItemIcon(c.id, { size: 'sm' });
  }
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
    return `<div class="c-main">${icon(c)}<div class="grow"><div class="nm"><span class="q${q}">${esc(c.name || c.g[0])}</span>${tagsOf(c)}</div><div class="sub">${esc(sub != null ? sub : whereOf(c))}</div>${nd.length ? `<div class="sub need">Needs ${esc(nd.join(' and '))}</div>` : ''}</div></div>`;
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
      const cur = sl.cur.map((x) => (x.id ? `<span class="have">${A.anyItemIcon(x.id, { size: 'xs' })}<span>${esc(A.anyItemName(x.id))}</span></span>` : '<span class="have dim">empty</span>')).join('');
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
    else if (!sl.ups.length) h += `<div class="empty">Nothing you can use at level ${lvl} beats what ${esc(base.short)} has here.</div>`;
    else {
      const counts = {};
      sl.ups.forEach((y) => { const k = kindKey(y); counts[k] = (counts[k] || 0) + 1; });
      const f = filter !== 'all' && counts[filter] ? filter : 'all';
      h += `<div class="chips"><button data-gearsrc="all" class="${f === 'all' ? 'on' : ''}">All<span>${sl.ups.length}</span></button>${KINDS.filter(([k]) => counts[k]).map(([k, l]) => `<button data-gearsrc="${k}" class="${f === k ? 'on' : ''}">${esc(l)}<span>${counts[k]}</span></button>`).join('')}</div>`;
      const full = f === 'all' ? sl.ups : sl.ups.filter((y) => kindKey(y) === f);
      const open = A.STATE.gearUpAll === sl.name, list = open ? full : full.slice(0, UP_SHOW);
      h += `<div class="table gopt"><div class="thead"><div>Item</div><div>Source</div><div class="c-num">AH price</div><div class="c-num">Score</div><div class="c-num">Gain</div></div>`;
      list.forEach((y) => { h += `<div class="tr">${itemCell(y.c)}${srcCell(y)}${priceCell(y)}<div class="c-num">${fmt1(y.s)}</div><div class="c-num pos">${gainTxt(y.d)}</div></div>`; });
      h += '</div>';
      if (full.length > UP_SHOW) h += `<button class="linkbtn more" data-gearupall="${open ? '' : esc(sl.name)}">${open ? 'Show the best ' + UP_SHOW : `Show all ${full.length}`}</button>`;
    }
    // ---- pre-BiS
    h += `<h3>Pre-BiS <span>· the best up to level 60, raids left out</span></h3>`;
    if (sl.twoHander) return h + `<div class="empty">Not needed: your main-hand target is a two-hander.</div></section>`;
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
    return h + '</section>';
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
  const VIEWS = [['up', 'By slot'], ['ah', 'Auction House'], ['sets', 'Class sets']];
  const curSpec = () => { const l = specs(); return l.find((s) => s.i === A.STATE.gearSpec) || l.find((s) => s.i === (A.CH.snap || {}).activeSpec) || l[0]; };

  V.gear = function () {
    const ch = char();
    if (!A.GD || !A.GD.items) return '<div class="empty">The game-data pack (data/gamedata.js) is missing.</div>';
    if (!canUse()) return '<div class="empty">Your weapon and armor skills aren\'t saved yet: Sync in game.</div>';
    const list = specs();
    if (!list.length) return '<div class="empty">Talents not saved yet: Sync in game.</div>';
    const active = (A.CH.snap || {}).activeSpec;
    const cur = curSpec();
    let h = `<div class="seg">${list.map((s) => `<button data-gearspec="${s.i}" class="${s === cur ? 'on' : ''}">${esc(s.label)}${s.i === active ? ' · active' : ''}</button>`).join('')}</div>`;
    const pk = profileKey(cur), prof = W.get(pk);
    const w = pk && weightsFor(cur, pk);
    const view = VIEWS.some(([k]) => k === A.STATE.gearView) ? A.STATE.gearView : 'up';
    const base = baseline(cur, pk);
    const sets = SETS();
    const setSel = `<label class="sel"><span class="k">Compare with</span>${sets.length ? `<select data-gearset>${[['worn', 'What you wear'], ...sets.map((g) => [String(g.id), `“${g.name}” set`])].map(([k, l]) => `<option value="${esc(k)}"${base.key === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>` : '<span>What you wear</span>'}</label>`;
    h += `<div class="toolbar"><div class="seg">${VIEWS.map(([k, l]) => `<button data-gearview="${k}" class="${view === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
    if (!w || !Object.keys(w).length) return h + `<div class="empty">No stat weights for ${esc(cur.tree || cur.label)} yet. Pick or make some on the <button class="linkbtn" data-tab="weights">Stat weights</button> page.</div>`;
    const lvl = ch.level || 60;
    const P = plan(w, lvl, base, getPicks(cur), !!A.STATE.gearReach);
    const upSlots = P.slots.filter((s) => s.ups.length && !s.blocked);
    const bigUp = upSlots.slice().sort((a, b) => b.ups[0].d - a.ups[0].d)[0];
    const ahN = P.slots.reduce((a, s) => a + s.ahUps.length, 0);
    const cheapest = P.slots.flatMap((s) => s.ahUps).sort((a, b) => a.ah.price - b.ah.price)[0];
    const preT = P.slots.filter((s) => !s.twoHander).flatMap((s) => s.targets);
    const baseIds = new Set(Object.values(base.worn).map((x) => x.id));
    const preDone = preT.filter((t) => baseIds.has(t.c.id) && !t.c.roll).length;
    const top = Object.entries(w).filter(([k]) => !W.PCT[k]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${W.statName(k, A.GD.stat)} ${+v.toFixed(2)}`).join(' · ');
    const why = pickedProfile(cur) ? 'your pick' : `default for ${cur.tree}`;
    const sel = P.slots.some((s) => s.name === A.STATE.gearSlot) ? A.STATE.gearSlot : (bigUp || P.slots[0]).name;
    h += `<div class="cards c4">
      <button class="card link" data-gearview="up" data-gearslot="${esc(bigUp ? bigUp.name : sel)}"><span class="k">Upgrades now</span><span class="v">${upSlots.length} <span class="dim small">of ${P.slots.length} slots</span></span><span class="sub">${upSlots.length ? `biggest: ${esc(bigUp.name)} ${gainTxt(bigUp.ups[0].d)}` : `nothing beats ${esc(base.short)}`}</span></button>
      <button class="card link" data-gearview="ah"><span class="k">On your AH</span><span class="v">${ahN}</span><span class="sub">${cheapest ? `cheapest ${A.money(cheapest.ah.price, { short: true })}: ${esc(cheapest.c.name)}` : 'no upgrades listed'}</span></button>
      <div class="card"><span class="k">Pre-BiS</span><span class="v">${preDone}/${preT.length}</span><span class="sub">targets already in ${esc(base.short)}</span></div>
      <button class="card link" data-tab="weights"><span class="k">Weights: ${esc(prof.name)}</span><span class="v small">${esc(top)}</span><span class="sub">${esc(why)} · change on Stat weights</span></button></div>`;
    if (view === 'up') h += `<div class="gearlay">${slotList(P, sel, setSel)}${slotDetail(P, P.slots.find((s) => s.name === sel), lvl, base, KIND_WORD[A.STATE.gearSrc] ? A.STATE.gearSrc : 'all')}</div>`;
    else if (view === 'ah') h += `<div class="toolbar">${setSel}</div>` + ahView(P, lvl);
    else h += setsView(classSets());
    if (view !== 'sets') h += `<details class="how"><summary>How this works, and what's left out</summary><p>Score = each stat × its weight, added up. Gain = score minus what ${esc(base.short)} has in that slot (rings and trinkets: the weaker one). Random greens ("of Healing") are scored from their roll's exact stats (foreverchanges.pro, confirmed in game); for each roll, the best base you can wear at your level is shown. Left out: ${Object.entries(P.skipped).map(([k, v]) => `${v.toLocaleString()} ${esc(k)}`).join(' · ')}. Use and proc effects aren't in the score. Sources follow the item tooltip: Forever data is marked, Classic-only rates say so.</p></details>`;
    return h;
  };

  // ---------------------------------------------------------------- the same advice as data, for the Claude snapshot (js/claude.js)
  CC.gear = {
    summary() {
      const ch = char();
      if (!A.GD || !A.GD.items || !canUse()) return [];
      const active = (A.CH.snap || {}).activeSpec;
      const opt = (sl) => (y) => ({ slot: sl.name, id: y.c.id, name: y.c.name, roll: y.c.roll || null, score: +y.s.toFixed(1), gain: +y.d.toFixed(1),
        reqLevel: y.c.req, boe: !!y.c.boe, source: y.ah ? 'ah' : y.c.kind, where: y.c.kind === 'owned' ? y.c.where : whereOf(y.c), needs: needs(y.c),
        ah: y.ah ? { price: y.ah.price, listed: y.ah.qty, seen: y.ah.t } : null });
      const sets = classSets().map((s) => ({ name: s.name, kind: s.kind, owned: s.have, pieces: s.slots, worn: s.worn,
        missing: s.pieces.filter((p) => !p.at).map((p) => ({ id: p.id, name: p.g[0], slot: p.slot, where: whereOf({ id: p.id, g: p.g, how: (A.GD.how || {})[p.id] }) })),
        bonuses: s.bonus.map(([n, t]) => ({ pieces: n, text: t, active: s.worn >= n })) }));
      return specs().map((sp) => {
        const pk = profileKey(sp);
        const w = pk && weightsFor(sp, pk);
        const prof = W.get(pk);
        const out = { spec: sp.i, label: sp.label, tree: sp.tree, active: sp.i === active, weights: w && Object.keys(w).length ? pk : null, classSets: sets };
        if (!out.weights) return out;
        out.weightsName = prof.name;
        out.weightsChosen = pickedProfile(sp) ? 'picked' : 'default for the biggest tree';
        out.weightsSource = prof.own ? 'yours' : (prof.src || {}).url || (prof.src || {}).label || null;
        out.weightValues = w;
        const base = baseline(sp, pk);
        out.comparedWith = base.label;
        const P = plan(w, ch.level || 60, base, getPicks(sp));
        const baseIds = new Set(Object.values(base.worn).map((x) => x.id));
        out.worn = P.slots.map((sl) => ({ slot: sl.name, score: +sl.weakest.s.toFixed(1), items: sl.cur.filter((x) => x.id).map((x) => ({ id: x.id, name: A.anyItemName(x.id), score: +x.s.toFixed(1) })) }));
        out.upgrades = P.slots.flatMap((sl) => sl.now.map(opt(sl)));
        out.ahUpgrades = P.slots.flatMap((sl) => sl.ahUps.map(opt(sl)));
        out.watch = out.ahUpgrades;                 // the older name for AH upgrades
        out.rollsToSearch = P.slots.flatMap((sl) => sl.search.map((r) => ({ slot: sl.name, roll: r.c.roll, bestBase: r.c.g[0], id: r.c.id, reqLevel: r.c.req, gain: +r.d.toFixed(1), bases: r.n })));
        out.preBis = P.slots.filter((sl) => !sl.twoHander).flatMap((sl) => sl.targets.map((t) => ({ slot: sl.name, id: t.c.id, name: t.c.name, roll: t.c.roll || null, score: +t.s.toFixed(1),
          picked: t.picked, status: baseIds.has(t.c.id) && !t.c.roll ? 'done' : t.c.kind === 'owned' ? t.c.where : (!t.c.roll && P.at[t.c.id]) || 'missing', where: whereOf(t.c), needs: needs(t.c),
          alternatives: sl.alts.map((y) => ({ id: y.c.id, name: y.c.name, score: +y.s.toFixed(1), where: whereOf(y.c) })) })));
        return out;
      });
    },
    // shared with the Stat weights page and the item advice (js/weights.js, js/advice.js)
    specs, profileKey, pickedProfile, setProfile, baseline, canUse, weightsFor, SLOTS,
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
