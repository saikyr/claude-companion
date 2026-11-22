// Claude Companion: stat weights. One place for every class and spec's default stat priority,
// the numbers the app scores gear with, and your own profiles (copy, edit, rename, reset, delete).
// Used by the Gear tab (js/gear.js), the bag flags (js/flags.js) and the Claude snapshot.
//
// Where the defaults come from (docs/STAT-WEIGHTS.md has the full table and the reasoning):
//   ORDER  Icy Veins' WoW Forever stat priority page for each spec (all 27 updated 4 Nov 2026,
//          Enhancement 13 Nov), read 22 Nov 2026. The guides give an order, not numbers.
//   COST   what one point of each stat costs on Forever gear, measured from the game-data pack
//          (endgametools tooltips from the Forever client): item budgets add up as the square
//          root of the sum of squares, so a stat's cost = the budget it uses / its amount.
//   CONV   Forever client conversions from foreverdb.net/stats: 14 crit rating = 1% crit,
//          10 hit rating = 1% hit, 12 dodge / 15 parry / 5 block rating = 1%, 14 attack power =
//          1 weapon DPS, attack power per Strength / Agility by class.
// Starter weight of a stat = its COST x a factor for its place in the ORDER (1st 1.0, 2nd 0.8,
// 3rd 0.65, 4th 0.5, 5th 0.4, 6th 0.32; stats the guide says are "also valued" 0.3; not listed 0).
// That turns "A before B" into "a point budget spent on A is worth more than the same budget
// on B". It is not a simulation: edit a copy when you know better.
(function () {
  'use strict';

  // ---------------------------------------------------------------- stats
  // ids are the game-data pack's stat ids (gamedata/build.py STAT); 'dps' is weapon damage per
  // second read from the tooltip
  const S = { agi: 3, str: 4, int: 5, spi: 6, sta: 7, def: 12, dodge: 13, parry: 14, block: 15, hit: 31, crit: 32,
    haste: 36, exp: 37, ap: 38, heal: 41, sdmg: 42, mp5: 43, sp: 45, pen: 47, bv: 48, armor: 100 };
  const SCHOOL = { fire: 110, shadow: 111, frost: 112, arcane: 113, nature: 114, holy: 115 };
  // a % line is worth this many rating points (CONV)
  const PCT = { 116: [S.crit, 14], 21: [S.crit, 14], 117: [S.hit, 10], 18: [S.hit, 10], 118: [S.dodge, 12], 119: [S.parry, 15], 120: [S.block, 5] };
  // COST per point, Stamina = 1. n = items the cost was measured on; 'assumed' = no clean sample
  const COST = {
    [S.str]: [1, 'measured, 31 item groups'], [S.agi]: [1, 'measured, 30'], [S.int]: [1, 'measured, 30'], [S.spi]: [1, 'measured, 35'],
    [S.sta]: [1, 'reference'], [S.sp]: [1, 'measured, 24'], [S.heal]: [0.54, 'measured, 5 items (small sample)'],
    [S.hit]: [1.33, 'measured, 23 items'], [S.crit]: [0.86, 'measured, 20 items'], [S.mp5]: [2.33, 'measured, 20 items (wide spread)'],
    [S.ap]: [0.5, 'measured, 53 items'], [S.def]: [1.79, 'measured, 33 items'], [S.dodge]: [1.08, 'measured, 9 items'],
    [S.block]: [1.25, 'measured, 4 items'], [S.bv]: [0.57, 'measured, 5 items'],
    [S.exp]: [1.33, 'assumed equal to hit (no clean sample)'], [S.parry]: [1.08, 'assumed equal to dodge'],
    [S.haste]: [0.86, 'assumed equal to crit (haste is rare on Forever gear)'], [S.pen]: [1, 'assumed (no clean sample)'],
    [S.armor]: [0.1, 'assumed: armor is mostly the item type, not budget'],
  };
  const RANK = [1, 0.8, 0.65, 0.5, 0.4, 0.32], ALSO = 0.3;
  // CONV: attack power per Strength and per Agility at level 60 (foreverdb.net/stats, Forever client)
  const AP_PER = { WARRIOR: [2, 0], PALADIN: [2, 0], SHAMAN: [2, 0], DRUID: [2, 1], ROGUE: [1, 1], HUNTER: [1, 2] };

  // ---------------------------------------------------------------- default priorities
  // [class, tree, id, name, role, order, also, schools, url slug, updated]
  // role: 'phys' (attack power), 'ranged' (hunter), 'spell', 'heal', 'tank'
  const IV = 'https://www.icy-veins.com/wow-forever/';
  const SPECS = [
    ['WARRIOR', 'Arms', 'iv-arms', 'Arms', 'phys', ['dps', 'hit', 'exp', 'crit', 'str'], ['haste', 'agi', 'ap'], [], 'arms-warrior-melee-dps'],
    ['WARRIOR', 'Fury', 'iv-fury', 'Fury', 'phys', ['dps', 'hit', 'exp', 'crit', 'str'], ['haste', 'agi', 'ap'], [], 'fury-warrior-melee-dps'],
    ['WARRIOR', 'Protection', 'iv-protwar-threat', 'Protection: threat', 'phys', ['exp', 'hit', 'agi', 'str', 'sta'], [], [], 'protection-warrior-tank'],
    ['WARRIOR', 'Protection', 'iv-protwar-survival', 'Protection: survival', 'tank', ['sta', 'armor', 'agi', 'avoid', 'def'], [], [], 'protection-warrior-tank'],
    ['ROGUE', 'Assassination', 'iv-assassination', 'Assassination', 'phys', ['exp', 'hit', 'agi', 'dps', 'crit'], [], [], 'assassination-rogue-melee-dps'],
    ['ROGUE', 'Combat', 'iv-combat', 'Combat', 'phys', ['exp', 'hit', 'agi', 'dps', 'crit'], [], [], 'combat-rogue-melee-dps'],
    ['ROGUE', 'Subtlety', 'iv-subtlety', 'Subtlety', 'phys', ['dps', 'exp', 'hit', 'wskill', 'agi'], [], [], 'subtlety-rogue-melee-dps'],
    ['HUNTER', 'Beast Mastery', 'iv-bm', 'Beast Mastery', 'ranged', ['dps', 'hit', 'crit', 'agi', 'ap'], [], [], 'beast-mastery-hunter-ranged-dps'],
    ['HUNTER', 'Marksmanship', 'iv-mm', 'Marksmanship', 'ranged', ['dps', 'hit', 'crit', 'agi', 'ap'], [], [], 'marksmanship-hunter-ranged-dps'],
    ['HUNTER', 'Survival', 'iv-sv', 'Survival', 'phys', ['dps', 'hit', 'crit', 'agi', 'ap'], [], [], 'survival-hunter-melee-dps'],
    ['MAGE', 'Arcane', 'iv-arcane', 'Arcane', 'spell', ['hit', 'sp', 'crit', 'int', 'spi', 'mp5'], [], ['arcane'], 'arcane-mage-ranged-dps'],
    ['MAGE', 'Fire', 'iv-fire', 'Fire', 'spell', ['hit', 'sp', 'crit', 'int', 'spi', 'mp5'], [], ['fire'], 'fire-mage-ranged-dps'],
    ['MAGE', 'Frost', 'iv-frost', 'Frost', 'spell', ['hit', 'sp', 'crit', 'int', 'mp5', 'spi'], [], ['frost'], 'frost-mage-ranged-dps'],
    ['WARLOCK', 'Affliction', 'iv-affliction', 'Affliction', 'spell', ['hit', 'sp', 'crit', 'haste', 'int'], [], ['shadow'], 'affliction-warlock-ranged-dps'],
    ['WARLOCK', 'Demonology', 'iv-demonology', 'Demonology', 'spell', ['hit', 'sp', 'crit', 'haste', 'int'], [], ['shadow', 'fire'], 'demonology-warlock-ranged-dps'],
    ['WARLOCK', 'Destruction', 'iv-destruction', 'Destruction', 'spell', ['hit', 'sp', 'haste', 'crit', 'int'], [], ['fire', 'shadow'], 'destruction-warlock-ranged-dps'],
    ['PRIEST', 'Discipline', 'iv-disc', 'Discipline (guide order)', 'heal', ['heal', 'mp5', 'spi', 'int', 'crit'], [], [], 'discipline-priest-healer'],
    ['PRIEST', 'Holy', 'iv-holy', 'Holy (guide order)', 'heal', ['heal', 'mp5', 'spi', 'int', 'crit'], [], [], 'holy-priest-healer'],
    ['PRIEST', 'Shadow', 'iv-shadow', 'Shadow (guide order)', 'spell', ['hit', 'sp', 'crit', 'pen', 'spi'], [], ['shadow'], 'shadow-priest-ranged-dps'],
    ['PALADIN', 'Holy', 'iv-holypal', 'Holy', 'heal', ['heal', 'int', 'spi', 'mp5', 'crit'], [], [], 'holy-paladin-healer'],
    ['PALADIN', 'Protection', 'iv-protpal', 'Protection', 'tank', ['sta', 'def', 'sp', 'int', 'str'], [], ['holy'], 'protection-paladin-tank'],
    ['PALADIN', 'Retribution', 'iv-ret-unsealed', 'Retribution: Unsealed Wrath', 'phys', ['dps', 'hit', 'exp', 'str', 'sp'], ['crit', 'agi', 'int'], ['holy'], 'retribution-paladin-melee-dps'],
    ['PALADIN', 'Retribution', 'iv-ret-holyshock', 'Retribution: Holy Shock', 'phys', ['dps', 'hit', 'sp', 'crit', 'exp'], ['str', 'agi', 'int'], ['holy'], 'retribution-paladin-melee-dps'],
    ['SHAMAN', 'Elemental', 'iv-elemental', 'Elemental', 'spell', ['sp', 'hit', 'crit', 'int', 'mp5'], [], ['nature', 'fire', 'frost'], 'elemental-shaman-ranged-dps'],
    ['SHAMAN', 'Enhancement', 'iv-enhancement', 'Enhancement', 'phys', ['dps', 'hit', 'exp', 'str', 'int', 'sp'], [], ['nature', 'fire', 'frost'], 'enhancement-shaman-melee-dps', 'Nov 13, 2026'],
    ['SHAMAN', 'Restoration', 'iv-restosham', 'Restoration', 'heal', ['heal', 'crit', 'int', 'spi', 'mp5'], [], [], 'restoration-shaman-healer'],
    ['DRUID', 'Balance', 'iv-balance', 'Balance', 'spell', ['hit', 'crit', 'sp', 'int'], [], ['arcane', 'nature'], 'balance-druid-ranged-dps'],
    ['DRUID', 'Feral', 'iv-feral-cat', 'Feral: cat and bear threat', 'phys', ['dps', 'exp', 'hit', 'agi', 'str'], ['crit', 'ap'], [], 'feral-druid-melee-dps-and-tank'],
    ['DRUID', 'Feral', 'iv-feral-bear', 'Feral: bear survival', 'tank', ['armor', 'def', 'sta', 'agi', 'dodge'], [], [], 'feral-druid-melee-dps-and-tank'],
    ['DRUID', 'Restoration', 'iv-restodruid', 'Restoration', 'heal', ['heal', 'int', 'spi', 'mp5', 'crit'], [], [], 'restoration-druid-healer'],
  ];
  // Guide words that the pack has no stat for: weapon skill shows on gear as a skill line, not a stat.
  const NO_STAT = { wskill: 'Weapon Skill (gear shows it as "+N <weapon> skill", which the pack does not count yet)' };
  const WORD = { dps: 'Weapon DPS', hit: 'Hit', exp: 'Expertise', crit: 'Critical Strike', str: 'Strength', agi: 'Agility', int: 'Intellect',
    spi: 'Spirit', sta: 'Stamina', sp: 'Spell Power', heal: 'Healing Power', mp5: 'MP5', haste: 'Haste', pen: 'Spell Pierce', ap: 'Attack Power',
    armor: 'Armor', def: 'Defense', dodge: 'Dodge', avoid: 'Avoidance (Dodge, Parry)', wskill: 'Weapon Skill' };

  // the starter weights for one row of SPECS (rule at the top of the file)
  function derive(row) {
    const [cls, , , , role, order, also, schools] = row;
    const w = {}, basis = {};
    const put = (k, v, why) => { if (v > 0) { w[k] = +v.toFixed(3); basis[k] = why; } };
    const factor = (tok) => { const i = order.indexOf(tok); return i >= 0 ? RANK[i] : also.includes(tok) ? ALSO : 0; };
    const placed = (tok) => { const i = order.indexOf(tok); return i >= 0 ? `#${i + 1} in the guide` : also.includes(tok) ? 'also valued by the guide' : ''; };
    const simple = ['str', 'agi', 'int', 'spi', 'sta', 'hit', 'crit', 'exp', 'haste', 'mp5', 'def', 'dodge', 'pen', 'armor'];
    simple.forEach((tok) => { const f = factor(tok); if (f) put(S[tok], COST[S[tok]][0] * f, `${placed(tok)} × cost ${COST[S[tok]][0]}`); });
    if (factor('avoid')) { const f = factor('avoid'); put(S.dodge, COST[S.dodge][0] * f, `${placed('avoid')} (Avoidance) × cost`); put(S.parry, COST[S.parry][0] * f, `${placed('avoid')} (Avoidance) × cost`); }
    if (role === 'tank' && w[S.dodge] == null && factor('agi')) put(S.dodge, COST[S.dodge][0] * ALSO, 'tank: dodge');
    // spell power: damage specs count spell damage and their own schools; healers count healing
    if (role === 'heal') {
      const f = factor('heal');
      put(S.heal, COST[S.heal][0] * f, `${placed('heal')} × cost ${COST[S.heal][0]}`);
      put(S.sp, w[S.heal], 'spell power heals for the same amount (1 point = 1 healing)');
    } else if (factor('sp')) {
      const v = COST[S.sp][0] * factor('sp');
      put(S.sp, v, `${placed('sp')} × cost 1`); put(S.sdmg, v, 'spell damage = spell power for damage');
      schools.forEach((sc) => put(SCHOOL[sc], v, `${sc} damage counts for your ${sc} spells`));
      // "+X healing and +X/3 damage" items (Forever's healing stat) still give a third as damage
      put(S.heal, v / 3, 'healing items also give a third as spell damage');
    }
    // attack power: ranked, or implied by the stat that gives it (CONV); weapon DPS = 14 attack power
    if (role === 'phys' || role === 'ranged' || (role === 'tank' && order.includes('str'))) {
      const per = AP_PER[cls] || [1, 0];
      const apStr = per[0] >= 2 && w[S.str] ? w[S.str] / per[0] : 0;
      const agiAp = role === 'ranged' ? 2 : per[1];
      const apAgi = agiAp && w[S.agi] ? (w[S.agi] * 0.5) / agiAp : 0;   // about half of Agility's value is its attack power, half its crit
      const ranked = factor('ap') ? COST[S.ap][0] * factor('ap') : 0;
      const ap = Math.max(ranked, apStr, apAgi);
      if (ap) put(S.ap, ap, ranked >= apStr && ranked >= apAgi ? `${placed('ap')} × cost 0.5` : apStr >= apAgi ? `from Strength (${per[0]} attack power per Strength)` : 'from Agility (half its value)');
      if (order.includes('dps') || also.includes('dps')) put('dps', ap * 14, '14 attack power = 1 weapon DPS (Forever client)');
    }
    if (role === 'tank' && order.includes('sta')) put(S.bv, COST[S.bv][0] * ALSO, 'shield block value');
    return { w, basis };
  }

  // Priest: the two sets worked out for this project from Forever mechanics (18 Nov 2026; Holy from
  // the mana model in the project's stat-weights notes, Shadow from the same notes). Kept as the
  // Priest defaults; the guide-order sets sit next to them.
  const PROJECT = [
    { id: 'healing', cls: 'PRIEST', trees: ['Discipline', 'Holy'], name: 'Healing (mana model)', role: 'heal',
      w: { 41: 1, 45: 1, 5: 1.6, 43: 2.3, 6: 0.7, 32: 0.3, 116: 4.2, 21: 4.2 },
      src: { label: 'Worked out 18 Nov 2026 from Forever priest mechanics (heal coefficients, Spirit regen, Meditation, 50% of pulls mana-short)', url: null },
      note: '+1 healing = 1. Mana stats are worth more the more often you run out of mana.' },
    { id: 'shadow', cls: 'PRIEST', trees: ['Shadow'], name: 'Shadow (project weights)', role: 'spell',
      w: { 45: 1, 42: 1, 111: 1, 6: 0.55, 43: 0.66, 5: 0.35, 32: 0.3, 116: 4.2, 21: 4.2, 31: 0.2, 117: 2, 18: 2 },
      src: { label: 'Project Shadow weights (22 Nov 2026)', url: null },
      note: '+1 shadow spell power = 1.' },
  ];

  const BUILTIN = {};
  SPECS.forEach((row) => {
    const [cls, tree, id, name, role, order, also, , slug, upd] = row;
    const d = derive(row);
    BUILTIN[id] = { id, cls, trees: [tree], name, role, w: d.w, basis: d.basis, order: order.map((t) => WORD[t]), also: also.map((t) => WORD[t]),
      missing: order.filter((t) => NO_STAT[t]).map((t) => NO_STAT[t]),
      src: { label: `Icy Veins, WoW Forever ${name.split(':')[0].replace(' (guide order)', '')} stat priority (updated ${upd || 'Nov 4, 2026'}, read 22 Nov 2026)`, url: IV + slug + '-pve-stat-priority' },
      note: 'Starter weights: the guide\'s order × what each stat costs on Forever gear. Not a simulation.' };
  });
  PROJECT.forEach((p) => { BUILTIN[p.id] = p; });
  // what each tree uses until you pick something else
  const DEFAULT = {};
  Object.values(BUILTIN).forEach((p) => p.trees.forEach((t) => { const k = p.cls + '/' + t; if (!DEFAULT[k]) DEFAULT[k] = p.id; }));
  DEFAULT['PRIEST/Discipline'] = 'healing'; DEFAULT['PRIEST/Holy'] = 'healing'; DEFAULT['PRIEST/Shadow'] = 'shadow';

  // ---------------------------------------------------------------- your own profiles
  // Saved in this browser (localStorage 'cc.weights.v1'), per class so alts of the same class share
  // them. Which profile a spec uses is kept per character and spec ('cc.gear.profile.<name>.<spec>',
  // the key the Gear tab always used).
  const KEY = 'cc.weights.v1';
  const store = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || { profiles: {} }; } catch (e) { return { profiles: {} }; } };
  const save = (st) => localStorage.setItem(KEY, JSON.stringify(st));
  const clean = (w) => { const o = {}; Object.entries(w || {}).forEach(([k, v]) => { v = Number(v); if (v > 0 && isFinite(v)) o[k] = +v.toFixed(3); }); return o; };

  const W = {
    S, PCT, COST, RANK, ALSO, AP_PER, SPECS, BUILTIN, WORD,
    get: (id) => BUILTIN[id] || store().profiles[id] || null,
    custom: (cls) => Object.values(store().profiles).filter((p) => !cls || p.cls === cls),
    // every profile you can pick for a class, built-in first; a tree's own ones first
    forClass(cls, tree) {
      const b = Object.values(BUILTIN).filter((p) => p.cls === cls);
      b.sort((x, y) => (y.trees.includes(tree) - x.trees.includes(tree)));
      return b.concat(W.custom(cls));
    },
    defaultFor: (cls, tree) => DEFAULT[cls + '/' + tree] || null,
    // a new profile of your own, copied from another (or empty)
    create(cls, fromId, name) {
      const st = store(), from = fromId && W.get(fromId);
      const id = 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      st.profiles[id] = { id, cls, own: true, name: (name || (from ? from.name + ' (mine)' : 'My weights')).slice(0, 60), w: clean(from ? from.w : {}), from: from ? (from.from || from.id) : null, updated: Date.now() };
      save(st);
      return id;
    },
    set(id, statId, value) {
      const st = store(), p = st.profiles[id];
      if (!p) return false;
      const v = Number(value);
      if (v > 0 && isFinite(v)) p.w[statId] = +v.toFixed(3); else delete p.w[statId];
      p.updated = Date.now(); save(st); return true;
    },
    rename(id, name) { const st = store(), p = st.profiles[id]; if (!p || !String(name || '').trim()) return false; p.name = String(name).trim().slice(0, 60); p.updated = Date.now(); save(st); return true; },
    // back to the numbers of the profile it was copied from
    reset(id) { const st = store(), p = st.profiles[id]; const from = p && p.from && BUILTIN[p.from]; if (!from) return false; p.w = clean(from.w); p.updated = Date.now(); save(st); return true; },
    remove(id) { const st = store(); if (!st.profiles[id]) return false; delete st.profiles[id]; save(st); return true; },
    // The old Gear tab kept one "Your own weights" list per character and spec. Move it into a
    // profile once, and point that spec at it.
    migrate(charName, specIndex, cls) {
      const oldKey = `cc.gear.own.${charName || ''}.${specIndex}`, pickKey = `cc.gear.profile.${charName || ''}.${specIndex}`;
      let old = null;
      try { old = JSON.parse(localStorage.getItem(oldKey) || 'null'); } catch (e) { old = null; }
      if (!old || typeof old !== 'object') return null;
      const st = store();
      const id = 'u-migrated-' + (charName || 'x').replace(/[^A-Za-z]/g, '') + '-' + specIndex;
      if (!st.profiles[id]) { st.profiles[id] = { id, cls, own: true, name: `My weights (spec ${specIndex})`, w: clean(old), from: null, updated: Date.now() }; save(st); }
      if (localStorage.getItem(pickKey) === 'own') localStorage.setItem(pickKey, id);
      localStorage.removeItem(oldKey);
      return id;
    },

    // ---------------------------------------------------------------- scoring
    // An item's stats keyed by pack stat id, plus 'dps' for weapons. From the game's own numbers
    // when you have the item (random suffixes count), else the pack.
    GAME: { ITEM_MOD_AGILITY_SHORT: 3, ITEM_MOD_STRENGTH_SHORT: 4, ITEM_MOD_INTELLECT_SHORT: 5, ITEM_MOD_SPIRIT_SHORT: 6,
      ITEM_MOD_STAMINA_SHORT: 7, ITEM_MOD_SPELL_HEALING_DONE_SHORT: 41, ITEM_MOD_SPELL_DAMAGE_DONE_SHORT: 42,
      ITEM_MOD_MANA_REGENERATION_SHORT: 43, ITEM_MOD_SPELL_POWER_SHORT: 45, ITEM_MOD_SHADOW_DAMAGE_DONE_SHORT: 111,
      ITEM_MOD_HIT_RATING_SHORT: 31, ITEM_MOD_CRIT_RATING_SHORT: 32, ITEM_MOD_SPELL_CRIT_RATING_SHORT: 32, ITEM_MOD_HASTE_RATING_SHORT: 36,
      ITEM_MOD_EXPERTISE_RATING_SHORT: 37, ITEM_MOD_ATTACK_POWER_SHORT: 38, ITEM_MOD_DEFENSE_SKILL_RATING_SHORT: 12, ITEM_MOD_DODGE_RATING_SHORT: 13,
      ITEM_MOD_PARRY_RATING_SHORT: 14, ITEM_MOD_BLOCK_RATING_SHORT: 15, ITEM_MOD_BLOCK_VALUE_SHORT: 48, ITEM_MOD_HEALTH_REGEN_SHORT: 46,
      ITEM_MOD_SPELL_PENETRATION_SHORT: 47, RESISTANCE0_NAME: 100, ITEM_MOD_FIRE_RESISTANCE_SHORT: 101, ITEM_MOD_FROST_RESISTANCE_SHORT: 102,
      ITEM_MOD_NATURE_RESISTANCE_SHORT: 103, ITEM_MOD_SHADOW_RESISTANCE_SHORT: 104, ITEM_MOD_ARCANE_RESISTANCE_SHORT: 105,
      ITEM_MOD_FIRE_DAMAGE_DONE_SHORT: 110, ITEM_MOD_FROST_DAMAGE_DONE_SHORT: 112, ITEM_MOD_ARCANE_DAMAGE_DONE_SHORT: 113,
      ITEM_MOD_NATURE_DAMAGE_DONE_SHORT: 114, ITEM_MOD_HOLY_DAMAGE_DONE_SHORT: 115, ITEM_MOD_DAMAGE_PER_SECOND_SHORT: 'dps' },
    // "(41.3 damage per second)" in a tooltip
    dpsOf(lines) {
      for (const l of lines || []) { const t = typeof l === 'string' ? l : l && l.l; const m = /\(([\d.]+) damage per second\)/.exec(t || ''); if (m) return Number(m[1]); }
      return 0;
    },
    fromGame(stats, tip) {
      const st = {};
      Object.entries(stats || {}).forEach(([k, v]) => { const id = W.GAME[k]; if (id != null && typeof v === 'number') st[id] = (st[id] || 0) + v; });
      if (st.dps == null) { const d = W.dpsOf(tip); if (d) st.dps = d; }
      return st;
    },
    fromPack(g) {
      if (!g) return {};
      const st = {};
      (g[8] || []).forEach(([k, v]) => { st[k] = (st[k] || 0) + v; });
      if (g[9] === 2) { const d = W.dpsOf(g[10]); if (d) st.dps = d; }
      return st;
    },
    // sum of stat x weight; % lines count as their rating (CONV) unless the profile weighs them itself
    score(st, w) {
      let s = 0;
      for (const [k, v] of Object.entries(st || {})) {
        let wt = w[k];
        if (wt == null && PCT[k]) wt = (w[PCT[k][0]] || 0) * PCT[k][1];
        s += (wt || 0) * v;
      }
      return s;
    },
    // what the stat ids are called, for tables
    statName(k, names) { return k === 'dps' ? 'Weapon DPS' : (names && names[k]) || ({ 36: 'Haste', 37: 'Expertise' })[k] || 'stat ' + k; },
    // stats you can weigh in the editor, in a sensible order
    EDITABLE: ['dps', 38, 4, 3, 7, 5, 6, 31, 32, 37, 36, 45, 42, 41, 43, 47, 110, 111, 112, 113, 114, 115, 12, 13, 14, 15, 48, 100],
  };
  window.CCWeights = W;

  // ---------------------------------------------------------------- the Stat weights tab
  const CC = window.CC;
  if (!CC || !CC.api || !CC.V) return;
  const A = CC.api, V = CC.V, esc = A.esc;
  const char = () => ((A.CH && A.CH.snap) || {}).character || {};
  const names = () => (A.GD && A.GD.stat) || {};
  const fmt = (v) => (v == null ? '' : String(+Number(v).toFixed(3)));

  // which profile each of your specs uses (the Gear tab's spec list)
  function specList() { return CC.gear && CC.gear.specs ? CC.gear.specs() : []; }

  V.weights = function () {
    const ch = char(), cls = ch.classFile;
    if (!cls) return '<div class="empty">Your character isn\'t saved yet: Sync in game.</div>';
    const specs = specList();
    specs.forEach((sp) => W.migrate(ch.name, sp.i, cls));
    const all = W.forClass(cls);
    const sel = W.get(A.STATE.wProfile) && W.get(A.STATE.wProfile).cls === cls ? W.get(A.STATE.wProfile)
      : W.get(specs.length && CC.gear.profileKey ? CC.gear.profileKey(specs.find((s) => s.i === (A.CH.snap || {}).activeSpec) || specs[0]) : null) || all[0];
    let h = '';
    if (specs.length) {
      h += `<h2>Your specs</h2><div class="table wspec"><div class="thead"><div>Spec</div><div>Scores gear with</div></div>`;
      specs.forEach((sp) => {
        const cur = CC.gear.profileKey(sp);
        h += `<div class="tr"><div class="c-main"><div class="nm">${esc(sp.label)}${sp.i === (A.CH.snap || {}).activeSpec ? ' <span class="badge on">active</span>' : ''}</div></div><div><select data-wspec="${sp.i}">${W.forClass(cls, sp.tree).map((p) => `<option value="${esc(p.id)}"${p.id === cur ? ' selected' : ''}>${esc(p.name)}${p.own ? ' (yours)' : ''}</option>`).join('')}</select></div></div>`;
      });
      h += '</div>';
    }
    h += `<h2>Profiles for ${esc(ch.class || cls)}</h2><div class="chips">${all.map((p) => `<button data-wprof="${esc(p.id)}" class="${sel && p.id === sel.id ? 'on' : ''}">${esc(p.name)}${p.own ? ' <span>yours</span>' : ''}</button>`).join('')}<button data-wnew="">+ New empty profile</button></div>`;
    if (!sel) return h + '<div class="empty">No profiles for this class yet.</div>';
    h += `<div class="wcard"><div class="row sb"><div><div class="nm">${esc(sel.name)}</div>`;
    if (sel.src) h += `<p class="meta">${sel.src.url ? `<a href="${esc(sel.src.url)}" target="_blank" rel="noopener">${esc(sel.src.label)}</a>` : esc(sel.src.label)}</p>`;
    if (sel.own) h += `<p class="meta">Your own profile${sel.from && W.get(sel.from) ? `, copied from “${esc(W.get(sel.from).name)}”` : ''}. Saved in this browser.</p>`;
    h += `</div><div class="chips">${sel.own
      ? `<button data-wrename="${esc(sel.id)}">Rename</button>${sel.from && W.BUILTIN[sel.from] ? `<button data-wreset="${esc(sel.id)}">Reset to original</button>` : ''}<button data-wcopy="${esc(sel.id)}">Copy</button><button class="neg" data-wdel="${esc(sel.id)}">Delete</button>`
      : `<button data-wcopy="${esc(sel.id)}">Copy to edit</button>`}</div></div>`;
    if (sel.order) h += `<p class="prio">${sel.order.map((x, i) => `<span><b>${i + 1}</b> ${esc(x)}</span>`).join('')}${sel.also && sel.also.length ? `<span class="dim">also: ${esc(sel.also.join(', '))}</span>` : ''}</p>`;
    if (sel.missing && sel.missing.length) h += `<p class="meta">Not scored yet: ${esc(sel.missing.join('; '))}.</p>`;
    if (sel.note) h += `<p class="meta">${esc(sel.note)}</p>`;
    // the numbers: read-only for built-in profiles, editable for yours
    const keys = W.EDITABLE.filter((k) => sel.own || sel.w[k] != null).concat(Object.keys(sel.w).filter((k) => !W.EDITABLE.map(String).includes(String(k))));
    h += `<div class="wedit">${keys.map((k) => {
      const v = sel.w[k];
      const why = sel.basis && sel.basis[k] ? ` title="${esc(sel.basis[k])}"` : '';
      return `<label${why}><span>${esc(W.statName(k, names()))}</span>${sel.own ? `<input type="number" step="0.05" min="0" data-wset="${esc(sel.id)}" data-wstat="${esc(k)}" value="${fmt(v)}" placeholder="0">` : `<b class="num">${fmt(v)}</b>`}</label>`;
    }).join('')}</div>`;
    h += `<p class="meta">Points per 1 of each stat; an item's score is the sum of stat × weight. Crit, hit, dodge, parry and block “%” lines count as rating (14 crit, 10 hit, 12 dodge, 15 parry, 5 block rating = 1%, Forever client via foreverdb.net/stats) unless a profile gives them their own number. Hover a number to see where it came from.</p></div>`;
    h += `<details class="how"><summary>How the starter weights are worked out</summary><p>Order: each spec's WoW Forever stat priority page on Icy Veins (linked above). Those pages give an order, not numbers. Cost: what one point of each stat uses of an item's stat budget on Forever gear, measured from the game-data pack (Forever client tooltips): Stamina, Strength, Agility, Intellect, Spirit and Spell Power 1, Healing 0.54, Hit 1.33, Crit 0.86, MP5 2.33, Attack Power 0.5, Defense 1.79, Dodge 1.08; Expertise, Parry, Haste, Spell Pierce and bonus Armor have no clean sample and are assumed (the tooltip on each number says so). Starter weight = cost × 1, 0.8, 0.65, 0.5, 0.4 or 0.32 for 1st to 6th in the order, 0.3 for stats the guide says are also valued, 0 for the rest. Attack power comes from the stat that gives it (2 per Strength for Warriors, Paladins, Shamans, Druids; half of Agility's value for Rogues and Hunters); 14 attack power = 1 weapon DPS. Hit and Expertise count the same before and after their cap, because the app doesn't know your hit total yet: stop weighing them once you're capped (8% melee and ranged, 17% spells against raid bosses).</p></details>`;
    return h;
  };

  const rerender = () => A.render();
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-wprof],[data-wnew],[data-wcopy],[data-wreset],[data-wdel],[data-wrename]');
    if (!t) return;
    const cls = char().classFile;
    if (t.dataset.wprof != null) A.STATE.wProfile = t.dataset.wprof;
    else if (t.dataset.wnew != null) A.STATE.wProfile = W.create(cls, null, 'My weights');
    else if (t.dataset.wcopy != null) A.STATE.wProfile = W.create(cls, t.dataset.wcopy);
    else if (t.dataset.wreset != null) W.reset(t.dataset.wreset);
    else if (t.dataset.wdel != null) {
      const id = t.dataset.wdel;
      W.remove(id);
      // a spec that used it goes back to its default
      specList().forEach((sp) => { if (CC.gear.profileKey(sp) === id) CC.gear.setProfile(sp, null); });
      A.STATE.wProfile = null;
    } else if (t.dataset.wrename != null) {
      const p = W.get(t.dataset.wrename);
      const name = window.prompt('Name for this profile', p ? p.name : '');
      if (name) W.rename(t.dataset.wrename, name);
    }
    rerender();
  });
  document.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-wset]');
    if (inp) { W.set(inp.dataset.wset, inp.dataset.wstat, inp.value); rerender(); return; }
    const sel = e.target.closest('[data-wspec]');
    if (sel) { const sp = specList().find((s) => String(s.i) === sel.dataset.wspec); if (sp) CC.gear.setProfile(sp, sel.value); rerender(); }
  });
})();
