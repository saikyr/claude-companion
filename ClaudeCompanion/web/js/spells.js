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
    const byId = {}, best = {};
    let n = 0;
    arr((snap || {}).spellbook).forEach((tab) => arr(tab && tab.spells).forEach((s) => {
      if (!s || !s.name || s.passive) return;
      n++;
      const r = rankNo(s.rank);
      if (s.id != null) byId[s.id] = { name: s.name, rank: r };
      if (r != null && (!best[s.name] || r > best[s.name].rank)) best[s.name] = { rank: r, id: s.id };
    }));
    return { byId, best, n };
  }

  // ch: one character as the app holds it (CH): snap, specs (keyed 1 and 2), trainer
  function check(ch) {
    ch = ch || {};
    const snap = ch.snap || {};
    const level = Number((snap.character || {}).level) || 0;
    const B = book(snap);
    const tr = ch.trainer && arr(ch.trainer.services).length ? ch.trainer : null;
    const known = (name, rank) => !!(B.best[name] && rank != null && B.best[name].rank >= rank);

    // each spec's bars: a spell whose rank is below the best rank in your spellbook
    const specs = Object.entries(ch.specs || {}).map(([k, sp]) => ({ k: Number(k), sp }))
      .filter((x) => x.sp && (x.k === 1 || x.k === 2) && arr(x.sp.actionBars).length)
      .sort((a, b) => a.k - b.k)
      .map(({ k, sp }) => {
        const outdated = [], unranked = [];
        let spells = 0;
        arr(sp.actionBars).forEach((a) => {
          if (!a || a.kind !== 'spell' || a.id == null) return;
          spells++;
          const have = B.byId[a.id];
          if (!have) { if (a.name && B.best[a.name]) unranked.push({ slot: a.slot, name: a.name }); return; }
          const best = B.best[have.name];
          if (have.rank != null && best && best.rank > have.rank) {
            outdated.push({ slot: a.slot, key: a.key || null, name: have.name, rank: have.rank, best: best.rank, bestId: best.id });
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
    return {
      book: { taken: snap.taken || null, spells: B.n },
      trainer: tr ? { taken: tr.taken || null, npc: tr.npc || null, level: tr.level != null ? Number(tr.level) : null } : null,
      specs, train, trainCost, later,
    };
  }

  const api = { check, rankNo };
  root.CCSpells = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
