// An in-memory copy of the sync backend's rules (supabase/migrations/20261122140000_sync.sql), for
// test/web/sync.test.js and the browser check test/web/sync-browser.js. Same calls, same answers.
const crypto = require('crypto');

function memoryBackend() {
  const accounts = new Map();   // id -> { merged_into }
  const devices = new Map();    // key hash -> { id, account, name, os, chars }
  const records = new Map();    // account|id -> record
  const codes = new Map();      // account -> { code, expires }
  let seq = 0, down = false;
  const sha = (k) => crypto.createHash('sha256').update(k).digest('hex');
  const dev = (key) => { const d = (key || '').length >= 32 && devices.get(sha(key)); if (!d) throw new Error('unknown device'); return d; };
  const group = (root) => new Set([...accounts.entries()].filter(([id, a]) => id === root || a.merged_into === root).map(([id]) => id));
  const fns = {
    cc_register({ p_key, p_name, p_os }) {
      if (!p_key || p_key.length < 32 || p_key.length > 200) throw new Error('bad device key');
      let d = devices.get(sha(p_key));
      if (!d) {
        const acc = crypto.randomUUID(); accounts.set(acc, { merged_into: null });
        d = { id: crypto.randomUUID(), account: acc, name: p_name, os: p_os, chars: [] }; devices.set(sha(p_key), d);
      }
      return { account: d.account, device: d.id };
    },
    cc_push({ p_key, p_records }) {
      const d = dev(p_key);
      if (!Array.isArray(p_records) || p_records.length > 1000) throw new Error('send an array of at most 1000 records');
      if (p_records.some((x) => !x.id || x.id.length > 400 || !x.char || !x.kind || x.data == null || JSON.stringify(x.data).length > 65536)) throw new Error('bad record');
      const g = group(d.account);
      let n = 0;
      for (const x of p_records) {
        const k = d.account + '|' + x.id, cur = records.get(k);
        if (!x.mutable && [...g].some((a) => records.has(a + '|' + x.id))) continue;   // another computer of the account sent it
        if (!cur) { records.set(k, { account: d.account, id: x.id, dev: d.id, char: x.char, kind: x.kind, t: x.t, data: x.data, mutable: !!x.mutable, seq: ++seq }); n++; }
        else if (cur.mutable && x.mutable && JSON.stringify(cur.data) !== JSON.stringify(x.data)) { Object.assign(cur, { data: x.data, t: x.t, dev: d.id, seq: ++seq }); n++; }
        if (x.char !== '*' && !d.chars.includes(x.char)) d.chars.push(x.char);
      }
      return { stored: n, account: d.account, device: d.id };
    },
    cc_pull({ p_key, p_after, p_limit }) {
      const d = dev(p_key), g = group(d.account);
      const out = [...records.values()].filter((r) => g.has(r.account) && r.seq > (p_after || 0) && !(r.mutable && r.dev === d.id))
        .sort((a, b) => a.seq - b.seq).slice(0, Math.min(Math.max(p_limit || 2000, 1), 5000))
        .map((r) => ({ id: r.id, dev: r.dev, char: r.char, kind: r.kind, t: r.t, data: r.data, mutable: r.mutable, seq: r.seq }));
      return { account: d.account, device: d.id, records: out,
        devices: [...devices.values()].filter((x) => x.account === d.account).map((x) => ({ id: x.id, name: x.name, os: x.os, chars: x.chars, seen: null })) };
    },
    cc_link_code({ p_key }) {
      const d = dev(p_key), code = crypto.randomBytes(4).toString('hex').toUpperCase();
      codes.set(d.account, { code, expires: Date.now() + 30 * 60 * 1000 });
      return { code };
    },
    cc_link({ p_key, p_code }) {
      const d = dev(p_key), want = String(p_code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const hit = [...codes.entries()].find(([, c]) => c.code === want && c.expires > Date.now());
      if (!hit) throw new Error('that code is wrong or has expired');
      const target = hit[0], rootFrom = accounts.get(d.account).merged_into || d.account, rootInto = accounts.get(target).merged_into || target;
      if (rootFrom !== rootInto) {
        const joining = group(rootFrom);
        joining.forEach((a) => { accounts.get(a).merged_into = rootInto; });
        for (const x of devices.values()) if (x.account === rootFrom) x.account = rootInto;
        [...records.values()].filter((r) => joining.has(r.account)).sort((a, b) => a.seq - b.seq).forEach((r) => { r.seq = ++seq; });
      }
      hit[1].expires = Date.now();
      return { account: target, device: d.id };
    },
  };
  const fetch = async (url, opts) => {
    if (down) throw new TypeError('Failed to fetch');
    const fn = url.split('/rpc/')[1];
    try { const r = fns[fn](JSON.parse(opts.body)); return { ok: true, status: 200, text: async () => JSON.stringify(r) }; }
    catch (e) { return { ok: false, status: 400, text: async () => JSON.stringify({ message: e.message }) }; }
  };
  return { fetch, fns, records, devices, accounts, set down(v) { down = v; } };
}
module.exports = { memoryBackend };
