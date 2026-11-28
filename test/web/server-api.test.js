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
  // an account with weeks of AH scans: 250,000 records, 81 MB (27 Nov: the 20 MB limit refused it, "did not save api/sync-cache")
  const big = { account: 'a', after: 1, recs: {}, names: {} };
  const pad = 'é'.repeat(100);
  for (let i = 0; i < 160000; i++) big.recs['id' + i] = { dev: 'x', char: 'W-A', kind: 'ah_obs', t: i, data: { item: i, name: pad, min: i } };
  const bigText = JSON.stringify(big);
  check(Buffer.byteLength(bigText) > 40 * 1024 * 1024, `the big cache is over 40 MB (${Math.round(Buffer.byteLength(bigText) / 1048576)} MB)`);
  check((await post('api/sync-cache', bigText)).ok, 'the page saves a sync cache over 20 MB');
  check((await (await get('api/sync-cache')).text()) === bigText, 'and reads it back byte for byte');
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

  // no Claude runs on this computer any more (the coach writes the cards online): the old addresses are gone
  check((await get('api/claude')).status === 404 && (await post('api/claude', '{"action":"on"}')).status === 400 &&
    (await post('api/claude-cards', '{"schema":1,"cards":[]}')).status === 400, 'api/claude and api/claude-cards are gone');
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
