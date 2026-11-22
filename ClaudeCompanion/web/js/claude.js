// Claude Companion: the snapshot Claude reads. After each load the page sends a compact,
// stable JSON summary of what it shows to the local server, which saves it as
// ClaudeCompanion/companion-data/snapshot.json. Schema: companion-data/SCHEMA.md.
(function () {
  const CC = window.CC;
  if (!CC || !CC.api) return;
  const A = CC.api, arr = A.arr;
  const SCHEMA = 1;

  function build() {
    const CH = A.CH;
    if (!CH || !CH.snap) return null;
    const s = CH.snap, c = s.character || {};
    const ah = CH.ah || {};
    const name = (id) => A.anyItemName(id);
    return {
      schema: SCHEMA,
      written: new Date().toISOString(),
      savedInGame: s.taken ? new Date(s.taken * 1000).toISOString() : null,
      pack: A.GD ? { built: A.GD.built ? new Date(A.GD.built * 1000).toISOString() : null, from: A.GD.from } : null,
      character: { name: c.name, level: c.level, xp: c.xp, xpMax: c.xpMax, rested: c.rested, class: c.class, race: c.race,
        faction: c.faction, money: c.money, where: c.where, hearth: c.hearth },
      gear: CC.gear ? CC.gear.summary() : [],
      equipped: arr(s.equipped).filter((e) => e && e.item).map((e) => ({ slot: e.slotName, id: Number((/item:(\d+)/.exec(e.item) || [])[1]), name: (A.item(e.item) || {}).name })),
      quests: arr(s.quests).filter((q) => q && q.id).map((q) => {
        const gq = (A.GD && A.GD.quests[q.id]) || {};
        const to = arr(gq.to)[0];
        return { id: q.id, title: q.title, level: q.level, complete: !!(q.ready || q.complete), failed: !!q.failed,
          objectives: arr(q.objectives).map((o) => o.text), turnIn: to ? { npc: to[1], zone: to[2], x: to[3], y: to[4] } : null,
          xp: (q.rewards || {}).xp, money: (q.rewards || {}).money };
      }),
      cooldowns: A.cooldowns ? A.cooldowns().map((c) => ({ name: c.name, profession: c.prof || null, readyAt: c.ends })) : [],
      professions: arr(s.skills).filter((k, i, all) => k && k.maxRank > 1 && k.skillLineCategoryID === 11 && all.findIndex((y) => y && y.name === k.name) === i)
        .map((k) => ({ name: k.name, rank: k.rank, max: k.maxRank })),
      reputation: arr(s.reputation).filter((r) => r && !r.isHeader).map((r) => ({ name: r.name, standing: r.reaction, value: r.currentStanding })),
      ah: {
        lastScan: ah.lastScan ? { t: ah.lastScan.t, auctions: ah.lastScan.auctions } : null,
        itemsPriced: Object.keys(ah.prices || {}).length,
        sold: arr(ah.sales).slice(-25).map((x) => ({ t: x.t, item: x.item, net: x.net })),
        bought: arr(ah.buys).slice(-25).map((x) => ({ t: x.t, item: x.item, price: x.price })),
        flips: A.flipsOf ? (({ totals, done, open }) => ({ totals, done: done.slice(0, 25), open })) (A.flipsOf(ah)) : null,
        mine: ah.owned ? arr(ah.owned.list).map((a) => ({ id: a.id, name: name(a.id), qty: a.qty, buyout: a.buyout })) : [],
      },
    };
  }

  let last = '';
  document.addEventListener('cc:loaded', () => {
    if (location.protocol === 'file:') return;          // file mode has no server to write it
    setTimeout(() => {
      let snap;
      try { snap = build(); } catch (e) { console.warn('snapshot', e); return; }
      if (!snap) return;
      const body = JSON.stringify(snap, null, 1);
      const key = body.replace(/"written":"[^"]*"/, '');
      if (key === last) return;
      last = key;
      // the custom header keeps other web pages from writing here (they can't send it without permission)
      fetch('api/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body }).catch(() => {});
    }, 500);
  });
  CC.snapshot = build;
})();
