// node test/contract.test.js [base ref, e.g. origin/main]
// The contract between the parts (docs/INTERFACES.md): the addon, the two local servers,
// the app page and the sync backend are written separately, so this checks that they still agree.
// Each check names the one place that owns the fact.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'ClaudeCompanion');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const one = (re, text, what) => { const m = re.exec(text); if (!m) { check(false, what + ': not found'); return null; } return m[1]; };

// 1. One version: the .toc owns it (the game shows it); Core.lua and the changelog say the same.
const toc = read(A, 'ClaudeCompanion.toc');
const core = read(A, 'Core.lua');
const ver = one(/^## Version:\s*(\S+)/m, toc, 'toc version');
check(one(/^ns\.VERSION = "([^"]+)"/m, core, 'Core.lua ns.VERSION') === ver, `Core.lua ns.VERSION is the .toc version (${ver})`);
check(one(/^## (\S+)/m, read(ROOT, 'CHANGELOG.md'), 'CHANGELOG heading') === ver, `the newest CHANGELOG.md section is ${ver}`);
// every file the .toc loads exists, and every addon Lua file is loaded
const tocFiles = toc.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim());
const luaFiles = fs.readdirSync(A).filter((f) => f.endsWith('.lua'));
check(tocFiles.every((f) => fs.existsSync(path.join(A, f))), 'every file the .toc loads exists');
check(luaFiles.every((f) => tocFiles.includes(f)), 'every addon .lua file is in the .toc (no dead files)');

// 2. The build stamp: publish-stable.py replaces exactly this line with the build's commit.
check((core.match(/^ns\.BUILD = "dev"$/mg) || []).length === 1, 'Core.lua has one ns.BUILD = "dev" line (stamped per build)');
check(/db\.addonBuild = ns\.BUILD/.test(core), 'the addon saves its build (ClaudeCompanionDB.addonBuild), which the servers read');

// 3. Save schema (ClaudeCompanionDB): Core.lua owns it, its header and the architecture doc agree.
const saveSchema = one(/^ns\.SCHEMA = (\d+)/m, core, 'Core.lua ns.SCHEMA');
check(one(/Layout \(schema (\d+)\)/, core, 'Core.lua layout comment') === saveSchema, `Core.lua's layout comment says schema ${saveSchema}`);
check(one(/`ClaudeCompanionDB`\*\* \(SavedVariables, `schema = (\d+)`\)/, read(ROOT, 'docs', 'INTERFACES.md'), 'INTERFACES save schema') === saveSchema,
  'docs/INTERFACES.md names the same save schema');

// 4. snapshot.json schema: js/claude.js writes it, companion-data/SCHEMA.md documents it.
const snap = one(/const SCHEMA = (\d+);/, read(A, 'web', 'js', 'claude.js'), 'claude.js SCHEMA');
check(one(/## snapshot\.json, schema (\d+)/, read(A, 'companion-data', 'SCHEMA.md'), 'SCHEMA.md snapshot schema') === snap, `snapshot.json schema ${snap} in claude.js and SCHEMA.md`);

// 5. Local HTTP API: the Mac and Windows servers answer the same paths, and the page only calls those.
const routes = (text) => new Set((text.match(/'\/api\/[a-z-]+'/g) || []).map((s) => s.slice(1, -1)));
const py = routes(read(A, 'web', 'server.py'));
const ps = routes(read(A, 'web', 'server.ps1'));
const onlyPy = [...py].filter((r) => !ps.has(r)), onlyPs = [...ps].filter((r) => !py.has(r));
check(py.size > 5 && !onlyPy.length && !onlyPs.length, `server.py and server.ps1 serve the same API (${[...py].sort().join(' ')})` +
  (onlyPy.length || onlyPs.length ? ` — only in server.py: ${onlyPy.join(' ') || '-'}; only in server.ps1: ${onlyPs.join(' ') || '-'}` : ''));
const pageFiles = fs.readdirSync(path.join(A, 'web', 'js')).filter((f) => f.endsWith('.js') && f !== 'icons.js').map((f) => path.join(A, 'web', 'js', f));
pageFiles.push(path.join(A, 'web', 'index.html'));
const called = new Set();
for (const f of pageFiles) for (const m of read(f).matchAll(/['"`/]api\/([a-z-]+)/g)) called.add('/api/' + m[1]);
const unknown = [...called].filter((r) => !py.has(r));
check(called.size > 0 && !unknown.length, 'every API path the page calls is served' + (unknown.length ? `: missing ${unknown.join(' ')}` : ''));
// what the page may write (POST) is the same set on both servers
const pyPost = new Set((/target = \{([\s\S]*?)\}\.get\(/.exec(read(A, 'web', 'server.py')) || [, ''])[1].match(/'\/api\/[a-z-]+'/g) || []);
const psText = read(A, 'web', 'server.ps1');
const psPost = new Set([...(/\$writable = @\{([^}]*)\}/.exec(psText) || [, ''])[1].match(/'\/api\/[a-z-]+'/g) || [],
  ...[...(/\$files = @\{([\s\S]*?)\}\s*\n/.exec(psText) || [, ''])[1].matchAll(/'\/api\/[a-z-]+'/g)].map((m) => m[0]).filter((r) => r !== "'/api/cards'")]);
check(pyPost.size > 0 && pyPost.size === psPost.size && [...pyPost].every((r) => psPost.has(r)), `both servers let the page write the same files (${[...pyPost].join(' ')})`);

// 6. Sync backend: every function the page calls is created by a migration, and a migration that is
// on main is never edited (the live database already ran it): changes go in a new file.
const mig = path.join(ROOT, 'supabase', 'migrations');
const sql = fs.readdirSync(mig).filter((f) => f.endsWith('.sql')).sort().map((f) => read(mig, f)).join('\n');
const defined = new Set([...sql.matchAll(/function\s+(?:public\.)?(cc_[a-z_]+)\s*\(/gi)].map((m) => m[1].toLowerCase()));
const rpcs = new Set([...read(A, 'web', 'js', 'sync.js').matchAll(/rpc\(\s*'(cc_[a-z_]+)'/g)].map((m) => m[1]));
const undef = [...rpcs].filter((r) => !defined.has(r));
check(rpcs.size > 0 && !undef.length, `every backend call in js/sync.js exists in supabase/migrations (${[...rpcs].join(' ')})` + (undef.length ? `: missing ${undef.join(' ')}` : ''));
check(fs.readdirSync(mig).every((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f)), 'migration files are named <14-digit time>_<name>.sql (they run in name order)');
const base = process.argv[2];
if (base) {
  let changed = '';
  try { changed = execFileSync('git', ['diff', '--name-status', `${base}...HEAD`, '--', 'supabase/migrations'], { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { check(false, `git diff against ${base}: ${e.message.split('\n')[0]}`); }
  const edited = changed.split('\n').filter((l) => l.trim() && !l.startsWith('A'));
  check(!edited.length, `no migration already on ${base} is edited or removed` + (edited.length ? `: ${edited.join(', ')}` : ''));
}

// 7. The build ships what the page loads: every script and stylesheet index.html names exists.
const html = read(A, 'web', 'index.html');
const assets = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]).filter((p) => !p.startsWith('http'));
const gone = assets.filter((p) => !fs.existsSync(path.join(A, 'web', p)));
check(assets.length > 3 && !gone.length, 'every file index.html loads exists' + (gone.length ? `: missing ${gone.join(' ')}` : ''));

// 8. Claude's interface (CLAUDE.md, INTERFACES.md #6): the card fields SCHEMA.md documents are the ones
// tools/check-cards.py accepts, and the function CLAUDE.md tells Claude to call exists in a migration.
const schemaMd = read(A, 'companion-data', 'SCHEMA.md');
const cardTable = (/### cards\.json, schema 1([\s\S]*?)\n### /.exec(schemaMd) || [, ''])[1];
const docFields = new Set([...cardTable.matchAll(/^\| `([a-z]+)(?:\[\])?`(?:, `([a-z]+)`)?/gm)].flatMap((m) => [m[1], m[2]]).filter(Boolean));
const checker = read(ROOT, 'tools', 'check-cards.py');
const keyFields = new Set(((/KEYS = \{([\s\S]*?)\}/.exec(checker) || [, ''])[1].match(/'([a-z]+)'/g) || []).map((k) => k.slice(1, -1)));
const diff = [...docFields].filter((k) => !keyFields.has(k)).concat([...keyFields].filter((k) => !docFields.has(k)));
check(docFields.size > 5 && !diff.length, `card fields agree in SCHEMA.md and tools/check-cards.py` + (diff.length ? `: ${diff.join(' ')}` : ''));
const guide = read(ROOT, 'CLAUDE.md');
const fns = new Set([...guide.matchAll(/private\.([a-z_]+)\(/g)].map((m) => m[1]));
const missingFn = [...fns].filter((f) => !new RegExp(`function\\s+private\\.${f}\\s*\\(`, 'i').test(sql));
check(fns.has('claude_put_setting') && !missingFn.length, `every private.* function CLAUDE.md names exists in a migration (${[...fns].join(' ')})` + (missingFn.length ? `: missing ${missingFn.join(' ')}` : ''));

console.log(failed ? `${failed} contract check(s) failed` : 'contract holds');
process.exit(failed ? 1 : 0);
