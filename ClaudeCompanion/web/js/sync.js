// Claude Companion: history sync between computers (docs/ARCHITECTURE.md, "Sync between computers").
//
// HISTORY (the journal, grinds, dungeon runs, sessions, AH prices / sales / buys / posts, disenchant
// results, notes, plus the app's settings) is the union of every computer's. NOW (bags, gear, quests,
// talents, rep, bank, professions...) is each save's copy of the game server's: each computer sends its
// copy, and the view shows each part from whichever computer saw it last. Through a small Supabase backend:
//
//  - every record has an id made from its content (character, kind, time, what it was), so the same
//    event seen by two computers is ONE record, a re-send changes nothing, and there are no conflicts
//  - each computer sends what is new in its save after every save it sees (each /reload,
//    logout, and the automatic saves), and fetches everything new from its other computers
//  - the merged view (js/merge.js, its tested rules) shows one character: your save here plus the
//    history from every other computer, including history the addon has already trimmed here
//  - offline: nothing is lost. What wasn't sent stays "not sent" (the high-water marks only move on
//    success) and goes with the next save; the app always works from the local save
//
// Identity: each install has a random device key, made once by the local server
// (companion-data/sync.json). The backend keeps only its hash. Two computers join one account with a link code (System
// tab), or Claude joins them on the backend when it can tell they're the same person's.
// Only the publishable key is here; the tables are closed, and the cc_* functions only ever touch the
// account of the key that calls them.
(function (root) {
  const CONFIG = {
    url: 'https://jucbngafdnyaizfxgplk.supabase.co',
    key: 'sb_publishable_PIOdDOdU5fXYnfA1jI7MlA_l6xLvsUx',
  };
  const BATCH = 500;
  const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map((k) => x[k]) : []);
  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : 0);

  // short stable hash (FNV-1a, 52 bits through two 32-bit halves) for ids
  function hash(s) {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    }
    return a.toString(36) + (b & 0xfffff).toString(36);
  }

  // ------------------------------------------------------------------ records from a save
  // Same identities as js/merge.js uses to union two saves, so the merged view and the backend agree.
  const evKey = (e) => [e.t, e.e, e.name || e.title || e.item || e.link || e.to || e.text || '', e.amount != null ? e.amount : e.count != null ? e.count : e.quest || ''].join('|');
  const tracker = (x) => [x.start || x.id, x.name || ''].join('|');
  const ahKey = (x) => JSON.stringify([x.t, x.item || x.link || x.name, x.price || x.net || x.unit]);
  // trackers (sessions, grinds, runs) can still change after they're first saved (the addon ends a
  // grind "away" later, a run gets its last loot): they're replaced when their data changes. The rest
  // is written once.
  const REPLACED = new Set(['session', 'grind', 'run']);
  const KINDS = [
    // [kind, list, identity, time]
    ['journal', (c) => c.journal, evKey, (e) => e.t],
    ['session', (c) => c.sessions, tracker, (x) => x.start],
    ['grind', (c) => c.grinds, tracker, (x) => x.start],
    ['run', (c) => c.runs, tracker, (x) => x.start],
    ['note', (c) => c.notes, (n) => n.t + '|' + n.text, (n) => n.t],
    ['history', (c) => c.history, (h) => JSON.stringify([h.t, h.level, h.money]), (h) => h.t],
    ['de', (c) => c.deResults, (d) => JSON.stringify([d.t, d.item]), (d) => d.t],
    ['ah_sale', (c) => (c.ah || {}).sales, ahKey, (x) => x.t],
    ['ah_buy', (c) => (c.ah || {}).buys, ahKey, (x) => x.t],
    ['ah_post', (c) => (c.ah || {}).posts, ahKey, (x) => x.t],
  ];
  const LIVE_CAP = 60000;
  function slim(x) {
    // a running tracker can carry a lot of loot; keep the record under the backend's size limit
    if (!x) return null;
    if (JSON.stringify(x).length < LIVE_CAP / 3) return x;
    const y = Object.assign({}, x); delete y.loot; delete y.groupLoot; delete y.killsBy; delete y.lootBy; y.slim = true;
    return y;
  }

  // every record in one save: [{ id, char, kind, t, data, mutable }]
  function recordsOf(db, device) {
    const out = [];
    Object.entries((db && db.chars) || {}).forEach(([ck, c]) => {
      if (!c || typeof c !== 'object') return;
      for (const [kind, list, key, time] of KINDS) {
        const nth = new Map();
        arr(list(c)).forEach((x) => {
          if (!x || typeof x !== 'object') return;
          const k0 = key(x), n = (nth.get(k0) || 0) + 1;
          nth.set(k0, n);
          const t = Math.round(num(time(x)));
          out.push({ id: `${ck}|${kind}|${t}|${hash(k0)}${n > 1 ? '#' + n : ''}`, char: ck, kind, t, data: x, mutable: REPLACED.has(kind) || undefined });
        });
      }
      // AH price observations: one record each, with the item they belong to
      Object.entries((c.ah || {}).prices || {}).forEach(([ik, p]) => {
        if (!p) return;
        arr(p.obs).forEach((o) => {
          if (!o) return;
          const t = Math.round(num(o.t));
          out.push({ id: `${ck}|ah_obs|${t}|${hash(ik + '|' + (o.src || ''))}`, char: ck, kind: 'ah_obs', t,
            data: Object.assign({ key: ik, item: p.id, name: p.name || undefined, q: p.q }, o) });
        });
      });
      // how the character is now, as this computer last saw it (bags, gear, quests, talents, rep, bank, class trainer,
      // mail, professions, flight paths, own auctions): replaced each time. The view shows each part
      // from whichever computer saw it last (js/merge.js), so a computer you haven't played on lately
      // still shows what you have now
      const now = { snap: c.snap, bank: c.bank, mail: c.mail, professions: c.professions, specs: c.specs, trainer: c.trainer, taxi: c.taxi, taxiRead: c.taxiRead,
        ah: { owned: (c.ah || {}).owned, lastScan: (c.ah || {}).lastScan }, bossLog: c.bossLog };
      if (c.snap) out.push({ id: `${ck}|now|${device}`, char: ck, kind: 'now', t: Math.round(num((c.snap || {}).taken)), mutable: true, data: now });
      // what's running on this computer right now, and when it last saw the character: replaced each time
      out.push({ id: `${ck}|live|${device}`, char: ck, kind: 'live', t: Math.round(num(c.lastSeen)), mutable: true,
        data: { lastSeen: num(c.lastSeen) || num((c.snap || {}).taken), grind: slim(c.grind), run: slim(c.run), session: slim(c.session) } });
    });
    return out;
  }

  // the records another computer sent, as a save-shaped DB js/merge.js can merge: [{ dev, db }]
  function peersOf(records, names, hereDevice) {
    const byDev = new Map();
    const get = (dev, ck) => {
      if (!byDev.has(dev)) byDev.set(dev, { chars: {} });
      const db = byDev.get(dev);
      return db.chars[ck] || (db.chars[ck] = { journal: [], sessions: [], grinds: [], runs: [], notes: [], history: [], deResults: [],
        ah: { prices: {}, sales: [], buys: [], posts: [] }, lastSeen: 0 });
    };
    const LIST = { journal: 'journal', session: 'sessions', grind: 'grinds', run: 'runs', note: 'notes', history: 'history', de: 'deResults' };
    const AH = { ah_sale: 'sales', ah_buy: 'buys', ah_post: 'posts' };
    for (const r of records) {
      if (!r || !r.data || r.kind === 'setting') continue;
      const dev = r.dev || 'unknown';
      const c = get(dev, r.char);
      if (LIST[r.kind]) c[LIST[r.kind]].push(r.data);
      else if (AH[r.kind]) c.ah[AH[r.kind]].push(r.data);
      else if (r.kind === 'ah_obs') {
        const d = r.data, k = d.key || String(d.item);
        const p = c.ah.prices[k] || (c.ah.prices[k] = { id: d.item, name: d.name, q: d.q, obs: [], last: 0 });
        const o = Object.assign({}, d); delete o.key; delete o.item; delete o.name; delete o.q;
        p.obs.push(o); p.last = Math.max(p.last, num(o.t));
      } else if (r.kind === 'now' && dev !== hereDevice) {
        const d = r.data;
        ['snap', 'bank', 'mail', 'professions', 'specs', 'trainer', 'taxi', 'taxiRead', 'bossLog'].forEach((f) => { if (d[f] != null) c[f] = d[f]; });
        if (d.ah) { if (d.ah.owned) c.ah.owned = d.ah.owned; if (d.ah.lastScan) c.ah.lastScan = d.ah.lastScan; }
      } else if (r.kind === 'live' && dev !== hereDevice) {
        c.lastSeen = num(r.data.lastSeen);
        if (r.data.grind) c.grind = r.data.grind;
        if (r.data.run) c.run = r.data.run;
        if (r.data.session) c.session = r.data.session;
      }
    }
    const label = (dev) => (dev === hereDevice ? 'this computer, earlier' : (names && names[dev]) || 'other computer');
    return [...byDev.entries()].map(([dev, db]) => {
      // a character this save doesn't have stays out of the view (it has no "now" part to show)
      Object.values(db.chars).forEach((c) => { const sort = (l) => l.sort((a, b) => num(a.t || a.start) - num(b.t || b.start)); Object.values(LIST).forEach((f) => sort(c[f])); });
      return { dev: label(dev), id: dev, db };
    });
  }

  // own save + the other computers' history = one character (js/merge.js)
  function view(own, cache, hereDevice) {
    const M = root.CCMerge || (typeof require !== 'undefined' ? require('./merge.js') : null);
    if (!M || !cache || !cache.recs || !own || !own.chars) return own;
    const recs = Object.values(cache.recs);
    if (!recs.length) return own;
    const peers = peersOf(recs, cache.names || {}, hereDevice).filter((p) => Object.keys(p.db.chars).some((k) => own.chars[k]));
    // only characters this computer has: the view always shows this save's "now"
    peers.forEach((p) => Object.keys(p.db.chars).forEach((k) => { if (!own.chars[k]) delete p.db.chars[k]; }));
    if (!peers.length) return own;
    const out = M.merge(own, peers, 'this computer');
    out.syncedFrom = peers.map((p) => p.dev);
    return out;
  }

  // ------------------------------------------------------------------ the client
  // io: { fetch, loadState(), saveState(s), loadCache(), saveCache(c), now(), device: {name, os}, log }
  function client(io) {
    const rpc = async (fn, args) => {
      const r = await io.fetch(`${CONFIG.url}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers: { apikey: CONFIG.key, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
      const text = await r.text();
      if (!r.ok) { let m = text; try { m = JSON.parse(text).message || text; } catch (e) { /* plain text */ } throw new Error(m); }
      return text ? JSON.parse(text) : null;
    };
    let state = null, cache = null;
    const status = { ok: null, error: null, pushed: null, pulled: null, devices: [], busy: false, queued: 0 };

    // one at a time: the app window's cycle and a link click must not register this computer twice
    let readying = null;
    function ready() {
      if (!readying) readying = readyOnce().finally(() => { readying = null; });
      return readying;
    }
    async function loadState() {
      if (!state) state = Object.assign({ sent: {}, live: {}, settings: {}, settingsT: {}, pendingSince: {} }, (await io.loadState()) || {});
      return state;
    }
    async function readyOnce() {
      await loadState();
      // sync turned off on this computer (System tab): nothing goes out and nothing comes in
      if (state.off) { const e = new Error('sync is off on this computer'); e.off = true; throw e; }
      // the device key is made once by the local server (GET /api/sync), so two pages can't race
      if (!state.key || String(state.key).length < 32) { state = null; throw new Error('no device key yet (the app server makes it)'); }
      if (!state.account || !state.device) {
        const r = await rpc('cc_register', { p_key: state.key, p_name: (io.device || {}).name || null, p_os: (io.device || {}).os || null });
        state.account = r.account; state.device = r.device;
        await io.saveState(state);
      }
      if (!cache) cache = (await io.loadCache()) || null;
      if (!cache || cache.account !== state.account) cache = { account: state.account, after: 0, recs: {}, names: {} };
      return state;
    }

    // Settings, per key, the newest change wins. state.settings[k] = the value this computer and the
    // backend agree on; state.settingsT[k] = when it last changed (here or there). A value that differs
    // here is a local change: it goes with the next push, unless a newer one comes from elsewhere first.
    // Settings only go out after one pull, and after joining an account its settings win (adopt).
    function noteLocal(local) {
      Object.entries(local || {}).forEach(([k, v]) => {
        if (state.settings[k] !== v && !(state.pendingSince || {})[k]) (state.pendingSince = state.pendingSince || {})[k] = Math.round(io.now() / 1000);
        if (state.settings[k] === v && state.pendingSince) delete state.pendingSince[k];
      });
    }

    // send what's new in this save; returns how many records went
    async function push(db, local) {
      await ready();
      const all = recordsOf(db, state.device);
      const pending = all.filter((r) => {
        if (r.mutable) return state.live[r.id] !== hash(JSON.stringify(r.data));
        const hw = state.sent[r.char + '|' + r.kind];
        return hw == null || r.t >= hw;
      });
      if (state.pulledOnce) {
        noteLocal(local);
        Object.entries(local || {}).forEach(([k, v]) => {
          if (state.settings[k] === v) return;
          const t = (state.pendingSince || {})[k] || Math.round(io.now() / 1000);
          pending.push({ id: 'setting|' + k, char: '*', kind: 'setting', t, mutable: true, data: { k, v, t }, _setting: true });
        });
      }
      pending.sort((a, b) => a.t - b.t);
      status.queued = pending.length;
      let sent = 0;
      for (let i = 0; i < pending.length; i += BATCH) {
        const batch = pending.slice(i, i + BATCH);
        await rpc('cc_push', { p_key: state.key, p_records: batch.map(({ id, char, kind, t, data, mutable }) => ({ id, char, kind, t, data, mutable: !!mutable })) });
        for (const r of batch) {
          if (r._setting) { state.settings[r.data.k] = r.data.v; state.settingsT[r.data.k] = r.data.t; if (state.pendingSince) delete state.pendingSince[r.data.k]; }
          else if (r.mutable) state.live[r.id] = hash(JSON.stringify(r.data));
          else { const k = r.char + '|' + r.kind; state.sent[k] = Math.max(state.sent[k] == null ? -1 : state.sent[k], r.t); }
        }
        sent += batch.length;
        status.queued = pending.length - sent;
        await io.saveState(state);
      }
      status.pushed = new Date(io.now()).toISOString();
      return sent;
    }

    // a new account for this computer (it joined another): start over from the account's records
    function joined(account) {
      cache = { account, after: 0, recs: {}, names: {} };
      state.account = account; state.adopt = true; state.pulledOnce = false;
      state.settings = {}; state.settingsT = {}; state.pendingSince = {};
    }

    // fetch everything new on the account; returns { changed, settings: {k: v} to apply here }
    async function pull(local) {
      await ready();
      noteLocal(local);
      let changed = 0; const settings = {};
      for (let page = 0; page < 200; page++) {
        const r = await rpc('cc_pull', { p_key: state.key, p_after: cache.after, p_limit: 2000 });
        if (r.account !== cache.account) {
          // joined another account (here, on another computer of the old one, or by Claude on the backend)
          if (cache.account) joined(r.account); else cache.account = r.account;
          state.account = r.account; await io.saveState(state); continue;
        }
        status.devices = r.devices || [];
        (r.devices || []).forEach((d) => { cache.names[d.id] = d.name ? `${d.name}${d.os ? ' (' + d.os + ')' : ''}` : d.os || 'other computer'; });
        for (const x of r.records || []) {
          cache.after = Math.max(cache.after, x.seq);
          if (x.kind === 'setting') {
            const d = x.data || {};
            if (x.dev === state.device || typeof d.v !== 'string' || typeof d.k !== 'string') continue;
            const t = Number(d.t || x.t) || 0;
            const pendingHere = local && local[d.k] !== undefined && local[d.k] !== state.settings[d.k];
            if (state.adopt || !pendingHere || t > ((state.pendingSince || {})[d.k] || 0)) {
              settings[d.k] = d.v; state.settings[d.k] = d.v; state.settingsT[d.k] = t;
              if (state.pendingSince) delete state.pendingSince[d.k];
            }
            continue;
          }
          cache.recs[x.id] = { dev: x.dev, char: x.char, kind: x.kind, t: x.t, data: x.data };
          changed++;
        }
        if ((r.records || []).length < 2000) break;
      }
      state.adopt = false; state.pulledOnce = true;
      await io.saveState(state);
      if (changed) await io.saveCache(cache);
      status.pulled = new Date(io.now()).toISOString();
      return { changed, settings };
    }

    // this computer's snapshot (what companion-data/snapshot.json has: where the character is, the
    // quest log, gear advice...) as one replaced record, so Claude can read every computer's "now"
    // online. Other computers don't pull it. Sent only when it changed (written/by don't count).
    async function pushSnapshot(snap) {
      if (!snap) return false;
      await ready();
      const data = Object.assign({}, snap); delete data.written; delete data.by;
      const body = JSON.stringify(data), h = hash(body), id = 'snapshot|' + state.device;
      if (state.live[id] === h) return false;
      if (body.length > 2000000) throw new Error('the snapshot is too big to send');
      const t = Math.round((Date.parse(snap.savedInGame || snap.written || '') || io.now()) / 1000);
      await rpc('cc_push', { p_key: state.key, p_records: [{ id, char: '*', kind: 'snapshot', t, data, mutable: true }] });
      state.live[id] = h; await io.saveState(state);
      return true;
    }

    async function linkCode() { await ready(); return rpc('cc_link_code', { p_key: state.key }); }
    async function link(code) {
      await ready();
      const r = await rpc('cc_link', { p_key: state.key, p_code: code });
      if (r.error) throw new Error(r.error);
      joined(r.account); await io.saveState(state);
      return r;
    }

    // turn sync off (or back on) for this computer. Off keeps everything: what's not sent yet stays
    // marked "not sent" and goes when it's turned back on; what's online stays online.
    async function isOff() { await loadState(); return !!state.off; }
    async function setOff(off) {
      await loadState();
      if (off) state.off = true; else delete state.off;
      await io.saveState(state);
    }

    return {
      ready, push, pull, pushSnapshot, linkCode, link, isOff, setOff, status,
      get state() { return state; }, get cache() { return cache; },
      view: (own) => view(own, cache, state && state.device),
    };
  }

  const api = { CONFIG, hash, recordsOf, peersOf, view, client };
  if (typeof module !== 'undefined') module.exports = api;
  root.CCSync = api;

  // ------------------------------------------------------------------ in the app
  if (typeof window === 'undefined' || !window.CC || !location.protocol.startsWith('http')) return;
  const CC = window.CC, A = CC.api;
  const BACKGROUND = new URLSearchParams(location.search).has('background');
  const getJson = (u) => fetch(u, { cache: 'no-store' }).then((r) => (r.status === 200 ? r.json() : null)).catch(() => null);
  const putJson = (u, o) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body: JSON.stringify(o) })
    .then((r) => { if (!r.ok) throw new Error('the local server did not save ' + u); });
  // settings that belong to this computer only
  const LOCAL_ONLY = /^cc\.(update|sync)\./;
  const settingsNow = () => {
    const d = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('cc.') && !LOCAL_ONLY.test(k)) d[k] = localStorage.getItem(k); }
    return d;
  };
  const C = client({
    fetch: (u, o) => fetch(u, o), now: () => Date.now(),
    loadState: () => getJson('api/sync'), saveState: (s) => putJson('api/sync', s),
    loadCache: () => getJson('api/sync-cache'), saveCache: (c) => putJson('api/sync-cache', c),
    get device() { return { name: (A.STATE.device || {}).host || null, os: (A.STATE.device || {}).os || null }; },
  });
  CC.sync = C;
  CC.syncView = (db) => (C.cache && !(C.state || {}).off ? C.view(db) : db);

  let running = null, again = false, lastPull = 0, viewed = false;
  async function cycle() {
    if (running) { again = true; return running; }
    running = (async () => {
      C.status.busy = true;
      try {
        // this browser's settings are the ones in companion-data/settings.json (js/claude.js loads them
        // first), in the app window and in the hidden browser alike
        if (CC.settingsReady) await CC.settingsReady;
        C.status.off = await C.isOff();
        if (C.status.off) return;
        // pull first: settings from elsewhere are weighed against changes here before anything goes out
        const r = await C.pull(settingsNow());
        const apply = Object.entries(r.settings).filter(([k, v]) => !LOCAL_ONLY.test(k) && localStorage.getItem(k) !== v);
        apply.forEach(([k, v]) => localStorage.setItem(k, v));
        if (apply.length) await putJson('api/settings', Object.assign({}, settingsNow(), Object.fromEntries(
          Object.keys(localStorage).filter((k) => LOCAL_ONLY.test(k)).map((k) => [k, localStorage.getItem(k)]))));
        const raw = A.RAW;
        if (raw && raw.chars) await C.push(raw, settingsNow());
        if (CC.lastSnapshot) await C.pushSnapshot(CC.lastSnapshot);
        lastPull = Date.now();
        const changedSettings = Object.keys(r.settings).length > 0;
        C.status.ok = true; C.status.error = null;
        // the first time (cache read from disk) and whenever something new came in
        if ((r.changed || changedSettings || !viewed) && A.RAW) { viewed = true; CC.reload(); }
      } catch (e) {
        if (e && e.off) C.status.off = true;
        else { C.status.ok = false; C.status.error = String((e && e.message) || e); }
      } finally {
        C.status.busy = false;
        running = null;
        if (A.CH && A.STATE.tab === 'system') A.render();
      }
      if (again) { again = false; return cycle(); }
    })();
    return running;
  }
  CC.syncNow = cycle;
  // after every save the app reads (cc:loaded fires once per new save, and after a merge reload)
  let lastStamp = null;
  document.addEventListener('cc:loaded', () => {
    if (A.STATE.saveStamp === lastStamp && Date.now() - lastPull < 5 * 60 * 1000) return;
    lastStamp = A.STATE.saveStamp;
    setTimeout(cycle, 300);
  });
  // System tab: where sync stands, the computers on this account, and linking another computer
  const V = CC.V, baseSystem = V.system;
  let linkMsg = '', codeTyped = '';   // what's typed in the code field survives a re-render
  V.system = function () {
    const st = C.status, s = C.state || {};
    const esc = A.esc, when = (x) => (x ? A.ago(Date.parse(x) / 1000) : 'not yet');
    const devs = (st.devices || []).map((d) => `<div class="li"><div class="grow">${esc(d.name || d.os || 'computer')}${d.id === s.device ? ' <span class="dim">(this one)</span>' : ''}<div class="sub">${esc((d.chars || []).join(', ') || 'no characters yet')}</div></div><div class="num dim small">seen ${when(d.seen)}</div></div>`).join('');
    if (st.off) {
      return `<h2>Sync between computers</h2><p class="meta">Sync is off on this computer. Nothing is sent or fetched, and the app shows only this computer's save. What was sent before stays online, and anything new goes when you turn it back on.</p>
      <div class="toolbar linkbar"><button class="btn" data-sync="on">Turn sync on</button></div>` + baseSystem();
    }
    const state = st.busy ? 'Syncing…' : st.ok === false ? `<span class="neg">Not synced: ${esc(st.error)}</span> <span class="dim">(it keeps what's new and tries again)</span>`
      : st.ok ? `Synced · sent ${when(st.pushed)} · checked ${when(st.pulled)}` : 'Starting…';
    let h = `<h2>Sync between computers</h2><p class="meta">Your history (journal, grinds, runs, AH prices and sales, settings) is kept online and shared by your computers. Your bags, gear, quests and the rest of what you have now come from whichever computer saved last.</p>
      <p>${state}${st.queued ? ` · ${st.queued} waiting to send` : ''}</p>
      ${devs ? `<div class="list">${devs}</div>` : ''}
      <div class="toolbar linkbar"><button class="btn ghost" data-sync="code">Link another computer</button>
      <span class="row"><input class="field code" id="cc-link-code" placeholder="Code from the other computer" maxlength="12" autocomplete="off" spellcheck="false" value="${esc(codeTyped)}"><button class="btn" data-sync="join">Join</button></span></div>
      ${linkMsg ? `<p class="meta">${linkMsg}</p>` : ''}
      <div class="toolbar"><button class="btn ghost" data-sync="off">Turn sync off on this computer</button></div>`;
    return h + baseSystem();
  };
  document.addEventListener('input', (e) => { if (e.target && e.target.id === 'cc-link-code') codeTyped = e.target.value; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.id === 'cc-link-code') { const j = document.querySelector('[data-sync="join"]'); if (j) j.click(); } });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sync]');
    if (!b) return;
    try {
      if (b.dataset.sync === 'off' || b.dataset.sync === 'on') {
        const off = b.dataset.sync === 'off';
        await C.setOff(off);
        C.status.off = off; linkMsg = '';
        if (off) CC.reload(); else { viewed = false; cycle(); }
      } else if (b.dataset.sync === 'code') {
        const r = await C.linkCode();
        const shown = String(r.code).replace(/^(.{4})(.{4})$/, '$1 $2');
        linkMsg = `On your other computer, open System and enter <span class="code">${A.esc(shown)}</span> (works once, for 30 minutes).`;
      } else {
        const code = (document.getElementById('cc-link-code') || {}).value || '';
        if (!code.trim()) return;
        await C.link(code);
        linkMsg = 'Linked. This computer now shares history with the other one.'; codeTyped = '';
        viewed = false; cycle();
      }
    } catch (err) { linkMsg = `<span class="neg">${A.esc(err.message || err)}</span>`; }
    A.render();
  });

  // the other computer may be playing: look for its news every 2 minutes while the app is open
  if (!BACKGROUND) setInterval(() => { if (document.visibilityState === 'visible' || Date.now() - lastPull > 10 * 60 * 1000) cycle(); }, 2 * 60 * 1000);
})(typeof window !== 'undefined' ? window : globalThis);
