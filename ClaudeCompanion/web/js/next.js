// Claude Companion: the Now page's next steps. One ranked list of what moves the character forward:
// quests, dungeons, items to chase, profession skill that opens an upgrade, attunements and keys.
// It scores nothing itself: every gain is the Gear engine's (js/advice.js rate, js/gear.js summary), quest
// state is js/quests.js, game data is the pack, attunements are data/rules.js `unlocks`. docs/ui-language.md, "The Now page".
(function () {
  const CC = window.CC;
  if (!CC || !CC.api) return;
  const A = CC.api, esc = A.esc, arr = A.arr;
  const RULES = window.GAMERULES || {};
  const MAX_LEVEL = 60;
  const MIN_GAIN = 0.5;          // the same floor the Gear page uses for "an upgrade"
  const XP_BELOW = 5;            // quests more than this many levels under you are left out of the XP ranking
  const LEVEL_AHEAD = 1;         // items you can wear within this many levels count (labelled "at 60")
  const snap = () => (A.CH && A.CH.snap) || {};
  const char = () => snap().character || {};
  const GD = () => A.GD || {};
  const SFX = () => window.GAMEDATA_SUFFIX || null;

  // ---------------------------------------------------------------- scores (the one engine)
  // An item's gain per spec, from CC.advice.rate: counted when that spec can wear it now or within a level.
  let RC = null;
  function rated(id) {
    const C = CC.advice && CC.advice.compute ? CC.advice.compute() : null;
    if (!RC || RC.C !== C) RC = { C, m: new Map() };
    if (RC.m.has(id)) return RC.m.get(id);
    const r = CC.advice && CC.advice.rate ? CC.advice.rate(id) : null, lvl = char().level || 0;
    // only what the Gear page counts: raid-only, PvP, other-faction and quest rewards you took are left out there
    const cand = gearCands();
    // something you already have is not a step (Ready now shows it when it beats what you wear)
    const out = r && (!cand || cand.byId[String(r.id)]) && !ownedIds().has(r.id) && {
      id: r.id, name: r.name, slot: (r.specs[0] || {}).slot || null,
      specs: r.specs.map((s) => {
        const ok = s.canWear && s.gain != null && s.gain > MIN_GAIN && (!s.level || s.level <= lvl + LEVEL_AHEAD);
        return { spec: s.spec, gain: ok ? s.gain : 0, at: ok && s.level ? s.level : null, effect: !!s.effect };
      }),
    };
    RC.m.set(id, out);
    return out;
  }
  let OW = null;
  function ownedIds() {
    const C = CC.advice && CC.advice.compute ? CC.advice.compute() : null;
    if (!OW || OW.C !== C) OW = { C, ids: new Set((CC.advice && CC.advice.owned ? CC.advice.owned() : []).map((o) => (A.item(o.key) || {}).id).filter(Boolean)) };
    return OW.ids;
  }
  let GC = null;
  function gearCands() {
    const G = CC.gear;
    if (!G || !G._candidates || !G.canUse) return null;
    const use = G.canUse();
    if (!use) return null;
    const key = JSON.stringify(use) + '|' + char().class + '|' + (snap().taken || 0);
    if (!GC || GC.key !== key) GC = { key, c: G._candidates(use, char().class) };
    return GC.c;
  }
  const specNames = () => { const C = CC.advice && CC.advice.compute ? CC.advice.compute() : null; return C ? C.ctxs.map((c) => c.name) : []; };
  // gain per spec added up over several items (each item weighted, e.g. by its drop chance)
  function addGains(into, r, w) { if (r) r.specs.forEach((s) => { if (s.gain) into[s.spec] = (into[s.spec] || 0) + s.gain * w; }); return into; }
  const mode = () => (A.STATE.nextSpec && specNames().includes(A.STATE.nextSpec) ? A.STATE.nextSpec : 'hybrid');
  const valueOf = (g) => (mode() === 'hybrid' ? Object.values(g || {}).reduce((a, b) => a + b, 0) : (g || {})[mode()] || 0);
  const gainTxt = (g) => Object.entries(g || {}).filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]).map(([s, v]) => `${esc(s)} +${v.toFixed(1)}`).join(' · ');

  // ---------------------------------------------------------------- dungeons (pack drops, once per pack)
  let DIDX = null;
  function dungeonIndex() {
    if (DIDX) return DIDX;
    const z = {}, size = GD().size || {}, inst = new Set();
    // an instance is a zone ForeverDB marks with an instance id on some drop; every drop listed in it counts
    // (many boss rows carry no instance id), and it is a raid when most of its gear needs a raid group
    for (const rows of Object.values(GD().src || {})) for (const r of rows) if (r[0] === 'drop' && r[5] && r[7]) inst.add(r[7]);
    for (const [k, rows] of Object.entries(GD().src || {})) {
      const g = A.gdItem(k);
      if (!g || (g[9] !== 2 && g[9] !== 4)) continue;
      for (const r of rows) {
        if (r[0] !== 'drop' || !r[7] || !inst.has(r[7])) continue;
        const d = z[r[7]] || (z[r[7]] = { name: r[7], items: new Map(), bosses: {}, big: 0 });
        if ((size[k] || 0) >= 20) d.big++;
        const cur = d.items.get(Number(k));
        if (!cur || (r[3] || 0) > (cur[3] || 0)) d.items.set(Number(k), r);
        if (r[6]) d.bosses[r[2]] = r[1];
      }
    }
    Object.values(z).forEach((d) => {
      d.raid = RAIDS.has(d.name) || d.big > d.items.size / 2;
      d.pvp = PVP.has(d.name);
      const lv = Object.keys(d.bosses).map((n) => (GD().npcs || {})[n]).filter(Boolean);
      d.min = lv.length ? Math.min(...lv.map((n) => n[1] || 0)) : null;
      d.max = lv.length ? Math.max(...lv.map((n) => n[2] || n[1] || 0)) : null;
    });
    DIDX = z;
    return z;
  }
  // which instances are raids or battlegrounds: data/rules.js (no per-item source says it reliably)
  const RAIDS = new Set(arr((RULES.instances || {}).raids)), PVP = new Set(arr((RULES.instances || {}).battlegrounds));
  const unlocks = () => arr(RULES.unlocks);
  // What one run is worth: per slot and spec, the expected gain of the best upgrade that drops (items in
  // order of gain, each counting only when nothing better dropped: Σ gain × p × Π(1 − p of the better ones)),
  // added over the slots. Items with no known drop rate are listed but not counted. `only` / `except`: boss NPC ids.
  function expectedRun(ups) {
    const gains = {};
    const bySlot = {};
    ups.forEach((u) => { if (u.pct != null) (bySlot[u.slot || '?'] = bySlot[u.slot || '?'] || []).push(u); });
    Object.values(bySlot).forEach((list) => {
      const specs = new Set(list.flatMap((u) => Object.keys(u.g)));
      specs.forEach((sp) => {
        let miss = 1, e = 0;
        list.filter((u) => u.g[sp]).sort((a, b) => b.g[sp] - a.g[sp]).forEach((u) => { const p = Math.min(1, u.pct / 100); e += u.g[sp] * p * miss; miss *= 1 - p; });
        if (e) gains[sp] = (gains[sp] || 0) + e;
      });
    });
    return gains;
  }
  function instanceValue(d, only, except) {
    const ups = [];
    let unrated = 0;
    d.items.forEach((r, id) => {
      if (only && !only.has(r[2])) return;
      if (except && except.has(r[2])) return;
      const g = A.gdItem(id);
      if (!g || g[11] !== 'e' || (SFX() && SFX().items[id])) return;       // Forever tooltip only; random rolls are not one item
      const sc = rated(id);
      if (!sc || !sc.specs.some((s) => s.gain)) return;
      const pct = r[3];
      if (pct == null) unrated++;
      ups.push({ id, name: sc.name, slot: sc.slot, boss: r[1], pct, forever: r[11] === 'm', kills: r[12], g: addGains({}, sc, 1), at: sc.specs.map((s) => s.at).find(Boolean) || null });
    });
    ups.sort((a, b) => valueOf(b.g) - valueOf(a.g));
    return { gains: expectedRun(ups), ups, unrated };
  }

  // ---------------------------------------------------------------- quests
  const Q = () => CC.quests;
  // holiday quests (QuestieDB's sort categories): not a step most of the year
  const SEASONAL = /^(Seasonal|Darkmoon Faire|Lunar Festival|Midsummer)$/;
  let raidQuest = () => false;
  function rewardGains(q) {
    // rewardAny: QuestieDB knows the items but not fixed vs choose-one, so it counts as choose-one (the lower claim)
    const pick = arr(q.choice).length ? arr(q.choice) : arr(q.rewardAny).length ? arr(q.rewardAny) : null;
    const fixed = arr(q.reward);
    const items = [];
    const g = {};
    fixed.forEach(([id]) => { const sc = rated(id); if (sc && sc.specs.some((s) => s.gain)) { addGains(g, sc, 1); items.push({ id, name: sc.name, g: addGains({}, sc, 1), how: 'get' }); } });
    if (pick) {
      // choose one: the best for the mode being ranked
      const opts = pick.map(([id]) => rated(id)).filter((sc) => sc && sc.specs.some((s) => s.gain));
      opts.sort((a, b) => valueOf(addGains({}, b, 1)) - valueOf(addGains({}, a, 1)));
      if (opts[0]) { addGains(g, opts[0], 1); items.push({ id: opts[0].id, name: opts[0].name, g: addGains({}, opts[0], 1), how: 'choose' }); }
    }
    return { g, items };
  }
  const who = (q) => { const f = arr(q && q.from)[0]; return f ? `${f[1]}${f[2] ? ', ' + f[2] : ''}` : ''; };
  const turnIn = (id) => { const t = arr((Q().pack(id) || {}).to)[0]; return t ? `${t[1]}${t[2] ? ', ' + t[2] : ''}` : ''; };
  // group members too low for a quest (from the save's group list)
  const groupShort = (min) => arr(snap().group).filter((m) => m && m.level && min && m.level < min).map((m) => `${m.name} (${m.level})`);

  // ---------------------------------------------------------------- the steps
  let SC = null;
  function steps() {
    const s = snap(), c = char(), lvl = c.level || 0;
    const key = [s.taken, mode(), CC.advice && CC.advice.compute ? 1 : 0].join('|');
    const C = CC.advice && CC.advice.compute ? CC.advice.compute() : null;
    if (SC && SC.key === key && SC.C === C) return SC.out;
    const leveling = lvl > 0 && lvl < MAX_LEVEL && c.xpMax;
    const xpPct = (xp) => (leveling && xp ? (100 * xp) / c.xpMax : 0);
    const out = [];
    if (!Q() || !GD().quests || !CC.advice || !CC.advice.rate) return out;
    const D = dungeonIndex();
    // a raid quest: its type, the raid it is set in, or a starting item that drops in a raid
    const raidZone = (z) => !!(z && D[z] && D[z].raid);
    raidQuest = (q) => q.type === 'Raid' || raidZone(q.cat) || arr(q.starter_item).some((it) => arr((GD().src || {})[it]).some((r) => raidZone(r[7])));
    const known = Q().known();
    const dungeonQuests = {};
    const zoneBundles = {};
    const ul = unlocks();
    const ulState = {};
    // ---- attunements and keys first: the dungeon rows need to know what's still locked
    const owns = (id) => ownedIds().has(id);
    ul.forEach((u) => {
      const qs = u.quests.filter((q) => Q().forYou(q));
      const done = qs.some((q) => Q().isDone(q)) || u.items.some(owns);
      ulState[u.id] = { done, qs };
    });
    // ---- dungeons
    Object.values(D).forEach((d) => {
      if (d.raid || d.pvp || d.max == null) return;
      if (d.min > lvl + 3) return;                                    // bosses well above you
      const carved = ul.filter((u) => u.value && u.value.npcs && u.value.npcs.some((n) => d.bosses[n]));
      const except = new Set(carved.flatMap((u) => u.value.npcs));
      const parts = [{ name: d.name, v: instanceValue(d, null, except.size ? except : null), u: ul.find((u) => u.value && u.value.zone === d.name) }]
        .concat(carved.map((u) => ({ name: u.name, v: instanceValue(d, new Set(u.value.npcs)), u })));
      parts.forEach((p) => {
        const locked = p.u && !ulState[p.u.id].done ? p.u : null;
        // boss levels of this part only (Upper and Lower Blackrock Spire)
        const ids = Object.keys(d.bosses).map(Number).filter((n) => (p.u && p.u.value && p.u.value.npcs ? p.u.value.npcs.includes(n) : !except.has(n)));
        const lv = ids.map((n) => (GD().npcs || {})[n]).filter(Boolean);
        const min = lv.length ? Math.min(...lv.map((n) => n[1] || 0)) : d.min, max = lv.length ? Math.max(...lv.map((n) => n[2] || n[1] || 0)) : d.max;
        out.push({ id: 'dungeon:' + p.name, kind: 'dungeon', name: p.name, zone: d.name, min, max, gains: p.v.gains, ups: p.v.ups, unrated: p.v.unrated, quests: [], locked, xp: 0 });
      });
    });
    const dungeonRow = (zone) => out.find((x) => x.kind === 'dungeon' && x.name === zone) || out.find((x) => x.kind === 'dungeon' && x.zone === zone);
    // ---- quests
    const twins = twinQuests(known);
    for (const [k, q] of (known ? Object.entries(GD().quests) : [])) {
      const id = Number(k);
      if (twins.has(id) || q.repeatable || q.type === 'Raid' || SEASONAL.test(q.cat || '') || !Q().forYou(id) || Q().isDone(id)) continue;
      if (raidQuest(q)) continue;
      const st = Q().status(id);
      if (st.state === 'done' || st.state === 'no' || st.state === 'unknown') continue;
      if (st.why.some((w) => w.kind === 'level' && w.level > lvl + LEVEL_AHEAD)) continue;
      if (arr(st.steps).some((x) => raidQuest(Q().pack(x) || {}))) continue;     // a raid chain: not a next step before raids

      const rw = rewardGains(q);
      const xp = q.lv >= lvl - XP_BELOW ? xpPct(q.xp) : 0;
      const hasGear = Object.keys(rw.g).length > 0;
      if (!hasGear && !xp) continue;
      // only the last step of a chain carries the chain: earlier steps show inside it
      if (arr(q.next).some((n) => { const nq = Q().pack(n); return nq && Q().forYou(n) && !Q().isDone(n) && arr(nq.prev).includes(id); }) && !hasGear) continue;
      const row = { id: 'quest:' + id, kind: 'quest', quest: id, name: q.t, zone: q.cat || '', lv: q.lv, gains: rw.g, items: rw.items, xp, st,
        from: who(Q().pack(st.first || id)), group: groupShort(q.min) };
      const dz = q.cat && D[q.cat] ? dungeonRow(q.cat) : null;
      if (dz && q.type === 'Dungeon') { dz.quests.push(row); continue; }
      if (!hasGear && leveling) { if (st.state !== 'open' && st.state !== 'active') continue; const b = zoneBundles[row.zone] || (zoneBundles[row.zone] = []); b.push(row); continue; }
      if (hasGear) out.push(row);
    }
    // dungeon rows add up their quests (a run does both)
    out.filter((x) => x.kind === 'dungeon').forEach((d) => {
      d.quests.forEach((q) => { Object.entries(q.gains).forEach(([sp, v]) => { d.gains[sp] = (d.gains[sp] || 0) + v; }); d.xp += q.xp; });
    });
    Object.entries(zoneBundles).forEach(([zone, qs]) => {
      qs.sort((a, b) => b.xp - a.xp);
      out.push({ id: 'zone:' + zone, kind: 'zone', name: zone || 'Other quests', zone, quests: qs, xp: qs.reduce((a, q) => a + q.xp, 0), gains: {} });
    });
    // ---- items to chase that no quest or dungeon above covers: the Gear page's own upgrades
    const seen = new Set();
    out.forEach((x) => { arr(x.ups).forEach((u) => seen.add(String(u.id))); arr(x.items).forEach((u) => seen.add(String(u.id))); arr(x.quests).forEach((q) => arr(q.items).forEach((u) => seen.add(String(u.id)))); });
    const byItem = {};
    arr(CC.gear && CC.gear.summary ? CC.gear.summary() : []).forEach((sp) => arr(sp.upgrades).forEach((u) => {
      if (!['ah', 'crafted', 'vendor', 'world'].includes(u.source) || seen.has(String(u.id))) return;
      if (u.reqLevel > lvl + LEVEL_AHEAD) return;
      const k = u.id + (u.roll ? ':' + u.roll : '');
      const it = byItem[k] || (byItem[k] = { id: 'item:' + k, kind: 'item', item: u.id, roll: u.roll, name: u.name, source: u.source, where: u.where, ah: u.ah, needs: u.needs, slot: u.slot, gains: {} });
      if (u.gain > MIN_GAIN) it.gains[sp.tree || sp.label] = Math.max(it.gains[sp.tree || sp.label] || 0, u.gain);
    }));
    // a crafted upgrade behind skill you're still raising becomes one profession step per skill level
    const profSteps = {};
    Object.values(byItem).forEach((it) => {
      if (it.source !== 'crafted') { out.push(it); return; }
      const gate = (A.itemGates ? A.itemGates(it.item) : []).find((x) => x.kind === 'skill' && !x.met);
      if (!gate) { out.push(it); return; }
      if (gate.have == null) return;                           // a profession you don't have: not a step
      const k = gate.prof + ':' + gate.skill;
      const p = profSteps[k] || (profSteps[k] = { id: 'prof:' + k, kind: 'prof', prof: gate.prof, skill: gate.skill, have: gate.have, name: `${gate.prof} ${gate.have} → ${gate.skill}`, opens: [], gains: {} });
      p.opens.push(it);
      Object.entries(it.gains).forEach(([sp, v]) => { p.gains[sp] = Math.max(p.gains[sp] || 0, v); });
    });
    Object.values(profSteps).forEach((p) => out.push(p));
    // ---- attunements and keys
    ul.forEach((u) => {
      const us = ulState[u.id];
      const row = { id: 'unlock:' + u.id, kind: 'unlock', u, name: u.name, done: us.done, gains: {} };
      if (u.value) { const d = out.find((x) => x.kind === 'dungeon' && x.name === (u.value.zone || u.name)); if (d) { row.gains = Object.assign({}, d.gains); row.dungeon = d.id; } }
      const q = known ? us.qs.map((x) => Q().status(x)).find((x) => x.state !== 'no') : null;
      row.st = q || null;
      row.unknown = !known && !us.done && us.qs.length > 0;
      if (!us.qs.length && u.items[0]) row.src = arr((GD().src || {})[u.items[0]])[0] || null;
      out.push(row);
    });
    out.forEach((x) => { x.v = valueOf(x.gains) + (leveling ? x.xp || 0 : 0); });
    SC = { key, C, out };
    return out;
  }
  // the ranked list for a filter: open steps with value first, then unlocks with nothing to rank them by
  const FILTERS = [['all', 'All'], ['gear', 'Gear'], ['quests', 'Quests'], ['dungeons', 'Dungeons'], ['prof', 'Professions'], ['unlocks', 'Unlocks']];
  const inFilter = (x, f) => f === 'all' ? !(x.kind === 'unlock' && (x.done || x.dungeon)) && (x.v > 0.05 || x.kind === 'unlock' && x.u.kind !== 'shortcut')
    : f === 'gear' ? x.kind === 'item' && x.v > 0.05
      : f === 'quests' ? (x.kind === 'quest' || x.kind === 'zone') && x.v > 0.05
        : f === 'dungeons' ? x.kind === 'dungeon' && (x.v > 0.05 || x.quests.length)
          : f === 'prof' ? x.kind === 'prof'
            : f === 'unlocks' ? x.kind === 'unlock' : false;
  function ranked(f) {
    return steps().filter((x) => inFilter(x, f)).sort((a, b) => (a.kind === 'unlock' && a.done) - (b.kind === 'unlock' && b.done) || b.v - a.v || a.name.localeCompare(b.name));
  }

  // The pack has some quests twice: a copy with no quest giver, or a second id for the same quest (Dire Maul's
  // "Unfinished Gordok Business" 1318 and 7703). Same title, zone, objective and rewards = one quest: keep the one
  // in your log, else the one with a quest giver, else the lower id; once any copy is done, all are.
  function twinQuests(known) {
    const out = new Set();
    if (!known) return out;
    const by = {};
    for (const [k, q] of Object.entries(GD().quests)) {
      const key = [q.t, q.cat || '', arr(q.obj)[0] || '', JSON.stringify(q.choice || []), JSON.stringify(q.reward || [])].join('|');
      (by[key] = by[key] || []).push(Number(k));
    }
    Object.values(by).forEach((all) => {
      const ids = all.filter((id) => Q().forYou(id));   // the other faction's copy is not a twin of yours
      if (ids.length < 2) return;
      if (ids.some((id) => Q().isDone(id))) { ids.forEach((id) => out.add(id)); return; }
      const score = (id) => { const st = Q().status(id).state; return (st === 'active' || st === 'ready' ? 4 : 0) + (arr(GD().quests[id].from).length ? 2 : 0); };
      ids.sort((a, b) => score(b) - score(a) || a - b).slice(1).forEach((id) => out.add(id));
    });
    return out;
  }

  // ---------------------------------------------------------------- ready now
  function readyNow() {
    const out = [], s = snap(), now = Date.now() / 1000;
    arr(s.quests).filter((q) => q.ready || q.complete).forEach((q) => out.push({ kind: 'turnin', id: 'quest:' + q.id, name: q.title, sub: 'ready to turn in' + (turnIn(q.id) ? ' to ' + turnIn(q.id) : '') }));
    arr(A.cooldowns ? A.cooldowns() : []).filter((c) => c.ends <= now).forEach((c) => out.push({ kind: 'cooldown', name: c.name, icon: c.icon, sub: (c.prof ? c.prof + ' cooldown' : 'cooldown') + ' · ready now' }));
    if (CC.advice && CC.advice.slotHint) {
      const seenK = new Set();
      arr(s.equipped).forEach((e) => {
        const h = e && CC.advice.slotHint(e.slot);
        if (h && !seenK.has(h.key)) { seenK.add(h.key); out.push({ kind: 'owned', key: h.key, name: h.name, sub: `${h.where === 'bank' ? 'in your bank' : 'in your bags'} · +${h.gain.toFixed(1)} ${h.spec} over what you wear` }); }
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- view
  const KIND_WORD = { dungeon: 'Dungeon', quest: 'Quest', zone: 'Quests', item: 'Item', prof: 'Profession', unlock: 'Unlock' };
  const SOURCE_WORD = { ah: 'On the AH', crafted: 'Crafted', vendor: 'Vendor', world: 'World drop' };
  // the app's own icons (app.js UI_ICON); a profession step shows that profession's icon, an item or quest its item
  const kindIcon = (k) => A.icon(A.uiIcon(k), { size: 'sm' });
  function rowIcon(x) {
    if (x.kind === 'item') return A.itemIconOf(x.item);
    if (x.kind === 'quest' && x.items[0]) return A.itemIconOf(x.items[0].id);
    if (x.kind === 'prof' && A.PROF_ICON[x.prof]) return A.icon(A.PROF_ICON[x.prof], { size: 'sm' });
    return kindIcon(x.kind);
  }
  const pct = (v) => `${v >= 10 ? Math.round(v) : v.toFixed(1)}% of a level`;
  function lines(x) {
    const st = x.st, why = [];
    if (x.kind === 'dungeon') {
      const n = x.ups.length;
      why.push(`${x.min === x.max ? 'Level ' + x.min : `Bosses level ${x.min}–${x.max}`}${n ? ` · ${n} upgrade${n === 1 ? '' : 's'}` : ''}${x.quests.length ? ` · ${x.quests.length} quest${x.quests.length === 1 ? '' : 's'}` : ''}`);
      if (x.locked) why.push({ need: `Needs ${x.locked.items[0] ? A.anyItemName(x.locked.items[0]) : x.locked.name} (Unlocks)` });
    } else if (x.kind === 'quest') {
      why.push(`${x.zone ? x.zone + ' · ' : ''}level ${x.lv}${x.st.steps && x.st.steps.length > 1 ? ` · ${x.st.steps.length - 1} earlier step${x.st.steps.length === 2 ? '' : 's'} to do` : ''}${x.st.state === 'active' ? ' · in your log' : x.from ? ' · starts at ' + x.from : ''}`);
      st.why.filter((w) => w.kind === 'rep').forEach((w) => why.push({ need: `Needs ${w.standing} with ${w.faction} (you: ${w.have == null ? 'none' : w.have.toLocaleString()} rep)` }));
      st.why.filter((w) => w.kind === 'level').forEach((w) => why.push({ need: `Needs level ${w.level}` }));
      st.why.filter((w) => w.kind === 'skill').forEach((w) => why.push({ need: `Needs ${w.prof} ${w.skill} (you: ${w.have})` }));
      if (x.group.length) why.push({ need: 'Too low in your group: ' + x.group.join(', ') });
    } else if (x.kind === 'zone') {
      why.push(`${x.quests.length} quest${x.quests.length === 1 ? '' : 's'} you can take now: ${x.quests.slice(0, 3).map((q) => esc(q.name)).join(', ')}${x.quests.length > 3 ? ', …' : ''}`);
    } else if (x.kind === 'item') {
      why.push(`${x.slot} · ${SOURCE_WORD[x.source] || ''}${x.ah ? ` · ${A.money(x.ah.price, { short: true })}, ${x.ah.listed} listed ${A.ago(x.ah.seen)}` : x.where ? ' · ' + x.where : ''}`);
      arr(x.needs).forEach((n) => why.push({ need: 'Needs ' + n }));
    } else if (x.kind === 'prof') {
      why.push(`Unlocks ${x.opens.slice(0, 2).map((o) => esc(o.name)).join(', ')}${x.opens.length > 2 ? ` and ${x.opens.length - 2} more` : ''}`);
    } else if (x.kind === 'unlock') {
      why.push(x.u.what);
      if (x.done) why.push('Done');
      else if (x.st) why.push(x.st.state === 'active' || x.st.state === 'ready' ? `In your log: ${Q().pack(x.st.id).t}` : `Starts with ${Q().pack(x.st.first || x.st.id).t}${who(Q().pack(x.st.first || x.st.id)) ? ' · ' + who(Q().pack(x.st.first || x.st.id)) : ''}${x.st.steps && x.st.steps.length > 1 ? ` · ${x.st.steps.length} steps` : ''}`);
      else if (x.unknown) why.push({ need: 'Your save has no completed-quest list yet: Sync in game' });
      else if (x.src) why.push(`${x.src[0] === 'drop' ? 'Drops from' : 'From'} ${x.src[1]}${x.src[7] ? ', ' + x.src[7] : ''}`);
      if (x.u.kind === 'raid') why.push(x.u.opens ? `Raid · opens ${new Date(x.u.opens + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'Raid · not open yet');
      if (x.st && x.st.why) x.st.why.filter((w) => w.kind === 'level').forEach((w) => why.push({ need: `Needs level ${w.level}` }));
    }
    return why;
  }
  const valueCell = (x) => {
    const g = gainTxt(x.gains), xp = x.xp ? pct(x.xp) : '';
    return `<div class="c-num">${g ? `<div class="pos">${g}</div>` : ''}${xp ? `<div class="sub">${xp}</div>` : ''}${!g && !xp ? '<span class="dim">–</span>' : ''}</div>`;
  };
  // what one step holds, shown when it's opened
  function detail(x) {
    let h = '<div class="nx-det">';
    // every row the same way: an icon, the name, a line under it (items through the shared item cell, app.js itemCell)
    const tr = (ic, main, sub, val) => `<div class="tr"><div class="c-main">${ic}<div class="grow"><div class="nm">${main}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div>${val}</div>`;
    const itemTr = (id, name, sub, val) => `<div class="tr">${A.itemCell(id, { name, subHtml: sub })}${val}</div>`;
    const qIc = kindIcon('quest');
    // a quest's rewards, each with its icon and tooltip
    const rewards = (items) => items.map((i) => A.itemInline(i.id, { name: i.name })).join('');
    const gv = (g) => `<div class="c-num pos">${gainTxt(g) || '<span class="dim">–</span>'}</div>`;
    const qa = (id, t) => `<a href="https://foreverchanges.pro/quest/${id}" target="_blank" rel="noopener">${esc(t)}</a>`;
    if (x.kind === 'dungeon') {
      if (x.ups.length) h += `<div class="tsec">Upgrades <span>${x.ups.length}, with the boss and drop chance</span></div>`;
      x.ups.slice(0, 12).forEach((u) => { h += itemTr(u.id, u.name, `${esc(u.boss)} · ${u.pct == null ? 'no drop rate' : u.forever ? `${u.pct}% (Forever, ${u.kills} kills)` : `${u.pct}% (Classic rate)`}${u.at ? ' · at ' + u.at : ''}`, gv(u.g)); });
      if (x.ups.length > 12) h += `<p class="meta">and ${x.ups.length - 12} more upgrades</p>`;
      if (x.quests.length) h += `<div class="tsec">Quests <span>${x.quests.length}</span></div>`;
      x.quests.forEach((q) => { h += tr(q.items[0] ? A.itemIconOf(q.items[0].id) : qIc, qa(q.quest, q.name), q.items.length ? rewards(q.items) : (q.xp ? pct(q.xp) : ''), gv(q.gains)); });
    } else if (x.kind === 'quest') {
      (x.st.steps || [x.quest]).forEach((s, i, all) => { const p = Q().pack(s) || {}; h += tr(qIc, `${i + 1}. ${qa(s, p.t || '#' + s)}`, `${p.cat || ''}${who(p) ? ' · from ' + esc(who(p)) : ''}`, i === all.length - 1 ? gv(x.gains) : '<div></div>'); });
      x.items.forEach((it) => { h += itemTr(it.id, it.name, it.how === 'choose' ? 'Choose one' : 'Reward', gv(it.g)); });
    } else if (x.kind === 'zone') {
      x.quests.forEach((q) => { h += tr(qIc, qa(q.quest, q.name), `level ${q.lv}${q.from ? ' · from ' + esc(q.from) : ''}`, `<div class="c-num">${pct(q.xp)}</div>`); });
    } else if (x.kind === 'prof') {
      x.opens.forEach((o) => { h += itemTr(o.item, o.name, esc(o.where || ''), gv(o.gains)); });
      const p = (A.CH.professions || {})[x.prof];
      const ups = arr(p && p.recipes).filter((r) => r.difficulty != null && r.difficulty < 2).map((r) => ({ r, c: A.craftCost ? A.craftCost(r) : null }))
        .sort((a, b) => (a.c && !a.c.missing ? a.c.cost : 1e12) - (b.c && !b.c.missing ? b.c.cost : 1e12)).slice(0, 5);
      h += `<div class="tsec">Cheapest skill-ups now <span>${p ? 'orange and yellow recipes, reagents at your AH prices' : `open ${esc(x.prof)} in game, then Sync`}</span></div>`;
      const recIc = (r) => (r.output && A.gdItem(r.output) ? A.itemIconOf(r.output) : A.icon(r.icon || A.PROF_ICON[x.prof], { size: 'sm' }));
      ups.forEach(({ r, c }) => { h += tr(recIc(r), esc(r.name), r.difficulty === 0 ? 'always gives a point' : 'usually gives a point', `<div class="c-num">${c && !c.missing ? A.money(c.cost, { short: true }) : '<span class="dim">no price</span>'}</div>`); });
    } else if (x.kind === 'unlock') {
      if (x.st && x.st.steps) x.st.steps.forEach((s, i) => { const p = Q().pack(s) || {}; h += tr(qIc, `${i + 1}. ${qa(s, p.t || '#' + s)}`, `${p.cat || ''}${who(p) ? ' · from ' + esc(who(p)) : ''}`, '<div></div>'); });
      h += `<p class="meta">Source: ${esc(x.u.src)}. ${x.u.who === 'each' ? 'Everyone in the group needs it.' : 'One holder opens it for the group.'}</p>`;
    } else if (x.kind === 'item') {
      h += `<p class="meta">${esc(x.where || '')} <a class="linkbtn" data-tab="gear">Open on the Gear page</a></p>`;
    }
    return h + '</div>';
  }
  function cardNotes() {
    const open = CC.cards && CC.cards.open ? CC.cards.open() : [];
    const by = {};
    const loose = [];
    open.forEach((c) => { if (c.step) (by[c.step] = by[c.step] || []).push(c); else loose.push(c); });
    return { by, loose, all: open };
  }
  function html() {
    const f = A.STATE.nextF || 'all';
    const list = ranked(f), lvl = char().level || 0;
    const notes = cardNotes();
    const sp = specNames();
    let h = '';
    const ready = readyNow();
    if (ready.length) {
      const readyIc = (r) => (r.kind === 'owned' ? A.itemIcon(r.key, { size: 'sm' }) : r.kind === 'cooldown' ? A.icon(r.icon || A.uiIcon('cooldown'), { size: 'sm' }) : kindIcon('quest'));
      const readyNm = (r) => (r.kind === 'owned' ? A.itemLink(Number((/^item:(\d+)/.exec(r.key) || [])[1]), { key: r.key, name: r.name }) : esc(r.name));
      h += `<h2>Ready now</h2><div class="list">${ready.map((r) => `<div class="li">${readyIc(r)}<div class="grow"><div>${readyNm(r)}</div><div class="sub">${esc(r.sub)}</div></div></div>`).join('')}</div>`;
    }
    if (notes.all.length) {
      const visible = list.slice(0, A.STATE.nextAll === f ? 200 : 25);
      const shown = notes.all.filter((c) => !c.step || !visible.some((x) => x.id === c.step)).slice(0, 4);
      if (shown.length) h += `<h2>From Claude <span class="n dim small">${notes.all.length} open</span></h2><div class="list">${shown.map((c) => `<div class="li link" data-tab="claude">${kindIcon(['farm', 'flip', 'quest', 'gear', 'craft', 'route'].includes(c.kind) ? c.kind : 'note')}<div class="grow"><div>${esc(c.title)}</div>${c.summary ? `<div class="sub">${esc(c.summary)}</div>` : ''}</div></div>`).join('')}</div>`;
    }
    const counts = Object.fromEntries(FILTERS.map(([k]) => [k, ranked(k).length]));
    h += `<h2>Next steps</h2><div class="toolbar"><div class="chips">${FILTERS.map(([k, l]) => `<button data-nextf="${k}" class="${f === k ? 'on' : ''}">${l} <span>${counts[k]}</span></button>`).join('')}</div>
      ${sp.length > 1 ? `<div class="seg">${[['hybrid', 'Hybrid']].concat(sp.map((n) => [n, n])).map(([k, l]) => `<button data-nextspec="${esc(k)}" class="${mode() === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>` : ''}</div>`;
    if (CC.quests && !Q().known()) h += '<p class="meta">Quests are left out: your save has no list of completed quests yet. Sync in game (or /reload) and they appear.</p>';
    if (!list.length) return h + `<div class="empty">${!CC.advice || !CC.quests ? 'Sync in game to see your next steps.' : f === 'all' ? 'Nothing to rank: no quest, dungeon or item here beats what you have.' : 'Nothing in this group.'}</div>` + how(lvl);
    h += `<div class="table nextsteps"><div class="thead"><div>Step</div><div>Kind</div><div class="c-num">${lvl < MAX_LEVEL ? 'Gain · XP' : 'Gain'}</div></div>`;
    list.slice(0, A.STATE.nextAll === f ? 200 : 25).forEach((x) => {
      const ws = lines(x), open = A.STATE.nextOpen === x.id;
      const subs = ws.map((w) => (typeof w === 'string' ? `<div class="sub">${w.includes('<') ? w : esc(w)}</div>` : `<div class="sub need">${esc(w.need)}</div>`)).join('');
      const cn = arr(notes.by[x.id]).map((c) => `<div class="sub"><span class="tag">From Claude</span> ${esc(c.title)}</div>`).join('');
      h += `<div class="tr link${open ? ' on' : ''}" data-nextopen="${esc(x.id)}"><div class="c-main">${rowIcon(x)}<div class="grow"><div class="nm">${esc(x.name)}${x.kind === 'quest' && x.st.state === 'active' ? ' <span class="tag">in log</span>' : ''}${x.kind === 'unlock' && x.done ? ' <span class="tag ok">done</span>' : ''}</div>${subs}${cn}</div></div><div class="dim small">${KIND_WORD[x.kind]}</div>${valueCell(x)}</div>`;
      if (open) h += detail(x);
    });
    if (list.length > 25 && A.STATE.nextAll !== f) h += `<div class="tr link dim small" data-nextall="${f}">Show all ${list.length}</div>`;
    h += '</div>';
    return h + how(lvl);
  }
  const how = (lvl) => `<details class="how"><summary>How these are ranked</summary><p>Every gain is the Gear page's score (your weights, against the gear each spec is compared with); Hybrid adds your specs together. A dungeon is worth what one run is expected to give: per slot, the best upgrade that drops, weighed by drop chances (ForeverDB; Classic rates say so), plus its quests; a quest is worth its best reward; a profession step, the best upgrade its skill opens; an attunement, what it opens.${lvl < MAX_LEVEL ? ` Under ${MAX_LEVEL}, a quest's XP counts too, as a percentage of your level (QuestieDB Forever XP; quests more than ${XP_BELOW} levels under you are left out).` : ''} Effort (chain steps, group, reputation) is shown, not scored. Items you can wear within ${LEVEL_AHEAD} level count, marked with the level.</p></details>`;

  document.addEventListener('click', (e) => {
    const f = e.target.closest('[data-nextf]');
    if (f) { A.STATE.nextF = f.dataset.nextf; A.STATE.nextOpen = null; A.render(); return; }
    const s = e.target.closest('[data-nextspec]');
    if (s) { A.STATE.nextSpec = s.dataset.nextspec; A.render(); return; }
    const a = e.target.closest('[data-nextall]');
    if (a) { A.STATE.nextAll = a.dataset.nextall; A.render(); return; }
    if (e.target.closest('a')) return;
    const o = e.target.closest('[data-nextopen]');
    if (o) { A.STATE.nextOpen = A.STATE.nextOpen === o.dataset.nextopen ? null : o.dataset.nextopen; A.render(); }
  });

  // ---------------------------------------------------------------- the same list for Claude (snapshot nextSteps)
  function snapshot() {
    const keep = A.STATE.nextSpec;
    A.STATE.nextSpec = 'hybrid';
    try {
      return ranked('all').slice(0, 30).map((x) => ({
        id: x.id, kind: x.kind, name: x.name, value: +x.v.toFixed(2), gains: Object.fromEntries(Object.entries(x.gains).map(([k, v]) => [k, +v.toFixed(1)])),
        xpPctOfLevel: x.xp ? +x.xp.toFixed(1) : null,
        lines: lines(x).map((w) => (typeof w === 'string' ? w.replace(/<[^>]+>/g, '') : 'NEEDS: ' + w.need)),
        steps: x.st && x.st.steps ? x.st.steps : undefined,
      }));
    } finally { A.STATE.nextSpec = keep; }
  }
  CC.next = { steps, ranked, readyNow, html, snapshot, _dungeonIndex: dungeonIndex };
})();
