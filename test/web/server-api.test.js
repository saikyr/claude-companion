// node test/web/server-api.test.js <port> <companion-data folder>
// The local server's HTTP API, the same for server.py (macOS) and server.ps1 (Windows; CI runs it on
// a Windows runner with Windows PowerShell 5.1): what the page needs from it to show the save, write
// snapshot.json and sync (the device key, its state and cache files kept byte for byte).
const fs = require('fs'), path = require('path');
const [port, dataDir] = process.argv.slice(2);
const base = `http://localhost:${port}/`;
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };
const get = (u) => fetch(base + u, { cache: 'no-store' });
const post = (u, body, h) => fetch(base + u, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'X-CC': '1' }, h || {}), body });

(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await (await get('api/ping')).text()) === 'claude-companion') break; } catch (e) { /* starting */ } await new Promise((ok) => setTimeout(ok, 1000)); }
  check((await (await get('api/ping')).text()) === 'claude-companion', 'the server answers');
  const st = await (await get('api/stamp')).json();
  check(typeof st.stamp === 'string' && st.size > 0 && st.host && st.os, `stamp: the save, its size and this computer (${st.os} ${st.host})`);
  check(st.game === true || st.game === false || st.game === null, `stamp says whether the game runs (${st.game})`);
  const data = await (await get('api/data')).text();
  check(data.includes('ClaudeCompanionDB'), 'data: the save itself');

  const k1 = await (await get('api/sync')).json(), k2 = await (await get('api/sync')).json();
  check(/^[0-9a-f]{64}$/.test(k1.key || ''), 'the server makes this computer\'s sync key (256 bits, hex)');
  check(k1.key === k2.key, 'and keeps it');
  check(JSON.parse(fs.readFileSync(path.join(dataDir, 'sync.json'), 'utf8')).key === k1.key, 'in companion-data/sync.json');
  // the page's sync state, deeply nested, kept exactly
  const state = { key: k1.key, account: 'a', device: 'd', sent: { 'W-A|journal': 1795000000 }, live: { 'snapshot|d': 'h1' },
    settings: { 'cc.weights.v1': '{"a":{"b":{"c":{"d":[1,2,{"e":"é ✓"}]}}}}' }, settingsT: {}, pendingSince: {}, pulledOnce: true };
  check((await post('api/sync', JSON.stringify(state))).ok, 'the page saves its sync state');
  check(JSON.stringify(await (await get('api/sync')).json()) === JSON.stringify(state), 'and reads it back unchanged (nesting, accents)');
  const cache = { account: 'a', after: 99, recs: {}, names: {} };
  for (let i = 0; i < 5000; i++) cache.recs['id' + i] = { dev: 'x', char: 'W-A', kind: 'ah_obs', t: i, data: { id: i, obs: { t: i, min: i * 3, deep: { a: { b: [i] } } } } };
  const cacheText = JSON.stringify(cache);
  check((await post('api/sync-cache', cacheText)).ok, `the page saves the other computers' history (${Math.round(cacheText.length / 1024)} KB)`);
  check((await (await get('api/sync-cache')).text()) === cacheText, 'and reads it back byte for byte');
  check((await post('api/snapshot', JSON.stringify({ schema: 1, by: 'test' }))).ok && JSON.parse(fs.readFileSync(path.join(dataDir, 'snapshot.json'), 'utf8')).by === 'test', 'the page writes snapshot.json');
  check((await post('api/sync', '{}', { 'X-CC': '' })).status === 400, 'a write without the app\'s header is refused');
  // DNS rebinding: a web page that points its own domain at 127.0.0.1 sends that domain as Host
  const foreign = await new Promise((ok) => require('http').get({ host: '127.0.0.1', port, path: '/api/sync', headers: { Host: 'evil.example:' + port } },
    (r) => { r.resume(); ok(r.statusCode); }).on('error', () => ok('error')));
  check(foreign === 400 || foreign === 'error', `a request for another host name is refused (${foreign})`);
  check(JSON.parse(fs.readFileSync(path.join(dataDir, 'sync.json'), 'utf8')).key === k1.key, 'so the key stays');
  // the game's combat log (js/combatlog.js): listed newest first, read from a byte, only from Logs/
  const logs = path.join(dataDir, '..', '..', '..', '..', 'Logs');
  fs.mkdirSync(logs, { recursive: true });
  const older = path.join(logs, 'WoWCombatLog-112126_101010.txt'), newer = path.join(logs, 'WoWCombatLog-112226_231212.txt');
  fs.writeFileSync(older, 'old\n'); fs.utimesSync(older, new Date(Date.now() - 86400000), new Date(Date.now() - 86400000));
  const text = '11/22/2026 23:12:12.0000  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,0,BUILD_VERSION,1.15.8,PROJECT_ID,2\n' + 'x'.repeat(5 * 1024 * 1024) + '\nend\n';
  fs.writeFileSync(newer, text);
  fs.writeFileSync(path.join(logs, 'secret.txt'), 'not a log');
  const list = await (await get('api/combatlog')).json();
  check(list.files && list.files.length === 2 && list.files[0].name === path.basename(newer) && list.files[0].size === Buffer.byteLength(text) && list.files[0].mtime > 0,
    'combatlog lists the game\'s logs, newest first, with sizes (other files left out)');
  const head = Buffer.from(await (await get('api/combatlog?file=' + encodeURIComponent(path.basename(newer)) + '&from=0')).arrayBuffer());
  check(head.length === 4 * 1024 * 1024 && head.toString('utf8', 0, 80).includes('COMBAT_LOG_VERSION'), `combatlog reads 4 MB at a time from the start (${head.length})`);
  const tail = Buffer.from(await (await get('api/combatlog?file=' + encodeURIComponent(path.basename(newer)) + '&from=' + (Buffer.byteLength(text) - 4))).arrayBuffer());
  check(tail.toString() === 'end\n', 'and from any byte to the end');
  const past = await get('api/combatlog?file=' + encodeURIComponent(path.basename(newer)) + '&from=' + (Buffer.byteLength(text) + 10));
  check(past.ok && (await past.arrayBuffer()).byteLength === 0, 'past the end: nothing');
  for (const bad of ['secret.txt', '..%2F..%2FWTF%2Fx.txt', 'WoWCombatLog%2F..%2F..%2Fx.txt']) {
    const r = await get('api/combatlog?file=' + bad + '&from=0');
    check(r.status === 404, `combatlog refuses ${decodeURIComponent(bad)} (${r.status})`);
  }
  check((await get('api/combatlog?file=' + encodeURIComponent(path.basename(newer)) + '&from=abc')).status === 400, 'combatlog refuses a bad offset');
  const combat = JSON.stringify({ v: 1, files: { a: 10 }, npcs: { 'Son of Arkkoroc': { kills: 3 } } });
  check((await post('api/combat', combat)).ok && (await (await get('api/combat')).text()) === combat, 'the page saves its combat-log counts and reads them back');
  const up = await (await get('api/update')).json();
  check(up && 'installed' in up && 'available' in up, 'update status answers');

  // Claude updates the cards after a save (#169), with test/fixtures/fake-claude.js as Claude Code (CC_CLAUDE)
  const run = path.join(dataDir, 'claude-run'), fromClaude = path.join(dataDir, 'from-claude');
  const cstat = async (q) => (await get('api/claude' + (q || ''))).json();
  const cpost = async (o) => post('api/claude', JSON.stringify(o));
  const until = async (ok, secs) => { for (let i = 0; i < (secs || 40); i++) { const st = await cstat(); if (ok(st)) return st; await new Promise((r) => setTimeout(r, 1000)); } return cstat(); };
  let cs = await cstat('?check=1');
  check(cs.on === false && cs.claude === true && cs.signedIn === true && cs.running === false && cs.cap > 0, `api/claude: off, Claude Code found and signed in (${JSON.stringify(cs)})`);
  check((await cpost({ action: 'nonsense' })).status === 400 && (await post('api/claude', '{"action":"on"}', { 'X-CC': '' })).status === 400, 'an unknown action, or a post without the app\'s header, is refused');
  cs = await (await cpost({ action: 'on' })).json();
  check(cs.on === true, 'turned on');
  const now = { schema: 1, cards: [{ id: 'plan-1', title: 'Plan', status: 'open', updated: '2026-11-20T10:00:00Z', steps: ['a', 'b'] }, { id: 'other', title: 'Other', created: '2026-11-19T10:00:00Z' }] };
  check((await post('api/claude-cards', JSON.stringify(now))).ok && JSON.parse(fs.readFileSync(path.join(run, 'cards-now.json'), 'utf8')).cards.length === 2, 'the page writes every card it has for the run (claude-run/cards-now.json)');
  const digest = (t) => ({ t, name: 'Ana', level: 60, quests: [1, 2], items: { 14047: 3 }, rep: {}, cards: {} });
  cs = await (await cpost({ action: 'save', name: 'Ana', digest: digest(1000), wake: null, worth: false })).json();
  check(cs.digests && cs.digests.Ana && cs.digests.Ana.t === 1000 && !cs.queued && !cs.running, "a save not worth a run: only its digest is kept, for the next save's change");
  cs = await (await cpost({ action: 'save', name: 'Ana', digest: digest(900), wake: { character: 'Ana', level: { from: 59, to: 60 } }, worth: true })).json();
  check(cs.digests.Ana.t === 1000 && !cs.queued && !cs.running, 'an older save (another window already told this one): nothing');
  const wake = { since: '2026-11-27T00:00:00.000Z', at: '2026-11-27T00:10:00.000Z', character: 'Ana', questsDone: [{ id: 5102, title: 'General Drakkisath' }] };
  await cpost({ action: 'save', name: 'Ana', digest: digest(2000), wake, worth: true });
  cs = await until((st) => st.last && st.last.wrote && !st.running);
  const fake = JSON.parse(fs.readFileSync(path.join(run, 'fake-args.json'), 'utf8'));
  const written = JSON.parse(fs.readFileSync(path.join(fromClaude, 'cards.json'), 'utf8'));
  check(cs.last.ok && cs.last.why === 'save' && cs.last.cards === 2 && cs.runs === 1 && !fs.existsSync(path.join(fromClaude, 'cards.draft.json')),
    `a save worth it starts one run, and its draft becomes cards.json (${JSON.stringify(cs.last)})`);
  check(written.cards[0].title === 'Plan (updated, save)' && written.cards[1].id === 'other', 'with what Claude wrote');
  check(fake.job.why === 'save' && JSON.stringify(fake.job.wake) === JSON.stringify(wake) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(fake.job.now), 'run.json says why, what the save changed, and now');
  const a = fake.args, has = (...xs) => xs.every((x) => a.includes(x));
  check(a[0] === '-p' && /claude\/REFRESH\.md/.test(a[1]) && has('--restricted', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--output-format', 'json') &&
    a[a.indexOf('--tools') + 1] === 'Read,Glob,Grep,Write,Edit' && has('Read(./**)', 'Edit(./companion-data/from-claude/cards.draft.json)') && !a.some((x) => /Bash|PowerShell|WebFetch/.test(x)) &&
    !a.some((x) => ['Read', 'Glob', 'Grep', 'Edit', 'Write'].includes(x)),
    `Claude Code runs with REFRESH.md, no commands, no web, reading only the addon folder and writing only the draft (${a.join(' ')})`);
  check(path.resolve(fake.cwd) === path.resolve(dataDir, '..'), `in the addon folder (${fake.cwd})`);
  check(fake.env.ANTHROPIC_API_KEY === null && fake.env.ANTHROPIC_AUTH_TOKEN === null, 'with no API key in its environment: it runs on the player\'s own Claude plan');
  // the gate refused the new file (the page saves that in state.json upload): the same session fixes it
  check(cs.checking === true, 'then it waits for the card check');
  const refusal = 'cards refused (1 problem): plan-1 [fact] "Dark Rune": 1.41 does not match ah:20520';
  await post('api/cards-state', JSON.stringify({ schema: 1, cards: {}, upload: { at: new Date().toISOString(), ok: false, refused: true, error: refusal } }));
  cs = await until((st) => st.last && st.last.why === 'refused' && !st.running);
  const fix = JSON.parse(fs.readFileSync(path.join(run, 'fake-args.json'), 'utf8'));
  check(fix.args[fix.args.indexOf('--resume') + 1] === 'fake-session' && fix.job.why === 'refused' && fix.job.refusal === refusal && fix.job.fix === 1,
    `a refusal goes back to the same Claude session with what the check said (${fix.args.join(' ')})`);
  check(JSON.parse(fs.readFileSync(path.join(fromClaude, 'cards.json'), 'utf8')).cards[0].title === 'Plan (updated, refused)', 'and its fixed list becomes cards.json');
  await post('api/cards-state', JSON.stringify({ schema: 1, cards: {}, upload: { at: new Date().toISOString(), ok: true, refused: false, cards: 2 } }));
  cs = await until((st) => st.last && st.last.gate === 'ok' && !st.checking);
  check(cs.last.gate === 'ok' && !cs.queued, `the check passed: done, no more runs (${JSON.stringify(cs.last)})`);
  // asked from the System tab; and off: a save starts nothing
  await cpost({ action: 'run' });
  cs = await until((st) => st.last && st.last.why === 'asked' && !st.running);
  check(cs.last.why === 'asked' && cs.runs === 3, `Update now starts a run (${cs.runs} today)`);
  // cards-now.json was written before the last two runs: each starts from the cards the run before wrote
  const given = JSON.parse(fs.readFileSync(path.join(run, 'cards-now.json'), 'utf8'));
  check(given.cards[0].title === 'Plan (updated, refused)' && given.cards.length === 2, `a run starts from the newer cards.json, card by card (${given.cards[0].title})`);
  await post('api/cards-state', JSON.stringify({ schema: 1, cards: {}, upload: { at: new Date().toISOString(), ok: true, refused: false, cards: 2 } }));
  await until((st) => !st.checking);
  // a draft that leaves a card out is not used: that card would go from every computer
  const before = fs.readFileSync(path.join(fromClaude, 'cards.json'), 'utf8');
  await post('api/claude-cards', JSON.stringify({ schema: 1, cards: [...now.cards, { id: 'drop', title: 'Keep me', created: '2026-11-19T10:00:00Z' }] }));
  await cpost({ action: 'run' });
  cs = await until((st) => st.runs === 4 && st.last && st.last.why === 'asked' && !st.running);
  check(!cs.last.ok && /left out 1 card/.test(cs.last.error || '') && !cs.last.wrote && fs.readFileSync(path.join(fromClaude, 'cards.json'), 'utf8') === before &&
    fs.existsSync(path.join(fromClaude, 'cards.draft.bad.json')), `a draft missing a card: refused, cards.json kept (${cs.last.error})`);
  await cpost({ action: 'off' });
  cs = await (await cpost({ action: 'save', name: 'Ana', digest: digest(3000), wake, worth: true })).json();
  check(cs.on === false && !cs.queued && !cs.running && cs.runs === 4, 'turned off: a save starts nothing');
  // sync off: the cards can't be checked, so no run
  const syncState = fs.readFileSync(path.join(dataDir, 'sync.json'), 'utf8');
  await post('api/sync', JSON.stringify(Object.assign(JSON.parse(syncState), { off: true })));
  await cpost({ action: 'on' }); await cpost({ action: 'run' });
  cs = await until((st) => st.last && /sync is off/.test(st.last.error || ''), 15);
  check(/sync is off/.test(cs.last.error || '') && cs.runs === 4, `sync off: no run, and the System tab says why (${cs.last.error})`);
  await post('api/sync', syncState);
  await cpost({ action: 'off' });
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
