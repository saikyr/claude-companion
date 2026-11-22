// Claude Companion: Gear tab. Next upgrades, pre-BiS and a BoE watch list for each spec,
// scored from the game-data pack (endgametools tooltips, sources from QuestieDB / ForeverDB)
// and what you wear now (the game's own stats, so random suffixes count).
(function () {
  const CC = window.CC;
  if (!CC || !CC.api || !CC.V) return;
  const A = CC.api, V = CC.V, esc = A.esc, arr = A.arr;

  // ---------------------------------------------------------------- stat weights
  // Profiles, default priorities for every class and spec, and item stats live in js/weights.js.
  const W = window.CCWeights;
  if (!W) return;
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

  const char = () => ((A.CH && A.CH.snap) || {}).character || {};
  const idOf = (key) => { const m = /item:(\d+)/.exec(key || ''); return m ? Number(m[1]) : null; };
  const score = W.score;
  const packStats = (id) => W.fromPack(A.gdItem(id));
  // the game's own numbers for an item you have (random suffixes count), else the pack's
  const ownStats = (mine, id) => (mine && mine.stats ? W.fromGame(mine.stats, mine.tip) : packStats(id));

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
  // the weights profile a spec uses: your pick (js/weights.js profiles), else the spec's default
  function profileKey(spec) {
    const cls = char().classFile;
    W.migrate(char().name, spec.i, cls);
    const pick = localStorage.getItem(store(spec, 'profile'));
    const p = pick && W.get(pick);
    return p && p.cls === cls ? pick : W.defaultFor(cls, spec.tree);
  }
  const setProfile = (spec, id) => { if (id) localStorage.setItem(store(spec, 'profile'), id); else localStorage.removeItem(store(spec, 'profile')); };
  // What a spec's upgrades are measured against: the gear set for that spec, else what you wear now.
  // A set is linked by your pick in the tab, else the game's own spec link, else a name that matches the
  // spec or its weights ("heals" ~ Healing, "shadow" ~ Shadow).
  const SETS = () => arr((A.CH.snap || {}).gearSets).filter((g) => g && g.name && arr(g.items).length);
  function baseline(spec, pk) {
    const sets = SETS(), pick = localStorage.getItem(store(spec, 'set'));
    const stem = (x) => (x || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 4);
    const words = [spec.tree, pk && W.get(pk) && W.get(pk).name].map(stem).filter((x) => x.length === 4);
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
  const weightsFor = (spec, pk) => (W.get(pk) || {}).w || null;

  // PvP gear: sold in the two PvP halls (Champions' Hall, Hall of Legends). Bought with Honor; the epic pieces
  // also need a PvP rank (icy-veins.com/wow-forever/pvp-rank-system), so they stay out of PvE lists.
  const PVP_HALLS = ["Champions' Hall", 'Hall of Legends'];
  // PvP pieces are also named after the PvP rank titles (Alliance and Horde), which is how the ones sold elsewhere show
  const PVP_RANK = /^(Premier )?(Private|Corporal|Sergeant|Master Sergeant|Sergeant Major|Knight|Knight-Lieutenant|Knight-Captain|Knight-Champion|Lieutenant Commander|Commander|Marshal|Field Marshal|Grand Marshal|Scout|Grunt|Senior Sergeant|First Sergeant|Stone Guard|Blood Guard|Legionnaire|Centurion|Champion|Lieutenant General|General|Warlord|High Warlord)'s /;
  // vendors by name (where they stand, which side they serve), for "Vendor · <name>" lines from the client
  let VENDORS = null;
  const vendorInfo = (name) => {
    if (!VENDORS) { VENDORS = {}; Object.values(A.GD.vend || {}).forEach((rows) => arr(rows).forEach((v) => { if (!VENDORS[v[0]]) VENDORS[v[0]] = { hall: PVP_HALLS.includes(v[1]), side: v[7] || '' }; })); }
    return VENDORS[name] || null;
  };
  const howVendor = (id) => { const m = /^Vendor · ([^·]+)/.exec((A.GD.how || {})[id] || ''); return m ? vendorInfo(m[1].trim()) : null; };
  const isPvp = (id) => arr((A.GD.vend || {})[id]).some((v) => PVP_HALLS.includes(v[1])) || PVP_RANK.test((A.gdItem(id) || [''])[0]) || !!(howVendor(id) || {}).hall;
  // ---------------------------------------------------------------- candidates
  let cache = null;
  function candidates(use, cls) {
    const ck = JSON.stringify(use);
    if (cache && cache.ck === ck) return cache;
    const out = [], skipped = { 'raid only': 0, 'PvP honor gear': 0, 'other faction only': 0, 'only Classic data says where it comes from': 0, 'no endgametools tooltip': 0, 'not for your class': 0, 'no known source': 0 };
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
      if (isPvp(id)) { skipped['PvP honor gear']++; continue; }
      out.push({ id, g, inv: g[4], req: g[3] || 0, st: W.fromPack(g), boe, size, how });
    }
    cache = { ck, out, skipped };
    return cache;
  }

  // an item you have that the candidate list doesn't carry (no endgametools page): scored from the game's numbers
  const mine = (id, st) => { const g = A.gdItem(id) || [A.anyItemName(id), 1, 0, 0, 0]; return { id, g, inv: g[4], req: g[3] || 0, st, boe: g[7] === 2, how: (A.GD.how || {})[id] }; };
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
      // pre-BiS targets: the best items up to level 60, counting what you already have (one per slot, two rings/trinkets)
      const seen = new Set();
      const pool = out.filter((c) => invs.includes(c.inv) && c.req <= 60 && !(name === 'Off hand' && twoHand))
        .concat(cur.filter((x) => !out.some((c) => c.id === x.id)).map((x) => mine(x.id, x.st)));
      const targets = pool.map((c) => ({ c, s: score(c.st, w) })).sort((a, b) => b.s - a.s)
        .filter((x) => !seen.has(x.c.g[0]) && seen.add(x.c.g[0])).slice(0, slots.length);
      return {
        name, cur, base, targets,
        now: rank(fits.filter((c) => c.req <= lvl)).slice(0, 3),
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

  // ---------------------------------------------------------------- what you have
  // where each of your items is: worn, in your bags or in your bank (as of the last Sync / bank visit)
  function owned() {
    const at = {};
    const put = (key, where) => { const m = /item:(\d+)/.exec(key || ''); if (m && !at[m[1]]) at[m[1]] = where; };
    Object.values((A.CH.snap || {}).equipped || {}).forEach((e) => e && put(e.item, 'worn'));
    arr((A.CH.snap || {}).bags).forEach((b) => arr(b.items).forEach((x) => put(x.item, 'bags')));
    arr((A.CH.bank || {}).bags).forEach((b) => arr(b.items).forEach((x) => put(x.item, 'bank')));
    return at;
  }
  const STATUS = { worn: ['worn', 'pos'], bags: ['in your bags', 'pos'], bank: ['in your bank', 'pos'] };
  const status = (at, id, inBase) => (inBase ? '<span class="badge on">in this set</span>' : at[id] ? `<span class="badge on">${STATUS[at[id]][0]}</span>` : '<span class="badge">missing</span>');

  // ---------------------------------------------------------------- class sets
  // Every item set for your class, from the pack (pieces: ForeverDB; names and bonuses: endgametools).
  // Only pieces Forever is known to have count; the kind of set follows where most pieces come from.
  const INV_NAME = { 1: 'Head', 2: 'Neck', 3: 'Shoulder', 5: 'Chest', 20: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrist', 10: 'Hands',
    11: 'Finger', 12: 'Trinket', 16: 'Back', 13: 'One-hand', 17: 'Two-hand', 21: 'Main hand', 22: 'Off hand', 23: 'Held in off hand',
    14: 'Shield', 15: 'Ranged', 25: 'Thrown', 26: 'Ranged', 28: 'Relic' };
  const CLASS_BIT = { WARRIOR: 1, PALADIN: 2, HUNTER: 4, ROGUE: 8, PRIEST: 16, SHAMAN: 64, MAGE: 128, WARLOCK: 256, DRUID: 1024 };
  const KIND_ORDER = ['Dungeon', 'Dungeon set upgrade (quests)', 'Crafted', 'Vendor', 'World drop', 'PvP (Honor)', 'Raid', 'Unknown source'];
  function pieceKind(id) {
    const size = (A.GD.size || {})[id] || 0, rows = arr((A.GD.src || {})[id]);
    if (size >= 20 || rows.some((r) => r[0] === 'quest' && ((A.GD.quests || {})[r[2]] || {}).type === 'Raid')) return 'Raid';
    if (isPvp(id)) return 'PvP (Honor)';
    if (size) return 'Dungeon';
    if (rows.some((r) => r[0] === 'quest' || r[0] === 'container')) return 'Dungeon set upgrade (quests)';
    if (rows.some((r) => r[0] === 'craft')) return 'Crafted';
    if ((A.GD.vend || {})[id]) return 'Vendor';
    if (rows.some((r) => r[0] === 'drop' && r[5])) return 'Dungeon';
    return rows.length ? 'World drop' : null;
  }
  function classSets() {
    const bit = CLASS_BIT[char().classFile] || 0, at = owned(), side = (char().faction || '')[0];
    // only sets the Forever client shows (named from a piece's tooltip)
    return Object.entries(A.GD.sets || {}).filter(([, s]) => s[3] & bit && s[0]).map(([sid, [name, ids, bonus]]) => {
      const pieces = ids.map((id) => {
        const g = A.gdItem(id) || [];
        const how = (A.GD.how || {})[id], src = (A.GD.src || {})[id], vend = arr((A.GD.vend || {})[id]);
        const hv = howVendor(id);
        if (hv && hv.side && side && !hv.side.includes(side)) return null;            // only the other faction's vendor sells it
        const onForever = !!how || arr(src).some((r) => r[10] === 'f') || vend.some((v) => v[5] && (!v[7] || !side || v[7].includes(side)));
        return { id, g, slot: INV_NAME[g[4]] || '', on: onForever, kind: pieceKind(id), at: at[id] || null, req: g[3] || 0 };
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

  // ---------------------------------------------------------------- view
  function itemCell(c, extra) {
    const g = c.g;
    return `<div class="c-main">${A.anyItemIcon(c.id, { size: 'sm' })}<div class="grow"><div class="nm"><span class="q${g[1]}">${esc(g[0])}</span>${extra || ''}</div>`;
  }
  const whereOf = (c) => c.how || ((A.gdSourceLines(c.id, 1, false)[0] || {}).l) || (c.boe ? 'BoE: not seen on your AH yet' : '');
  function row(x, slot) {
    const id = x.c.id;
    const price = x.c.boe ? A.planPrice(id) : null;
    const how = (price ? `AH ${A.money(price, { short: true })} · ` : '') + esc(whereOf(x.c));
    const need = needs(x.c).map((r) => ` <span class="badge">needs ${esc(r)}</span>`).join('');
    const tags = `${x.c.req > (char().level || 0) ? ` <span class="badge">level ${x.c.req}</span>` : ''}${x.c.boe ? ' <span class="badge">BoE</span>' : ''}${x.c.size === 10 ? ' <span class="badge">10-player</span>' : ''}${need}`;
    return `<div class="tr">${itemCell(x.c, tags)}<div class="sub">${esc(slot)} · ${how}</div></div></div><div class="c-num">${x.s.toFixed(1)}</div><div class="c-num pos">+${x.d.toFixed(1)}</div></div>`;
  }
  function table(title, plans, key, empty) {
    let h = `<h3>${esc(title)}</h3><div class="table geart"><div class="thead"><div>Item</div><div class="c-num">Score</div><div class="c-num">Gain</div></div>`;
    let n = 0;
    plans.forEach((p) => p[key] && p[key].forEach((x) => { h += row(x, p.name); n++; }));
    if (!n) h += `<div class="tr"><div class="dim">${esc(empty)}</div></div>`;
    return h + '</div>';
  }
  // pre-BiS checklist: per slot, what you have in this set next to the best item up to 60, and whether you own it
  function preBisRows(plans, at, base) {
    const baseIds = new Set(Object.values(base.worn).map((x) => x.id));
    const rows = [];
    plans.forEach((p) => p.targets.forEach((t, k) => {
      const cur = p.cur[k] || p.cur[0];
      const done = baseIds.has(t.c.id);
      rows.push({ slot: p.name, t, cur, done, owned: done || !!at[t.c.id] });
    }));
    return rows;
  }
  function preBisTable(rows, at) {
    let h = `<div class="table prebis"><div class="thead"><div>Slot</div><div>Pre-BiS target</div><div>You have now</div><div>Status</div></div>`;
    rows.forEach((r) => {
      const c = r.t.c;
      const cur = r.cur ? A.gdItem(r.cur.id) : null;
      h += `<div class="tr"><div class="dim">${esc(r.slot)}</div>${itemCell(c, needs(c).map((x) => ` <span class="badge">needs ${esc(x)}</span>`).join(''))}<div class="sub">${esc(whereOf(c))}</div></div></div>
        <div class="c-main"><div class="grow"><div class="nm">${cur ? `<span class="q${cur[1]}">${esc(cur[0])}</span>` : r.cur ? esc(A.anyItemName(r.cur.id)) : '<span class="dim">empty</span>'}</div></div></div>
        <div>${r.done ? '<span class="badge on">done</span>' : status(at, c.id, false)}</div></div>`;
    });
    return h + '</div>';
  }
  function setsView(list) {
    if (!list.length) return '<div class="empty">No item sets for your class in the game data yet.</div>';
    let h = '<div class="setlist">';
    list.forEach((s) => {
      const open = s.have > 0 ? ' open' : '';
      h += `<details class="setcard"${open}><summary><span class="nm">${esc(s.name)}</span><span class="dim small">${esc(s.kind)} · item level ${s.il}</span><span class="badge${s.have ? ' on' : ''}">${s.have}/${s.slots} owned</span></summary>`;
      h += '<div class="setbody"><div class="table setp"><div class="thead"><div>Piece</div><div>Where</div><div>Status</div></div>';
      s.pieces.sort((a, b) => a.slot.localeCompare(b.slot)).forEach((p) => {
        h += `<div class="tr">${itemCell({ id: p.id, g: p.g })}<div class="sub">${esc(p.slot)}</div></div></div><div class="sub">${esc(whereOf({ id: p.id, g: p.g, how: (A.GD.how || {})[p.id], boe: p.g[7] === 2 }))}</div><div>${p.at ? `<span class="badge on">${STATUS[p.at][0]}</span>` : '<span class="badge">missing</span>'}</div></div>`;
      });
      h += '</div>';
      if (s.bonus.length) h += `<ul class="bonus">${s.bonus.map(([n, t]) => `<li class="${s.worn >= n ? 'pos' : ''}"><b>(${n})</b> ${esc(t)}</li>`).join('')}</ul>`;
      h += '</div></details>';
    });
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
    const mine = W.forClass(ch.classFile, cur.tree).filter((p) => p.trees ? p.trees.includes(cur.tree) : true);
    h += `<div class="toolbar"><span class="dim small">Weights</span><div class="chips">${mine.map((p) => `<button data-gearprof="${esc(p.id)}" class="${pk === p.id ? 'on' : ''}">${esc(p.name)}${p.own ? ' <span>yours</span>' : ''}</button>`).join('')}<button data-tab="weights">Edit weights…</button></div></div>`;
    const w = pk && weightsFor(cur, pk);
    const cls = classSets();
    if (!w || !Object.keys(w).length) return h + `<div class="empty">No stat weights for ${esc(cur.tree || cur.label)} yet. Pick a profile above, or make your own on the Stat weights page.</div><h2>Class sets</h2>` + setsView(cls);
    if (CC.advice) h += CC.advice.bestOwnedHTML(cur);
    const lvl = ch.level || 60;
    const base = baseline(cur, pk);
    const sets = SETS();
    if (sets.length) h += `<div class="toolbar"><span class="dim small">Compare with</span><div class="chips">${[['worn', 'What you wear'], ...sets.map((g) => [String(g.id), g.name])].map(([k, l]) => `<button data-gearset="${esc(k)}" class="${base.key === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div></div>`;
    const plans = plan(w, lvl, base.worn);
    const skipped = plans.pop().skipped;
    const at = owned();
    const pre = preBisRows(plans, at, base);
    const done = pre.filter((r) => r.done).length, have = pre.filter((r) => r.owned).length;
    const nowN = plans.reduce((a, p) => a + p.now.length, 0);
    const best = cls.find((s) => s.have) || cls.find((s) => s.kind === 'Dungeon');
    h += `<p class="meta">${esc(W.get(pk).name)} weights: ${Object.entries(w).map(([k, v]) => `${esc(W.statName(k, A.GD.stat))} ${+v.toFixed(2)}`).join(' · ')}. Score = sum of stat × weight. Measured against ${esc(base.label)}.</p>`;
    h += `<div class="cards c3"><div class="card"><span class="k">Pre-BiS</span><span class="v">${done}/${pre.length}</span><span class="sub">slots done · ${have - done} more owned, not in this set</span></div>
      <div class="card"><span class="k">Upgrades now</span><span class="v">${nowN}</span><span class="sub">usable at level ${lvl}</span></div>
      <div class="card"><span class="k">Class sets</span><span class="v">${cls.length}</span><span class="sub">${best ? `${esc(best.name)}: ${best.have}/${best.slots} owned` : 'none on Forever yet'}</span></div></div>`;
    h += `<h2>Pre-BiS checklist</h2><p class="meta">The best item per slot up to level 60 for these weights, raids left out.</p>` + preBisTable(pre, at);
    h += table(`Next upgrades you can use at level ${lvl}`, plans, 'now', 'Nothing beats this set at your level.');
    h += '<h2>Class sets</h2><p class="meta">Every item set for your class that Forever is known to have. Bonuses you have active (pieces worn) are highlighted.</p>' + setsView(cls);
    h += table('Watch the AH: BoE upgrades', plans, 'watch', 'No BoE upgrades for your slots.');
    h += `<details class="how"><summary>What's left out</summary><p>${Object.entries(skipped).map(([k, v]) => `${v.toLocaleString()} ${esc(k)}`).join(' · ')}. Items with no endgametools page are mostly ones Forever's client carries but doesn't drop. Sources and drop chances follow the item tooltip: Forever data is marked, Classic-only rates say so.</p></details>`;
    return h;
  };

  // the same advice as data, for the Claude snapshot (js/claude.js)
  CC.gear = {
    summary() {
      const ch = char();
      if (!A.GD || !A.GD.items || !canUse()) return [];
      const active = (A.CH.snap || {}).activeSpec;
      const at = owned();
      const row = (p) => (x) => ({ slot: p.name, id: x.c.id, name: x.c.g[0], score: +x.s.toFixed(1), gain: +x.d.toFixed(1),
        reqLevel: x.c.req, boe: x.c.boe, where: whereOf(x.c), needs: needs(x.c) });
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
        out.weightsSource = prof.own ? 'yours' : (prof.src || {}).url || (prof.src || {}).label || null;
        out.weightValues = w;
        const base = baseline(sp, pk);
        out.comparedWith = base.label;
        const plans = plan(w, ch.level || 60, base.worn);
        plans.pop();
        out.worn = plans.map((p) => ({ slot: p.name, score: +p.base.toFixed(1) }));
        out.upgrades = plans.flatMap((p) => p.now.map(row(p)));
        out.preBis = preBisRows(plans, at, base).map((r) => ({ slot: r.slot, id: r.t.c.id, name: r.t.c.g[0], score: +r.t.s.toFixed(1),
          status: r.done ? 'done' : at[r.t.c.id] || 'missing', where: whereOf(r.t.c), needs: needs(r.t.c) }));
        out.watch = plans.flatMap((p) => p.watch.map(row(p)));
        return out;
      });
    },
    // shared with the Stat weights page and the item advice (js/weights.js, js/advice.js)
    specs, profileKey, setProfile, baseline, canUse, weightsFor, SLOTS,
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
      if (sp) setProfile(sp, p.dataset.gearprof);
      A.render();
    }
  });
})();
