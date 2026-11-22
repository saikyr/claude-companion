// Claude Companion: one character across computers.
// The PC and the Mac each keep their own SavedVariables (the game writes them, so they can't be
// shared directly). Each computer's server publishes its save to the others (server.py / server.ps1,
// "sync"); the page merges them here into one ClaudeCompanionDB before showing anything or writing
// snapshot.json, so every computer shows the same character and Claude reads one picture.
//
// Rules, per character (same "Name-Realm" key):
//  - history that only grows (journal, finished sessions / grinds / runs, notes, AH sales, buys,
//    posts, price observations, disenchant results, history) is the union of both, without
//    duplicates, in time order; entries from another computer carry dev = that computer
//  - "what it's like now" (bags, gear, bank, mail, professions, specs, flight paths, the running
//    session / grind / run) comes from whichever computer saw it last (each part has its own time)
//  - a grind or run still marked running on a computer whose save is older than another computer's
//    play is not running any more: it's shown as ended "away", like the addon itself would
// Nothing here writes to either save.
(function (root) {
  const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map((k) => x[k]) : []);
  const num = (x) => (typeof x === 'number' ? x : 0);

  // a stable identity for a journal entry: time, kind and what it was about
  function evKey(e) {
    return [e.t, e.e, e.name || e.title || e.item || e.link || e.to || e.text || '', e.amount != null ? e.amount : e.count != null ? e.count : e.quest || ''].join('|');
  }
  function unionBy(lists, key, sortKey) {
    const seen = new Map();
    // identical entries inside one save are separate events (three stacks looted in the same second):
    // the nth copy in one save matches the nth copy in the other, so none is lost and none doubled
    lists.forEach(([list, dev]) => { const nth = new Map(); arr(list).forEach((x) => {
      if (!x || typeof x !== 'object') return;
      const k0 = key(x);
      const n = (nth.get(k0) || 0) + 1; nth.set(k0, n);
      const k = k0 + '#' + n;
      if (!seen.has(k)) seen.set(k, dev ? Object.assign({ dev }, x) : x);
    }); });
    const out = [...seen.values()];
    if (sortKey) out.sort((a, b) => num(sortKey(a)) - num(sortKey(b)));
    return out;
  }
  const newest = (cands, t) => cands.filter((c) => c.v != null).sort((a, b) => num(t(b.v)) - num(t(a.v)))[0];

  function mergeChar(parts) {
    // parts: [{ c, dev, here, seen }] for one character; seen = when that computer last saw it
    const base = parts.find((p) => p.here) || parts[0];
    const out = Object.assign({}, base.c);
    const others = (p) => (p.here ? null : p.dev);
    const all = (field) => parts.map((p) => [p.c[field], others(p)]);
    out.journal = unionBy(all('journal'), evKey, (e) => e.t);
    out.notes = unionBy(all('notes'), (n) => n.t + '|' + n.text, (n) => n.t);
    out.history = unionBy(all('history'), (h) => JSON.stringify([h.t, h.level, h.money]), (h) => h.t);
    const tracker = (t) => [t.start || t.id, t.name || ''].join('|');
    out.sessions = unionBy(all('sessions'), tracker, (s) => s.start);
    out.grinds = unionBy(all('grinds'), tracker, (s) => s.start);
    out.runs = unionBy(all('runs'), tracker, (s) => s.start);
    out.deResults = unionBy(all('deResults'), (d) => JSON.stringify([d.t, d.item]), (d) => d.t);
    // the latest-seen copy of each "now" part
    const pick = (field, t) => { const n = newest(parts.map((p) => ({ v: p.c[field] })), t); return n ? n.v : undefined; };
    out.snap = pick('snap', (s) => s.taken);
    out.bank = pick('bank', (b) => b.taken);
    out.mail = pick('mail', (m) => m.taken);
    const byName = (field, t) => {
      const m = {};
      parts.forEach((p) => Object.entries(p.c[field] || {}).forEach(([k, v]) => { if (!m[k] || num(t(v)) > num(t(m[k]))) m[k] = v; }));
      return m;
    };
    out.professions = byName('professions', (x) => x && x.taken);
    out.specs = byName('specs', (x) => x && (x.talentsTaken || x.barsTaken));
    out.taxi = byName('taxi', (x) => x && x.last);
    out.taxiRead = byName('taxiRead', (x) => x);
    out.lastSeen = Math.max(...parts.map((p) => num(p.c.lastSeen)));
    // running trackers: only from the computer that saw the character last
    const latest = parts.slice().sort((a, b) => num(b.seen) - num(a.seen))[0];
    out.session = latest.c.session;
    const live = (field, list) => {
      const p = parts.find((x) => x.c[field]);
      if (!p) return undefined;
      if (p === latest || num(p.c[field].last) >= num(latest.seen) - 120) return p.c[field];
      // played elsewhere after this one stopped: it ended when last counted, like the addon's "away"
      const ended = Object.assign({}, p.c[field], { finish: p.c[field].last || p.c[field].start, ended: 'away', dev: others(p) || undefined });
      if (!out[list].some((x) => tracker(x) === tracker(ended))) out[list].push(ended);
      return undefined;
    };
    out.grind = live('grind', 'grinds');
    out.run = live('run', 'runs');
    // auction house: prices are observations over time, kept from both
    const ah = Object.assign({}, base.c.ah || {});
    const prices = {};
    parts.forEach((p) => Object.entries((p.c.ah || {}).prices || {}).forEach(([k, pr]) => {
      const cur = prices[k];
      if (!cur) { prices[k] = Object.assign({}, pr, { obs: arr(pr.obs).slice() }); return; }
      cur.obs = unionBy([[cur.obs], [pr.obs]], (o) => o.t + '|' + (o.src || ''), (o) => o.t);
      cur.last = Math.max(num(cur.last), num(pr.last));
    }));
    ah.prices = prices;
    for (const f of ['sales', 'buys', 'posts']) ah[f] = unionBy(parts.map((p) => [(p.c.ah || {})[f], others(p)]), (x) => JSON.stringify([x.t, x.item || x.link || x.name, x.price || x.net || x.unit]), (x) => x.t);
    const scanned = pick('ah', (a) => (a.lastScan || {}).t);
    if (scanned && scanned.lastScan) ah.lastScan = scanned.lastScan;
    ah.owned = (pick('ah', (a) => (a.owned || {}).taken) || {}).owned || ah.owned;
    ah.scans = parts.reduce((a, p) => a + num((p.c.ah || {}).scans), 0);
    out.ah = ah;
    out.devices = parts.map((p) => ({ dev: p.dev, here: !!p.here, seen: p.seen || null }));
    return out;
  }

  // own: this computer's ClaudeCompanionDB; peers: [{ dev, db, savedAt }]. Returns a new DB.
  function merge(own, peers, hereDev) {
    peers = (peers || []).filter((p) => p && p.db && p.db.chars);
    if (!peers.length) return own;
    const out = Object.assign({}, own);
    for (const f of ['items', 'spells', 'npcs', 'quests']) {
      out[f] = Object.assign({}, ...peers.map((p) => p.db[f] || {}), own[f] || {});
    }
    const keys = new Set([...Object.keys(own.chars || {}), ...peers.flatMap((p) => Object.keys(p.db.chars))]);
    out.chars = {};
    for (const k of keys) {
      const parts = [];
      if (own.chars && own.chars[k]) parts.push({ c: own.chars[k], dev: hereDev || 'here', here: true, seen: num(own.chars[k].lastSeen) || num((own.chars[k].snap || {}).taken) });
      peers.forEach((p) => { const c = p.db.chars[k]; if (c) parts.push({ c, dev: p.dev, here: false, seen: num(c.lastSeen) || num((c.snap || {}).taken) }); });
      out.chars[k] = parts.length === 1 && parts[0].here ? parts[0].c : mergeChar(parts);
    }
    out.mergedFrom = [hereDev || 'here', ...peers.map((p) => p.dev)];
    return out;
  }

  const api = { merge, mergeChar, evKey };
  if (typeof module !== 'undefined') module.exports = api;
  root.CCMerge = api;
})(typeof window !== 'undefined' ? window : globalThis);
