// Claude Companion: history sync between computers (docs/ARCHITECTURE.md, "Sync between computers").
//
// The game server is the truth for how your character is NOW (gear, bags, quests, rep, skills), and
// every computer reads that from its own save. What only the addon remembers is HISTORY: the journal,
// grinds, dungeon runs, sessions, AH prices / sales / buys / posts, disenchant results, notes, plus the
// app's settings (gear weights and picks). That is what syncs, through a small Supabase backend:
//
//  - every record has an id made from its content (character, kind, time, what it was), so the same
//    event seen by two computers is ONE record, a re-send changes nothing, and there are no conflicts
//  - each computer sends what is new in its save after every save it sees (each /reload, /cc sync,
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
  const KINDS = [
    // [kind, list, identity, time]
    ['journal', (c) => c.journal, evKey, (e) => e.t],
    ['session', (c) => c.sessions, tracker, (x) => x.finish || x.last || x.start],
    ['grind', (c) => c.grinds, tracker, (x) => x.finish || x.last || x.start],
    ['run', (c) => c.runs, tracker, (x) => x.finish || x.last || x.start],
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
    const y = Object.assign({}, x); delete y.loot; delete y.groupLoot; delete y.killsBy; y.slim = true;
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
          out.push({ id: `${ck}|${kind}|${t}|${hash(k0)}${n > 1 ? '#' + n : ''}`, char: ck, kind, t, data: x });
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

    async function ready() {
      if (!state) state = Object.assign({ sent: {}, live: {}, settings: {} }, (await io.loadState()) || {});
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

    // send what's new in this save; returns how many records went
    async function push(db, settings) {
      await ready();
      const all = recordsOf(db, state.device);
      const pending = all.filter((r) => {
        if (r.mutable) return state.live[r.id] !== hash(JSON.stringify(r.data));
        const hw = state.sent[r.char + '|' + r.kind];
        return hw == null || r.t >= hw;
      });
      // settings: last writer wins, per key
      Object.entries(settings || {}).forEach(([k, v]) => {
        if (state.settings[k] === v) return;
        pending.push({ id: 'setting|' + k, char: '*', kind: 'setting', t: Math.round(io.now() / 1000), mutable: true, data: { k, v }, _setting: true });
      });
      pending.sort((a, b) => a.t - b.t);
      status.queued = pending.length;
      let sent = 0;
      for (let i = 0; i < pending.length; i += BATCH) {
        const batch = pending.slice(i, i + BATCH);
        await rpc('cc_push', { p_key: state.key, p_records: batch.map(({ id, char, kind, t, data, mutable }) => ({ id, char, kind, t, data, mutable: !!mutable })) });
        for (const r of batch) {
          if (r._setting) state.settings[r.data.k] = r.data.v;
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

    // fetch everything new on the account; returns { changed, settings: {k: v} from other computers }
    async function pull() {
      await ready();
      let changed = 0; const settings = {};
      for (let page = 0; page < 200; page++) {
        const r = await rpc('cc_pull', { p_key: state.key, p_after: cache.after, p_limit: 2000 });
        if (r.account !== cache.account) { cache = { account: r.account, after: 0, recs: {}, names: {} }; state.account = r.account; await io.saveState(state); continue; }
        status.devices = r.devices || [];
        (r.devices || []).forEach((d) => { cache.names[d.id] = d.name ? `${d.name}${d.os ? ' (' + d.os + ')' : ''}` : d.os || 'other computer'; });
        for (const x of r.records || []) {
          cache.after = Math.max(cache.after, x.seq);
          if (x.kind === 'setting') {
            if (x.dev !== state.device && x.data && typeof x.data.v === 'string') { settings[x.data.k] = x.data.v; state.settings[x.data.k] = x.data.v; }
            continue;
          }
          cache.recs[x.id] = { dev: x.dev, char: x.char, kind: x.kind, t: x.t, data: x.data };
          changed++;
        }
        if ((r.records || []).length < 2000) break;
      }
      if (changed || Object.keys(settings).length) { await io.saveCache(cache); await io.saveState(state); }
      status.pulled = new Date(io.now()).toISOString();
      return { changed, settings };
    }

    async function linkCode() { await ready(); return rpc('cc_link_code', { p_key: state.key }); }
    async function link(code) {
      await ready();
      const r = await rpc('cc_link', { p_key: state.key, p_code: code });
      state.account = r.account; await io.saveState(state);
      cache = { account: r.account, after: 0, recs: {}, names: {} };
      return r;
    }

    return {
      ready, push, pull, linkCode, link, status,
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
  CC.syncView = (db) => (C.cache ? C.view(db) : db);

  let running = null, again = false, lastPull = 0, viewed = false;
  async function cycle() {
    if (running) { again = true; return running; }
    running = (async () => {
      C.status.busy = true;
      try {
        const raw = A.RAW;
        if (raw && raw.chars) await C.push(raw, BACKGROUND ? {} : settingsNow());
        const r = await C.pull();
        lastPull = Date.now();
        let changedSettings = false;
        Object.entries(r.settings).forEach(([k, v]) => { if (!LOCAL_ONLY.test(k) && localStorage.getItem(k) !== v) { localStorage.setItem(k, v); changedSettings = true; } });
        C.status.ok = true; C.status.error = null;
        // the first time (cache read from disk) and whenever something new came in
        if ((r.changed || changedSettings || !viewed) && A.RAW) { viewed = true; CC.reload(); }
      } catch (e) {
        C.status.ok = false; C.status.error = String((e && e.message) || e);
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
  let linkMsg = '';
  V.system = function () {
    const st = C.status, s = C.state || {};
    const esc = A.esc, when = (x) => (x ? A.ago(Date.parse(x) / 1000) : 'not yet');
    const devs = (st.devices || []).map((d) => `<div class="li"><div class="grow">${esc(d.name || d.os || 'computer')}${d.id === s.device ? ' <span class="dim">(this one)</span>' : ''}<div class="sub">${esc((d.chars || []).join(', ') || 'no characters yet')}</div></div><div class="num dim small">seen ${when(d.seen)}</div></div>`).join('');
    const state = st.busy ? 'Syncing…' : st.ok === false ? `<span class="neg">Not synced: ${esc(st.error)}</span> <span class="dim">(it keeps what's new and tries again)</span>`
      : st.ok ? `Synced · sent ${when(st.pushed)} · checked ${when(st.pulled)}` : 'Starting…';
    let h = `<h2>Sync between computers</h2><p class="meta">Your history (journal, grinds, runs, AH prices and sales, settings) is kept online and shared by your computers. What you wear and carry always comes from this computer's save.</p>
      <p>${state}${st.queued ? ` · ${st.queued} waiting to send` : ''}</p>
      ${devs ? `<div class="list">${devs}</div>` : ''}
      <div class="row wrap" style="gap:.5rem;margin-top:.75rem"><button class="btn" data-sync="code">Link another computer</button>
      <input id="cc-link-code" placeholder="Code from your other computer" maxlength="12" style="width:14rem"><button class="btn" data-sync="join">Join</button></div>
      ${linkMsg ? `<p class="small">${linkMsg}</p>` : ''}`;
    return h + baseSystem();
  };
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sync]');
    if (!b) return;
    try {
      if (b.dataset.sync === 'code') {
        const r = await C.linkCode();
        linkMsg = `On your other computer, open System and enter <b>${A.esc(r.code)}</b> (works for 30 minutes).`;
      } else {
        const code = (document.getElementById('cc-link-code') || {}).value || '';
        if (!code.trim()) return;
        await C.link(code);
        linkMsg = 'Linked. This computer now shares history with the other one.';
        viewed = false; cycle();
      }
    } catch (err) { linkMsg = `<span class="neg">${A.esc(err.message || err)}</span>`; }
    A.render();
  });

  // the other computer may be playing: look for its news every 2 minutes while the app is open
  if (!BACKGROUND) setInterval(() => { if (document.visibilityState === 'visible' || Date.now() - lastPull > 10 * 60 * 1000) cycle(); }, 2 * 60 * 1000);
})(typeof window !== 'undefined' ? window : globalThis);
