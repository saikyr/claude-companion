// Claude Companion: enchants (#147). For each spec and the gear it is compared with (Gear page: what you wear, or
// the spec's gear set), every slot's permanent enchant: its name and stats, its score with the spec's weights
// (js/weights.js, the one scoring engine), empty slots that can take one, and the best enchant you can get for each
// slot, with how: a formula you know (its reagents and tools, from the game), one a trainer or a formula item
// teaches, or an item that applies it (an Arcanum, a Zandalar Signet, an armor kit).
//
// What an enchant gives, best source first:
//   1. the game's own words: the "Enchanted: ..." line of the item's tooltip, the description of a formula you know
//      (Professions.lua), the "Use:" line of a Forever item that applies it (pack tooltip from endgametools);
//   2. the pack's Classic data (VMaNGOS, labelled): the spell's description and which items it fits.
// Forever changed some enchants (Enchant Chest - Superior Mana is Superior Intellect there): when the game's name
// for a formula you know differs from the Classic one, the Classic numbers are not used for it.
// The one place an enchant's text becomes stats is parse() below.
(function () {
  const CC = window.CC;
  if (!CC || !CC.api || !CC.V) return;
  const A = CC.api, arr = A.arr, esc = A.esc;
  const W = window.CCWeights;
  if (!W) return;

  // ---------------------------------------------------------------- text to stats
  // Pack stat ids (gamedata/build.py STAT): 3 Agi, 4 Str, 5 Int, 6 Spi, 7 Sta, 12 Defense, 18 spell hit %, 21 spell
  // crit %, 38 attack power, 39 ranged attack power, 41 healing, 42 spell damage, 43 mp5, 45 spell power, 46 hp5,
  // 48 block value, 100 armor, 101-105 resistances, 110-115 school damage, 116 crit %, 117 hit %, 118 dodge %,
  // 120 block %. Three of the enchant's own: mana, health and wdmg (weapon damage per hit), scored below.
  const BASE = { agility: 3, strength: 4, intellect: 5, spirit: 6, stamina: 7 };
  const RES = { fire: 101, frost: 102, nature: 103, shadow: 104, arcane: 105 };
  const SCHOOL = { fire: 110, shadow: 111, frost: 112, arcane: 113, nature: 114, holy: 115 };
  const ALL = (ids, v) => Object.fromEntries(ids.map((k) => [k, v]));
  const num = (m) => Number(m.slice(1).find((x) => x != null));
  const B = '(agility|strength|intellect|spirit|stamina)', R5 = '(fire|frost|nature|shadow|arcane)', S6 = '(fire|frost|shadow|nature|arcane|holy)';
  // [pattern, stats from the match]; tried in order, each match is taken out of the text before the next pattern, so
  // "healing and spell damage by up to 13" is spell power once, not healing as well
  const RULES = [
    [/\+?(\d+) to all stats|all stats \+?(\d+)|\+(\d+) all stats/, (m) => ALL(Object.values(BASE), num(m))],
    [/\+?(\d+) (?:to )?all resistances|resistances? to all (?:schools of magic|magic schools) by (\d+)|(\d+) resistance to all magic schools|all resistances \+?(\d+)/, (m) => ALL(Object.values(RES), num(m))],
    [/\+?(\d+) (?:to (?:your |all )?)?(?:healing and (?:spell )?damage|(?:spell )?damage and healing)|(?:healing and (?:spell )?damage|(?:spell )?damage and healing)[a-z ]{0,45}?\+?(\d+)|\+?(\d+) spell power|spell power (?:by )?\+?(\d+)/, (m) => ({ 45: num(m) })],
    [/up to (\d+) damage to spells|\+?(\d+) spell damage|spell damage (?:by up to )?\+?(\d+)|damage spells \+?(\d+)/, (m) => ({ 42: num(m) })],
    [/healing[a-z'+ ]{0,50}?(\d+)|(\d+) (?:points of )?healing/, (m) => ({ 41: num(m) })],
    [new RegExp(S6 + ' damage (?:by )?(?:up to )?\\+?(\\d+)|(\\d+) additional ' + S6 + ' damage when casting|\\+(\\d+) ' + S6 + ' (?:spell )?damage'), (m) => (m[1] ? { [SCHOOL[m[1]]]: Number(m[2]) } : m[4] ? { [SCHOOL[m[4]]]: Number(m[3]) } : { [SCHOOL[m[6]]]: Number(m[5]) })],
    [/(\d+) mana (?:every|per) 5 sec|mana per 5 (?:sec\.? )?\+?(\d+)|\+(\d+) mp5|mana regen(?:eration)? \+?(\d+)(?: (?:mana )?per 5 sec\.?)?/, (m) => ({ 43: num(m) })],
    [/(\d+) health (?:every|per) 5 sec/, (m) => ({ 46: num(m) })],
    [/\+?(\d+) ranged attack power|ranged attack power (?:by )?\+?(\d+)/, (m) => ({ 39: num(m) })],
    [/\+?(\d+) attack power|attack power (?:by )?\+?(\d+)/, (m) => ({ 38: num(m) })],
    [/(\d+) (?:shield )?block value|block value (?:by )?\+?(\d+)/, (m) => ({ 48: num(m) })],
    [/\+?([\d.]+)% (?:chance to )?block|block (?:chance )?\+?([\d.]+)%/, (m) => ({ 120: num(m) })],
    [/\+?([\d.]+)% (?:chance to )?dodge|dodge \+?([\d.]+)%/, (m) => ({ 118: num(m) })],
    [/\+?([\d.]+)% chance to hit with spells|chance to hit with spells by ([\d.]+)%|spell hit \+?([\d.]+)%|\+?([\d.]+)% spell hit/, (m) => ({ 18: num(m) })],
    [/(?:chance to land a )?critical strike with spells by ([\d.]+)%|\+?([\d.]+)% (?:chance to )?(?:critical strike|crit) with spells|spell crit(?:ical)?(?: strike)? \+?([\d.]+)%|\+?([\d.]+)% spell crit(?:ical)?(?: strike)?/, (m) => ({ 21: num(m) })],
    [/(?:chance to land a )?critical strike by ([\d.]+)%|\+?([\d.]+)% (?:chance to )?(?:critical strike|crit)|crit(?:ical)?(?: strike)? \+?([\d.]+)%/, (m) => ({ 116: num(m) })],
    [/\+?([\d.]+)% chance to hit|chance to hit by ([\d.]+)%|\+?([\d.]+)% hit|\bhit \+?([\d.]+)%/, (m) => ({ 117: num(m) })],
    [new RegExp('\\+?(\\d+) (?:to )?' + B + '|' + B + '(?: value)? (?:by |\\+)(\\d+)'), (m) => (m[2] ? { [BASE[m[2]]]: Number(m[1]) } : { [BASE[m[3]]]: Number(m[4]) })],
    [new RegExp('\\+?(\\d+) ' + R5 + ' resistance|resistance to ' + R5 + ' by (\\d+)|' + R5 + ' resistance \\+?(\\d+)'), (m) => (m[2] ? { [RES[m[2]]]: Number(m[1]) } : m[3] ? { [RES[m[3]]]: Number(m[4]) } : { [RES[m[5]]]: Number(m[6]) })],
    [/\+?(\d+) defense(?: skill)?|defense (?:value|skill)?[a-z ,]{0,80}?by (\d+)|defense \+?(\d+)/, (m) => ({ 12: num(m) })],
    [/armor value[a-z ,]{0,80}?by (\d+)|\+?(\d+) (?:additional )?(?:points of )?armor|armor by (\d+)|armor \+?(\d+)/, (m) => ({ 100: num(m) })],
    [/\+?(\d+) (?:mana|health|hit points)\b|(?:mana|health) of the wearer by (\d+)/, (m) => ({ [/mana/.test(m[0]) ? 'mana' : 'health']: num(m) })],
    [/(?:do|does) \+?(\d+) (?:additional )?(?:points? of )?damage(?! to | against)|(\d+) additional (?:points? of )?damage(?! to | against)|increases its damage by (\d+)|^\+(\d+) (?:weapon )?damage$/, (m) => ({ wdmg: num(m) })],
  ];
  // what is left after the stats: an effect the score can't count (a proc, speed, a skill, threat), like an item's own
  const EFFECT = /often|chance|faster|when (?:struck|attacking|you)|beasts|demons|elementals|disarm|absorption|stun|block with it|speed|haste|skill|threat|stealth|fishing line|steal|curse|chill|heals for|movement|damage every time/;
  // the text of an enchant line, a description or a Use: line, as one lower-case string
  const clean = (t) => String(t || '').replace(/\|c[0-9a-fA-F]{8}|\|r/g, '').replace(/^(Enchanted|Use|Equip): /, '').replace(/Only usable on items level \d+ and above\.?/i, '')
    .replace(/Does not stack with other enchantments for the selected equipment slot\.?/i, '').toLowerCase().replace(/\s+/g, ' ').trim();
  // a proc or a buff for a while (Crusader: "often ... increases Strength by 100 for 15 sec"): all of it is an effect
  const PROC = /\boften\b|chance on hit|per hit|has a \d+% chance|% chance to inflict|for \$\d+d|for \d+ (?:sec|min)/;
  function parse(text) {
    let t = clean(text);
    const st = {};
    if (PROC.test(t)) return { st, effect: true, any: false };
    for (const [rx, fn] of RULES) {
      for (let i = 0; i < 4; i++) {          // a pattern can match twice ("10 Stamina, 10 Intellect")
        const m = rx.exec(t);
        if (!m) break;
        Object.entries(fn(m) || {}).forEach(([k, v]) => { if (isFinite(v)) st[k] = (st[k] || 0) + v; });
        t = t.slice(0, m.index) + ' ; ' + t.slice(m.index + m[0].length);
      }
    }
    return { st, effect: EFFECT.test(t), any: Object.keys(st).length > 0 };
  }

  // ---------------------------------------------------------------- what fits where
  // the pack's Classic masks ([class, subclass mask, inventory type mask]) against an item: what the game checks
  // (a mask by slot alone decides by slot: Enchant Cloak - Minor Agility names the weapon class with the cloak slot)
  const fitsMask = (m, it) => !!it && (m[0] < 0 || m[0] == null || m[0] === it.cls || (!!m[2] && !m[1])) && (!m[1] || (m[1] & (1 << it.sub)) !== 0) && (!m[2] || (m[2] & (1 << it.inv)) !== 0);
  // a formula Forever added (no Classic data) fits by the slot in its name: "Enchant Bracer - Lesser Healing Power"
  // (Forever's own: a necklace, #175, and an off-hand held item, inventory type 23; "Off-hand" and "Off-Hand" both occur)
  const NAME_FIT = { bracer: [4, 0, 1 << 9], chest: [4, 0, (1 << 5) | (1 << 20)], cloak: [4, 0, 1 << 16], boots: [4, 0, 1 << 8], gloves: [4, 0, 1 << 10],
    shield: [4, 1 << 6, 0], weapon: [2, 189939, 0], '2h weapon': [2, 1378, 0], necklace: [4, 0, 1 << 2], 'off-hand': [-1, 0, 1 << 23] };
  const nameFit = (name) => { const m = /^(?:Formula: )?Enchant (2H Weapon|Bracer|Chest|Cloak|Boots|Gloves|Shield|Weapon|Necklace|Off-Hand) - /i.exec(name || ''); return m ? NAME_FIT[m[1].toLowerCase()] : null; };
  // the worn item as the masks read it: the game's own class, subclass and slot for an item you have, else the pack's
  function itemKind(x) {
    const it = x.key && A.item(x.key), g = A.gdItem(x.id);
    const inv = (it && CC.advice && CC.advice.invOf ? CC.advice.invOf(it) : 0) || (g && g[4]) || 0;
    const cls = it && it.class != null ? it.class : g && g[9];
    if (cls == null) return null;
    // armor: the pack's subclass as the Forever tooltip names it (a shield the pack files as Miscellaneous), js/gear.js
    const sub = cls === 4 && g && CC.gear && CC.gear.packSub ? CC.gear.packSub(g) : it && it.subclass != null ? it.subclass : g && g[12];
    return { cls, sub: sub != null ? sub : -1, inv };
  }
  // a weapon's speed, for an enchant that adds damage per hit
  function speedOf(x) {
    const it = x.key && A.item(x.key), lines = arr(it && it.tip).concat(arr((A.gdItem(x.id) || [])[10]));
    for (const l of lines) { const m = /^Speed ([\d.]+)$/.exec(typeof l === 'string' ? l : (l && l.r) || (l && l.l) || ''); if (m) return Number(m[1]); }
    return 0;
  }

  // ---------------------------------------------------------------- the enchant on an item
  const ENCH = () => (A.GD && A.GD.enchants) || {};
  const idOfKey = (key) => { const m = /^item:-?\d+:(\d+)/.exec(key || ''); return m && Number(m[1]) > 0 ? Number(m[1]) : null; };
  // the "Enchanted: ..." line of an item you have (the game's own name for it)
  function gameLine(key) {
    const it = key && A.item(key);
    for (const l of arr(it && it.tip)) { const t = typeof l === 'string' ? l : l && l.l; const m = /^Enchanted: (.+)$/.exec(t || ''); if (m) return m[1].trim(); }
    return null;
  }
  // every formula the character knows, by spell id (the game's own: name, reagents, tools, description)
  const known = () => { const p = ((A.CH || {}).professions || {}).Enchanting; return arr(p && p.recipes); };
  const isEnchantFormula = (r) => r && !r.output && /^Enchant /.test(r.name || '');
  // what one enchant gives: { name, st, effect, from, label }. from: 'game' (the tooltip line), 'formula' (a formula you
  // know, the game's description), 'item' (a Forever item's Use: line), 'classic' (VMaNGOS), 'changed' (Forever
  // renamed it and the game hasn't said what it gives yet) or 'unknown'
  const spellsOf = (e) => e[2].map((x) => x[0]), itemsOf = (e) => e[3].map((x) => x[0]);
  const classicName = (sp) => ((A.GD.recipes || {})[sp] || [])[0];
  // a Forever item's own "Use: Permanently ..." line (endgametools tooltip), if the pack has it
  const useLine = (id) => { const g = A.gdItem(id); return (g && g[11] === 'e' && arr(g[10]).find((l) => /^Use: Permanently/.test(l))) || null; };
  // what a formula you know gives: the game's description, else Classic data unless Forever renamed it
  function formulaStats(k, e) {
    if (k.desc) return Object.assign({ from: 'formula' }, parse(k.desc));
    if (classicName(k.id) && classicName(k.id) !== k.name) return { st: {}, effect: false, any: false, from: 'changed' };
    return Object.assign({ from: 'classic' }, parse(e[1]));
  }
  function info(eid, line) {
    const e = ENCH()[eid];
    // the game's line: its stats, unless it is the Classic name word for word and the Classic text says more (the line
    // is a short name: "Healing and Spell Damage +18/Spell Hit +1%" may hold more than the parser reads from a name)
    const same = (n) => !!n && String(n).toLowerCase() === String(line).toLowerCase();
    if (line) {
      const p = parse(line);
      if (!e) return Object.assign({ name: line, from: p.any ? 'game' : 'unknown' }, p);
      if (p.any) {
        const c = parse(e[1]);
        if (same(e[0]) && Object.keys(c.st).some((k) => !(k in p.st))) return Object.assign({ name: line, from: 'classic' }, c);
        return Object.assign({ name: line, from: 'game' }, p);
      }
      // a line with no numbers that is neither the Classic name nor an item's that applies it: Forever renamed it, so
      // the Classic numbers may not be its own (Superior Mana is Superior Intellect there)
      if (!same(e[0]) && !itemsOf(e).some((id) => same(A.anyItemName(id))) && !spellsOf(e).some((sp) => same(String(classicName(sp) || '').replace(/^Enchant [^-]+ - /, ''))))
        return { name: line, st: {}, effect: false, any: false, from: 'changed' };
    }
    // an enchant only an item applies is called what the item is ("Lesser Arcanum of Rumination", not the spell's
    // "Lesser Arcane Amalgamation"; "Light Armor Kit", not "Armor +8")
    const name = line || (e && (!e[2].length && e[3].length ? A.anyItemName(e[3][0][0]) : e[0])) || `enchant ${eid}`;
    if (!e) return { name, st: {}, effect: false, any: false, from: 'unknown' };
    const mine = known().filter((r) => spellsOf(e).includes(r.id));
    const told = mine.find((r) => r.desc);
    if (told) return Object.assign({ name }, formulaStats(told, e));
    for (const id of itemsOf(e)) { const u = useLine(id); if (u) return Object.assign({ name, from: 'item' }, parse(u)); }
    const k = mine[0];
    if (k && formulaStats(k, e).from === 'changed') return { name: line || k.name.replace(/^Enchant [^-]+ - /, ''), st: {}, effect: false, any: false, from: 'changed' };
    return Object.assign({ name, from: 'classic' }, parse(e[1]));
  }
  const FROM_WORD = { game: 'the game', formula: 'your formula (the game)', item: 'the item (Forever tooltip)', formulaItem: 'the formula (Forever tooltip)', foreverdb: 'ForeverDB', classic: 'Classic data', changed: 'renamed on Forever: open Enchanting in game to read it', unknown: 'not in the game data' };

  // ---------------------------------------------------------------- scoring
  // mana and health count as the Intellect and Stamina that give them (15 mana, 10 health each: the Classic rates);
  // weapon damage per hit as weapon DPS at the weapon's speed
  function scoreSt(st, x) {
    const o = {};
    Object.entries(st || {}).forEach(([k, v]) => {
      if (k === 'mana') o[5] = (o[5] || 0) + v / 15;
      else if (k === 'health') o[7] = (o[7] || 0) + v / 10;
      else if (k === 'wdmg') { const sp = speedOf(x); if (sp) o.dps = (o.dps || 0) + v / sp; }
      else o[k] = (o[k] || 0) + v;
    });
    return o;
  }
  const UNKNOWN = "not read yet: this copy of the item isn't in your saved items (open your bags or bank in game, then Sync)";
  const BANKED = "in your bank: the game doesn't say which copy the set uses there, so its enchant is unknown (put it in your bags)";
  const unknownText = (x) => (x.bank ? BANKED : UNKNOWN);
  const SLOT_NAME = { 1: 'Head', 2: 'Neck', 3: 'Shoulder', 5: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrist', 10: 'Hands', 15: 'Back', 16: 'Main hand', 17: 'Off hand', 18: 'Ranged' };

  // ---------------------------------------------------------------- Forever's own formulas (#175)
  // pack fench[spell] = [name, what it gives (ForeverDB), [formula items], [[reagent, count]], [tool ids], skill]: every
  // enchanting recipe ForeverDB saw on Forever, the new ones and the Classic ones whose reagents changed
  const NOFENCH = {}, FENCH = () => (A.GD && A.GD.fench) || NOFENCH;
  const fenchReagents = (sp) => { const f = FENCH()[sp]; return f && arr(f[3]).length ? arr(f[3]).map(([id, need]) => ({ id, need })) : null; };
  // its tools, when ForeverDB names any (none named: the Classic recipe's stand)
  const fenchTools = (sp) => { const f = FENCH()[sp]; return f && arr(f[4]).length ? arr(f[4]).map((t) => ({ name: A.anyItemName(t) })) : null; };
  // every formula item Forever added that Classic data doesn't teach: { id, name, sp (its spell, when ForeverDB has
  // it), text (what it gives, the formula's own tooltip, else ForeverDB's words), from }. One per name: Forever lists
  // some twice (Formula: Enchant 2H Weapon - Spellblasting 274394 and 238305); the copy with a tooltip and a source wins.
  let FF = null, FFgd = null, FFfe = null;
  function foreverFormulas() {
    if (FF && FFgd === A.GD && FFfe === FENCH()) return FF;
    FFgd = A.GD; FFfe = FENCH(); FF = [];
    if (!A.GD) return FF;
    const items = (A.GD && A.GD.items) || {}, rec = A.GD.recipes || {}, bySp = {};
    const classic = new Set(Object.values(rec).filter((r) => r[1] === 'Enchanting').map((r) => String(r[0]).toLowerCase()));
    Object.values(rec).forEach((r) => arr(r[4]).forEach((id) => classic.add('#' + id)));
    Object.entries(FENCH()).forEach(([sp, f]) => arr(f[2]).forEach((id) => { bySp[id] = Number(sp); }));
    const byName = {};
    Object.entries(items).forEach(([k, g]) => {
      const id = Number(k), name = String(g[0] || '');
      if (!/^Formula: Enchant /.test(name) || classic.has('#' + id)) return;
      const ench = name.replace(/^Formula: /, '');
      if (classic.has(ench.toLowerCase()) || !nameFit(ench)) return;
      const tip = arr(g[10]).find((l) => typeof l === 'string' && /^“Teaches you how to/.test(l));
      const sp = bySp[id] || null, fx = sp && FENCH()[sp] ? FENCH()[sp][1] : '';
      const text = tip ? tip.replace(/^“Teaches you how to (?:permanently )?enchant .+? (?:to|so) /, '').replace(/”$/, '') : fx;
      const sk = arr(g[10]).map((l) => /^Requires Enchanting \((\d+)\)$/.exec(typeof l === 'string' ? l : '')).find(Boolean);
      const skill = sk ? Number(sk[1]) : sp && FENCH()[sp] && FENCH()[sp][5] != null ? FENCH()[sp][5] : null;
      const c = { id, name: ench, sp, text, skill, from: tip ? 'formulaItem' : fx ? 'foreverdb' : 'unknown', known: !!(tip || fx) + !!sp + !!((A.GD.how || {})[id]) };
      const had = byName[ench.toLowerCase()];
      if (!had || c.known > had.known) byName[ench.toLowerCase()] = c;
    });
    FF = Object.values(byName);
    return FF;
  }

  // ---------------------------------------------------------------- every enchant you could put on an item
  // { key, id, name, st, effect, from, how, have (you can apply it now), raid, needs, reagents, tools, item, formula }
  function candidates(x) {
    const kind = itemKind(x);
    if (!kind) return [];
    const out = [], mine = known(), seen = new Set();
    const raid = (id) => !!(CC.gear && CC.gear.raidSource && CC.gear.raidSource(id));
    const RANK = { known: 0, trainer: 1, formula: 2 };
    for (const [eid, e] of Object.entries(ENCH())) {
      const sps = e[2].filter((x) => fitsMask(x.slice(1), kind)), its = e[3].filter((x) => fitsMask(x.slice(1), kind));
      if (!sps.length && !its.length) continue;
      const classic = Object.assign({ from: 'classic' }, parse(e[1]));
      const base = { id: Number(eid), name: e[0] };
      // the formulas that put it on this item: the one you know (what the game says it takes), else how to learn one
      let best = null;
      sps.forEach(([sp]) => {
        const k = mine.find((r) => r.id === sp), r = (A.GD.recipes || {})[sp] || [];
        // the reagents Forever asks (ForeverDB), else Classic's
        const fr = fenchReagents(sp);
        const pack = { reagents: fr || arr(r[6]).map(([id, need]) => ({ id, need })), reagentsFrom: fr ? 'forever' : 'classic', tools: (fr && fenchTools(sp)) || arr(r[2]).map((t) => ({ name: A.anyItemName(t) })) };
        let c = null;
        // called what its formula is called ("Superior Striking", not the enchant's "Impact" it shares with a two-hander's)
        base.name = ((k && k.name) || r[0] || e[0]).replace(/^Enchant [^-]+ - /, '');
        if (k) { seen.add(k.id); c = Object.assign({}, base, formulaStats(k, e), { how: 'known', formula: { id: k.id, name: k.name }, reagents: arr(k.reagents), tools: arr(k.tools), have: true }); }
        else if (r[7] != null) c = Object.assign({}, base, classic, pack, { how: 'trainer', formula: { id: sp, name: r[0] }, skill: r[7] });
        else if (arr(r[4]).length) c = Object.assign({}, base, classic, pack, { how: 'formula', formula: { id: sp, name: r[0] }, taughtBy: r[4][0], raid: arr(r[4]).every(raid) });
        if (c && (!best || RANK[c.how] < RANK[best.how])) best = Object.assign({}, c);
      });
      if (best) out.push(Object.assign(best, { key: 'f' + best.formula.id }));
      its.forEach(([id]) => { const u = useLine(id);
        out.push(Object.assign({}, base, u ? Object.assign({ from: 'item' }, parse(u)) : classic, { key: 'i' + id, how: 'item', item: id, name: A.anyItemName(id), raid: raid(id), have: A.ownedCount(id) > 0, needs: (A.GD.req || {})[id] || null })); });
    }
    // formulas you know that Forever added (no Classic data): by the slot in their name and the game's description
    mine.filter((r) => isEnchantFormula(r) && !seen.has(r.id) && r.id > 1000000).forEach((r) => {
      const m = nameFit(r.name);
      if (!m || !fitsMask(m, kind)) return;
      const p = r.desc ? parse(r.desc) : { st: {}, effect: false, any: false };
      out.push({ key: 'f' + r.id, id: null, name: r.name.replace(/^Enchant [^-]+ - /, ''), st: p.st, effect: p.effect, any: p.any, from: r.desc ? 'formula' : 'changed',
        how: 'known', formula: { id: r.id, name: r.name }, reagents: arr(r.reagents), tools: arr(r.tools), have: true });
    });
    // formulas Forever added that you don't know yet (#175): by the slot in their name, what their tooltip says, and the
    // reagents ForeverDB lists (none yet in a pack built before #175: reagents unknown, not none)
    // one formula once: by its full name ("Enchant 2H Weapon - Strength" is not Classic's "Enchant Weapon - Strength",
    // which fits a two-hander too)
    const have = new Set(out.filter((c) => c.formula).map((c) => String(c.formula.name).toLowerCase()));
    foreverFormulas().forEach((f) => {
      const short = f.name.replace(/^Enchant .+? - /, '');
      if (have.has(f.name.toLowerCase()) || !fitsMask(nameFit(f.name), kind)) return;
      if (mine.some((r) => String(r.name).toLowerCase() === f.name.toLowerCase())) return;
      const p = f.text ? parse(f.text) : { st: {}, effect: false, any: false };
      const fr = f.sp && fenchReagents(f.sp);
      have.add(f.name.toLowerCase());
      out.push({ key: 'i' + f.id + 'f', id: null, name: short, st: p.st, effect: p.effect, any: p.any, from: f.from, how: 'formula', forever: true,
        formula: { id: f.sp, name: f.name }, taughtBy: f.id, learnSkill: f.skill, raid: raid(f.id), reagents: fr || [], reagentsFrom: fr ? 'forever' : null, tools: (f.sp && fenchTools(f.sp)) || [] });
    });
    return out;
  }

  // ---------------------------------------------------------------- one spec's enchants
  // base: CC.gear.baseline (what the spec is compared with: worn gear or its set). Per slot that can take an enchant:
  // { slot, item, enchant (null = none), empty, best, bestNow, options }. best: the highest-scoring one you can get
  // outside raids; bestNow: the best you can apply yourself today (a formula you know, an item in your bags).
  function plan(w, base) {
    const rows = [];
    Object.entries(base.worn || {}).forEach(([slot, x]) => {
      const name = SLOT_NAME[slot];
      if (!name || !x || !x.id) return;
      const opts = candidates(x);
      if (!opts.length) return;
      const eid = idOfKey(x.key), line = gameLine(x.key);
      const cur = eid ? Object.assign({ id: eid }, info(eid, line)) : null;
      const curSt = cur ? scoreSt(cur.st, x) : {};
      const curS = cur ? W.score(curSt, w, name, {}) : 0;
      // an enchant on now whose worth isn't known (no stats read, or an effect only): gains over it are unknown
      const unsure = !x.key || x.guess || (cur && !cur.any);
      // the hit model's total counts items only, not enchants, so an enchant replaces no hit there
      opts.forEach((c) => { c.s = W.score(scoreSt(c.st, x), w, name, {}); c.d = c.s - curS; });
      opts.sort((a, b) => b.s - a.s || (b.have || 0) - (a.have || 0));
      const ok = opts.filter((c) => !c.raid);
      const best = ok.find((c) => c.any && c.s > 0) || null;
      rows.push({ unsure, raidBest: opts.find((c) => c.raid && c.any && c.s > ((best && best.s) || 0)) || null, slot: Number(slot), name, x, cur, curS, known: !!x.key && !x.guess, empty: !!x.key && !x.guess && !eid,
        best, bestNow: opts.find((c) => c.have && c.any && c.s > 0) || null, options: opts });
    });
    return rows.sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
  }
  const ORDER = ['Head', 'Neck', 'Shoulder', 'Back', 'Chest', 'Wrist', 'Hands', 'Waist', 'Legs', 'Feet', 'Main hand', 'Off hand', 'Ranged'];

  // ---------------------------------------------------------------- words
  const statText = (st) => Object.entries(st || {}).map(([k, v]) => {
    const n = +Number(v).toFixed(2);
    if (k === 'mana') return `+${n} mana`; if (k === 'health') return `+${n} health`; if (k === 'wdmg') return `+${n} weapon damage`;
    return `+${n}${W.PCT[k] ? '%' : ''} ${W.statName(k, A.GD.stat).replace(/ %$/, '')}`;
  }).join(', ');
  // the stats, and where they're from when it isn't the game
  const statsOf = (c) => (statText(c.st) || (c.effect ? 'an effect (not scored)' : 'stats unknown')) + (c.any && c.effect ? ' + an effect (not scored)' : '') + (c.from === 'classic' ? ' (Classic data)' : c.from === 'changed' ? ' (renamed on Forever: open Enchanting in game to read it)' : '');
  const reagentRow = (c) => (arr(c.reagents).length ? `<div class="sub">Reagents${c.how !== 'known' && c.reagentsFrom !== 'forever' ? ' (Classic data)' : ''}: ${esc(reagentText(c.reagents))}${matsOf(c) ? ' · ' + esc(matsText(matsOf(c))) : ''}</div>`
    : c.forever ? '<div class="sub dim">Reagents: not in this game-data pack yet (the next update adds them)</div>' : '');
  const reagentText = (rs) => arr(rs).map((g) => `${g.need || 1}× ${A.anyItemName(g.id)}`).join(', ');
  // the reputation an item needs (pack req: [faction, standing 5 Friendly .. 8 Exalted])
  const repText = (r) => (r ? ` · needs ${r[0]} ${['', '', '', '', '', 'Friendly', 'Honored', 'Revered', 'Exalted'][r[1]] || ''}`.trimEnd() : '');
  // how you get one, in words
  function howText(c) {
    if (c.how === 'known') return `you know ${c.formula.name}` + (c.tools.length ? ` · needs ${c.tools.map((t) => t.name).join(', ')}` : '');
    if (c.how === 'trainer') return `${c.formula.name}: an Enchanting trainer teaches it${c.skill ? ` at skill ${c.skill}` : ''} (Classic data)`;
    // a Forever formula: who sells it on your side and for what, and what learning it asks against what you have
    if (c.how === 'formula' && c.forever) {
      const buy = A.buyLine && A.buyLine(c.taughtBy), gates = A.itemGates ? A.itemGates(c.taughtBy).filter((g) => g.kind === 'rep') : [];
      return `${c.formula.name}: learnt from ${A.anyItemName(c.taughtBy)}` + (buy ? ' · ' + buy.replace(/^Buy: /, 'sold by ') : (A.GD.how || {})[c.taughtBy] ? ` (${A.GD.how[c.taughtBy]})` : ' · source not in the game data')
        + gates.map((g) => ' · ' + g.text.replace(/^Needs /, 'needs ')).join('') + (c.learnSkill ? ` · Enchanting ${c.learnSkill} to learn` : '');
    }
    if (c.how === 'formula') return `${c.formula.name}: learnt from ${A.anyItemName(c.taughtBy)}` + (((A.GD.how || {})[c.taughtBy]) ? ` (${A.GD.how[c.taughtBy]})` : '') + repText((A.GD.req || {})[c.taughtBy]);
    const rep = repText(c.needs);
    return `${A.anyItemName(c.item)}${c.have ? ' (in your bags)' : ''}` + ((A.GD.how || {})[c.item] ? ` · ${A.GD.how[c.item]}` : ((A.gdSourceLines(c.item, 1, false)[0] || {}).l ? ' · ' + A.gdSourceLines(c.item, 1, false)[0].l : '')) + rep;
  }
  // what its reagents cost (js/app.js craftCost: your AH plan price or a vendor's, whichever is lower; a reagent with
  // neither is counted, never guessed). null: reagents not known (a Forever formula in a pack built before #175)
  const matsOf = (c) => {
    if (!arr(c.reagents).length || !A.craftCost) return null;
    const k = A.craftCost({ reagents: c.reagents });
    return { cost: k.cost, missing: k.missing, from: c.how === 'known' ? 'the game' : c.reagentsFrom === 'forever' ? 'ForeverDB (Forever)' : 'Classic data' };
  };
  const matsText = (m) => (!m ? '' : m.missing && !m.cost ? 'mats: no AH or vendor price yet (scan the AH)'
    : `mats ≈ ${A.coinText(m.cost)}${m.missing ? ` + ${m.missing} reagent${m.missing > 1 ? 's' : ''} with no price yet` : ''}`);
  const one = (c, d) => (c ? { name: c.name, enchant: c.id, stats: c.st, scored: c.any, effect: c.effect, statsFrom: c.from, score: +c.s.toFixed(1), gain: +c.d.toFixed(1),
    how: c.how, formula: c.formula || null, item: c.item ? { id: c.item, name: A.anyItemName(c.item), inBags: !!c.have } : null, trainerSkill: c.skill != null ? c.skill : undefined,
    taughtBy: c.taughtBy ? { id: c.taughtBy, name: A.anyItemName(c.taughtBy) } : undefined, raid: c.raid || undefined,
    reagents: arr(c.reagents).map((g) => ({ id: g.id, name: A.anyItemName(g.id), need: g.need || 1, have: A.ownedCount(g.id) })), tools: arr(c.tools).map((t) => (t.met != null ? { name: t.name, met: t.met } : { name: t.name })),
    reagentsFrom: arr(c.reagents).length ? (c.how === 'known' ? 'game' : c.reagentsFrom || 'classic') : c.forever ? 'unknown' : undefined,
    materials: c.how === 'item' ? undefined : matsOf(c) || null, learnSkill: c.learnSkill || undefined,
    where: howText(c) } : d);

  // the snapshot's enchants[] for one spec (js/gear.js summary)
  function summary(w, base) {
    return plan(w, base).map((r) => ({
      slot: r.name, item: { id: r.x.id, name: A.anyItemName(r.x.id) },
      enchant: !r.known ? 'unknown: ' + unknownText(r.x) : r.cur ? { id: r.cur.id, name: r.cur.name, stats: r.cur.st, scored: r.cur.any, effect: r.cur.effect, statsFrom: r.cur.from, score: +r.curS.toFixed(1) } : null,
      empty: r.empty,
      best: one(r.best, null), bestYouCanApplyNow: one(r.bestNow, null), bestFromRaids: one(r.raidBest, undefined),
      isBest: !!(r.cur && !r.unsure && (!r.best || r.best.d <= 0.05)),
      gainUnknown: r.unsure || undefined,
    }));
  }

  // ---------------------------------------------------------------- the Gear page's Enchants view
  const fmt = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
  const SHOW = 6;
  function view(w, base) {
    const rows = plan(w, base);
    if (!A.GD.enchants) return '<div class="empty">This game-data pack has no enchants yet: it updates itself within a day.</div>';
    const empty = rows.filter((r) => r.empty), gain = rows.filter((r) => r.best && !r.unsure && r.best.d > 0.05);
    let h = `<p class="meta">Every slot of ${esc(base.short)} that can take a permanent enchant: what is on it, its score with these weights, and the best you can get.
      ${empty.length ? `<b class="neg">${empty.length} slot${empty.length > 1 ? 's have' : ' has'} no enchant:</b> ${empty.map((r) => esc(r.name)).join(', ')}.` : 'No enchantable slot is empty.'}
      ${gain.length ? `${gain.length} could take a better one.` : ''}</p>`;
    h += '<div class="table ench"><div class="thead"><div>Slot</div><div>Enchant now</div><div class="c-num">Score</div><div>Best you can get</div><div class="c-num">Gain</div></div>';
    rows.forEach((r) => {
      const cur = !r.known ? `<span class="dim">${esc(unknownText(r.x))}</span>`
        : r.cur ? `<b>${esc(r.cur.name)}</b><div class="sub">${esc(statText(r.cur.st) || (r.cur.effect ? 'an effect (not scored)' : 'stats unknown'))} · ${esc(FROM_WORD[r.cur.from])}</div>`
          : '<span class="badge neg">no enchant</span>';
      const b = r.best;
      const best = b ? `<b>${esc(b.name)}</b><div class="sub">${esc(statsOf(b))} · ${esc(howText(b))}</div>${reagentRow(b)}`
        + (r.bestNow && r.bestNow !== b ? `<div class="sub">Best you can apply now: <b>${esc(r.bestNow.name)}</b> ${r.unsure ? '' : fmt(r.bestNow.d)}</div>` : '') : '<span class="dim">nothing outside raids scores for these weights</span>';
      const rb = r.raidBest ? `<div class="sub">From raids: <b>${esc(r.raidBest.name)}</b> ${!r.unsure ? fmt(r.raidBest.d) : ''} <span class="badge">raid</span> · ${esc(howText(r.raidBest))}</div>` : '';
      h += `<div class="tr"><div>${esc(r.name)}<div class="sub">${A.itemLink(r.x.id)}</div></div><div>${cur}</div><div class="c-num">${r.cur ? r.curS.toFixed(1) : '—'}</div><div>${best}${rb}</div><div class="c-num ${b && b.d > 0.05 && !r.unsure ? 'pos' : 'dim'}">${!b ? '—' : r.unsure ? '?' : b.d > 0.05 ? fmt(b.d) : 'best'}</div></div>`;
      const more = r.options.filter((c) => c !== b).slice(0, SHOW);
      if (more.length) h += `<details class="ench-more"><summary class="dim small">${r.options.length - 1} other enchant${r.options.length > 2 ? 's' : ''} for ${esc(r.name)}</summary><ul>${more.map((c) => `<li>${esc(c.name)} ${c.any ? fmt(c.d) : '<span class="dim">(not scored)</span>'}${c.raid ? ' <span class="badge">raid</span>' : ''} <span class="dim">· ${esc(statsOf(c))} · ${esc(howText(c))}</span></li>`).join('')}</ul></details>`;
    });
    h += '</div>';
    h += `<details class="how"><summary>How enchants are scored</summary><p>An enchant's stats come from the game when it has said: the item's own "Enchanted:" line, the description of a formula you know, or a Forever item's "Use:" line. Otherwise they come from Classic data (VMaNGOS), marked so. Forever changed some enchants: when the game's name for a formula you know differs from the Classic one, its Classic numbers aren't used until you open Enchanting in game. Mana and health count as the Intellect (15 mana) and Stamina (10 health) that would give them; weapon damage counts as weapon DPS at the weapon's speed. Procs, haste, speed, skills and threat are effects and aren't scored, like an item's own. "Best you can get" leaves out raid enchants (they are in the list, marked).</p></details>`;
    return h;
  }

  CC.enchants = { parse, info, candidates, plan, summary, view, fitsMask, nameFit, idOfKey };
})();
