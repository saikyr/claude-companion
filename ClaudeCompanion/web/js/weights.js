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
  // second read from the tooltip. A profile weighs it twice: 'dps' for a melee weapon (main hand; an
  // off-hand weapon counts half, as off-hand hits do half damage) and 'rdps' for a bow, gun, crossbow
  // or thrown weapon in the Ranged slot. Only Hunters weigh 'rdps'; nobody weighs a wand's DPS.
  const S = { agi: 3, str: 4, int: 5, spi: 6, sta: 7, def: 12, dodge: 13, parry: 14, block: 15, hit: 31, crit: 32,
    haste: 36, exp: 37, ap: 38, rap: 39, heal: 41, sdmg: 42, mp5: 43, sp: 45, pen: 47, bv: 48, armor: 100 };
  const OFF_HAND_DPS = 0.5;
  const SCHOOL = { fire: 110, shadow: 111, frost: 112, arcane: 113, nature: 114, holy: 115 };
  // a % line is worth this many rating points (CONV)
  const PCT = { 116: [S.crit, 14], 21: [S.crit, 14], 117: [S.hit, 10], 18: [S.hit, 10], 118: [S.dodge, 12], 119: [S.parry, 15], 120: [S.block, 5] };
  const PCT_KEYS = Object.keys(PCT);
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
    ['WARRIOR', 'Protection', 'iv-protwar-threat', 'Protection (threat)', 'phys', ['exp', 'hit', 'agi', 'str', 'sta'], [], [], 'protection-warrior-tank'],
    ['WARRIOR', 'Protection', 'iv-protwar-survival', 'Protection (survival)', 'tank', ['sta', 'armor', 'agi', 'avoid', 'def'], [], [], 'protection-warrior-tank'],
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
    ['PRIEST', 'Discipline', 'iv-disc', 'Discipline', 'heal', ['heal', 'mp5', 'spi', 'int', 'crit'], [], [], 'discipline-priest-healer'],
    ['PRIEST', 'Holy', 'iv-holy', 'Holy', 'heal', ['heal', 'mp5', 'spi', 'int', 'crit'], [], [], 'holy-priest-healer'],
    ['PRIEST', 'Shadow', 'iv-shadow', 'Shadow', 'spell', ['hit', 'sp', 'crit', 'pen', 'spi'], [], ['shadow'], 'shadow-priest-ranged-dps'],
    ['PALADIN', 'Holy', 'iv-holypal', 'Holy', 'heal', ['heal', 'int', 'spi', 'mp5', 'crit'], [], [], 'holy-paladin-healer'],
    ['PALADIN', 'Protection', 'iv-protpal', 'Protection', 'tank', ['sta', 'def', 'sp', 'int', 'str'], [], ['holy'], 'protection-paladin-tank'],
    ['PALADIN', 'Retribution', 'iv-ret-unsealed', 'Retribution (Unsealed Wrath)', 'phys', ['dps', 'hit', 'exp', 'str', 'sp'], ['crit', 'agi', 'int'], ['holy'], 'retribution-paladin-melee-dps'],
    ['PALADIN', 'Retribution', 'iv-ret-holyshock', 'Retribution (Holy Shock)', 'phys', ['dps', 'hit', 'sp', 'crit', 'exp'], ['str', 'agi', 'int'], ['holy'], 'retribution-paladin-melee-dps'],
    ['SHAMAN', 'Elemental', 'iv-elemental', 'Elemental', 'spell', ['sp', 'hit', 'crit', 'int', 'mp5'], [], ['nature', 'fire', 'frost'], 'elemental-shaman-ranged-dps'],
    ['SHAMAN', 'Enhancement', 'iv-enhancement', 'Enhancement', 'phys', ['dps', 'hit', 'exp', 'str', 'int', 'sp'], [], ['nature', 'fire', 'frost'], 'enhancement-shaman-melee-dps', 'Nov 13, 2026'],
    ['SHAMAN', 'Restoration', 'iv-restosham', 'Restoration', 'heal', ['heal', 'crit', 'int', 'spi', 'mp5'], [], [], 'restoration-shaman-healer'],
    ['DRUID', 'Balance', 'iv-balance', 'Balance', 'spell', ['hit', 'crit', 'sp', 'int'], [], ['arcane', 'nature'], 'balance-druid-ranged-dps'],
    ['DRUID', 'Feral', 'iv-feral-cat', 'Feral (cat, bear threat)', 'phys', ['dps', 'exp', 'hit', 'agi', 'str'], ['crit', 'ap'], [], 'feral-druid-melee-dps-and-tank'],
    ['DRUID', 'Feral', 'iv-feral-bear', 'Feral (bear survival)', 'tank', ['armor', 'def', 'sta', 'agi', 'dodge'], [], [], 'feral-druid-melee-dps-and-tank'],
    ['DRUID', 'Restoration', 'iv-restodruid', 'Restoration', 'heal', ['heal', 'int', 'spi', 'mp5', 'crit'], [], [], 'restoration-druid-healer'],
  ];
  // Guide words that the pack has no stat for: weapon skill shows on gear as a skill line, not a stat.
  const NO_STAT = { wskill: 'Weapon Skill (gear shows it as "+N <weapon> skill", which the pack does not count yet)' };
  const WORD = { dps: 'Weapon DPS', hit: 'Hit', exp: 'Expertise', crit: 'Critical Strike', str: 'Strength', agi: 'Agility', int: 'Intellect',
    spi: 'Spirit', sta: 'Stamina', sp: 'Spell Power', heal: 'Healing Power', mp5: 'MP5', haste: 'Haste', pen: 'Spell Pierce', ap: 'Attack Power',
    armor: 'Armor', def: 'Defense', dodge: 'Dodge', avoid: 'Avoidance (Dodge, Parry)', wskill: 'Weapon Skill' };

  // the starter weights for one row of SPECS (rule at the top of the file)
  function derive(row) {
    const [cls, tree, , , role, order, also, schools] = row;
    const w = {}, basis = {};
    const put = (k, v, why) => { if (v > 0) { w[k] = +v.toFixed(3); basis[k] = why; } };
    const factor = (tok) => { const i = order.indexOf(tok); return i >= 0 ? RANK[i] : also.includes(tok) ? ALSO : 0; };
    const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
    const placed = (tok) => { const i = order.indexOf(tok); return i >= 0 ? `${ORD[i]} in the guide's order (× ${RANK[i]})` : also.includes(tok) ? `also valued by the guide (× ${ALSO})` : ''; };
    const cost = (c) => `, × ${c} for what a point costs on Forever gear`;
    const simple = ['str', 'agi', 'int', 'spi', 'sta', 'hit', 'crit', 'exp', 'haste', 'mp5', 'def', 'dodge', 'pen', 'armor'];
    simple.forEach((tok) => { const f = factor(tok); if (f) put(S[tok], COST[S[tok]][0] * f, placed(tok) + cost(COST[S[tok]][0])); });
    if (factor('avoid')) { const f = factor('avoid'); put(S.dodge, COST[S.dodge][0] * f, `Avoidance: ${placed('avoid')}${cost(COST[S.dodge][0])}`); put(S.parry, COST[S.parry][0] * f, `Avoidance: ${placed('avoid')}${cost(COST[S.parry][0])}`); }
    if (role === 'tank' && w[S.dodge] == null && factor('agi')) put(S.dodge, COST[S.dodge][0] * ALSO, 'Tanks: some value on Dodge');
    // a tank's armor always counts a little, so a cloth robe with the right stats doesn't beat a plate chest
    if ((role === 'tank' || tree === 'Protection') && !factor('armor')) put(S.armor, COST[S.armor][0] * ALSO, 'Tanks: some value on armor (the guide does not rank it)');
    // spell power: damage specs count spell damage and their own schools; healers count healing
    if (role === 'heal') {
      const f = factor('heal');
      put(S.heal, COST[S.heal][0] * f, placed('heal') + cost(COST[S.heal][0]));
      put(S.sp, w[S.heal], 'Spell power heals for the same amount as +healing');
    } else if (factor('sp')) {
      const v = COST[S.sp][0] * factor('sp');
      put(S.sp, v, placed('sp') + cost(1)); put(S.sdmg, v, 'Spell damage counts the same as spell power for damage');
      schools.forEach((sc) => put(SCHOOL[sc], v, `${sc[0].toUpperCase() + sc.slice(1)} damage counts in full for your ${sc} spells`));
      // "+X healing and +X/3 damage" items (Forever's healing stat) still give a third as damage
      put(S.heal, v / 3, 'Healing items also give a third as much spell damage');
    }
    // attack power: ranked, or implied by the stat that gives it (CONV); weapon DPS = 14 attack power
    if (role === 'phys' || role === 'ranged' || (role === 'tank' && order.includes('str'))) {
      const per = AP_PER[cls] || [1, 0];
      const apStr = per[0] >= 2 && w[S.str] ? w[S.str] / per[0] : 0;
      const agiAp = role === 'ranged' ? 2 : per[1];
      const apAgi = agiAp && w[S.agi] ? (w[S.agi] * 0.5) / agiAp : 0;   // about half of Agility's value is its attack power, half its crit
      const ranked = factor('ap') ? COST[S.ap][0] * factor('ap') : 0;
      const ap = Math.max(ranked, apStr, apAgi);
      if (ap) put(S.ap, ap, ranked >= apStr && ranked >= apAgi ? placed('ap') + cost(0.5) : apStr >= apAgi ? `What Strength gives: ${per[0]} attack power per Strength` : 'What Agility gives: half its value is attack power');
      // weapon DPS: the weapon the spec hits with. Ranged Hunters shoot (their melee weapon is a stat stick);
      // Survival Hunters fight in melee and still shoot; everyone else's ranged weapon only pulls.
      const hunter = cls === 'HUNTER';
      if (order.includes('dps') || also.includes('dps')) {
        if (role !== 'ranged') put('dps', ap * 14, '14 attack power = 1 weapon DPS (Forever client). Counts for your main hand; an off-hand weapon counts half (off-hand hits do half damage)');
        if (hunter) put('rdps', ap * 14, '14 attack power = 1 ranged weapon DPS (Forever client): your bow, gun or crossbow');
      }
      if (hunter && ap) put(S.rap, ap, 'Ranged attack power counts like attack power for your shots');
      // a stat the guide doesn't rank still gives attack power (CONV): Strength for Rogues, for example
      if (ap && role !== 'tank') {
        const strAp = role === 'ranged' ? 0 : per[0];        // Strength gives no ranged attack power
        if (!factor('str') && strAp) put(S.str, ap * strAp, `Not in the guide's order, but each Strength gives ${strAp} attack power`);
        if (!factor('agi') && agiAp) put(S.agi, ap * agiAp, `Not in the guide's order, but each Agility gives ${agiAp} attack power`);
      }
    }
    if (role === 'tank' && order.includes('sta')) put(S.bv, COST[S.bv][0] * ALSO, 'Tanks: some value on shield block value');
    return { w, basis };
  }

  // Priest: worked out for this project from Forever's own spell and regen numbers (18 Nov 2026, the
  // project's stat-weights notes), because the guides give an order but no numbers and their order is for
  // level-60 raids. They replace the guide-order sets for Priests; the guide's order is kept for comparison.
  const HEAL_W = { 41: 1, 45: 1, 5: 1.6, 43: 2.3, 6: 0.7, 32: 0.3 };
  const HEAL_WHY = {
    41: 'The unit: every other number is "worth this many points of +healing".',
    45: 'Spell power heals for the same amount as +healing.',
    5: '1 Intellect = 15 mana (16.5 with Mental Strength). 1 mana is worth about 0.19 healing in a pull you run out of mana (3.2 healing per mana / 17 healing per +1 healing over one mana bar). Counted for half of all pulls: 1.6.',
    43: 'MP5 gives mana all fight long: about 48 mana per point over a 2-minute bar, × 0.19 × half the pulls: 2.3. Worth more in long fights (3.5 at 4 minutes), less in short ones.',
    6: 'Spirit regen counts at 50% while casting (Meditation 3/3), and the model assumes you never leave the 5-second rule: 0.7, the lowest case. Gaps in casting make it worth more.',
    32: '14 crit rating = 1% crit (Forever client). A crit heal adds 50%, but about a third of it overheals: 0.3.',
  };
  const HEAL_NOTE = 'One point of +healing = 1. Mana stats are counted for the pulls where you run short of mana (half of them, a middle estimate), which is why Intellect and MP5 sit above what the raid guides suggest: while levelling in dungeons you run out of mana before you run out of time. If you rarely go out of mana, copy this and lower Intellect, MP5 and Spirit.';
  const HEAL_SRC = { label: 'Worked out 18 Nov 2026 from Forever priest numbers: heal coefficients (foreverchanges.pro), base heals (metabot.gg), Spirit and Meditation (conquestcapped.com), 14 crit rating = 1% (foreverdb.net/stats)', url: null };
  const PROJECT = [
    { id: 'healing', cls: 'PRIEST', trees: ['Holy'], name: 'Holy', role: 'heal', w: HEAL_W, why: HEAL_WHY, note: HEAL_NOTE, src: HEAL_SRC },
    { id: 'disc', cls: 'PRIEST', trees: ['Discipline'], name: 'Discipline', role: 'heal', w: HEAL_W, why: HEAL_WHY, note: HEAL_NOTE, src: HEAL_SRC },
    { id: 'shadow', cls: 'PRIEST', trees: ['Shadow'], name: 'Shadow', role: 'spell',
      w: { 45: 1, 42: 1, 111: 1, 6: 0.55, 43: 0.66, 5: 0.35, 32: 0.3, 31: 0.2 },
      why: {
        45: 'The unit: every other number is "worth this many points of shadow spell power".',
        42: 'Spell damage counts for shadow spells in full.', 111: 'Shadow damage counts in full.',
        6: 'Spirit Tap doubles Spirit for 15 s after each kill and keeps 50% regen while casting, so Spirit refills you between pulls: 0.55.',
        43: 'Steady mana through a questing loop (about 6 kills per mana bar): 0.66.',
        5: '15 mana per point plus a little crit: 0.35.',
        32: '14 crit rating = 1% crit; crits add 50% (100% in Shadowform) to Mind Blast and Mind Flay only: 0.3.',
        31: '10 hit rating = 1% hit. Against mobs of your level you already hit 96%, and Shadow Focus adds more, so little is missed: 0.2.',
      },
      note: 'One point of shadow spell power = 1. Built for questing and dungeons: kill, regen with Spirit Tap, next pull. For raid bosses (17% spell hit needed), copy this and raise Hit.',
      src: { label: 'Worked out 18 Nov 2026 from Forever shadow ranks (metabot.gg), talents (foreverchanges.pro talents), 14 crit / 10 hit rating = 1% (foreverdb.net/stats); coefficients are Classic rules', url: null } },
  ];

  const BUILTIN = {}, GUIDE = {};
  SPECS.forEach((row) => {
    const [cls, tree, id, name, role, order, also, , slug, upd] = row;
    const d = derive(row);
    const p = { id, cls, trees: [tree], name, role, w: d.w, basis: d.basis, order: order.map((t) => WORD[t]), also: also.map((t) => WORD[t]),
      missing: order.filter((t) => NO_STAT[t]).map((t) => NO_STAT[t]),
      src: { label: `Icy Veins, WoW Forever ${name.replace(/ \(.*\)$/, '')} stat priority (updated ${upd || 'Nov 4, 2026'}, read 22 Nov 2026)`, url: IV + slug + '-pve-stat-priority' },
      note: 'The order is the guide\'s. Each number = that place in the order × what one point of the stat costs on Forever gear, so a stat that items give a lot of (Healing: 0.54 of a point of budget each) gets a smaller number than a rare one (MP5: 2.33). Not a simulation: copy it and change what you know better.' };
    // a tree the project worked out its own numbers for keeps the guide's order only for comparison
    if (PROJECT.some((x) => x.cls === cls && x.trees.includes(tree))) GUIDE[cls + '/' + tree] = p; else BUILTIN[id] = p;
  });
  PROJECT.forEach((p) => { p.guide = GUIDE[p.cls + '/' + p.trees[0]] || null; BUILTIN[p.id] = p; });
  // what each tree uses until you pick something else: its first profile
  const DEFAULT = {};
  Object.values(BUILTIN).forEach((p) => p.trees.forEach((t) => { const k = p.cls + '/' + t; if (!DEFAULT[k]) DEFAULT[k] = p.id; }));
  PROJECT.forEach((p) => p.trees.forEach((t) => { DEFAULT[p.cls + '/' + t] = p.id; }));

  // ---------------------------------------------------------------- your own profiles
  // Saved in this browser (localStorage 'cc.weights.v1'), per class so alts of the same class share
  // them. Which profile a spec uses is kept per character and spec ('cc.gear.profile.<Name-Realm>.spec<1|2>',
  // the key the Gear tab always used).
  const KEY = 'cc.weights.v1';
  const store = () => {
    let st; try { st = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { st = null; }
    st = st && st.profiles ? st : { profiles: {} };
    // older saves could carry a fixed weight for a "%" line, which hid edits to its rating: drop it
    Object.values(st.profiles).forEach((p) => { if (p && p.w) PCT_KEYS.forEach((k) => delete p.w[k]); });
    // Weapon DPS used to count in every weapon slot. Since it counts per slot (melee 'dps', ranged 'rdps'),
    // a Hunter's own profile keeps its number for the ranged weapon, and one copied from a ranged spec
    // stops counting the melee weapon's DPS. Done once per profile (v: 2), so later edits stay.
    let changed = false;
    Object.values(st.profiles).forEach((p) => {
      if (!p || !p.w || p.v >= 2) return;
      if (p.cls === 'HUNTER' && p.w.dps && p.w.rdps == null) { p.w.rdps = p.w.dps; if (BUILTIN[p.from] && BUILTIN[p.from].role === 'ranged') delete p.w.dps; }
      p.v = 2; changed = true;
    });
    if (changed) save(st);
    return st;
  };
  const save = (st) => localStorage.setItem(KEY, JSON.stringify(st));
  const clean = (w) => { const o = {}; Object.entries(w || {}).forEach(([k, v]) => { v = Number(v); if (v > 0 && isFinite(v) && !PCT[k]) o[k] = +v.toFixed(3); }); return o; };   // "%" lines follow their rating

  // ---------------------------------------------------------------- which tree a spec is
  // A spec is its biggest talent tree. With no points yet (below level 10, or a second spec never set up)
  // it is the tree that class levels in, not simply the first tree (a level-5 Paladin isn't a Holy healer).
  // A tie goes to the levelling tree if it is one of the tied ones, else to the first of them.
  const LEVELLING = { WARRIOR: 'Arms', PALADIN: 'Retribution', HUNTER: 'Beast Mastery', ROGUE: 'Combat', PRIEST: 'Shadow',
    MAGE: 'Frost', WARLOCK: 'Affliction', SHAMAN: 'Enhancement', DRUID: 'Feral' };
  const TREES = {};
  SPECS.forEach(([cls, tree]) => { (TREES[cls] = TREES[cls] || []).includes(tree) || TREES[cls].push(tree); });
  // pts: points per tree in the class's tree order (TREES), or null when the talents can't be read.
  // -> { tree, why: 'points' | 'tie' | 'none' | 'unknown' }
  function pickTree(cls, pts) {
    const names = TREES[cls] || [], lev = LEVELLING[cls] || names[0] || null;
    if (!Array.isArray(pts) || pts.length !== names.length) return { tree: lev, why: 'unknown' };
    const max = Math.max(...pts.map((x) => Number(x) || 0));
    if (!(max > 0)) return { tree: lev, why: 'none' };
    const top = names.filter((t, i) => (Number(pts[i]) || 0) === max);
    if (top.length === 1) return { tree: top[0], why: 'points' };
    return { tree: top.includes(lev) ? lev : top[0], why: 'tie' };
  }

  const W = {
    S, PCT, COST, RANK, ALSO, AP_PER, SPECS, BUILTIN, GUIDE, WORD, LEVELLING, TREES, pickTree,
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
      st.profiles[id] = { id, cls, own: true, v: 2, name: (name || (from ? from.name + ' (mine)' : 'My weights')).slice(0, 60), w: clean(from ? from.w : {}), from: from ? (from.from || from.id) : null, updated: Date.now() };
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
    // profile once, and point that spec at it (under `toKey`, the page's key for that spec's pick).
    migrate(charName, specIndex, cls, toKey) {
      const oldKey = `cc.gear.own.${charName || ''}.${specIndex}`, pickKey = `cc.gear.profile.${charName || ''}.${specIndex}`;
      let old = null;
      try { old = JSON.parse(localStorage.getItem(oldKey) || 'null'); } catch (e) { old = null; }
      if (!old || typeof old !== 'object') return null;
      const st = store();
      const id = 'u-migrated-' + (charName || 'x').replace(/[^A-Za-z]/g, '') + '-' + specIndex;
      if (!st.profiles[id]) { st.profiles[id] = { id, cls, own: true, name: `My weights (spec ${specIndex})`, w: clean(old), from: null, updated: Date.now() }; save(st); }
      if (localStorage.getItem(pickKey) === 'own') { localStorage.setItem(toKey || pickKey, id); if (toKey) localStorage.removeItem(pickKey); }
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
      ITEM_MOD_EXPERTISE_RATING_SHORT: 37, ITEM_MOD_ATTACK_POWER_SHORT: 38, ITEM_MOD_RANGED_ATTACK_POWER_SHORT: 39, ITEM_MOD_DEFENSE_SKILL_RATING_SHORT: 12, ITEM_MOD_DODGE_RATING_SHORT: 13,
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
      // many bows and guns say their ranged attack power only as an Equip line, which the pack doesn't count
      if (st[S.rap] == null) for (const l of g[10] || []) { const m = /^Equip: Increases ranged attack power by (\d+)\.$/.exec(l); if (m) st[S.rap] = Number(m[1]); }
      return st;
    },
    // which hand a slot is: a Gear slot name ('Main hand', 'Off hand', 'Ranged') or a game slot number
    hand: (slot) => ({ 'Main hand': 'main', 16: 'main', 'Off hand': 'off', 17: 'off', Ranged: 'ranged', 18: 'ranged' })[slot] || null,
    // what one point of weapon DPS is worth in a slot: melee 'dps' in the main hand, half of it in the off
    // hand, 'rdps' in the Ranged slot. No slot given (a caller that doesn't know): the melee number.
    dpsWeight(w, slot) {
      const h = W.hand(slot);
      if (h === 'ranged') return w.rdps || 0;
      if (h === 'off') return (w.dps || 0) * OFF_HAND_DPS;
      return w.dps || 0;
    },
    // sum of stat x weight; % lines count as their rating (CONV) unless the profile weighs them itself.
    // slot: where the item is worn (see hand), which decides what its weapon DPS is worth
    score(st, w, slot) {
      let s = 0;
      for (const [k, v] of Object.entries(st || {})) {
        let wt = k === 'dps' ? W.dpsWeight(w, slot) : w[k];
        if (wt == null && PCT[k]) wt = (w[PCT[k][0]] || 0) * PCT[k][1];
        s += (wt || 0) * v;
      }
      return s;
    },
    OFF_HAND_DPS,
    // what the stat ids are called, for tables
    statName(k, names) { return k === 'dps' ? 'Melee weapon DPS' : k === 'rdps' ? 'Ranged weapon DPS' : (names && names[k]) || ({ 36: 'Haste', 37: 'Expertise', 39: 'Ranged attack power' })[k] || 'stat ' + k; },
    // stats you can weigh in the editor, in a sensible order
    EDITABLE: ['dps', 'rdps', 38, 39, 4, 3, 7, 5, 6, 31, 32, 37, 36, 45, 42, 41, 43, 47, 110, 111, 112, 113, 114, 115, 12, 13, 14, 15, 48, 100],
  };
  window.CCWeights = W;

  // ---------------------------------------------------------------- the Stat weights tab
  const CC = window.CC;
  if (!CC || !CC.api || !CC.V) return;
  const A = CC.api, V = CC.V, esc = A.esc;
  const char = () => ((A.CH && A.CH.snap) || {}).character || {};
  const names = () => (A.GD && A.GD.stat) || {};
  const fmt = (v) => (v == null ? '' : String(+Number(v).toFixed(3)));
  // "%" lines are scored through their rating (PCT), so they aren't shown as weights of their own
  const SHOWN = (k) => !PCT[k];

  // which profile each of your specs uses (the Gear tab's spec list)
  function specList() { return CC.gear && CC.gear.specs ? CC.gear.specs() : []; }
  // how a spec came to use its weights, in words
  function reason(sp) {
    const pick = CC.gear.pickedProfile(sp);
    if (pick) return 'Your pick';
    if (!sp.tree) return 'Default';
    if (sp.treeWhy === 'none') return `Default: no talent points yet, so the tree your class levels in (${sp.tree})`;
    if (sp.treeWhy === 'unknown') return `Default: your talent trees couldn't be read, so the tree your class levels in (${sp.tree}). Sync in game, or pick weights`;
    if (sp.treeWhy === 'tie') return `Default: your points are tied, so ${sp.tree}. Pick other weights if you play the other tree`;
    return `Default: most of your talent points are in ${sp.tree}`;
  }

  // one profile: its numbers as bars, then why
  function profileCard(sel) {
    const own = !!sel.own;
    const keys = (own ? W.EDITABLE.filter(SHOWN) : []).concat(Object.keys(sel.w).filter(SHOWN)).filter((k, i, a) => a.findIndex((x) => String(x) === String(k)) === i)
      .sort((a, b) => (sel.w[b] || 0) - (sel.w[a] || 0));
    const max = Math.max(...keys.map((k) => sel.w[k] || 0), 0.001);
    let h = `<div class="wcard"><div class="row sb"><div><div class="nm">${esc(sel.name)} <span class="badge">${own ? 'yours' : 'built in'}</span></div>`;
    h += own ? `<p class="meta">Your own profile${sel.from && W.get(sel.from) ? `, copied from ${esc(W.get(sel.from).name)}` : ''}. Saved in this browser.</p>` : '';
    h += `</div><div class="chips">${own
      ? `<button data-wrename="${esc(sel.id)}">Rename</button>${sel.from && W.BUILTIN[sel.from] ? `<button data-wreset="${esc(sel.id)}">Reset to original</button>` : ''}<button data-wcopy="${esc(sel.id)}">Copy</button><button class="neg" data-wdel="${esc(sel.id)}">Delete</button>`
      : `<button data-wcopy="${esc(sel.id)}">Copy to edit</button>`}</div></div>`;
    h += '<div class="wbars">';
    keys.forEach((k) => {
      const v = sel.w[k] || 0;
      h += `<div class="wb"><span class="wn">${esc(W.statName(k, names()))}</span><span class="bar"><i style="--w:${((100 * v) / max).toFixed(1)}%"></i></span>${own
        ? `<input type="number" step="0.05" min="0" data-wset="${esc(sel.id)}" data-wstat="${esc(k)}" value="${fmt(sel.w[k])}" placeholder="0">`
        : `<b class="num">${fmt(v)}</b>`}</div>`;
    });
    h += '</div>';
    // why
    const base = own && sel.from ? W.get(sel.from) : sel;
    const why = (base && (base.why || base.basis)) || {};
    h += `<h3>Why these numbers</h3>`;
    if (own) h += `<p class="meta">These are your numbers.${base && base !== sel ? ` The reasons below are for ${esc(base.name)}, the profile you copied.` : ''}</p>`;
    if (base && base.note) h += `<p class="why-note">${esc(base.note)}</p>`;
    const rows = Object.keys(why).filter(SHOWN).sort((a, b) => ((base.w || {})[b] || 0) - ((base.w || {})[a] || 0));
    if (rows.length) h += `<ul class="whys">${rows.map((k) => `<li><b>${esc(W.statName(k, names()))} ${fmt((base.w || {})[k])}</b><span>${esc(why[k])}</span></li>`).join('')}</ul>`;
    if (base && base.order && base.order.length) h += `<p class="meta">Guide order: ${base.order.map((x, i) => `${i + 1}. ${esc(x)}`).join(' · ')}${base.also && base.also.length ? ` · also: ${esc(base.also.join(', '))}` : ''}.</p>`;
    if (base && base.guide) h += `<p class="meta">For comparison, the guide's order (written for level-60 raids): ${base.guide.order.map((x, i) => `${i + 1}. ${esc(x)}`).join(' · ')} (<a href="${esc(base.guide.src.url)}" target="_blank" rel="noopener">Icy Veins</a>).</p>`;
    if (base && base.missing && base.missing.length) h += `<p class="meta">Not scored yet: ${esc(base.missing.join('; '))}.</p>`;
    if (base && base.src) h += `<p class="meta">Source: ${base.src.url ? `<a href="${esc(base.src.url)}" target="_blank" rel="noopener">${esc(base.src.label)}</a>` : esc(base.src.label)}.</p>`;
    h += `<p class="meta">An item's score is the sum of each stat × its number. Crit, hit, dodge, parry and block "%" lines count as rating (14 crit, 10 hit, 12 dodge, 15 parry, 5 block rating = 1%, Forever client via foreverdb.net/stats). Not counted: hit caps, and Use or proc effects.</p>`;
    return h + '</div>';
  }

  V.weights = function () {
    const ch = char(), cls = ch.classFile;
    if (!cls) return '<div class="empty">Your character isn\'t saved yet: Sync in game.</div>';
    const specs = specList();
    specs.forEach((sp) => W.migrate(ch.name, sp.i - 1, cls));   // older own weights were keyed by the array index
    const active = (A.CH.snap || {}).activeSpec;
    const builtIn = Object.values(BUILTIN).filter((p) => p.cls === cls), mine = W.custom(cls);
    const activeSpec = specs.find((s) => s.i === active) || specs[0];
    const sel = W.get(A.STATE.wProfile) && W.get(A.STATE.wProfile).cls === cls ? W.get(A.STATE.wProfile)
      : W.get(activeSpec ? CC.gear.profileKey(activeSpec) : null) || builtIn[0];
    let h = '';
    if (specs.length) {
      h += `<h2>Your specs</h2><p class="meta">Each spec uses the weights for the talent tree you have the most points in, unless you pick others.</p><div class="table wspec"><div class="thead"><div>Spec</div><div>Scores gear with</div><div>Why</div></div>`;
      specs.forEach((sp) => {
        const cur = CC.gear.profileKey(sp), picked = CC.gear.pickedProfile(sp), def = W.defaultFor(cls, sp.tree);
        const opts = [`<option value=""${picked ? '' : ' selected'}>${esc((W.get(def) || {}).name || 'Default')} (default)</option>`]
          .concat(builtIn.concat(mine).filter((p) => p.id !== def || picked).map((p) => `<option value="${esc(p.id)}"${picked && p.id === cur ? ' selected' : ''}>${esc(p.name)}${p.own ? ' (yours)' : ''}</option>`));
        h += `<div class="tr"><div class="c-main"><div class="nm">${esc(sp.label)}${sp.i === active ? ' <span class="badge on">active</span>' : ''}</div></div><div><select data-wspec="${sp.i}">${opts.join('')}</select></div><div class="dim small">${esc(reason(sp))}</div></div>`;
      });
      h += '</div>';
    }
    h += `<h2>Weights</h2><div class="toolbar"><span class="dim small">Built in</span><div class="chips">${builtIn.map((p) => `<button data-wprof="${esc(p.id)}" class="${sel && p.id === sel.id ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>`;
    h += `<span class="dim small">Yours</span><div class="chips">${mine.map((p) => `<button data-wprof="${esc(p.id)}" class="${sel && p.id === sel.id ? 'on' : ''}">${esc(p.name)}</button>`).join('')}<button data-wnew="">+ New</button></div></div>`;
    if (!sel) return h + '<div class="empty">No weights for this class yet.</div>';
    return h + profileCard(sel);
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
      specList().forEach((sp) => { if (CC.gear.pickedProfile(sp) === id) CC.gear.setProfile(sp, null); });
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
    if (sel) { const sp = specList().find((s) => String(s.i) === sel.dataset.wspec); if (sp) CC.gear.setProfile(sp, sel.value || null); A.STATE.wProfile = null; rerender(); }
  });
})();
