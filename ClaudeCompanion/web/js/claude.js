// Claude Companion: the snapshot Claude reads. After each load the page sends a compact,
// stable JSON summary of what it shows to the local server, which saves it as
// ClaudeCompanion/companion-data/snapshot.json. Schema: companion-data/SCHEMA.md.
(function () {
  const CC = window.CC;
  if (!CC || !CC.api) return;
  const A = CC.api, arr = A.arr;
  const SCHEMA = 1;
  // ?background=1: the server's hidden browser, loading the page only to write the snapshot (server.py / server.ps1)
  const BACKGROUND = new URLSearchParams(location.search).has('background');
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body });
  // The app's own settings (gear weights and picks, flips set aside: everything saved under "cc.") are
  // kept in companion-data/settings.json too, so they survive a cleared browser, carry over between
  // browsers, and the hidden browser (which has none) gives the same gear advice. The file wins on load.
  const SETTINGS = 'cc.';
  const settingsReady = location.protocol === 'file:' ? Promise.resolve()
    : fetch('api/settings', { cache: 'no-store' }).then((r) => (r.status === 200 ? r.json() : {})).then((d) => {
      let changed = false;
      Object.entries(d || {}).forEach(([k, v]) => {
        if (k.startsWith(SETTINGS) && typeof v === 'string' && localStorage.getItem(k) !== v) { localStorage.setItem(k, v); changed = true; }
      });
      if (changed && A.CH) A.render();
    }).catch(() => {});
  function saveSettings() {
    const d = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(SETTINGS)) d[k] = localStorage.getItem(k); }
    const body = JSON.stringify(d);
    if (body === '{}') return;                          // nothing chosen in this browser: never blank the file
    if (body !== saveSettings.last) { saveSettings.last = body; post('api/settings', body).catch(() => {}); }
  }

  function build() {
    const CH = A.CH;
    if (!CH || !CH.snap) return null;
    const s = CH.snap, c = s.character || {};
    const ah = CH.ah || {};
    const name = (id) => A.anyItemName(id);
    return {
      schema: SCHEMA,
      written: new Date().toISOString(),
      by: BACKGROUND ? 'background' : 'app',
      savedInGame: s.taken ? new Date(s.taken * 1000).toISOString() : null,
      // the save file's modified time (UTC) this snapshot was built from: if the file is newer now, the snapshot is stale
      saveModified: A.STATE.saveStamp || null,
      // which computer wrote this: the PC and the Mac each keep their own save and their own snapshot.json
      device: Object.assign({ host: null, os: CH.device || null }, A.STATE.device || {}),
      // the sync account (js/sync.js): Claude reads every computer's history on the backend with it
      // (docs/ARCHITECTURE.md, "Sync between computers"). syncedFrom: other computers merged into this view
      sync: CC.sync && CC.sync.state ? { account: CC.sync.state.account || null, device: CC.sync.state.device || null,
        ok: CC.sync.status.ok, error: CC.sync.status.error, pushed: CC.sync.status.pushed, pulled: CC.sync.status.pulled,
        computers: (CC.sync.status.devices || []).map((d) => ({ name: d.name, os: d.os, seen: d.seen })),
        syncedFrom: (A.DB && A.DB.syncedFrom) || [] } : null,
      // the grind running now (if any) and the last few finished ones; ended: logout / away / idle when the addon ended it
      grind: (() => {
        const g = CH.grind;
        const t = (x) => (x ? new Date(x * 1000).toISOString() : null);
        const one = (x) => ({ name: x.name, device: x.device || null, start: t(x.start), last: t(x.last), finish: t(x.finish),
          secs: x.secs != null ? x.secs : null, kills: x.kills || 0, paused: !!x.paused, ended: x.ended || null });
        return { running: g ? one(g) : null, recent: arr(CH.grinds).slice(-5).reverse().map(one) };
      })(),
      // flight paths you know, by continent; read{} = when that continent's flight map was last open
      // (paths on a continent never read since the addon noted continents are under "unknown")
      flightPaths: (() => {
        const by = {};
        Object.entries(CH.taxi || {}).forEach(([n, x]) => { if (/^zzOLD/.test(n)) return; const k = (x && x.continent) || 'unknown'; (by[k] = by[k] || []).push(n); });
        Object.values(by).forEach((l) => l.sort());
        const read = {};
        Object.entries(CH.taxiRead || {}).forEach(([k, v]) => { read[k] = v ? new Date(v * 1000).toISOString() : null; });
        return { byContinent: by, read };
      })(),
      // dungeon and raid runs, newest first (js/runs.js); fromJournal = rebuilt from the Journal (before the addon tracked runs)
      runs: (() => {
        if (!CC.runs) return [];
        const t = (x) => (x ? new Date(x * 1000).toISOString() : null);
        return CC.runs.all(CH).slice(0, 10).map((r) => {
          const st = A.trackerStats(r);
          return { name: r.name, kind: r.kind || null, difficulty: r.difficulty || null, device: r.device || null, live: !!r.live, inside: r.live ? !!r.inside : null,
            start: t(r.start), finish: t(r.finish), ended: r.ended || null, secs: Math.round(st.secs), kills: r.kills || 0,
            bosses: arr(r.bosses).map((b) => b.name), bossSource: arr(r.bosses).length ? (r.bossSource || 'encounter events') : null, wipes: r.wipes || 0, deaths: r.deaths || 0, xp: r.xp || 0, quests: r.quests || 0,
            coin: st.coin, itemsValue: Math.round(st.ah),
            loot: Object.values(r.loot || {}).map((l) => ({ id: l.id, name: l.name || (A.item(l.item) || {}).name || null, q: l.q != null ? l.q : (A.item(l.item) || {}).q, count: l.count }))
              .filter((l) => (l.q || 0) >= 2),
            group: arr(r.group).map((m) => m.name), fromJournal: !!r.fromJournal,
            // loot that went to someone else (greens and better), with the rolls when there were any
            groupLoot: arr(r.groupLoot).map((g) => ({ t: t(g.t), who: g.who, name: (g.link || '').replace(/.*\[(.*)\].*/, '$1') || null, q: g.q, how: g.how,
              rolls: arr(g.rolls).map((x) => ({ who: x.who, choice: x.choice, roll: x.roll != null ? x.roll : null })) })) };
        });
      })(),
      // when each part was last read in game; some parts only update while that window is open in game
      taken: (() => {
        const t = (x) => (x ? new Date(x * 1000).toISOString() : null);
        const taxi = Object.values(CH.taxi || {}).map((x) => x.last || 0);
        const specs = {};
        Object.entries(CH.specs || {}).forEach(([k, sp]) => { specs[k] = t(sp && (sp.talentsTaken || sp.barsTaken)); });
        const profs = {};
        Object.values(CH.professions || {}).forEach((p) => { if (p && p.name) profs[p.name] = t(p.taken); });
        return { character: t(s.taken), bank: t((CH.bank || {}).taken), mail: t((CH.mail || {}).taken), flightPaths: t(taxi.length ? Math.max(...taxi) : null),
          ahScan: t((ah.lastScan || {}).t), ahOwned: t((ah.owned || {}).taken), professions: profs, specs };
      })(),
      pack: A.GD ? { built: A.GD.built ? new Date(A.GD.built * 1000).toISOString() : null, from: A.GD.from } : null,
      character: { name: c.name, level: c.level, xp: c.xp, xpMax: c.xpMax, rested: c.rested, class: c.class, race: c.race,
        faction: c.faction, money: c.money, where: c.where, hearth: c.hearth },
      gear: CC.gear ? CC.gear.summary() : [],
      // what the app says about each item you own (js/advice.js); keep-only items are left out
      bagAdvice: CC.advice ? CC.advice.snapshot() : [],
      bestOwned: CC.advice ? CC.advice.bestOwnedSnapshot() : [],
      weightProfiles: window.CCWeights ? window.CCWeights.custom((s.character || {}).classFile).map((p) => ({ id: p.id, name: p.name, from: p.from, weights: p.w })) : [],
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
        bought: arr(ah.buys).slice(-25).map((x) => ({ t: x.t, item: x.item, price: x.price, count: x.count || null })),
        flips: A.flipsOf ? (({ totals, done, open }) => ({ totals, done: done.slice(0, 25), open })) (A.flipsOf(ah)) : null,
        mine: ah.owned ? arr(ah.owned.list).map((a) => ({ id: a.id, name: name(a.id), qty: a.qty, buyout: a.buyout })) : [],
      },
    };
  }

  let last = '';
  document.addEventListener('cc:loaded', () => {
    if (location.protocol === 'file:') return;          // file mode has no server to write it
    setTimeout(async () => {
      await settingsReady;
      if (!BACKGROUND) saveSettings();
      let snap;
      try { snap = build(); } catch (e) { console.warn('snapshot', e); return; }
      if (!snap) return;
      const body = JSON.stringify(snap, null, 1);
      const key = body.replace(/"written":"[^"]*"/, '').replace(/"by":"[^"]*"/, '');
      if (key === last) return;
      last = key;
      // the custom header keeps other web pages from writing here (they can't send it without permission)
      post('api/snapshot', body).catch(() => {});
      // and online, for Claude (js/sync.js; its next cycle sends it if it changed)
      CC.lastSnapshot = snap;
      if (CC.syncNow) CC.syncNow();
    }, 500);
  });
  // settings changed in the app (a gear pick, own weights) reach the hidden browser too
  if (!BACKGROUND && location.protocol.startsWith('http')) settingsReady.then(() => setInterval(saveSettings, 10000));
  CC.snapshot = build;
  CC.settingsReady = settingsReady;   // js/sync.js reads settings only after the file's are in
})();
