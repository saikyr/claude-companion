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

  // the app build this computer runs (the server's companion-data/installed.json), so Claude can tell
  // from the snapshot online whether a computer has the latest update
  let installed = null;
  const installedReady = location.protocol === 'file:' ? Promise.resolve()
    : fetch('api/update', { cache: 'no-store' }).then((r) => r.json()).then((st) => { installed = (st && st.installed) || null; }).catch(() => {});

  // a quest's reward items: from the game when the quest is in the log (it shows the real rolls),
  // else from the game-data pack. Each with the app's score for every spec.
  function questRewards(rw, gq) {
    const rated = (x, how, count) => {
      const r = CC.advice && CC.advice.rate ? CC.advice.rate(x) : null;
      const id = r ? r.id : Number((/item:(\d+)/.exec(String(x)) || [])[1] || x);
      return { id, name: r ? r.name : A.anyItemName(id), how, count: count || 1,
        specs: r ? r.specs.map((p) => ({ spec: p.spec, score: p.score, gain: p.gain, slot: p.slot, vs: p.vs ? p.vs.name : null, canWear: p.canWear, level: p.level, effect: p.effect })) : null };
    };
    // the game's own list when it gave one; a complete quest often reads back with none (#98): then the pack's
    if (rw && (arr(rw.items).length || arr(rw.choices).length)) return [...arr(rw.items).map((r) => rated(r.item || r.id, 'get', r.count)), ...arr(rw.choices).map((r) => rated(r.item || r.id, 'choose', r.count))];
    gq = gq || {};
    return [...arr(gq.reward).map(([id, n]) => rated(id, 'get', n)), ...arr(gq.choice).map(([id, n]) => rated(id, 'choose', n)), ...arr(gq.rewardAny).map(([id, n]) => rated(id, 'any', n))];
  }

  // A quest to keep (CLAUDE.md, the dungeon-quest rule): this quest or any step of its chain is a pack
  // Dungeon quest, has its quest zone or objective in an instance (battlegrounds left out), or is a step
  // of a key or attunement (data/rules.js unlocks: the Skeleton Key, the Seal of Ascension...). Gives
  // { dungeon, why } or null. Never on a drop list, whatever its rewards score.
  function keepOf(id) {
    const Q = (A.GD && A.GD.quests) || {};
    let inst = null;
    try { inst = CC.next && CC.next._dungeonIndex ? CC.next._dungeonIndex() : null; } catch (e) { inst = null; }
    const isInst = (z) => !!(z && inst && inst[z] && !inst[z].pvp);
    const unlockOf = {};
    arr((window.GAMERULES || {}).unlocks).forEach((u) => arr(u.quests).forEach((q) => { unlockOf[q] = u; }));
    const hit = (g, q) => {
      const u = unlockOf[q];
      if (u) return { dungeon: u.name, why: 'key or attunement: ' + u.what };
      if (isInst(g.cat)) return { dungeon: g.cat, why: 'dungeon quest' };
      const o = arr(g.obj).join(' ');
      const named = inst && Object.keys(inst).find((z) => !inst[z].pvp && z.length > 3 && o.includes(z));
      if (named) return { dungeon: named, why: 'objective in ' + named };
      return g.type === 'Dungeon' ? { dungeon: g.cat ? 'a dungeon (quest zone ' + g.cat + ')' : 'a dungeon', why: 'dungeon quest' } : null;
    };
    // its chain: back along prev, forward along next (not the other prerequisites of a later step)
    for (const dir of ['prev', 'next']) {
      const seen = new Set();
      let todo = [id];
      while (todo.length && seen.size < 40) {
        const q = todo.shift();
        if (seen.has(q)) continue;
        seen.add(q);
        const g = Q[q];
        if (!g) continue;
        const h = hit(g, q);
        if (h) return Object.assign(h, q === id ? {} : { via: { id: q, title: g.t || null } });
        todo = todo.concat(arr(g[dir]));
      }
    }
    // reputation toward rewards: the quest gives rep with a faction whose standing some item needs (pack
    // req: rep-vendor gear, recipes) and the character isn't Exalted with it yet
    const gated = new Set(Object.values((A.GD && A.GD.req) || {}).map((r) => r && r[0]).filter(Boolean));
    const standing = {};
    arr((A.CH && A.CH.snap || {}).reputation).forEach((r) => { if (r && r.name) standing[r.name] = r.reaction; });
    const f = arr((Q[id] || {}).rep).find(([name, n]) => n > 0 && gated.has(name) && (standing[name] || 0) < 8);
    if (f) return { dungeon: null, why: 'reputation toward rewards: ' + f[0] + ' +' + f[1] };
    return null;
  }

  // a tracker's lootBy for Claude: the 10 creatures with the most corpses, their 8 commonest items
  function lootByOf(x) {
    const by = Object.entries(x.lootBy || {});
    if (!by.length) return null;
    return by.sort((a, b) => (b[1].corpses || 0) - (a[1].corpses || 0)).slice(0, 10).map(([name, b]) => ({
      // kills seen before the creature's name was known are under "npc <id>"
      name, npc: b.npc || null, kills: ((x.killsBy || {})[name] || 0) + (b.npc && name !== 'npc ' + b.npc ? (x.killsBy || {})['npc ' + b.npc] || 0 : 0), corpses: b.corpses || 0,
      items: Object.entries(b.items || {}).sort((p, q) => q[1] - p[1]).slice(0, 8).map(([id, n]) => ({ id: Number(id), name: A.anyItemName(Number(id)), count: n })) }));
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
      app: installed ? { build: installed.tag || null, installedAt: installed.at || null } : null,
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
        const one = (x, live) => Object.assign({ name: x.name, device: x.device || null, start: t(x.start), last: t(x.last), finish: t(x.finish),
          secs: x.secs != null ? x.secs : null, kills: x.kills || 0, deaths: x.deaths || 0, paused: !!x.paused, ended: x.ended || null,
          zones: Object.keys(x.zones || {}),
          targets: arr(x.targets).map((g) => ({ id: g.id, name: g.name, got: g.got || 0, expected: g.expected != null ? g.expected : null,
            kills: g.kills || 0, rated: !!g.rated, sample: g.sample || null })),
          // what each creature dropped, by corpse (the addon's lootBy; game builds where the loot window names
          // its corpse): kills = your and your group's kills of it, corpses = its corpses you opened. Its own
          // rate for an item lies between count / kills (corpses with no loot open no window) and count / corpses
          lootBy: lootByOf(x) }, A.goldOf(x, { live }));
        return { running: g ? one(g, true) : null, recent: arr(CH.grinds).slice(-20).reverse().map((x) => one(x)) };
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
            ...A.goldOf(r, { live: !!r.live }),
            loot: Object.values(r.loot || {}).map((l) => ({ id: l.id, name: l.name || (A.item(l.item) || {}).name || (l.id ? A.anyItemName(l.id) : null), q: l.q != null ? l.q : (A.item(l.item) || {}).q, count: l.count }))
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
        return { trainer: t((CH.trainer || {}).taken), character: t(s.taken), bank: t((CH.bank || {}).taken), mail: t((CH.mail || {}).taken), flightPaths: t(taxi.length ? Math.max(...taxi) : null),
          ahScan: t((ah.lastScan || {}).t), ahOwned: t((ah.owned || {}).taken), professions: profs, specs };
      })(),
      // what this game client allows addons (Core.lua ns.Capabilities): APIs present, values secret or
      // readable, and the place probes (loot window: which corpse each slot came from; inside an instance: GUIDs)
      caps: CH.caps || null,
      // the game's combat log on this computer (js/combatlog.js), when /combatlog was on: per creature, your and
      // your group's spells by school (n, full resists, damage and damage resisted) and kills. Counts only
      combat: CC.combat && CC.combat.state ? CC.combat.api.summary(CC.combat.state) : null,
      pack: A.GD ? { built: A.GD.built ? new Date(A.GD.built * 1000).toISOString() : null, from: A.GD.from } : null,
      character: { name: c.name, level: c.level, xp: c.xp, xpMax: c.xpMax, rested: c.rested, class: c.class, race: c.race,
        faction: c.faction, money: c.money, where: c.where, hearth: c.hearth },
      gear: CC.gear ? CC.gear.summary() : [],
      // what the app says about each item you own (js/advice.js); keep-only items are left out
      bagAdvice: CC.advice ? CC.advice.snapshot() : [],
      // the Now page's ranked next steps (js/next.js), Hybrid order; each gain is the app's own score per spec
      nextSteps: CC.next ? CC.next.snapshot() : [],
      bestOwned: CC.advice ? CC.advice.bestOwnedSnapshot() : [],
      weightProfiles: window.CCWeights ? window.CCWeights.custom((s.character || {}).classFile).map((p) => ({ id: p.id, name: p.name, from: p.from, weights: p.w })) : [],
      equipped: arr(s.equipped).filter((e) => e && e.item).map((e) => ({ slot: e.slotName, id: Number((/item:(\d+)/.exec(e.item) || [])[1]), name: (A.item(e.item) || {}).name })),
      quests: arr(s.quests).filter((q) => q && q.id).map((q) => {
        const gq = (A.GD && A.GD.quests[q.id]) || {};
        const to = arr(gq.to)[0];
        const keep = keepOf(q.id);
        return { id: q.id, title: q.title, level: q.level, complete: !!(q.ready || q.complete), failed: !!q.failed,
          // keep: a dungeon or raid quest (or a step of one): never on a drop list, whatever its rewards score
          dungeon: keep ? keep.dungeon : null, keep: !!keep, keepWhy: keep ? keep.why + (keep.via ? ' (step: ' + keep.via.title + ')' : '') : null,
          // reputation the quest gives (pack), so a rep goal can be weighed: [faction, amount]
          rep: arr(gq.rep).map(([f, n]) => ({ faction: f, amount: n })),
          objectives: arr(q.objectives).map((o) => o.text), turnIn: to ? { npc: to[1], zone: to[2], x: to[3], y: to[4] } : null,
          xp: (q.rewards || {}).xp, money: (q.rewards || {}).money,
          // every reward item scored for every spec by the app's one engine (js/advice.js rate): read
          // these, never score rewards by hand. choose = pick one of the choose rewards
          rewards: questRewards(q.rewards, gq),
          // the next quest in the chain and what it gives, scored the same way
          next: arr(gq.next).slice(0, 1).map((n) => { const nq = (A.GD && A.GD.quests[n]) || {}; return { id: n, title: nq.t || null, rewards: questRewards(null, nq) }; })[0] || null };
      }),
      // spell ranks (js/spells.js, the one check): each spec's bars with the rank of every spell, the ones
      // below the best rank you know (outdated), and from the class trainer's list (read while its window was
      // open) the ranks to train now and later. known = the best rank of each ranked spell in your spellbook
      spells: (() => {
        if (!window.CCSpells) return null;
        const t = (x) => (x ? new Date(x * 1000).toISOString() : null);
        const R = window.CCSpells.check(CH, A.GD, CC.gear ? { source: CC.gear.raidSource, row: CC.gear.raidRow } : null);
        const rk = window.CCSpells.rankNo;
        const byId = {};
        arr(s.spellbook).forEach((tab) => arr(tab && tab.spells).forEach((x) => { if (x && x.id != null) byId[x.id] = x; }));
        return {
          book: { taken: t(R.book.taken), spells: R.book.spells },
          trainer: R.trainer ? { taken: t(R.trainer.taken), npc: R.trainer.npc, level: R.trainer.level } : null,
          specs: R.specs.map((x) => ({ spec: x.spec, active: x.active, taken: t(x.taken), spells: x.spells, outdated: x.outdated, unranked: x.unranked,
            bars: arr((CH.specs || {})[x.spec] && CH.specs[x.spec].actionBars).filter((a) => a && a.kind)
              .map((a) => ({ slot: a.slot, key: a.key || null, kind: a.kind, name: a.name || (byId[a.id] || {}).name || null,
                rank: a.kind !== 'spell' ? null : byId[a.id] ? rk(byId[a.id].rank) : rk(a.rank) })) })),
          train: R.train, trainCost: R.trainCost, later: R.later.slice(0, 20), laterTotal: R.later.length,
          known: R.known,
          // spells and ranks only a book teaches that you don't know (Prayer of Fortitude), with the book, its
          // sources (forever: seen on Forever, else Classic data) and what your AH asks (copper, newest scan);
          // raid = books only raids give
          reagents: R.reagents,
          books: ['now', 'later', 'raid'].reduce((o, k) => Object.assign(o, { [k]: R.books[k].slice(0, k === 'now' ? 20 : 8)
            .map((b) => Object.assign({}, b, { ah: A.planPrice ? A.planPrice(b.item) : null })) }), {}),
        };
      })(),
      cooldowns: A.cooldowns ? A.cooldowns().map((c) => ({ name: c.name, profession: c.prof || null, readyAt: c.ends, item: c.item || null })) : [],
      professions: arr(s.skills).filter((k, i, all) => k && k.maxRank > 1 && k.skillLineCategoryID === 11 && all.findIndex((y) => y && y.name === k.name) === i)
        .map((k) => ({ name: k.name, rank: k.rank, max: k.maxRank })),
      // every known recipe's margin, the Professions tab's own numbers (#118): materials at your AH plan price or a
      // vendor's, whichever is lower; the product at your AH plan price × how many it makes, after the AH cut
      crafts: A.craftProfit ? Object.values(CH.professions || {}).filter((p) => p && p.name).flatMap((p) => arr(p.recipes).map((r) => {
        const cp = r.output ? A.craftProfit(r) : null, cc = A.craftCost(r);
        return { profession: p.name, name: r.name, output: r.output || null, makes: cp ? cp.makes : null,
          cost: cc.cost, missing: cc.missing, value: cp ? cp.value : null, profit: cp && !cc.missing ? cp.profit : null,
          reagents: cc.parts.map((x) => ({ id: x.id, name: A.anyItemName ? A.anyItemName(x.id) : null, need: x.need, each: x.each, from: x.from })),
          cooldownEnds: r.cooldownEnds || null };
      })).sort((a, b) => (b.profit == null ? -Infinity : b.profit) - (a.profit == null ? -Infinity : a.profit)) : [],
      reputation: arr(s.reputation).filter((r) => r && !r.isHeader).map((r) => ({ name: r.name, standing: r.reaction, value: r.currentStanding })),
      ah: {
        lastScan: ah.lastScan ? { t: ah.lastScan.t, auctions: ah.lastScan.auctions } : null,
        itemsPriced: Object.keys(ah.prices || {}).length,
        sold: arr(ah.sales).slice(-25).map((x) => ({ t: x.t, item: x.item, net: x.net })),
        bought: arr(ah.buys).slice(-25).map((x) => ({ t: x.t, item: x.item, price: x.price, count: x.count || null })),
        flips: A.flipsOf ? (({ totals, done, open }) => ({ totals, done: done.slice(0, 25), open })) (A.flipsOf(ah)) : null,
        // the buy list (#115): every rule with its evidence (speculative ones with their backtest), and the rows of the rules the app shows (hidden = rows of rules it doesn't)
        buyList: A.buyListOf ? ((b) => b && { scan: b.scan, rules: b.rules, rows: b.rows.filter((r) => r.offered).slice(0, 60), hidden: b.rows.filter((r) => !r.offered).length, index: b.index })(A.buyListOf(ah)) : null,
        // open flips against your rules (#117), your paper trades scored, and flip profit per week
        positions: A.positionsOf ? A.positionsOf(ah) : null,
        paper: A.paperOf ? ((p) => p && { rules: p.rules, trades: p.trades.slice(0, 40) })(A.paperOf(ah)) : null,
        weekly: A.weeklyOf ? A.weeklyOf(ah).slice(0, 12) : [],
        // your own sell-through per item (#116): posts against the sales that followed within 48 h
        sellThrough: A.sellThrough ? (({ since, windowHours, totals, items }) => ({ since, windowHours, totals, items: items.slice(0, 40) }))(A.sellThrough(ah)) : null,
        mine: ah.owned ? arr(ah.owned.list).map((a) => ({ id: a.id, name: name(a.id), qty: a.qty, buyout: a.buyout })) : [],
      },
    };
  }

  let last = '';
  const write = () => {
    if (location.protocol === 'file:') return;          // file mode has no server to write it
    setTimeout(async () => {
      await settingsReady; await installedReady;
      if (!BACKGROUND) saveSettings();
      // the snapshot is always the character played last (#4): looking at another in the picker doesn't change it
      if (CC.api.STATE.viewingOther) return;
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
  };
  document.addEventListener('cc:loaded', write);
  document.addEventListener('cc:combat', write);   // new combat-log counts (js/combatlog.js) read after the load
  // settings changed in the app (a gear pick, own weights) reach the hidden browser too
  if (!BACKGROUND && location.protocol.startsWith('http')) settingsReady.then(() => setInterval(saveSettings, 10000));
  CC.snapshot = build;
  CC.settingsReady = settingsReady;   // js/sync.js reads settings only after the file's are in
})();
