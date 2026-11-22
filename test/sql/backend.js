// The real sync backend for tests: a fresh database on a plain Postgres, with test/sql/prelude.sql
// (what Supabase already has) and every file in supabase/migrations applied in order. Calls go
// through psql as the anon role, the way the app's calls reach the functions on Supabase.
// Connection: the usual PGHOST / PGPORT / PGUSER (CI: a postgres service; locally any Postgres 15+).
const { spawnSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

function psql(db, sql) {
  const r = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', db], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error) throw r.error;
  if (r.status !== 0) { const m = /ERROR:\s+(.*)/.exec(r.stderr || ''); throw new Error(m ? m[1].trim() : (r.stderr || 'psql failed').trim()); }
  return r.stdout.trim();
}
// the same, without waiting: calls from several "computers" run at the same time, as on Supabase
function psqlAsync(db, sql) {
  return new Promise((resolve, reject) => {
    const p = spawn('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', db]);
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) return resolve(out.trim());
      const m = /ERROR:\s+(.*)/.exec(err); reject(new Error(m ? m[1].trim() : (err || 'psql failed').trim()));
    });
    p.stdin.end(sql);
  });
}
const lit = (v) => { const tag = '$q' + crypto.randomBytes(8).toString('hex') + '$'; return tag + String(v) + tag; };

function sqlBackend() {
  const db = 'cc_sync_test_' + crypto.randomBytes(4).toString('hex');
  psql('postgres', `create database ${db};`);
  psql(db, fs.readFileSync(path.join(__dirname, 'prelude.sql'), 'utf8'));
  const dir = path.join(ROOT, 'supabase', 'migrations');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) psql(db, fs.readFileSync(path.join(dir, f), 'utf8'));
  let down = false, ip = '203.0.113.7';
  const TYPES = { p_records: 'jsonb', p_after: 'bigint', p_limit: 'int' };
  // one API call, as the anon role, with the headers Supabase passes on
  function sqlOf(fn, args) {
    if (!/^cc_[a-z_]+$/.test(fn)) throw new Error('not an API function');
    const list = Object.entries(args || {}).filter(([, v]) => v != null)
      .map(([k, v]) => `${k} => ${lit(typeof v === 'object' ? JSON.stringify(v) : v)}${TYPES[k] ? '::' + TYPES[k] : ''}`);
    return `select set_config('request.headers', ${lit(JSON.stringify({ 'cf-connecting-ip': ip }))}, false);
set role anon;
select public.${fn}(${list.join(', ')})::text;`;
  }
  const call = (fn, args) => JSON.parse(psql(db, sqlOf(fn, args)).split('\n').pop());
  const fetch = async (url, opts) => {
    if (down) throw new TypeError('Failed to fetch');
    try {
      const r = JSON.parse((await psqlAsync(db, sqlOf(url.split('/rpc/')[1], JSON.parse(opts.body)))).split('\n').pop());
      return { ok: true, status: 200, text: async () => JSON.stringify(r) };
    }
    catch (e) { return { ok: false, status: 400, text: async () => JSON.stringify({ message: e.message }) }; }
  };
  return {
    db, fetch, call,
    query: (sql) => psql(db, sql),                                  // as the owner, for checks
    queryAsync: (sql) => psqlAsync(db, sql),                        // the same, without waiting (overlapping transactions)
    sqlOf,
    set down(v) { down = v; }, set ip(v) { ip = v; },
    drop() { try { psql('postgres', `drop database if exists ${db} with (force);`); } catch (e) { /* best effort */ } },
  };
}
module.exports = { sqlBackend, psql };
