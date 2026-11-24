// Claude Companion: spell ranks. The one place that says whether your action bars hold your best
// ranks, and which ranks you could train. It reads what the addon saved:
//   snap.spellbook   every spell and rank you know (Snapshot.lua Spellbook)
//   specs[g].actionBars  each spec's bars (spell id per slot)
//   trainer          the class trainer's own list, read while its window was open (Snapshot.lua ReadTrainer)
// Used by the Talents & Bars tab and by the snapshot Claude reads (js/claude.js, `spells`).
(function (root) {
  const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
  // "Rank 7" -> 7; a spell with one rank has none
  const rankNo = (r) => { const m = /(\d+)/.exec(String(r || '')); return m ? Number(m[1]) : null; };

  // what you know: by spell id, and the best rank of each spell name
  function book(snap) {
    const byId = {}, best = {}, names = new Set();
    let n = 0;
    arr((snap || {}).spellbook).forEach((tab) => arr(tab && tab.spells).forEach((s) => {
      if (!s || !s.name || s.passive) return;
      n++;
      names.add(s.name);
      const r = rankNo(s.rank);
      if (s.id != null) byId[s.id] = { name: s.name, rank: r };
      if (r != null && (!best[s.name] || r > best[s.name].rank)) best[s.name] = { rank: r, id: s.id };
    }));
    return { byId, best, names, n };
  }

  // Spells a book teaches (no trainer has them: Prayer of Fortitude, Arcane Brilliance, Gift of the Wild), from
  // the game-data pack: each class's books by their name ("Codex: Prayer of Fortitude II" = Prayer of Fortitude
  // rank 2), with a known source. A "Manual of" is a Warrior's or a Rogue's (Heroic Strike IX, Eviscerate IX):
  // cls null, so it counts for whoever knows a lower rank. A warlock's pet grimoires (Firebolt, Seduction...)
  // teach the pet, not you: left out; his own (Shadow Ward IV, Inferno) count.
  const BOOK_CLASS = [[/^Codex(?:: | of )(.+)$/, 'PRIEST'], [/^Tome of (.+)$/, 'MAGE'], [/^Book(?:: | of )(.+)$/, 'DRUID'],
    [/^Libram: (.+)$/, 'PALADIN'], [/^Guide: (.+)$/, 'HUNTER'], [/^Tablet of (.+)$/, 'SHAMAN'], [/^Handbook of (.+)$/, 'ROGUE'],
    [/^Grimoire of (.+)$/, 'WARLOCK'], [/^Manual of (.+)$/, null]];
  const BOOK_ONLY = { 16665: 'HUNTER' };      // Tome of Tranquilizing Shot is a Hunter's book
  const PET_SPELLS = new Set(['Firebolt', 'Blood Pact', 'Fire Shield', 'Phase Shift', 'Torment', 'Sacrifice', 'Consume Shadows', 'Suffering',
    'Lash of Pain', 'Soothing Kiss', 'Seduction', 'Lesser Invisibility', 'Devour Magic', 'Tainted Blood', 'Spell Lock', 'Paranoia']);
  const SPELL_OF = { 'Grimoire of Doom': 'Ritual of Doom' };   // a book whose name isn't the spell's
  const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
  // raid: the gear engine's rule (js/gear.js raidSource / raidRow: raid zones and maps, world bosses), passed
  // in by the app; without it nothing is called raid
  let BOOKS = null;
  function bookList(gd, raid) {
    raid = raid || {};
    if (BOOKS && BOOKS.gd === gd && BOOKS.raid === raid.source) return BOOKS.list;
    const list = [];
    Object.entries((gd && gd.items) || {}).forEach(([k, g]) => {
      if (!g || g[9] !== 9 || (gd.teach || {})[k]) return;                 // class 9 = books; teach = profession recipes
      let cls = BOOK_ONLY[k] || null, what = null;
      for (const [re, c] of BOOK_CLASS) { const m = re.exec(g[0]); if (m) { what = m[1]; cls = cls || c; break; } }
      if (!what) return;
      const m = /^(.+?)(?: \(Rank (\d+)\)| ([IVX]+))?$/.exec(what);
      const spell = SPELL_OF[g[0]] || m[1], rank = m[2] ? Number(m[2]) : m[3] ? ROMAN[m[3]] || null : null;
      if (cls === 'WARLOCK' && PET_SPELLS.has(spell)) return;
      // a vendor row with no zone is a test NPC (Jimmy McWeaksauce), not a place to buy it
      const src = arr((gd.src || {})[k]).filter((r) => r && (r[0] !== 'vendor' || r[7])), vend = arr((gd.vend || {})[k]);
      // sources: outside raids first, then seen on Forever first
      const all = src.map((r) => ({ kind: r[0], name: r[1], zone: r[7] || null, forever: r[10] === 'f', raid: !!(raid.row && raid.row(r)) }))
        .concat(vend.map((v) => ({ kind: 'vendor', name: v[0], zone: v[1] || null, forever: !!v[5], raid: false })))
        .sort((a, b) => a.raid - b.raid || b.forever - a.forever);
      if (!all.length) return;                                             // no known source: not in the game
      list.push({ item: Number(k), book: g[0], cls, spell, rank: rank || 1, req: g[3] || 0,
        raid: !!(raid.source && raid.source(k)), sources: all.slice(0, 4).map(({ raid: r, ...x }) => Object.assign(x, r ? { raid: r } : {})) });
    });
    BOOKS = { gd, raid: raid.source, list };
    return list;
  }

  // ch: one character as the app holds it (CH): snap, specs (keyed 1 and 2), trainer.
  // gd: the game-data pack, for the spells books teach (optional); raid: { source(id), row(srcRow) } from
  // js/gear.js, to keep books only raids give apart
  function check(ch, gd, raid) {
    ch = ch || {};
    const snap = ch.snap || {};
    const level = Number((snap.character || {}).level) || 0;
    const B = book(snap);
    const tr = ch.trainer && arr(ch.trainer.services).length ? ch.trainer : null;
    // a rank you know; a spell with no rank is known when its name is in the spellbook
    const known = (name, rank) => (rank == null ? B.names.has(name) : !!(B.best[name] && B.best[name].rank >= rank));

    // each spec's bars: a spell whose rank is below the best rank in your spellbook
    const specs = Object.entries(ch.specs || {}).map(([k, sp]) => ({ k: Number(k), sp }))
      .filter((x) => x.sp && (x.k === 1 || x.k === 2) && arr(x.sp.actionBars).length)
      .sort((a, b) => a.k - b.k)
      .map(({ k, sp }) => {
        const outdated = [], unranked = [];
        let spells = 0;
        // each bar spell's name and rank: from the spellbook by id, else the rank the addon saved with the slot
        const onBar = arr(sp.actionBars).filter((a) => a && a.kind === 'spell' && a.id != null).map((a) => {
          const b = B.byId[a.id];
          return { a, name: b ? b.name : a.name, rank: b ? b.rank : rankNo(a.rank) };
        });
        // the best rank somewhere on this spec's bars: a lower rank kept beside it is on purpose (a cheap heal)
        const bestOnBars = new Set(onBar.filter((x) => x.rank != null && B.best[x.name] && x.rank >= B.best[x.name].rank).map((x) => x.name));
        onBar.forEach(({ a, name, rank }) => {
          spells++;
          const best = B.best[name];
          if (rank == null) { if (name && best) unranked.push({ slot: a.slot, name }); return; }
          if (best && best.rank > rank && !bestOnBars.has(name)) {
            outdated.push({ slot: a.slot, key: a.key || null, name, rank, best: best.rank, bestId: best.id });
          }
        });
        return { spec: k, active: Number(snap.activeSpec) === k, taken: sp.barsTaken || null, spells, outdated, unranked };
      });

    // the trainer's list against the spellbook (the spellbook wins: a rank you know since is not to train)
    let train = [], later = [];
    if (tr) {
      const row = (s) => ({ name: s.name, rank: rankNo(s.rank), level: s.level != null ? Number(s.level) : null, cost: s.cost != null ? Number(s.cost) : null });
      const svc = arr(tr.services).filter((s) => s && s.name && s.status !== 'used').map((s) => Object.assign(row(s), { status: s.status }))
        .filter((s) => !known(s.name, s.rank));
      // "available" when read; a rank whose level you have reached since counts too
      train = svc.filter((s) => s.status === 'available' || (s.level != null && s.level <= level && Number(tr.level) < s.level))
        .map(({ status, ...s }) => s).sort((a, b) => (a.level || 0) - (b.level || 0) || a.name.localeCompare(b.name));
      later = svc.filter((s) => s.status === 'unavailable' && s.level != null && s.level > level)
        .map(({ status, ...s }) => s).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    }
    const trainCost = train.reduce((t, s) => t + (s.cost || 0), 0);
    // books for your class whose spell or rank you don't know: usable now, or later by level. Only a spell
    // with a rank is checked against your ranks (a book's rank 1 = the spell itself)
    const cls = (snap.character || {}).classFile;
    // raid: books only raids give (Molten Core, Ahn'Qiraj), kept apart from the ones you can go and get
    const books = { now: [], later: [], raid: [] };
    if (gd && cls && B.n) bookList(gd, raid).filter((b) => (b.cls ? b.cls === cls : B.names.has(b.spell)) && !known(b.spell, b.rank) && !(b.rank === 1 && B.names.has(b.spell)))
      .sort((a, b) => a.req - b.req || a.spell.localeCompare(b.spell))
      .forEach((b) => (b.raid ? books.raid : b.req <= level ? books.now : books.later).push(b));
    // group buffs you know with none of their reagent in your bags (the best rank you know decides which reagent)
    const inBags = {};
    arr(snap.bags).forEach((bg) => arr(bg && bg.items).forEach((x) => { const m = /item:(\d+)/.exec((x && x.item) || ''); if (m) inBags[m[1]] = (inBags[m[1]] || 0) + (x.count || 1); }));
    const reagents = arr((root.GAMERULES || {}).buffReagents).filter((r) => r.cls === cls).flatMap((r) => r.spells
      .filter((sp) => B.best[sp] && (r.rank == null || B.best[sp].rank === r.rank))
      .map((sp) => ({ spell: sp, item: r.item, name: r.name, have: inBags[r.item] || 0 })))
      .filter((r, i, all) => all.findIndex((y) => y.item === r.item && y.spell === r.spell) === i);
    return {
      book: { taken: snap.taken || null, spells: B.n },
      trainer: tr ? { taken: tr.taken || null, npc: tr.npc || null, level: tr.level != null ? Number(tr.level) : null } : null,
      specs, train, trainCost, later, books,
      // reagents for the group buffs you know (have = how many are in your bags; 0 = buy some)
      reagents,
      // the best rank of every ranked spell you know, by name
      known: Object.keys(B.best).sort().map((name) => ({ name, rank: B.best[name].rank })),
    };
  }

  const api = { check, rankNo };
  root.CCSpells = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
